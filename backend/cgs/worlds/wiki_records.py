from collections import defaultdict
from graphlib import TopologicalSorter

from django.db.models import Q

from .models import WikiAssertion, WikiProposition
from .wiki import at_tick, contains_tick, value_slot
from .wiki_schema import ACTORS, DEFINITIONS, FIELDS, MEASURED_TRAITS


def _slot(record):
    return record.field, *value_slot(record.field, record.qualifier_id, record.value)


def _direct_values(facts):
    values = defaultdict(set)
    for fact in facts:
        values[_slot(fact)].add((fact.value, str(fact.entry_id)))
    return values


def _inherit(own, parents):
    values = defaultdict(set)
    for parent in parents:
        for slot, candidates in parent.items():
            if FIELDS[slot[0]].inherited and slot not in own:
                values[slot].update(candidates)
    values.update(own)
    return values


def _definition_values(entry, at, own_facts):
    if entry.kind in DEFINITIONS:
        start = {str(entry.id)}
    else:
        definitions = defaultdict(set)
        for fact in own_facts:
            if fact.field in ("character_class", "species", "extra_class"):
                definitions[fact.field].add(fact.value)
        start = definitions["extra_class"].copy()
        for key in ("character_class", "species"):
            if len(definitions[key]) == 1:
                start.update(definitions[key])
    if not start:
        return []
    # Read only the definitions reachable from this entry. Each level is a
    # single query, even when a parent is shared by several definitions.
    fact_sets = {}
    graph = {}
    pending = set(start)
    while pending:
        facts = at_tick(WikiAssertion.objects.filter(
            entry_id__in=pending, entry__wiki_id=entry.wiki_id, entry__kind__in=DEFINITIONS,
        ), at)
        grouped = defaultdict(list)
        for fact in facts:
            grouped[str(fact.entry_id)].append(fact)
        for entry_id in pending:
            fact_sets[entry_id] = _direct_values(grouped[entry_id])
            graph[entry_id] = {a.value for a in grouped[entry_id] if a.field == "inherits_from"}
        pending = {parent for entry_id in pending for parent in graph[entry_id]} - graph.keys()
    resolved = {}
    for entry_id in TopologicalSorter(graph).static_order():
        resolved[entry_id] = _inherit(fact_sets[entry_id], (resolved[parent] for parent in graph[entry_id]))
    return [resolved[entry_id] for entry_id in start]


def _describe_values(entry, slots, own):
    values_by_field = defaultdict(list)
    for slot, candidates in slots.items():
        field, qualifier_id, _ = slot
        values = {value for value, _ in candidates}
        item = {"field": field, "state": "conflict"}
        if qualifier_id:
            item["qualifier_id"] = str(qualifier_id)
        if len(values) == 1:
            item.update(state="value", value=next(iter(values)))
        if slot not in own or any(source != str(entry.id) for _, source in candidates):
            item["default_sources"] = sorted({source for _, source in candidates})
        values_by_field[field].append(item)
    result = []
    for field, definition in FIELDS.items():
        if entry.kind not in definition.kinds:
            continue
        values = values_by_field[field]
        if values:
            result.extend(sorted(values, key=lambda value: (value.get("qualifier_id", ""), str(value.get("value", "")))))
        elif not (definition.many or definition.qualifier_required):
            result.append({"field": field, "state": "unknown"})
    return result


def effective_values(entry, facts, at):
    active = [fact for fact in facts if contains_tick(fact, at)]
    own = _direct_values(active)
    defaults = _definition_values(entry, at, active) if entry.kind in (*ACTORS, *DEFINITIONS) else []
    values = _describe_values(entry, _inherit(own, defaults), own)
    measured = {"resource_amount", *MEASURED_TRAITS}
    unit_ids = {item["qualifier_id"] for item in values if item["field"] in measured}
    units = defaultdict(set)
    for entry_id, unit in at_tick(WikiAssertion.objects.filter(
        entry__wiki_id=entry.wiki_id, entry_id__in=unit_ids, field="unit",
    ), at).values_list("entry_id", "value"):
        units[str(entry_id)].add(unit)
    for value in values:
        if value["field"] in measured and len(units[value["qualifier_id"]]) == 1:
            value["unit"] = next(iter(units[value["qualifier_id"]]))
    return values


