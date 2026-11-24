from django.db import transaction
from django.db.models import Q

from cgs.api import CgsError, resource_unavailable

from .drafts import _scoped_read
from .models import (
    MutationReceipt, WikiAssertion, WikiClaim, WikiEntry, WikiEvent, WikiEventLink,
    WikiFinding, WikiLearnedAbility, WikiObservation, WikiWorld, World,
)
from .services import digest_json
from .wiki import at_tick, contains_tick, entry_for, reject, typed_value, wiki_access
from .wiki_schema import FIELDS


def _in_world(query, record_id):
    record = query.filter(pk=record_id).first()
    if record is None:
        reject("INVALID_RECORD", "Choose a record in this world.")
    return record


def _field_of(record):
    return record.entry_id, record.field


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
        field = fact["field"]
        if field in values:
            reject("DUPLICATE_FACT", "Set each initial field once.")
        values[field] = WikiAssertion(
            entry=entry, field=field, value=typed_value(entry, field, fact["value"]),
            from_tick=tick, author_only=fact["author_only"],
        )
    WikiAssertion.objects.bulk_create(values.values())
    return entry.pk, set()


def _rename_entry(wiki, command):
    entry = entry_for(wiki, command["entry_id"])
    entry.name = _named(command["name"])
    entry.save(update_fields=["name"])
    return entry.pk, set()


def _record_fact(wiki, command):
    entry = entry_for(wiki, command["entry_id"])
    start, end = command["from_tick"], command["until_tick"]
    if end is not None and end <= start:
        reject("INVALID_INTERVAL", "The ending time must be after the starting time.")
    fact = WikiAssertion.objects.create(
        entry=entry, field=command["field"], value=typed_value(entry, command["field"], command["value"]),
        from_tick=start, until_tick=end, author_only=command["author_only"], source=command["source"],
    )
    return fact.pk, {_field_of(fact)}


def _correct_fact(wiki, command):
    fact = _in_world(WikiAssertion.objects.filter(entry__wiki=wiki).select_related("entry"), command["assertion_id"])
    fact.value = typed_value(fact.entry, fact.field, command["value"])
    fact.save(update_fields=["value"])
    return fact.pk, {_field_of(fact)}


def _apply_transition(entry, field, value, event, author_only):
    tick = event.tick
    timeline = WikiAssertion.objects.filter(entry=entry, field=field)
    current = list(at_tick(timeline, tick).order_by("from_tick", "id")[:2])
    if len(current) > 1 or (current and current[0].from_tick == tick):
        reject("AMBIGUOUS_TRANSITION", f"Resolve the existing {FIELDS[field].label.lower()} records at this time.")
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
    WikiAssertion.objects.create(
        entry=entry, field=field, value=value, from_tick=tick, until_tick=end,
        author_only=author_only, opened_by=event, closed_by_id=closed_by_id,
    )


EVENT_LINKS = (
    ("participant_ids", WikiEventLink.Role.PARTICIPANT, (WikiEntry.Kind.PERSON, WikiEntry.Kind.GROUP)),
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
        event.performed_by = entry_for(wiki, use["actor_id"], WikiEntry.Kind.PERSON) if use else None
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
    for change in command.get("changes", ()):
        entry = entry_for(wiki, change["entry_id"])
        field = change["field"]
        slot = (entry.pk, field)
        if slot in affected:
            reject("DUPLICATE_CHANGE", "An event can set a field on an entry once.")
        value = typed_value(entry, field, change["value"])
        _apply_transition(entry, field, value, event, change["author_only"])
        affected.add(slot)
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
    for entry_id, field in affected:
        unrelated = WikiAssertion.objects.filter(entry_id=entry_id, field=field).exclude(pk__in=ids)
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
    speaker = entry_for(wiki, command["speaker_id"], WikiEntry.Kind.PERSON)
    claim = WikiClaim.objects.create(
        entry=entry, speaker=speaker, field=command["field"], value=typed_value(entry, command["field"], command["value"]),
        tick=command["tick"], source=command["source"], author_only=command["author_only"],
    )
    return claim.pk, set()


def _record_observation(wiki, command):
    observer = entry_for(wiki, command["observer_id"], WikiEntry.Kind.PERSON)
    is_assertion = command["source_kind"] == "assertion"
    model = WikiAssertion if is_assertion else WikiClaim
    source = _in_world(model.objects.filter(entry__wiki=wiki).select_related("entry"), command["source_id"])
    definition = FIELDS[source.field]
    if source.author_only or source.entry.author_only or (not is_assertion and source.speaker.author_only):
        reject("PRIVATE_EVIDENCE", "Author-only records cannot be shared as a character’s evidence.")
    if definition.target_kind and entry_for(wiki, source.value, definition.target_kind).author_only:
        reject("PRIVATE_EVIDENCE", "This evidence points to an author-only entry.")
    about_tick = source.from_tick if is_assertion else source.tick
    if command["learned_at"] < about_tick:
        reject("INVALID_LEARNING_TIME", "The character learns the evidence at or after the source time.")
    observation = WikiObservation.objects.create(
        observer=observer, assertion=source if is_assertion else None, claim=source if not is_assertion else None,
        value=source.value, about_tick=about_tick, learned_at=command["learned_at"],
    )
    return observation.pk, set()


def _record_learned_ability(wiki, command):
    character = entry_for(wiki, command["character_id"], WikiEntry.Kind.PERSON)
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
        for key, code, record_ids, start, end in _active_findings(assertions):
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
