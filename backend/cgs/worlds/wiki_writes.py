from collections import defaultdict
from itertools import chain

from django.db import transaction
from django.db.models import Q

from cgs.api import CgsError, resource_unavailable

from .drafts import _scoped_read
from .models import (
    MutationReceipt, WikiAssertion, WikiCausalAccount, WikiCausalTerm, WikiClaim, WikiDiscovery, WikiEntry, WikiEvent, WikiEventLink, WikiEventReport,
    WikiFinding, WikiLearnedAbility, WikiMapImage, WikiObservation, WikiProposition, WikiWorld, World,
)
from .services import digest_json
from .wiki import (
    at_tick, check_hierarchies, check_interval, contains_tick, date_window_bounds, entry_for, reject, typed_assertion,
    typed_value, unit_at, value_slot, wiki_access,
)
from .wiki_events import (
    attach_event, check_event_tree, event_bounds, organize_event, update_event_causes, update_event_references,
)
from .wiki_layouts import save_connection, save_layout, save_waypoint
from .wiki_maps import attach_map_image, remove_map_pin, save_map_pin
from .wiki_relationships import RELATIONSHIP_FINDING_CODES, refresh_relationship_findings
from .wiki_schema import (
    ACTORS, DATE_WINDOW_FIELDS, ENTITY_KINDS, EVENT_PERFORMERS, EXACT_DATE_FIELDS, FIELDS, LIFESPAN_START_FIELDS,
)


def _in_world(query, record_id):
    record = query.filter(pk=record_id).first()
    if record is None:
        reject("INVALID_RECORD", "Choose a record in this world.")
    return record


def _field_of(record):
    return record.entry_id, record.field


def _value_arguments(entry, data, tick):
    return typed_assertion(entry, data["field"], data["value"], data.get("qualifier_id"), tick=tick)


def _citation(wiki, citation_id):
    return entry_for(wiki, citation_id, WikiEntry.Kind.SOURCE) if citation_id else None


def _slot_query(fact):
    timeline = WikiAssertion.objects.filter(entry_id=fact.entry_id, field=fact.field, qualifier_id=fact.qualifier_id)
    return timeline.filter(value=fact.value) if FIELDS[fact.field].many else timeline


def _named(value):
    name = value.strip()
    if not name:
        reject("MISSING_NAME", "Enter a name.")
    return name


def _variant_origin(wiki, kind, target_id, entry_id=None):
    if kind not in ACTORS:
        reject("INVALID_VARIANT", "Only a character or organism can have a variant relationship.")
    if target_id is None:
        return None
    target = entry_for(wiki, target_id)
    if target.kind not in ACTORS:
        reject("INVALID_VARIANT", "Select a character or organism as the source identity.")
    if entry_id is not None:
        parents = dict(WikiEntry.objects.filter(wiki=wiki, variant_of__isnull=False)
                       .values_list("pk", "variant_of_id"))
        seen = {entry_id}
        ancestor = target.pk
        while ancestor is not None:
            if ancestor in seen:
                reject("RELATIONSHIP_CYCLE", "A character cannot be a variant of itself or of one of its variants.")
            seen.add(ancestor)
            ancestor = parents.get(ancestor)
    return target


def _create_entry(wiki, command):
    origin_id = command.get("variant_of_id")
    entry = WikiEntry.objects.create(
        wiki=wiki, kind=command["kind"], name=_named(command["name"]), author_only=command["author_only"],
        overview=command.get("overview", ""), catalog_type=command.get("catalog_type", ""),
        variant_of=_variant_origin(wiki, command["kind"], origin_id) if origin_id else None,
    )
    tick = command.get("initial_at", 0)
    values = {}
    for fact in command.get("initial_values", ()):
        assertion = WikiAssertion(
            **_value_arguments(entry, fact, tick),
            from_tick=tick, author_only=fact["author_only"],
        )
        slot = (assertion.field, *value_slot(assertion.field, assertion.qualifier_id, assertion.value))
        if slot in values:
            reject("DUPLICATE_FACT", "Set each initial value once.")
        values[slot] = assertion
    WikiAssertion.objects.bulk_create(values.values())
    return entry.pk, {_field_of(assertion) for assertion in values.values()}


def _rename_entry(wiki, command):
    entry = entry_for(wiki, command["entry_id"])
    entry.name = _named(command["name"])
    entry.save(update_fields=["name"])
    return entry.pk, set()


def _set_variant_origin(wiki, command):
    entry = entry_for(wiki, command["entry_id"])
    entry.variant_of = _variant_origin(wiki, entry.kind, command["variant_of_id"], entry.pk)
    entry.save(update_fields=["variant_of"])
    return entry.pk, set()


