from collections import defaultdict

from django.db.models import Max

from .models import WikiEvent
from .wiki import reject
from .wiki_schema import MAX_CLOCK


def event_for(wiki, event_id):
    event = WikiEvent.objects.filter(wiki=wiki, pk=event_id).first()
    if event is None:
        reject("INVALID_EVENT", "Choose an event in this world.")
    return event


def event_bounds(event):
    if event.node_kind == WikiEvent.Kind.GROUP:
        if event.start_tick is None and event.end_tick is None:
            return None
        if event.start_tick is None or event.end_tick is None:
            reject("EVENT_RANGE", "Give the event group both dates or let its dates follow its children.")
        start, end = event.start_tick, event.end_tick
    elif event.date_precision == WikiEvent.Precision.UNKNOWN:
        if any(value is not None for value in (event.tick, event.start_tick, event.end_tick)):
            reject("EVENT_RANGE", "Leave all dates blank when the event date is unknown.")
        return None
    elif event.date_precision == WikiEvent.Precision.BOUNDED:
        if event.tick is not None or event.start_tick is None or event.end_tick is None:
            reject("EVENT_RANGE", "Enter the earliest and latest possible dates for this event.")
        start, end = event.start_tick, event.end_tick
        if start == end:
            reject("EVENT_RANGE", "Use an exact date when the earliest and latest times are the same.")
    else:
        if event.tick is None:
            reject("EVENT_RANGE", "Enter the event's exact effective time.")
        start = event.tick if event.start_tick is None else event.start_tick
        end = start if event.end_tick is None else event.end_tick
    if not 0 <= start <= end <= MAX_CLOCK:
        reject("EVENT_RANGE", "Keep the event's start and end in order and within the world clock.")
    if event.tick is not None and not start <= event.tick <= end:
        reject("EVENT_RANGE", "Set the effective time within the recorded event dates.")
    return start, end


def _within(event, limit, bounds):
    if limit and bounds and (bounds[0] < limit[0] or bounds[1] > limit[1]):
        reject(
            "EVENT_OUTSIDE_PARENT",
            f"{event.name} is dated {bounds[0]}–{bounds[1]}. Choose a group that includes those dates "
            f"or adjust the enclosing dates {limit[0]}–{limit[1]}.",
        )


def check_event_tree(event):
    nodes = {node.pk: node for node in WikiEvent.objects.filter(wiki=event.wiki)}
    children = defaultdict(list)
    for node in nodes.values():
        children[node.parent_id].append(node)

    parents = []
    seen = {event.pk}
    parent_id = event.parent_id
    while parent_id is not None:
        parent = nodes.get(parent_id)
        if parent is None or parent.node_kind != WikiEvent.Kind.GROUP:
            reject("INVALID_EVENT_PARENT", "Choose an event group in this world.")
        if parent_id in seen:
            reject("EVENT_CYCLE", "An event group cannot be placed inside itself or one of its descendants.")
        seen.add(parent_id)
        parents.append(parent)
        parent_id = parent.parent_id

    limit = None
    for parent in reversed(parents):
        limit = event_bounds(parent) or limit
    pending = [(event, limit)]
    while pending:
        node, enclosing = pending.pop()
        dates = event_bounds(node)
        _within(node, enclosing, dates)
        pending.extend((child, dates or enclosing) for child in children[node.pk])


def attach_event(event, parent_id):
    if parent_id:
        parent = event_for(event.wiki, parent_id)
        if parent.node_kind != WikiEvent.Kind.GROUP:
            reject("INVALID_EVENT_PARENT", "Choose an event group to contain this event.")
        event.parent = parent
    position = WikiEvent.objects.filter(
        wiki=event.wiki, parent_id=event.parent_id,
    ).aggregate(last=Max("sort_order"))["last"]
    event.sort_order = 0 if position is None else position + 1


def update_event_references(event, references):
    if event.node_kind != WikiEvent.Kind.GROUP:
        reject("INVALID_EVENT_REFERENCES", "Add cross-references from an event group.")
    ids = set(references)
    targets = list(WikiEvent.objects.filter(wiki=event.wiki, pk__in=ids).exclude(node_kind=WikiEvent.Kind.GROUP))
    if len(targets) != len(ids):
        reject("INVALID_EVENT_REFERENCES", "Choose recorded actions or occurrences in this world.")
    event.cross_references.set(targets)


def update_event_causes(event, references):
    ids = set(references)
    targets = list(WikiEvent.objects.filter(wiki=event.wiki, pk__in=ids))
    if len(targets) != len(ids):
        reject("INVALID_EVENT_CAUSE", "Choose cause events in this world.")
    prior_causes = defaultdict(list)
    for dependent, cause in WikiEvent.objects.filter(
        wiki=event.wiki, cause_events__isnull=False,
    ).values_list("id", "cause_events__id"):
        prior_causes[dependent].append(cause)
    pending = [target.pk for target in targets]
    visited = set()
    while pending:
        cause = pending.pop()
        if cause == event.pk:
            reject("EVENT_CAUSE_CYCLE", "An event cannot be its own cause, directly or through other cause links.")
        if cause not in visited:
            visited.add(cause)
            pending.extend(prior_causes[cause])
    event.cause_events.set(targets)


def organize_event(wiki, command):
    event = event_for(wiki, command["event_id"])
    old_parent = event.parent_id
    parent_id = command["parent_id"]
    parent = event_for(wiki, parent_id) if parent_id else None
    if parent and (parent.pk == event.pk or parent.node_kind != WikiEvent.Kind.GROUP):
        reject("INVALID_EVENT_PARENT", "Choose another event group to contain this event.")
    event.parent = parent
    event.save(update_fields=["parent"])
    check_event_tree(event)
    siblings = list(WikiEvent.objects.filter(wiki=wiki, parent=parent).exclude(pk=event.pk).order_by("sort_order", "id"))
    siblings.insert(command.get("position", len(siblings)), event)
    if old_parent != event.parent_id:
        previous = WikiEvent.objects.filter(wiki=wiki, parent_id=old_parent).order_by("sort_order", "id")
        for order, sibling in enumerate(previous):
            sibling.sort_order = order
            siblings.append(sibling)
    current = [sibling for sibling in siblings if sibling.parent_id == event.parent_id]
    for order, sibling in enumerate(current):
        sibling.sort_order = order
    WikiEvent.objects.bulk_update(siblings, ["sort_order"])
    return event.pk, set()
