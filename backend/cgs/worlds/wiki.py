from django.db.models import Q

from cgs.api import CgsError, parse_id, resource_unavailable

from .models import WikiEntry, WorldAccess
from .services import get_membership
from .wiki_schema import FIELDS, MAX_CLOCK


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


def typed_value(entry, field, value):
    definition = FIELDS[field]
    if entry.kind not in definition.kinds:
        reject("INVALID_FIELD", f"{definition.label} is unavailable for this entry type.")
    if definition.target_kind is not None:
        target = entry_for(entry.wiki, parse_id(value, field), definition.target_kind)
        if target.pk == entry.pk:
            reject("INVALID_REFERENCE", f"{definition.label} must point to a different entry.")
        return str(target.pk)
    if definition.value_kind == "integer":
        if type(value) is not int or not 0 <= value <= MAX_CLOCK:
            reject("INVALID_VALUE", f"{definition.label} requires a nonnegative whole number.")
    elif not isinstance(value, str) or not value.strip() or len(value) > 500:
        reject("INVALID_VALUE", f"{definition.label} requires text of 1 to 500 characters.")
    if definition.choices and value not in definition.choices:
        reject("INVALID_VALUE", f"Choose a supported value for {definition.label}.")
    return value


def at_tick(query, tick):
    return query.filter(from_tick__lte=tick).filter(Q(until_tick__isnull=True) | Q(until_tick__gt=tick))


def contains_tick(assertion, tick):
    return assertion.from_tick <= tick and (assertion.until_tick is None or tick < assertion.until_tick)