def _save_map_image(wiki, command, account_id):
    if command["op"] == "create_image_map":
        entry = WikiEntry.objects.create(
            wiki=wiki, kind=WikiEntry.Kind.MAP, name=_named(command["name"]), author_only=command["author_only"],
        )
    else:
        entry = entry_for(wiki, command["map_id"], WikiEntry.Kind.MAP)
    attach_map_image(entry, account_id, command["upload_id"])
    return entry.pk, set()


def _update_overview(wiki, command):
    entry = entry_for(wiki, command["entry_id"])
    entry.overview = command["overview"]
    entry.save(update_fields=["overview"])
    return entry.pk, set()


def _update_world_introduction(wiki, command):
    wiki.introduction = command["introduction"]
    wiki.save(update_fields=["introduction"])
    return wiki.pk, set()


def _update_world_home(wiki, command):
    cover_id = command["cover_map_id"]
    if cover_id and not WikiMapImage.objects.filter(wiki=wiki, entry_id=cover_id, entry__author_only=False).exists():
        reject("INVALID_HOME_COVER", "Choose an uploaded, nonprivate map from this world.")
    featured_ids = command["featured_entry_ids"]
    if WikiEntry.objects.filter(wiki=wiki, pk__in=featured_ids, author_only=False).count() != len(featured_ids):
        reject("INVALID_HOME_ARTICLES", "Choose articles from this world that are visible outside author-only editing.")
    wiki.introduction = command["introduction"]
    wiki.cover_map_id = cover_id
    wiki.featured_entry_ids = featured_ids
    wiki.save(update_fields=["introduction", "cover_map", "featured_entry_ids"])
    return wiki.pk, set()


def _set_discovery(wiki, command):
    observer = _actor_for(wiki, command["observer_id"])
    subject = entry_for(wiki, command["entry_id"])
    learned_at = command["learned_at"]
    discoveries = WikiDiscovery.objects.filter(observer=observer, subject=subject)
    if learned_at is None:
        discoveries.delete()
        return subject.pk, set()
    if subject.author_only or subject.pk == observer.pk:
        reject("INVALID_DISCOVERY", "Choose a nonprivate subject other than the observer.")
    discovery, _ = WikiDiscovery.objects.update_or_create(
        observer=observer, subject=subject, defaults={"learned_at": learned_at, "source": command["source"]},
    )
    return discovery.pk, set()


def _update_article_sections(wiki, command):
    entry = entry_for(wiki, command["entry_id"])
    entry.article_sections = command["sections"]
    entry.save(update_fields=["article_sections"])
    return entry.pk, set()


def _record_fact(wiki, command):
    entry = entry_for(wiki, command["entry_id"])
    start, end = command["from_tick"], command["until_tick"]
    check_interval(start, end)
    fact = WikiAssertion.objects.create(
        **_value_arguments(entry, command, start),
        from_tick=start, until_tick=end, author_only=command["author_only"], source=command["source"],
        citation=_citation(wiki, command.get("citation_id")),
    )
    return fact.pk, {_field_of(fact)}


def _correct_fact(wiki, command):
    fact = _in_world(WikiAssertion.objects.filter(entry__wiki=wiki).select_related("entry"), command["assertion_id"])
    fact.value = typed_value(fact.entry, fact.field, command["value"])
    fact.source = command.get("source", fact.source)
    if "citation_id" in command:
        fact.citation = _citation(wiki, command["citation_id"])
    fact.author_only = command.get("author_only", fact.author_only)
    if command.get("bind_unit"):
        fact.recorded_unit, fact.unit_source_id = unit_at(fact.field, fact.qualifier_id, fact.from_tick)
        if fact.recorded_unit is None:
            reject("UNIT_UNAVAILABLE", "Define one applicable unit on the measurement's Resource or Trait before rebinding it.")
    fact.save(update_fields=["value", "source", "citation", "author_only", "recorded_unit", "unit_source"])
    return fact.pk, {_field_of(fact)}


def _apply_transition(fact, event, mode):
    tick = event.tick
    timeline = _slot_query(fact)
    current = list(at_tick(timeline, tick).order_by("from_tick", "id")[:2])
    if len(current) > 1 or (current and current[0].from_tick == tick):
        reject("AMBIGUOUS_TRANSITION", f"Resolve the existing {FIELDS[fact.field].label.lower()} records at this time.")
    if not current and timeline.filter(until_tick=tick, closed_by__isnull=False).exists():
        reject("AMBIGUOUS_TRANSITION", f"Another event already ended this {FIELDS[fact.field].label.lower()} at this time.")
    if mode == "add" and current:
        reject("ALREADY_EFFECTIVE", "This value already applies at the event time.")
    if mode == "end" and (not current or current[0].value != fact.value):
        reject("MISSING_EFFECTIVE_VALUE", "Choose the value that applies at the event time.")
    next_value = timeline.filter(from_tick__gt=tick).order_by("from_tick", "id").first()
    end = current[0].until_tick if current else None
    closed_by_id = current[0].closed_by_id if current else None
    if next_value is not None and (end is None or next_value.from_tick < end):
        end, closed_by_id = next_value.from_tick, next_value.opened_by_id
    if current:
        previous = current[0]
        previous.until_tick = tick
        previous.closed_by = event
        previous.save(update_fields=["until_tick", "closed_by"])
    if mode != "end":
        fact.from_tick, fact.until_tick = tick, end
        fact.opened_by, fact.closed_by_id = event, closed_by_id
        fact.save()


