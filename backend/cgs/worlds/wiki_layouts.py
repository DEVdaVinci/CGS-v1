from uuid import uuid4

from django.db.models import Q

from .models import WikiConnection, WikiLayout, WikiLayoutFrame
from .wiki import at_tick, check_interval, entry_for, reject
from .wiki_schema import MAX_CLOCK


def _frame_at(layout, tick):
    return layout.frames.filter(from_tick__lte=tick).order_by("-from_tick").first()


def _require_layout(wiki, place_id):
    place = entry_for(wiki, place_id, "place")
    layout = WikiLayout.objects.filter(place=place).first()
    if layout is None:
        reject("MISSING_LAYOUT", "Give this place a measured layout first.")
    return layout


def _require_name(value):
    name = value.strip()
    if not name:
        reject("MISSING_NAME", "Enter a name.")
    return name


def _check_frame(bounds, points):
    right = bounds["left_cm"] + bounds["width_cm"]
    bottom = bounds["top_cm"] + bounds["height_cm"]
    if right > MAX_CLOCK or bottom > MAX_CLOCK:
        reject("LAYOUT_BOUNDS", "Keep the layout dimensions within the supported coordinate range.")
    for point in points:
        if not (bounds["left_cm"] <= point["x_cm"] <= right and bounds["top_cm"] <= point["y_cm"] <= bottom):
            reject("WAYPOINT_BOUNDS", f"{point['name']} must lie within this layout's bounds.")


def save_layout(wiki, command):
    place = entry_for(wiki, command["place_id"], "place")
    tick = command["from_tick"]
    layout, _ = WikiLayout.objects.get_or_create(place=place)
    previous = _frame_at(layout, tick)
    points = previous.points if previous else []
    bounds = {field: command[field] for field in ("left_cm", "top_cm", "width_cm", "height_cm")}
    _check_frame(bounds, points)
    WikiLayoutFrame.objects.update_or_create(
        layout=layout, from_tick=tick,
        defaults={"name": _require_name(command["name"]), "points": points, **bounds},
    )
    return layout.pk, set()


def save_waypoint(wiki, command):
    layout = _require_layout(wiki, command["place_id"])
    tick = command["from_tick"]
    previous = _frame_at(layout, tick)
    if previous is None:
        reject("MISSING_LAYOUT", "Give this place a measured layout at the selected time first.")
    points = previous.points.copy()
    point_id = command.get("point_id")
    position = len(points)
    if point_id:
        for index, point in enumerate(points):
            if point["id"] == point_id:
                position = index
                break
        else:
            reject("UNKNOWN_WAYPOINT", "Choose a waypoint on the selected layout.")
    point_id = point_id or str(uuid4())
    points[position:position + 1] = [{
        "id": point_id, "name": _require_name(command["name"]), "x_cm": command["x_cm"], "y_cm": command["y_cm"],
    }]
    bounds = {key: getattr(previous, key) for key in ("left_cm", "top_cm", "width_cm", "height_cm")}
    _check_frame(bounds, points)
    WikiLayoutFrame.objects.update_or_create(
        layout=layout, from_tick=tick, defaults={"name": previous.name, "points": points, **bounds},
    )
    return point_id, set()


def _check_endpoint(layout, point_id, start, end):
    first = _frame_at(layout, start)
    subsequent = layout.frames.filter(from_tick__gt=start).order_by("from_tick")
    if end is not None:
        subsequent = subsequent.filter(from_tick__lt=end)
    if first is None or any(
        not any(str(point_id) == point["id"] for point in frame.points)
        for frame in [first, *subsequent]
    ):
        reject("INACTIVE_WAYPOINT", "Choose endpoints present throughout the connection's effective dates.")


def save_connection(wiki, command):
    start, end = command["from_tick"], command["until_tick"]
    check_interval(start, end)
    first, last = _require_layout(wiki, command["from_place"]), _require_layout(wiki, command["to_place"])
    from_point, to_point = command["from_point"], command["to_point"]
    if first.pk == last.pk and from_point == to_point:
        reject("SAME_WAYPOINT", "A connection must join different waypoints.")
    _check_endpoint(first, from_point, start, end)
    _check_endpoint(last, to_point, start, end)
    connection = WikiConnection()
    if "connection_id" in command:
        connection = WikiConnection.objects.filter(from_layout__place__wiki=wiki, pk=command["connection_id"]).first()
        if connection is None:
            reject("INVALID_CONNECTION", "Choose a connection in this world.")
    connection.from_layout, connection.to_layout = first, last
    connection.from_point, connection.to_point = from_point, to_point
    connection.from_tick, connection.until_tick = start, end
    connection.name, connection.description, connection.source = _require_name(command["name"]), command["description"], command["source"]
    connection.bidirectional, connection.length_cm = command["bidirectional"], command["length_cm"]
    connection.save()
    return connection.pk, set()


def _describe_frame(frame):
    return {
        "id": str(frame.layout_id), "place_id": str(frame.layout.place_id), "name": frame.name,
        "from_tick": frame.from_tick, "left_cm": frame.left_cm, "top_cm": frame.top_cm,
        "width_cm": frame.width_cm, "height_cm": frame.height_cm, "points": frame.points,
    }


def place_layout(entry, at):
    frames = WikiLayoutFrame.objects.filter(layout__place__wiki_id=entry.wiki_id, from_tick__lte=at)
    available = [_describe_frame(frame) for frame in frames.select_related("layout").order_by("layout_id", "-from_tick").distinct("layout_id")]
    layout = next((item for item in available if item["place_id"] == str(entry.pk)), None)
    connections = []
    if layout is not None:
        routes = at_tick(WikiConnection.objects.filter(
            Q(from_layout_id=layout["id"]) | Q(to_layout_id=layout["id"]),
            from_layout__place__wiki_id=entry.wiki_id,
        ).select_related("from_layout", "to_layout"), at)
        for route in routes.order_by("name", "id"):
            connections.append({
                "id": str(route.pk), "name": route.name, "description": route.description, "source": route.source,
                "from_place": str(route.from_layout.place_id), "to_place": str(route.to_layout.place_id),
                "from_point": str(route.from_point), "to_point": str(route.to_point),
                "from_tick": route.from_tick, "until_tick": route.until_tick, "bidirectional": route.bidirectional,
                "length_cm": route.length_cm,
            })
    return {"frame": layout, "available": available, "connections": connections}
