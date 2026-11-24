from collections import defaultdict

from django.db import transaction
from django.db.models import Q

from cgs.api import CgsError, resource_unavailable

from .drafts import _scoped_read
from .models import (
    MutationReceipt, WikiAssertion, WikiClaim, WikiEntry, WikiEvent, WikiEventLink,
    WikiFinding, WikiLearnedAbility, WikiObservation, WikiProposition, WikiWorld, World,
)
from .services import digest_json
from .wiki import (
    at_tick, check_hierarchies, check_interval, contains_tick, entry_for, reject, typed_assertion,
    typed_value, value_slot, wiki_access,
)
from .wiki_schema import ACTORS, FIELDS


def _in_world(query, record_id):
    record = query.filter(pk=record_id).first()
    if record is None:
        reject("INVALID_RECORD", "Choose a record in this world.")
    return record


def _field_of(record):
    return record.entry_id, record.field


def _value_arguments(entry, data):
    return typed_assertion(entry, data["field"], data["value"], data.get("qualifier_id"))


def _slot_query(fact):
    timeline = WikiAssertion.objects.filter(entry_id=fact.entry_id, field=fact.field, qualifier_id=fact.qualifier_id)
    return timeline.filter(value=fact.value) if FIELDS[fact.field].many else timeline


def _named(value):
    name = value.strip()
    if not name:
        reject("MISSING_NAME", "Enter a name.")
    return name


def _create_entry(wiki, command):
    entry = WikiEntry.objects.create(
        wiki=wiki, kind=command["kind"], name=_named(command["name"]), author_only=command["author_only"],
    )
    tick = command.get("initial_at", 0)
    values = {}
    for fact in command.get("initial_values", ()):
        assertion = WikiAssertion(
            **_value_arguments(entry, fact),
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


def _record_fact(wiki, command):
    entry = entry_for(wiki, command["entry_id"])
    start, end = command["from_tick"], command["until_tick"]
    check_interval(start, end)
    fact = WikiAssertion.objects.create(
        **_value_arguments(entry, command),
        from_tick=start, until_tick=end, author_only=command["author_only"], source=command["source"],
    )
    return fact.pk, {_field_of(fact)}


def _correct_fact(wiki, command):
    fact = _in_world(WikiAssertion.objects.filter(entry__wiki=wiki).select_related("entry"), command["assertion_id"])
    fact.value = typed_value(fact.entry, fact.field, command["value"])
    fact.source = command.get("source", fact.source)
    fact.author_only = command.get("author_only", fact.author_only)
    fact.save(update_fields=["value", "source", "author_only"])
    return fact.pk, {_field_of(fact)}


def _apply_transition(fact, event, mode):
    tick = event.tick
    timeline = _slot_query(fact)
    current = list(at_tick(timeline, tick).order_by("from_tick", "id")[:2])
    if len(current) > 1 or (current and current[0].from_tick == tick):
        reject("AMBIGUOUS_TRANSITION", f"Resolve the existing {FIELDS[fact.field].label.lower()} records at this time.")
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
    ("place_ids", WikiEventLink.Role.PLACE, (WikiEntry.Kind.PLACE,)),
    ("item_ids", WikiEventLink.Role.ITEM, (WikiEntry.Kind.ITEM,)),
)


def _save_event_details(wiki, event, command):
    event.name = _named(command["name"])
    event.source = command.get("source", event.source)
    event.description = command.get("description", event.description)
    if "ability_use" in command:
        use = command["ability_use"]
        event.ability = entry_for(wiki, use["ability_id"], WikiEntry.Kind.ABILITY) if use else None
        event.performed_by = _actor_for(wiki, use["actor_id"]) if use else None
    event.save()
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
    event = WikiEvent(wiki=wiki, tick=command["tick"])
    _save_event_details(wiki, event, command)
    affected = set()
    slots = set()
    for change in command.get("changes", ()):
        entry = entry_for(wiki, change["entry_id"])
        fact = WikiAssertion(
            **_value_arguments(entry, change), author_only=change["author_only"], source=change.get("source", ""),
        )
        slot = (entry.pk, fact.field, *value_slot(fact.field, fact.qualifier_id, fact.value))
        if slot in slots:
            reject("DUPLICATE_CHANGE", "An event can change each effective value once.")
        slots.add(slot)
        mode = change.get("mode", "add" if FIELDS[fact.field].many else "set")
        _apply_transition(fact, event, mode)
        affected.add(_field_of(fact))
    return event.pk, affected


def _edit_event(wiki, command):
    event = _in_world(WikiEvent.objects.filter(wiki=wiki), command["event_id"])
    _save_event_details(wiki, event, command)
    return event.pk, set()


def _correct_event_date(wiki, command):
    event = _in_world(WikiEvent.objects.filter(wiki=wiki), command["event_id"])
    tick = command["tick"]
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
    event.tick = tick
    event.save(update_fields=["tick"])
    return event.pk, affected