EVENT_LINKS = (
    ("participant_ids", WikiEventLink.Role.PARTICIPANT, (*ACTORS, WikiEntry.Kind.GROUP)),
    ("performer_ids", WikiEventLink.Role.PERFORMER, EVENT_PERFORMERS),
    ("target_ids", WikiEventLink.Role.TARGET, ENTITY_KINDS),
    ("place_ids", WikiEventLink.Role.PLACE, (WikiEntry.Kind.PLACE,)),
    ("item_ids", WikiEventLink.Role.ITEM, (WikiEntry.Kind.ITEM,)),
    ("purpose_ids", WikiEventLink.Role.PURPOSE, (WikiEntry.Kind.GOAL,)),
    ("fulfillment_ids", WikiEventLink.Role.FULFILLMENT, (WikiEntry.Kind.REQUIREMENT, WikiEntry.Kind.METHOD_STEP)),
    ("behavior_ids", WikiEventLink.Role.BEHAVIOR, (WikiEntry.Kind.BEHAVIOR,)),
    ("backstory_ids", WikiEventLink.Role.BACKSTORY, ENTITY_KINDS),
    ("era_ids", WikiEventLink.Role.ERA, (WikiEntry.Kind.ERA,)),
)


def _save_event_details(wiki, event, command):
    event.name = _named(command["name"])
    event.source = command.get("source", event.source)
    if "citation_id" in command:
        event.citation = _citation(wiki, command["citation_id"])
    event.description = command.get("description", event.description)
    event.summary = command.get("summary", event.summary)
    event.method = command.get("method", event.method)
    event.start_tick = command.get("start_tick", event.start_tick)
    event.end_tick = command.get("end_tick", event.end_tick)
    event_bounds(event)
    if event.node_kind == WikiEvent.Kind.GROUP and (command.get("performer_ids") or command.get("target_ids")):
        reject("GROUP_EFFECT", "Record performers and targets on an action or occurrence within the group.")
    if "ability_use" in command:
        use = command["ability_use"]
        if use and event.node_kind == WikiEvent.Kind.GROUP:
            reject("GROUP_EFFECT", "Record ability use on an action or occurrence within the group.")
        event.ability = entry_for(wiki, use["ability_id"], WikiEntry.Kind.ABILITY) if use else None
        event.performed_by = _actor_for(wiki, use["actor_id"]) if use else None
    event.save()
    check_event_tree(event)
    if "cross_reference_ids" in command:
        update_event_references(event, command["cross_reference_ids"])
    if "cause_event_ids" in command:
        update_event_causes(event, command["cause_event_ids"])
    if "cause_assertion_ids" in command:
        ids = set(command["cause_assertion_ids"])
        causes = list(WikiAssertion.objects.filter(entry__wiki=wiki, pk__in=ids).exclude(opened_by=event))
        if len(causes) != len(ids):
            reject("INVALID_STATE_CAUSE", "Choose facts in this world that were established independently of this event.")
        event.cause_assertions.set(causes)
    for field, role, kinds in EVENT_LINKS:
        if field not in command:
            continue
        entries = []
        for entry_id in dict.fromkeys(command[field]):
            entry = entry_for(wiki, entry_id)
            if entry.kind not in kinds:
                reject("INVALID_EVENT_LINK", f"Choose a valid {role.label.lower()} for this event.")
            entries.append(WikiEventLink(event=event, entry=entry, role=role))
        event.links.filter(role=role).delete()
        WikiEventLink.objects.bulk_create(entries)


def _record_event(wiki, command):
    precision = command.get("date_precision", WikiEvent.Precision.EXACT)
    if precision != WikiEvent.Precision.EXACT and command.get("changes"):
        reject("EFFECT_TIME_REQUIRED", "Give this event an exact effective time before adding state changes.")
    event = WikiEvent(
        wiki=wiki, tick=command["tick"], node_kind=command.get("node_kind", WikiEvent.Kind.OCCURRENCE),
        date_precision=precision,
    )
    attach_event(event, command.get("parent_id"))
    _save_event_details(wiki, event, command)
    affected = set()
    slots = set()
    for change in command.get("changes", ()):
        entry = entry_for(wiki, change["entry_id"])
        fact = WikiAssertion(
            **_value_arguments(entry, change, event.tick), author_only=change["author_only"], source=change.get("source", ""),
        )
        slot = (entry.pk, fact.field, *value_slot(fact.field, fact.qualifier_id, fact.value))
        if slot in slots:
            reject("DUPLICATE_CHANGE", "An event can change each effective value once.")
        slots.add(slot)
        mode = change.get("mode", "add" if FIELDS[fact.field].many else "set")
        _apply_transition(fact, event, mode)
        affected.add(_field_of(fact))
    return event.pk, affected


