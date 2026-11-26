from collections import defaultdict

from .models import WikiAssertion, WikiEntry, WikiFinding
from .wiki import contains_tick
from .wiki_schema import RELATIONSHIP_ROLES


PARTY_KIND_FINDING = "RELATIONSHIP_PARTY_KIND"
PARTY_LIMIT_FINDING = "RELATIONSHIP_PARTY_LIMIT"
RELATIONSHIP_FINDING_CODES = (PARTY_KIND_FINDING, PARTY_LIMIT_FINDING)
PARTY_FIELDS = tuple(role for role, _, _ in RELATIONSHIP_ROLES)
POLICY_FIELDS = {field for _, kinds, limit in RELATIONSHIP_ROLES for field in (kinds, limit)}
TRACKED_FIELDS = ("relationship_type", *PARTY_FIELDS, *sorted(POLICY_FIELDS))


def _active(assertions, at):
    return [assertion for assertion in assertions if contains_tick(assertion, at)]


def _unique(assertions, at):
    active = _active(assertions, at)
    return active[0] if len({assertion.value for assertion in active}) == 1 else None


def _record_finding(results, entry_id, field, code, interval, records, details):
    start, end = interval
    record_ids = sorted({str(record.pk) for record in records})
    series = results[(entry_id, field, code)]
    if series:
        last = series[-1]
        if last["until_tick"] == start and last["record_ids"] == record_ids and last["details"] == details:
            last["until_tick"] = end
            return
    series.append({
        "from_tick": start, "until_tick": end, "record_ids": record_ids,
        "details": details,
    })


def _find_relationship_issues(definition_id, policies, relationships, kinds, results):
    boundaries = sorted({
        tick
        for fields in (policies, *relationships)
        for assertions in fields.values()
        for assertion in assertions
        for tick in (assertion.from_tick, assertion.until_tick)
        if tick is not None
    })
    for interval in zip(boundaries, boundaries[1:] + [None]):
        start, _ = interval
        associated = []
        for fields in relationships:
            active_type = _unique(fields["relationship_type"], start)
            if active_type is not None and active_type.value == definition_id:
                parties = {role: _unique(fields[role], start) for role in PARTY_FIELDS}
                associated.append((active_type, parties))

        for role, allowed_field, cap_field in RELATIONSHIP_ROLES:
            allowed = {record.value: record for record in _active(policies[allowed_field], start)}
            cap = _unique(policies[cap_field], start)
            assignments = defaultdict(list)
            for active_type, parties in associated:
                party = parties[role]
                if party is None or party.value not in kinds:
                    continue
                kind = kinds[party.value]
                if allowed and kind not in allowed:
                    _record_finding(results, party.entry_id, role, PARTY_KIND_FINDING, interval, (
                        active_type, party, *allowed.values(),
                    ), {
                        "relationship_type_id": definition_id, "actual_kind": kind, "allowed_kinds": sorted(allowed),
                    })
                if cap is not None and all(parties.values()):
                    assignments[party.value].append((active_type, party))
            for matches in assignments.values():
                count = len(matches)
                if count <= cap.value:
                    continue
                records = [cap, *(party for _, party in matches)]
                for active_type, party in matches:
                    _record_finding(results, party.entry_id, role, PARTY_LIMIT_FINDING, interval, (
                        active_type, *records,
                    ), {
                        "relationship_type_id": definition_id, "actual_count": count, "maximum_count": cap.value,
                    })


def refresh_relationship_findings(wiki, affected, edit_counter):
    if not any(field in TRACKED_FIELDS for _, field in affected):
        return
    by_entry = defaultdict(lambda: defaultdict(list))
    parties = set()
    for assertion in WikiAssertion.objects.filter(entry__wiki=wiki, field__in=TRACKED_FIELDS).order_by("from_tick", "id"):
        by_entry[str(assertion.entry_id)][assertion.field].append(assertion)
        if assertion.field in PARTY_FIELDS:
            parties.add(assertion.value)
    definitions = {key: fields for key, fields in by_entry.items() if POLICY_FIELDS.intersection(fields)}
    relationships_by_type = defaultdict(list)
    for fields in by_entry.values():
        for definition_id in {assertion.value for assertion in fields.get("relationship_type", ())}:
            if definition_id in definitions:
                relationships_by_type[definition_id].append(fields)
    kinds = {str(entry_id): kind for entry_id, kind in WikiEntry.objects.filter(wiki=wiki, pk__in=parties)
             .values_list("pk", "kind")}
    results = defaultdict(list)
    for definition_id, relationships in relationships_by_type.items():
        _find_relationship_issues(definition_id, definitions[definition_id], relationships, kinds, results)

    open_keys = []
    for (entry_id, field, code), series in results.items():
        for period in series:
            suffix = "kind" if code == PARTY_KIND_FINDING else "limit"
            key = f"relationship:{entry_id}:{field}:{suffix}:{period['from_tick']}"
            WikiFinding.objects.update_or_create(key=key, defaults={
                **period, "entry_id": entry_id, "field": field, "code": code, "resolved_at_edit": None,
            })
            open_keys.append(key)
    WikiFinding.objects.filter(
        entry__wiki=wiki, code__in=RELATIONSHIP_FINDING_CODES, resolved_at_edit__isnull=True,
    ).exclude(key__in=open_keys).update(resolved_at_edit=edit_counter)