def derived_age(entry, values, at):
    start_key, end_key = ("birth_tick", "death_tick") if entry.kind in ACTORS else (
        "creation_tick", "extinction_tick" if entry.kind == "species" else "destruction_tick"
    )
    dates = {item["field"]: item for item in values if item["field"] in (start_key, end_key)}
    start = dates[start_key].get("value")
    end = dates[end_key].get("value")
    if dates[end_key]["state"] == "conflict" or (end is not None and start is not None and end < start):
        return None
    year = entry.wiki.days_per_year
    age_at = min(at, end) if end is not None else at
    return (age_at - start) // year if year and start is not None and age_at >= start else None


def incoming_links(entry, at):
    inverse = {key: definition.inverse for key, definition in FIELDS.items() if definition.inverse}
    candidates = at_tick(WikiAssertion.objects.filter(
        entry__wiki_id=entry.wiki_id, field__in=inverse,
    ), at)
    matches = list(candidates.filter(value=str(entry.id)).order_by("field", "entry__name", "id"))
    exclusives = [fact for fact in matches if not FIELDS[fact.field].many]
    conflicts = {
        (source, field, qualifier)
        for source, field, qualifier in candidates.filter(
            entry_id__in={fact.entry_id for fact in exclusives}, field__in={fact.field for fact in exclusives},
        ).exclude(value=str(entry.id)).values_list("entry_id", "field", "qualifier_id")
    }
    return [
        {
            "id": str(fact.id), "entry_id": str(fact.entry_id), "field": fact.field, "label": inverse[fact.field],
            "qualifier_id": str(fact.qualifier_id) if fact.qualifier_id else None,
            "from_tick": fact.from_tick, "until_tick": fact.until_tick, "source": fact.source,
        }
        for fact in matches
        if FIELDS[fact.field].many or (fact.entry_id, fact.field, fact.qualifier_id) not in conflicts
    ]


def family_links(entry, facts, at):
    active = [fact for fact in facts if fact.field in ("parent", "sibling") and contains_tick(fact, at)]
    subject = str(entry.id)
    parents = {fact.value for fact in active if fact.field == "parent"}
    declared = {fact.value for fact in active if fact.field == "sibling"}
    relations = at_tick(WikiAssertion.objects.filter(
        entry__wiki_id=entry.wiki_id, field__in=("parent", "sibling"),
    ), at)
    children = set()
    for entry_id, field in relations.filter(value=subject).values_list("entry_id", "field"):
        (children if field == "parent" else declared).add(str(entry_id))
    shared = defaultdict(set)
    for entry_id, parent in relations.filter(field="parent", value__in=parents).exclude(entry=entry).values_list("entry_id", "value"):
        shared[str(entry_id)].add(parent)
    return {
        "parents": sorted(parents), "children": sorted(children),
        "siblings": [
            {"entry_id": sibling, "declared": sibling in declared, "shared_parent_ids": sorted(shared[sibling])}
            for sibling in sorted(declared | shared.keys())
        ],
    }


def observation_visible(observation, visible_ids):
    source = observation.assertion or observation.claim
    return (
        not source.author_only
        and str(source.entry_id) in visible_ids
        and (not observation.claim_id or not source.speaker_id or str(source.speaker_id) in visible_ids)
        and (not source.qualifier_id or str(source.qualifier_id) in visible_ids)
        and (not FIELDS[source.field].target_kinds or observation.value in visible_ids)
    )


def propositions_for(entry, at, observer=None, visible_ids=None):
    records = at_tick(WikiProposition.objects.filter(
        Q(holder=entry) | Q(subject=entry), holder__wiki_id=entry.wiki_id,
    ), at).select_related("holder", "evidence__assertion", "evidence__claim")
    if observer is not None:
        records = records.filter(holder=observer, author_only=False)

    data = []
    for record in records.order_by("from_tick", "id"):
        subject_id = str(record.subject_id)
        qualifier_id = str(record.qualifier_id) if record.qualifier_id else None
        if observer is not None and (
            subject_id not in visible_ids or (qualifier_id and qualifier_id not in visible_ids)
            or (FIELDS[record.field].target_kinds and record.value not in visible_ids)
            or (record.evidence and not observation_visible(record.evidence, visible_ids))
        ):
            continue
        data.append({
            "id": str(record.id), "holder_id": str(record.holder_id), "subject_id": subject_id,
            "kind": "desired_state" if record.holder.kind == "goal" else "belief", "field": record.field,
            "value": record.value, "qualifier_id": qualifier_id,
            "from_tick": record.from_tick, "until_tick": record.until_tick, "about_tick": record.about_tick,
            "evidence_id": str(record.evidence_id) if record.evidence_id else None,
            "source": record.source, "author_only": record.author_only,
        })
    return data