def _record_event_group(wiki, command):
    event = WikiEvent(wiki=wiki, node_kind=WikiEvent.Kind.GROUP)
    attach_event(event, command.get("parent_id"))
    _save_event_details(wiki, event, command)
    return event.pk, set()


def _edit_event(wiki, command):
    event = _in_world(WikiEvent.objects.filter(wiki=wiki), command["event_id"])
    if "date_precision" in command or "tick" in command:
        precision, tick = command.get("date_precision", event.date_precision), command.get("tick", event.tick)
        if event.node_kind == WikiEvent.Kind.GROUP:
            reject("GROUP_DATE", "Edit the group range in its start and end fields.")
        if (precision != event.date_precision or tick != event.tick) and (
            event.opened_assertions.exists() or event.closed_assertions.exists()
        ):
            reject("EFFECT_TIME_REQUIRED", "This event has state changes. Use Correct event date to move their effective time.")
        event.date_precision, event.tick = precision, tick
    _save_event_details(wiki, event, command)
    return event.pk, set()


def _correct_event_date(wiki, command):
    event = _in_world(WikiEvent.objects.filter(wiki=wiki), command["event_id"])
    tick = command["tick"]
    if event.node_kind == WikiEvent.Kind.GROUP:
        reject("GROUP_DATE", "Edit the group dates separately from its recorded actions.")
    if event.date_precision != WikiEvent.Precision.EXACT:
        reject("EVENT_DATE_NOT_EXACT", "Use Edit event details to change an approximate or unknown date.")
    records = list(
        WikiAssertion.objects.filter(entry__wiki=wiki).filter(Q(opened_by=event) | Q(closed_by=event))
    )
    if tick == event.tick:
        return event.pk, set()
    limits = sorted((tick, event.tick))
    affected = {_field_of(record) for record in records}
    ids = [record.pk for record in records]
    for record in records:
        unrelated = _slot_query(record).exclude(pk__in=ids)
        if unrelated.filter(Q(from_tick__range=limits) | Q(until_tick__range=limits)).exists():
            reject("INTERVENING_BOUNDARY", "Correct related timeline boundaries together before moving this event.")
    for record in records:
        if record.opened_by_id == event.pk:
            record.from_tick = tick
        if record.closed_by_id == event.pk:
            record.until_tick = tick
        if record.until_tick is not None and record.until_tick <= record.from_tick:
            reject("INTERVENING_BOUNDARY", "This date crosses another boundary on the timeline.")
    WikiAssertion.objects.bulk_update(records, ["from_tick", "until_tick"])
    offset = tick - event.tick
    if event.start_tick is not None:
        event.start_tick += offset
    if event.end_tick is not None:
        event.end_tick += offset
    event.tick = tick
    event_bounds(event)
    event.save(update_fields=["tick", "start_tick", "end_tick"])
    check_event_tree(event)
    return event.pk, affected


def _claim_dates(command, claim=None):
    dates = {
        key: command.get(key, getattr(claim, key, None))
        for key in ("tick", "start_tick", "end_tick")
    }
    precision = command.get("date_precision", claim.date_precision if claim else "exact")
    tick, start, end = dates["tick"], dates["start_tick"], dates["end_tick"]
    valid = (
        (precision == "exact" and tick is not None and start is None and end is None)
        or (precision == "bounded" and tick is None and start is not None and end is not None and start < end)
        or (precision == "unknown" and all(value is None for value in dates.values()))
    )
    if not valid:
        reject("CLAIM_DATE", "Enter an exact time, an ordered range, or choose Unknown and leave the dates blank.")
    return {"date_precision": precision, **dates}


def _save_claim_citations(wiki, claim, command):
    if "additional_citation_ids" in command:
        citations = [
            _citation(wiki, citation_id) for citation_id in dict.fromkeys(command["additional_citation_ids"])
            if citation_id != str(claim.citation_id)
        ]
        claim.additional_citations.set(citations)
    elif "citation_id" in command and claim.citation_id:
        claim.additional_citations.remove(claim.citation_id)


def _record_claim(wiki, command):
    entry = entry_for(wiki, command["entry_id"])
    speaker = _actor_for(wiki, command["speaker_id"]) if command.get("speaker_id") else None
    citation = _citation(wiki, command.get("citation_id"))
    if speaker is None and citation is None:
        reject("CLAIM_ATTRIBUTION_REQUIRED", "Choose a speaker or cite a source article for the claim.")
    dates = _claim_dates(command)
    claim = WikiClaim.objects.create(
        **_value_arguments(entry, command, dates["tick"]), **dates,
        speaker=speaker, citation=citation, source=command["source"], author_only=command["author_only"],
    )
    _save_claim_citations(wiki, claim, command)
    return claim.pk, set()


