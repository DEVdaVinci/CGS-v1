from collections import defaultdict
from decimal import Decimal
import json
import re

from django.db.models import Count, Min, Q

from cgs.api import CgsError, parse_id, resource_unavailable

from .models import WikiAssertion, WikiEntry, WorldAccess
from .services import get_membership
from .wiki_schema import FIELDS, MAX_CLOCK, MEASURED_FIELDS


EXACT_DECIMAL = re.compile(r"-?\d{1,15}(?:\.\d{1,9})?", re.ASCII)


def wiki_access(world_id, account_id, *, writing=False):
    membership = get_membership(account_id, world_id)
    if membership.role not in (WorldAccess.Role.OWNER, WorldAccess.Role.EDITOR):
        raise resource_unavailable()
    if writing and not can_edit(membership):
        raise CgsError(403, "ACTION_UNAVAILABLE", "You can read this Wiki but cannot edit it.")
    return membership


def can_edit(membership):
    return membership.role == WorldAccess.Role.OWNER or "edit_world" in membership.capabilities


def reject(code, message):
    raise CgsError(422, "VALIDATION_FAILED", "Review the Wiki change.", [
        {"code": code, "message": message},
    ])


def entry_for(wiki, entry_id, kind=None):
    entries = WikiEntry.objects.filter(wiki=wiki, pk=entry_id)
    if kind is not None:
        entries = entries.filter(kind=kind)
    entry = entries.first()
    if entry is None:
        reject("INVALID_ENTRY", "Choose an entry of the required type in this world.")
    return entry


def _decimal_text(amount):
    return format(amount.normalize(), "f") if amount else "0"


def _distribution(value, label):
    def invalid():
        reject("INVALID_DISTRIBUTION", f"{label} needs 1 to 40 unique numeric outcomes with positive weights.")

    if not isinstance(value, str) or len(value) > 4096:
        invalid()
    try:
        rows = json.loads(value)
    except (ValueError, RecursionError):
        invalid()
    if not isinstance(rows, list) or not 1 <= len(rows) <= 40:
        invalid()
    weights = {}
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"value", "weight"}:
            invalid()
        outcome, weight = row["value"], row["weight"]
        if any(not isinstance(number, str) or not EXACT_DECIMAL.fullmatch(number) for number in (outcome, weight)):
            invalid()
        outcome, weight = Decimal(outcome), Decimal(weight)
        if weight <= 0 or outcome in weights:
            invalid()
        weights[outcome] = weight
    return json.dumps(
        [{"value": _decimal_text(outcome), "weight": _decimal_text(weights[outcome])} for outcome in sorted(weights)],
        separators=(",", ":"),
    )


def date_window_bounds(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,16}:[0-9]{1,16}", value):
        return None
    earliest, latest = map(int, value.split(":"))
    return (earliest, latest) if earliest <= latest <= MAX_CLOCK else None


def typed_value(entry, field, value):
    definition = FIELDS[field]
    if entry.kind not in definition.kinds:
        reject("INVALID_FIELD", f"{definition.label} is unavailable for this entry type.")
    if definition.target_kinds:
        target = entry_for(entry.wiki, parse_id(value, field))
        if target.kind not in definition.target_kinds or (field == "inherits_from" and target.kind != entry.kind):
            reject("INVALID_REFERENCE", f"Choose a valid linked entry for {definition.label}.")
        if target.pk == entry.pk:
            reject("INVALID_REFERENCE", f"{definition.label} must point to a different entry.")
        return str(target.pk)
    if definition.value_kind == "integer":
        if type(value) is not int or not 0 <= value <= MAX_CLOCK:
            reject("INVALID_VALUE", f"{definition.label} requires a nonnegative whole number.")
    elif definition.value_kind == "decimal":
        if not isinstance(value, str) or not EXACT_DECIMAL.fullmatch(value):
            reject("INVALID_VALUE", f"{definition.label} requires an exact decimal number.")
        amount = Decimal(value)
        if field in {"mass_kg", "width_cm", "length_cm"} and amount < 0:
            reject("INVALID_VALUE", f"{definition.label} must be nonnegative.")
        if definition.minimum is not None and amount < definition.minimum:
            reject("INVALID_VALUE", f"{definition.label} must be at least {definition.minimum}.")
        if definition.maximum is not None and amount > definition.maximum:
            reject("INVALID_VALUE", f"{definition.label} must be at most {definition.maximum}.")
        return _decimal_text(amount)
    elif definition.value_kind == "distribution":
        return _distribution(value, definition.label)
    elif definition.value_kind == "time_window":
        if value == "unknown":
            return value
        bounds = date_window_bounds(value)
        if bounds is None:
            reject("INVALID_DATE_WINDOW", f"{definition.label} needs an unknown date or two ordered dates.")
        return f"{bounds[0]}:{bounds[1]}"
    elif not isinstance(value, str) or not value.strip() or len(value) > 500:
        reject("INVALID_VALUE", f"{definition.label} requires text of 1 to 500 characters.")
    if definition.choices and value not in definition.choices:
        reject("INVALID_VALUE", f"Choose a supported value for {definition.label}.")
    return value