def _record_claim(wiki, command):
    entry = entry_for(wiki, command["entry_id"])
    speaker = _actor_for(wiki, command["speaker_id"])
    claim = WikiClaim.objects.create(
        **_value_arguments(entry, command), speaker=speaker,
        tick=command["tick"], source=command["source"], author_only=command["author_only"],
    )
    return claim.pk, set()


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
    if source.author_only or source.entry.author_only or (not is_assertion and source.speaker.author_only):
        reject("PRIVATE_EVIDENCE", "Author-only records cannot be shared as a character’s evidence.")
    if source.qualifier_id and source.qualifier.author_only:
        reject("PRIVATE_EVIDENCE", "This evidence names an author-only qualifier.")
    if definition.target_kinds and entry_for(wiki, source.value).author_only:
        reject("PRIVATE_EVIDENCE", "This evidence points to an author-only entry.")
    about_tick = source.from_tick if is_assertion else source.tick
    if command["learned_at"] < about_tick:
        reject("INVALID_LEARNING_TIME", "The character learns the evidence at or after the source time.")
    if "about_tick" in command:
        about_tick = command["about_tick"]
        valid = contains_tick(source, about_tick) if is_assertion else source.tick == about_tick
        if not valid or command["learned_at"] < about_tick:
            reject("INVALID_LEARNING_TIME", "Choose an observation time within the source and before learning.")
    observation = WikiObservation.objects.create(
        observer=observer, assertion=source if is_assertion else None, claim=source if not is_assertion else None,
        value=source.value, about_tick=about_tick, learned_at=command["learned_at"],
    )
    return observation.pk, set()


def _save_proposition(wiki, command):
    holder = entry_for(wiki, command["holder_id"])
    if holder.kind not in (*ACTORS, "goal"):
        reject("INVALID_HOLDER", "Choose a character, organism, or goal.")
    existing = command.get("proposition_id")
    proposition = _in_world(WikiProposition.objects.filter(holder__wiki=wiki), existing) if existing else WikiProposition()
    subject = entry_for(wiki, command["entry_id"])
    values = typed_assertion(subject, command["field"], command["value"], command.get("qualifier_id"))
    start, end = command["from_tick"], command["until_tick"]
    check_interval(start, end)
    evidence = None
    if command.get("evidence_id"):
        evidence = _in_world(WikiObservation.objects.filter(observer=holder), command["evidence_id"])
        if evidence.learned_at > start:
            reject("INVALID_EVIDENCE_TIME", "Choose evidence learned by the start of this belief.")
    proposition.holder, proposition.subject = holder, subject
    proposition.field, proposition.value, proposition.qualifier = values["field"], values["value"], values["qualifier"]
    proposition.about_tick = command.get("about_tick")
    proposition.from_tick, proposition.until_tick = start, end
    proposition.evidence, proposition.source, proposition.author_only = evidence, command["source"], command["author_only"]
    proposition.save()
    return proposition.pk, set()


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
    "record_fact": _record_fact,
    "correct_fact": _correct_fact,
    "record_event": _record_event,
    "edit_event": _edit_event,
    "correct_event_date": _correct_event_date,
    "record_claim": _record_claim,
    "record_observation": _record_observation,
    "record_proposition": _save_proposition,
    "correct_proposition": _save_proposition,
    "set_calendar": _set_calendar,
    "record_learned_ability": _record_learned_ability,
    "correct_learned_ability": _correct_learned_ability,
}


def _active_findings(assertions):
    for index, first in enumerate(assertions):
        for second in assertions[index + 1:]:
            if first.until_tick is not None and second.from_tick >= first.until_tick:
                break
            if first.value != second.value:
                ids = sorted((str(first.pk), str(second.pk)))
                end = min((t for t in (first.until_tick, second.until_tick) if t is not None), default=None)
                yield "canon:" + ":".join(ids), "CANON_CONFLICT", ids, second.from_tick, end
    snapshots = WikiObservation.objects.filter(assertion_id__in=[a.pk for a in assertions]).select_related("assertion")
    for known in snapshots:
        fact = known.assertion
        if known.value != fact.value or not contains_tick(fact, known.about_tick):
            yield (
                f"evidence:{known.pk}", "OBSERVATION_SOURCE_CHANGED",
                [str(fact.pk), str(known.pk)], known.about_tick, None,
            )


def _refresh_findings(affected, edit_counter):
    for entry_id, field in sorted(affected):
        assertions = list(WikiAssertion.objects.filter(entry_id=entry_id, field=field).order_by("from_tick", "id"))
        open_keys = []
        slots = defaultdict(list)
        for assertion in assertions:
            slots[value_slot(field, assertion.qualifier_id, assertion.value)].append(assertion)
        for group in slots.values():
            for key, code, record_ids, start, end in _active_findings(group):
                WikiFinding.objects.update_or_create(
                    key=key, defaults={
                        "entry_id": entry_id, "field": field, "code": code, "record_ids": record_ids,
                        "from_tick": start, "until_tick": end, "resolved_at_edit": None,
                    },
                )
                open_keys.append(key)
        WikiFinding.objects.filter(entry_id=entry_id, field=field, resolved_at_edit__isnull=True).exclude(
            key__in=open_keys
        ).update(resolved_at_edit=edit_counter)


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
            record_id, affected = OPERATIONS[command["op"]](wiki, command)
            check_hierarchies(wiki, affected)
            wiki.edit_counter += 1
            _refresh_findings(affected, wiki.edit_counter)
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