def _correct_claim(wiki, command):
    claim = _in_world(WikiClaim.objects.filter(entry__wiki=wiki).select_related("entry"), command["claim_id"])
    dates = _claim_dates(command, claim)
    claim.value = typed_value(claim.entry, claim.field, command["value"])
    claim.source = command.get("source", claim.source)
    claim.author_only = command.get("author_only", claim.author_only)
    if "citation_id" in command:
        claim.citation = _citation(wiki, command["citation_id"])
    if not claim.speaker_id and not claim.citation_id:
        reject("CLAIM_ATTRIBUTION_REQUIRED", "Keep a source article for this claim while its speaker is unknown.")
    if command.get("bind_unit"):
        claim.recorded_unit, claim.unit_source_id = unit_at(claim.field, claim.qualifier_id, dates["tick"])
        if claim.recorded_unit is None:
            reject("UNIT_UNAVAILABLE", "Choose an exact statement time with one applicable unit before rebinding it.")
    for name, value in dates.items():
        setattr(claim, name, value)
    claim.save(update_fields=["value", "source", "author_only", "citation", "recorded_unit", "unit_source", *dates])
    _save_claim_citations(wiki, claim, command)
    return claim.pk, {_field_of(claim)}


def _compatible_claim_time(claim, about, learned):
    if claim.tick is not None:
        return claim.tick <= learned and (about is None or about == claim.tick)
    if claim.start_tick is not None:
        return claim.start_tick <= learned and (about is None or claim.start_tick <= about <= claim.end_tick)
    return True


def _actor_for(wiki, entry_id):
    actor = entry_for(wiki, entry_id)
    if actor.kind not in ACTORS:
        reject("INVALID_ACTOR", "Choose a character or organism.")
    return actor


def _record_observation(wiki, command):
    observer = _actor_for(wiki, command["observer_id"])
    is_assertion = command["source_kind"] == "assertion"
    model = WikiAssertion if is_assertion else WikiClaim
    source = _in_world(model.objects.filter(entry__wiki=wiki).select_related("entry"), command["source_id"])
    definition = FIELDS[source.field]
    author_only = command.get("author_only", False)
    if not author_only:
        if (
            source.author_only or source.entry.author_only
            or (not is_assertion and source.speaker_id and source.speaker.author_only)
        ):
            reject("PRIVATE_EVIDENCE", "Mark this observation author only to use a protected record.")
        if source.qualifier_id and source.qualifier.author_only:
            reject("PRIVATE_EVIDENCE", "Mark this observation author only to use a protected qualifier.")
        if definition.target_kinds and entry_for(wiki, source.value).author_only:
            reject("PRIVATE_EVIDENCE", "Mark this observation author only to reference a protected entry.")
    about_tick = command.get("about_tick", source.from_tick if is_assertion else source.tick)
    learned = command["learned_at"]
    compatible = contains_tick(source, about_tick) if is_assertion else _compatible_claim_time(source, about_tick, learned)
    if not compatible or (about_tick is not None and learned < about_tick):
        reject("INVALID_LEARNING_TIME", "Choose an observation time consistent with the source and before learning.")
    observation = WikiObservation.objects.create(
        observer=observer, assertion=source if is_assertion else None, claim=source if not is_assertion else None,
        value=source.value, recorded_unit=source.recorded_unit, unit_source_id=source.unit_source_id,
        about_tick=about_tick, learned_at=learned, learning_note=command.get("learning_note", ""), author_only=author_only,
    )
    return observation.pk, set()


def _save_event_report(wiki, command):
    event = _in_world(WikiEvent.objects.filter(wiki=wiki), command["event_id"])
    observer = _actor_for(wiki, command["observer_id"])
    existing = command.get("report_id")
    report = _in_world(WikiEventReport.objects.filter(event=event), existing) if existing else WikiEventReport(event=event)
    reported, first, last = command["reported_tick"], command["earliest_tick"], command["latest_tick"]
    if ((first is None) != (last is None)) or (first is not None and (reported is not None or last < first)):
        reject("INVALID_REPORT_DATE", "Choose an exact date, two ordered dates, or an unknown date.")
    entries = [entry_for(wiki, entry_id) for entry_id in dict.fromkeys(command["known_entry_ids"])]
    if not command["author_only"] and any(entry.author_only for entry in entries):
        reject("PRIVATE_EVIDENCE", "Choose disclosed articles or withhold this report from character view.")

    report.observer = observer
    report.title = _named(command["title"])
    report.account, report.source = command["account"], command["source"]
    report.learned_at = command["learned_at"]
    report.reported_tick, report.earliest_tick, report.latest_tick = reported, first, last
    report.author_only = command["author_only"]
    report.save()
    report.known_entries.set(entries)
    return report.pk, set()


