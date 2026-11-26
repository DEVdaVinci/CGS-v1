from collections import Counter, defaultdict
from graphlib import TopologicalSorter

from django.db.models import Prefetch, Q

from .models import WikiAssertion, WikiCausalAccount, WikiCausalTerm, WikiProposition
from .wiki import at_tick, contains_tick, date_window_bounds, value_slot, visible_unit
from .wiki_schema import ACTORS, DATE_WINDOW_FIELDS, DEFINITIONS, FIELDS


PLAN_ORDERS = {
    "parent_goal": "goal_order",
    "shared_parent_goal": "shared_goal_order",
    "milestone_goal": "milestone_order",
    "method_requirement": "method_order",
    "step_method": "step_order",
}


def _slot(record):
    return record.field, *value_slot(record.field, record.qualifier_id, record.value)


def _direct_values(facts):
    values = defaultdict(set)
    for fact in facts:
        values[_slot(fact)].add((fact.value, fact.recorded_unit, str(fact.entry_id)))
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
        sources_by_value = defaultdict(set)
        for value, unit, source in candidates:
            sources_by_value[(value, unit)].add(source)
        item = {"field": field, "state": "conflict"}
        if qualifier_id:
            item["qualifier_id"] = str(qualifier_id)
        if len(sources_by_value) == 1:
            value, unit = next(iter(sources_by_value))
            item.update(state="value", value=value)
            if unit is not None:
                item["unit"] = unit
        if slot not in own or any(source != str(entry.id) for _, _, source in candidates):
            item["default_sources"] = sorted({source for _, _, source in candidates})
            if item["state"] == "conflict":
                ordered = sorted(sources_by_value.items(), key=lambda candidate: (str(candidate[0][0]), candidate[0][1] or ""))
                item["default_candidates"] = [
                    {"value": value, "unit": unit, "source_ids": sorted(sources)} for (value, unit), sources in ordered
                ]
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
    return _describe_values(entry, _inherit(own, defaults), own)


def derived_age(entry, values, at):
    start_key, end_key = ("birth_tick", "death_tick") if entry.kind in ACTORS else (
        "creation_tick", "extinction_tick" if entry.kind == "species" else "destruction_tick"
    )
    start_window, end_window = DATE_WINDOW_FIELDS[start_key], DATE_WINDOW_FIELDS[end_key]
    dates = {item["field"]: item for item in values if item["field"] in (start_key, end_key, start_window, end_window)}
    if any(item["state"] == "conflict" for item in dates.values()):
        return None
    start = dates[start_key].get("value")
    end = dates[end_key].get("value")
    start_bounds = date_window_bounds(dates[start_window].get("value"))
    end_bounds = date_window_bounds(dates[end_window].get("value"))
    if start is None or (start_bounds and not start_bounds[0] <= start <= start_bounds[1]):
        return None
    if end is not None and (end < start or (end_bounds and not end_bounds[0] <= end <= end_bounds[1])):
        return None
    if end is None and end_bounds and (end_bounds[0] <= at or end_bounds[1] < start):
        return None
    year = entry.wiki.days_per_year
    age_at = min(at, end) if end is not None else at
    return (age_at - start) // year if year and age_at >= start else None