def unit_at(field, qualifier_id, tick):
    if field not in MEASURED_FIELDS or qualifier_id is None or tick is None:
        return None, None
    units = at_tick(WikiAssertion.objects.filter(entry_id=qualifier_id, field="unit"), tick)
    matches = list(units.order_by("author_only", "id").values_list("value", "id"))
    if len({value for value, _ in matches}) == 1:
        return matches[0]
    return None, None


def visible_unit(record):
    return record.recorded_unit if record.unit_source_id and not record.unit_source.author_only else None


def typed_assertion(entry, field, value, qualifier_id=None, *, tick):
    definition = FIELDS[field]
    qualifier = None
    if qualifier_id is not None:
        if definition.qualifier_kind is None:
            reject("INVALID_QUALIFIER", f"{definition.label} has no qualifier.")
        qualifier = entry_for(entry.wiki, qualifier_id, definition.qualifier_kind)
    elif definition.qualifier_required:
        reject("INVALID_QUALIFIER", f"Choose a {definition.qualifier_kind.replace('_', ' ')} for {definition.label}.")
    unit, unit_source_id = unit_at(field, qualifier.pk if qualifier else None, tick)
    return {
        "entry": entry, "field": field, "value": typed_value(entry, field, value),
        "qualifier": qualifier, "recorded_unit": unit, "unit_source_id": unit_source_id,
    }


def value_slot(field, qualifier_id, value):
    """A repeated link is its own slot, while a qualified amount has one value."""
    return qualifier_id, value if FIELDS[field].many else None


def check_interval(start, end):
    if end is not None and end <= start:
        reject("INVALID_INTERVAL", "The ending time must be after the starting time.")


def check_health_records(affected):
    health_fields = {key for key, field in FIELDS.items() if field.kinds == (WikiEntry.Kind.HEALTH_CASE,)}
    case_ids = {entry_id for entry_id, field in affected if field in health_fields}
    if not case_ids:
        return

    subject = Q(field="health_subject")
    records = WikiAssertion.objects.filter(entry_id__in=case_ids, field__in=health_fields).values("entry__name", "entry_id")
    for record in records.annotate(
        subjects=Count("id", filter=subject),
        onset=Min("from_tick", filter=subject & Q(until_tick__isnull=True)),
        first_fact=Min("from_tick"),
    ):
        if record["subjects"] != 1 or record["onset"] is None:
            reject("HEALTH_SUBJECT_FIXED", "Correct the original affected individual in the health record's Fact history.")
        if record["first_fact"] < record["onset"]:
            reject("HEALTH_RECORD_START", f"{record['entry__name']} starts at time {record['onset']}. "
                   "Set its health facts at or after that time.")


def check_hierarchies(wiki, affected):
    subjects = defaultdict(set)
    for entry_id, field in affected:
        if FIELDS[field].acyclic or field == "located_in":
            hierarchy = "parent_goal" if field == "shared_parent_goal" else field
            subjects[hierarchy].add(str(entry_id))
    for field, sources in subjects.items():
        fields = ("parent_goal", "shared_parent_goal") if field == "parent_goal" else (field,)
        rows = WikiAssertion.objects.filter(entry__wiki=wiki, field__in=fields)
        if field == "located_in":
            rows = rows.filter(entry__kind=WikiEntry.Kind.PLACE)
        edges = defaultdict(list)
        for entry_id, target, starts, ends in rows.values_list("entry_id", "value", "from_tick", "until_tick"):
            edges[str(entry_id)].append((target, starts, ends if ends is not None else MAX_CLOCK + 1))
        for source in sources:
            pending = list(edges[source])
            checked = set()
            while pending:
                target, starts, ends = pending.pop()
                if target == source:
                    label = "Place containment" if field == "located_in" else FIELDS[field].label
                    reject("RELATIONSHIP_CYCLE", f"{label} would form a cycle at time {starts}.")
                state = (target, starts, ends)
                if state in checked:
                    continue
                checked.add(state)
                for next_target, next_start, next_end in edges[target]:
                    overlap_start, overlap_end = max(starts, next_start), min(ends, next_end)
                    if overlap_start < overlap_end:
                        pending.append((next_target, overlap_start, overlap_end))


def at_tick(query, tick):
    return query.filter(from_tick__lte=tick).filter(Q(until_tick__isnull=True) | Q(until_tick__gt=tick))


def contains_tick(assertion, tick):
    return assertion.from_tick <= tick and (assertion.until_tick is None or tick < assertion.until_tick)