def _save_proposition(wiki, command):
    holder = entry_for(wiki, command["holder_id"])
    if holder.kind not in (*ACTORS, "goal", "milestone"):
        reject("INVALID_HOLDER", "Choose a character, organism, goal, or milestone.")
    existing = command.get("proposition_id")
    proposition = _in_world(WikiProposition.objects.filter(holder__wiki=wiki), existing) if existing else WikiProposition()
    if existing and proposition.holder_id != holder.pk and proposition.causal_uses.exists():
        reject("BELIEF_IN_CAUSAL_ACCOUNT", "Update the linked causal accounts before changing this belief’s holder.")
    subject = entry_for(wiki, command["entry_id"])
    start, end = command["from_tick"], command["until_tick"]
    about = command.get("about_tick")
    measure_at = start if about is None else about
    values = _value_arguments(subject, command, measure_at)
    check_interval(start, end)
    evidence = None
    if command.get("evidence_id"):
        evidence = _in_world(
            WikiObservation.objects.filter(observer=holder).select_related("assertion", "claim"),
            command["evidence_id"],
        )
        if evidence.learned_at > start:
            reject("INVALID_EVIDENCE_TIME", "Choose evidence learned by the start of this belief.")
    if "additional_evidence_ids" in command:
        additional_ids = set(command["additional_evidence_ids"])
    elif existing:
        additional_ids = {str(pk) for pk in proposition.additional_evidence.values_list("pk", flat=True)}
    else:
        additional_ids = set()
    additional_ids.discard(command.get("evidence_id"))
    additional = list(WikiObservation.objects.filter(observer=holder, pk__in=additional_ids))
    if len(additional) != len(additional_ids):
        reject("INVALID_RECORD", "Choose additional observations recorded for the holder of this belief.")
    if any(observation.learned_at > start for observation in additional):
        reject("INVALID_EVIDENCE_TIME", "Choose evidence learned by the start of this belief.")
    if "confidence" in command:
        if command["confidence"] is not None and holder.kind not in ACTORS:
            reject("INVALID_HOLDER", "Confidence belongs to a belief held by a character or organism.")
        proposition.confidence = command["confidence"]
    old_measure_at = proposition.from_tick if proposition.about_tick is None else proposition.about_tick
    qualifier_id = values["qualifier"].pk if values["qualifier"] else None
    measurement_slot = (subject.pk, values["field"], qualifier_id)
    previous_slot = (proposition.subject_id, proposition.field, proposition.qualifier_id)
    evidence_id = evidence.pk if evidence else None
    binding_changed = (previous_slot, old_measure_at, proposition.evidence_id) != (measurement_slot, measure_at, evidence_id)
    if not existing or binding_changed:
        proposition.recorded_unit = values["recorded_unit"]
        proposition.unit_source_id = values["unit_source_id"]
        if evidence and evidence.value == values["value"] and (about is None or about == evidence.about_tick):
            source = evidence.assertion or evidence.claim
            if (source.entry_id, source.field, source.qualifier_id) == measurement_slot:
                proposition.recorded_unit = evidence.recorded_unit
                proposition.unit_source_id = evidence.unit_source_id
    proposition.holder, proposition.subject = holder, subject
    proposition.field, proposition.value, proposition.qualifier = values["field"], values["value"], values["qualifier"]
    proposition.about_tick = about
    proposition.from_tick, proposition.until_tick = start, end
    proposition.evidence, proposition.source, proposition.author_only = evidence, command["source"], command["author_only"]
    proposition.save()
    proposition.additional_evidence.set(additional)
    return proposition.pk, set()


def _save_causal_account(wiki, command):
    holder = _actor_for(wiki, command["holder_id"])
    existing = command.get("account_id")
    account = _in_world(WikiCausalAccount.objects.filter(holder=holder), existing) if existing else WikiCausalAccount()
    start, end = command["from_tick"], command["until_tick"]
    check_interval(start, end)
    terms = command["terms"]
    keys = {(term["belief_id"], term["phase"]) for term in terms}
    if len(keys) != len(terms):
        reject("DUPLICATE_CAUSAL_TERM", "Use a belief at most once in each causal phase.")
    ids = {belief_id for belief_id, _ in keys}
    known = {str(pk) for pk in WikiProposition.objects.filter(holder=holder, pk__in=ids, from_tick__lte=start)
             .values_list("pk", flat=True)}
    if known != ids:
        reject("INVALID_CAUSAL_TERM", "Choose beliefs this actor had recorded by the start of the account.")

    account.holder = holder
    account.title = _named(command["title"])
    account.applicability = command["applicability"]
    account.citation = _citation(wiki, command.get("citation_id"))
    account.from_tick, account.until_tick = start, end
    account.author_only = command["author_only"]
    account.save()
    if existing:
        account.terms.all().delete()
    WikiCausalTerm.objects.bulk_create([
        WikiCausalTerm(account=account, belief_id=term["belief_id"], phase=term["phase"], position=position)
        for position, term in enumerate(terms)
    ])
    return account.pk, set()