def _link_group(field):
    return "parent_goal" if field == "shared_parent_goal" else field


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
    links = [
        {
            "id": str(fact.id), "entry_id": str(fact.entry_id), "field": fact.field, "label": inverse[fact.field],
            "qualifier_id": str(fact.qualifier_id) if fact.qualifier_id else None,
            "from_tick": fact.from_tick, "until_tick": fact.until_tick, "source": fact.source,
        }
        for fact in matches
        if FIELDS[fact.field].many or (fact.entry_id, fact.field, fact.qualifier_id) not in conflicts
    ]
    primary_subgoals = {link["entry_id"] for link in links if link["field"] == "parent_goal"}
    links = [link for link in links if link["field"] != "shared_parent_goal" or link["entry_id"] not in primary_subgoals]
    plan_entries = {link["entry_id"] for link in links if link["field"] in PLAN_ORDERS}
    positions = defaultdict(set)
    if plan_entries:
        for entry_id, field, qualifier, value in at_tick(WikiAssertion.objects.filter(
            entry_id__in=plan_entries, field__in=PLAN_ORDERS.values(),
        ), at).values_list("entry_id", "field", "qualifier_id", "value"):
            positions[(str(entry_id), field, qualifier)].add(value)
    for link in links:
        if order_field := PLAN_ORDERS.get(link["field"]):
            qualifier = entry.pk if order_field == "shared_goal_order" else None
            values = positions[(link["entry_id"], order_field, qualifier)]
            link["order"] = next(iter(values)) if len(values) == 1 else None
            link["order_conflict"] = len(values) > 1
    positions_in_group = Counter((_link_group(link["field"]), link["order"]) for link in links if link.get("order") is not None)
    for link in links:
        if positions_in_group[(_link_group(link["field"]), link.get("order"))] > 1:
            link["order_shared"] = True
    links.sort(key=lambda link: (
        _link_group(link["field"]), link.get("order") is None, link.get("order") or 0,
        link["entry_id"] if link.get("order_shared") else "",
    ))
    return links


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


def _describe_proposition(record, observer, visible_ids):
    subject_id = str(record.subject_id)
    qualifier_id = str(record.qualifier_id) if record.qualifier_id else None
    if observer is not None and (
        record.author_only or record.holder_id != observer.pk
        or subject_id not in visible_ids or (qualifier_id and qualifier_id not in visible_ids)
        or (FIELDS[record.field].target_kinds and record.value not in visible_ids)
        or (record.evidence and not observation_visible(record.evidence, visible_ids))
    ):
        return None
    return {
        "id": str(record.id), "holder_id": str(record.holder_id), "subject_id": subject_id,
        "kind": "desired_state" if record.holder.kind in ("goal", "milestone") else "belief", "field": record.field,
        "value": record.value, "qualifier_id": qualifier_id,
        "unit": record.recorded_unit if observer is None else visible_unit(record),
        "from_tick": record.from_tick, "until_tick": record.until_tick, "about_tick": record.about_tick,
        "evidence_id": str(record.evidence_id) if record.evidence_id else None,
        "source": record.source, "author_only": record.author_only,
    }


def propositions_for(entry, at, observer=None, visible_ids=None):
    records = at_tick(WikiProposition.objects.filter(
        Q(holder=entry) | Q(subject=entry), holder__wiki_id=entry.wiki_id,
    ), at).select_related("holder", "evidence__assertion", "evidence__claim", "unit_source")
    if observer is not None:
        records = records.filter(holder=observer, author_only=False)
    return [
        data for record in records.order_by("from_tick", "id")
        if (data := _describe_proposition(record, observer, visible_ids)) is not None
    ]


def causal_accounts_for(entry, at, observer=None, visible_ids=None):
    if entry.kind not in ACTORS or (observer is not None and entry.pk != observer.pk):
        return []
    accounts = at_tick(WikiCausalAccount.objects.filter(holder=entry), at)
    if observer is not None:
        accounts = accounts.filter(author_only=False)
    terms = WikiCausalTerm.objects.select_related(
        "belief__holder", "belief__evidence__assertion", "belief__evidence__claim", "belief__unit_source",
    ).order_by("position")
    result = []
    for account in accounts.prefetch_related(Prefetch("terms", queryset=terms)).order_by("from_tick", "id"):
        citation = str(account.citation_id) if account.citation_id else None
        if observer is not None and citation and citation not in visible_ids:
            continue
        statements = []
        for term in account.terms.all():
            belief = _describe_proposition(term.belief, observer, visible_ids)
            if belief is None or (observer is not None and term.belief.from_tick > at):
                break
            statements.append({"phase": term.phase, "belief": belief})
        else:
            result.append({
                "id": str(account.pk), "title": account.title, "applicability": account.applicability,
                "citation_id": citation, "from_tick": account.from_tick, "until_tick": account.until_tick,
                "author_only": account.author_only, "terms": statements,
            })
    return result