def _set_calendar(wiki, command):
    wiki.days_per_year = command["days_per_year"]
    wiki.save(update_fields=["days_per_year"])
    return wiki.pk, set()


def _record_learned_ability(wiki, command):
    character = _actor_for(wiki, command["character_id"])
    ability = entry_for(wiki, command["ability_id"], WikiEntry.Kind.ABILITY)
    learned, created = WikiLearnedAbility.objects.get_or_create(
        character=character, ability=ability,
        defaults={"learned_at": command["learned_at"], "source": command["source"]},
    )
    if not created:
        reject("ABILITY_ALREADY_LEARNED", "This ability already has a learning record for the character.")
    return learned.pk, set()


def _correct_learned_ability(wiki, command):
    learned = _in_world(
        WikiLearnedAbility.objects.filter(character__wiki=wiki), command["learned_ability_id"],
    )
    learned.learned_at = command["learned_at"]
    learned.source = command.get("source", learned.source)
    learned.save(update_fields=["learned_at", "source"])
    return learned.pk, set()


OPERATIONS = {
    "create_entry": _create_entry,
    "rename_entry": _rename_entry,
    "set_variant_origin": _set_variant_origin,
    "update_overview": _update_overview,
    "update_world_introduction": _update_world_introduction,
    "update_world_home": _update_world_home,
    "set_discovery": _set_discovery,
    "update_article_sections": _update_article_sections,
    "record_fact": _record_fact,
    "correct_fact": _correct_fact,
    "record_event": _record_event,
    "record_event_group": _record_event_group,
    "edit_event": _edit_event,
    "organize_event": organize_event,
    "correct_event_date": _correct_event_date,
    "record_claim": _record_claim,
    "correct_claim": _correct_claim,
    "record_observation": _record_observation,
    "record_event_report": _save_event_report,
    "correct_event_report": _save_event_report,
    "record_proposition": _save_proposition,
    "correct_proposition": _save_proposition,
    "record_causal_account": _save_causal_account,
    "correct_causal_account": _save_causal_account,
    "set_calendar": _set_calendar,
    "save_layout": save_layout,
    "save_waypoint": save_waypoint,
    "save_connection": save_connection,
    "save_map_pin": save_map_pin,
    "remove_map_pin": remove_map_pin,
    "record_learned_ability": _record_learned_ability,
    "correct_learned_ability": _correct_learned_ability,
}


def _active_findings(assertions):
    for index, first in enumerate(assertions):
        for second in assertions[index + 1:]:
            if first.until_tick is not None and second.from_tick >= first.until_tick:
                break
            if (first.value, first.recorded_unit) != (second.value, second.recorded_unit):
                ids = sorted((str(first.pk), str(second.pk)))
                end = min((t for t in (first.until_tick, second.until_tick) if t is not None), default=None)
                yield "canon:" + ":".join(ids), "CANON_CONFLICT", ids, second.from_tick, end
    snapshots = WikiObservation.objects.filter(assertion_id__in=[a.pk for a in assertions]).select_related("assertion")
    for known in snapshots:
        fact = known.assertion
        if (known.value, known.recorded_unit) != (fact.value, fact.recorded_unit) or not contains_tick(fact, known.about_tick):
            yield (
                f"evidence:{known.pk}", "OBSERVATION_SOURCE_CHANGED",
                [str(fact.pk), str(known.pk)], known.about_tick, None,
            )


def _claim_findings(entry_id, field):
    observations = WikiObservation.objects.filter(claim__entry_id=entry_id, claim__field=field).select_related("claim")
    for known in observations:
        claim = known.claim
        if (known.value, known.recorded_unit) != (claim.value, claim.recorded_unit) or not _compatible_claim_time(
            claim, known.about_tick, known.learned_at
        ):
            yield (
                f"evidence:{known.pk}", "OBSERVATION_SOURCE_CHANGED",
                [str(claim.pk), str(known.pk)], known.learned_at if known.about_tick is None else known.about_tick, None,
            )


def _overlap_interval(first, second):
    start = max(first.from_tick, second.from_tick)
    end = min((tick for tick in (first.until_tick, second.until_tick) if tick is not None), default=None)
    return (start, end) if end is None or start < end else None


def _date_bounds(fact):
    return (fact.value, fact.value) if type(fact.value) is int else date_window_bounds(fact.value)


def _lifespan_findings(entry_id, field, endings):
    start_field = LIFESPAN_START_FIELDS[EXACT_DATE_FIELDS.get(field, field)]
    starts = list(WikiAssertion.objects.filter(entry_id=entry_id, field__in=(start_field, DATE_WINDOW_FIELDS[start_field])))
    for start in starts:
        start_bounds = _date_bounds(start)
        if start_bounds is None:
            continue
        for end in endings:
            end_bounds = _date_bounds(end)
            if end_bounds and end_bounds[1] < start_bounds[0] and (interval := _overlap_interval(start, end)):
                yield f"lifespan:{start.pk}:{end.pk}", "LIFESPAN_CONFLICT", [str(start.pk), str(end.pk)], *interval


def _date_window_findings(entry_id, field, windows):
    dates = list(WikiAssertion.objects.filter(entry_id=entry_id, field=EXACT_DATE_FIELDS[field]))
    for window in windows:
        bounds = date_window_bounds(window.value)
        if bounds is None:
            continue
        for date in dates:
            if not bounds[0] <= date.value <= bounds[1] and (interval := _overlap_interval(date, window)):
                yield f"date-window:{date.pk}:{window.pk}", "DATE_OUTSIDE_WINDOW", [str(date.pk), str(window.pk)], *interval


def _refresh_findings(affected, edit_counter):
    related_lifespan_ends = {
        (entry_id, end)
        for entry_id, field in affected
        for exact_end, exact_start in LIFESPAN_START_FIELDS.items()
        if field in (exact_start, DATE_WINDOW_FIELDS[exact_start])
        for end in (exact_end, DATE_WINDOW_FIELDS[exact_end])
    }
    date_windows = {(entry_id, DATE_WINDOW_FIELDS[field]) for entry_id, field in affected if field in DATE_WINDOW_FIELDS}
    for entry_id, field in sorted(affected | related_lifespan_ends | date_windows):
        assertions = list(WikiAssertion.objects.filter(entry_id=entry_id, field=field).order_by("from_tick", "id"))
        open_keys = []
        slots = defaultdict(list)
        for assertion in assertions:
            slots[value_slot(field, assertion.qualifier_id, assertion.value)].append(assertion)
        findings = chain(
            (finding for group in slots.values() for finding in _active_findings(group)),
            _claim_findings(entry_id, field),
            _lifespan_findings(entry_id, field, assertions)
            if EXACT_DATE_FIELDS.get(field, field) in LIFESPAN_START_FIELDS and assertions else (),
            _date_window_findings(entry_id, field, assertions) if field in EXACT_DATE_FIELDS and assertions else (),
        )
        for key, code, record_ids, start, end in findings:
            WikiFinding.objects.update_or_create(
                key=key, defaults={
                    "entry_id": entry_id, "field": field, "code": code, "record_ids": record_ids,
                    "from_tick": start, "until_tick": end, "resolved_at_edit": None,
                },
            )
            open_keys.append(key)
        WikiFinding.objects.filter(entry_id=entry_id, field=field, resolved_at_edit__isnull=True).exclude(
            code__in=RELATIONSHIP_FINDING_CODES,
        ).exclude(key__in=open_keys).update(resolved_at_edit=edit_counter)


def save_wiki_change(world_id, account_id, request_key, payload):
    digest = digest_json(payload)
    receipt_scope = {
        "principal_id": account_id, "operation": "wiki_change",
        "scope_key": f"wiki:{world_id}", "request_key": request_key,
    }
    with transaction.atomic():
        world = World.objects.select_for_update().filter(pk=world_id).first()
        if world is None:
            raise resource_unavailable()
        wiki_access(world_id, account_id, writing=True)
        receipt = MutationReceipt.objects.filter(**receipt_scope).first()
        if receipt is None:
            wiki, _ = WikiWorld.objects.get_or_create(world=world)
            if wiki.edit_counter != payload["expected_edit"]:
                raise CgsError(409, "STALE_WIKI", "This Wiki changed before you saved.", conflict_revision=wiki.edit_counter)
            command = payload["command"]
            if command["op"] in ("create_image_map", "attach_map_image"):
                record_id, affected = _save_map_image(wiki, command, account_id)
            else:
                record_id, affected = OPERATIONS[command["op"]](wiki, command)
            check_hierarchies(wiki, affected)
            wiki.edit_counter += 1
            _refresh_findings(affected, wiki.edit_counter)
            refresh_relationship_findings(wiki, affected, wiki.edit_counter)
            wiki.save(update_fields=["edit_counter"])
            receipt = MutationReceipt.objects.create(
                **receipt_scope, input_digest=digest, response_status=200, world=world,
                result={"edit_counter": wiki.edit_counter, "record_id": str(record_id)},
            )
        elif receipt.input_digest != digest:
            raise CgsError(409, "KEY_REUSED", "This idempotency key was used for a different request.")

    with transaction.atomic():
        _scoped_read()
        wiki_access(world_id, account_id, writing=True)
        return {"receipt_id": str(receipt.pk), **receipt.result}
