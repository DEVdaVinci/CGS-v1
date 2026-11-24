from collections import defaultdict
from fractions import Fraction


def _has_kind(records, record_id, kind, field="kind"):
    return records.get(record_id, {}).get(field) == kind


def _entry_errors(entities, links, rules, facts, points):
    for link_id, link in links.items():
        path = f"/links/{link_id}"
        for field in ("from_id", "to_id"):
            if link[field] not in entities:
                yield "REFERENCE_UNAVAILABLE", "Choose an existing entry in this draft.", f"{path}/{field}"
        if link["kind"] == "located_in" and link["to_id"] in entities and not _has_kind(entities, link["to_id"], "place"):
            yield "REFERENCE_KIND", "A location link must point to a place.", path + "/to_id"

    for entity_id, entity in entities.items():
        path = f"/entities/{entity_id}"
        for field, kind in (("parent_place_id", "place"), ("role_id", "role")):
            target = entity.get(field)
            if target is not None and not _has_kind(entities, target, kind):
                yield "REFERENCE_UNAVAILABLE", f"Choose an existing {kind} in this draft.", f"{path}/{field}"
        visited = {entity_id}
        parent = entity.get("parent_place_id")
        while parent is not None:
            if parent in visited:
                yield "CYCLIC_PARENT", "Places cannot contain themselves or their ancestors.", path + "/parent_place_id"
                break
            visited.add(parent)
            parent = entities.get(parent, {}).get("parent_place_id")
        if set(entity.get("action_rule_ids", ())) - rules.keys():
            yield "REFERENCE_UNAVAILABLE", "Choose existing action rules.", path + "/action_rule_ids"
        bounds = entity.get("bounds")
        if bounds and any(bounds[f"{axis}_min_cm"] >= bounds[f"{axis}_max_cm"] for axis in ("x", "y")):
            yield "INVALID_BOUNDS", "Room bounds must have positive width and height.", path + "/bounds"
        policy = entity.get("policy", {})
        if policy.get("mode") == "alarm_move":
            if policy["stimulus_fact_id"] not in facts:
                yield "REFERENCE_UNAVAILABLE", "Select the stimulus fact.", path + "/policy/stimulus_fact_id"
            if policy["destination_point_id"] not in points:
                yield "REFERENCE_UNAVAILABLE", "Select an existing alarm point.", path + "/policy/destination_point_id"
            if not _has_kind(rules, policy["move_rule_id"], "move", "template"):
                yield "REFERENCE_KIND", "Select a movement rule.", path + "/policy/move_rule_id"


def _fact_errors(facts, entities, references):
    intervals = defaultdict(list)
    for fact_id, fact in facts.items():
        path = f"/facts/{fact_id}"
        if fact["subject_id"] not in references:
            yield "REFERENCE_UNAVAILABLE", "Select an existing subject for this fact.", path + "/subject_id"
        if set(fact["source_ref_ids"]) - references:
            yield "REFERENCE_UNAVAILABLE", "Select existing sources for this fact.", path + "/source_ref_ids"
        value = fact["value"]
        if value["kind"] in ("reference", "references"):
            ids = [value["value"]] if value["kind"] == "reference" else value["value"]
            if set(ids) - references:
                yield "REFERENCE_UNAVAILABLE", "Select existing records for this fact value.", path + "/value"
        start, end = fact["effective_from_tick"], fact["effective_until_tick"]
        if end is not None and end <= start:
            yield "INVALID_INTERVAL", "The ending tick must be after the starting tick.", path + "/effective_until_tick"
        elif fact["kind"] == "truth":
            intervals[fact["subject_id"], fact["predicate"]].append((start, fact_id, end))
        if fact["kind"] == "claim" and not _has_kind(entities, fact["claimant_id"], "actor"):
            yield "REFERENCE_KIND", "Select a character who made this claim.", path + "/claimant_id"

    for group in intervals.values():
        last_end = -1
        for start, fact_id, end in sorted(group):
            if start < last_end:
                yield "OVERLAPPING_TRUTH", "Verified facts about the same subject and predicate cannot overlap.", f"/facts/{fact_id}/effective_from_tick"
            last_end = max(last_end, end if end is not None else float("inf"))


def _covered_segment(start, end, rooms):
    # Clip the segment to each rectangle. A walkable segment must have no gaps
    # between the resulting intervals, including where two rooms meet.
    intervals = []
    for bounds in rooms:
        low, high = Fraction(0), Fraction(1)
        for axis in ("x", "y"):
            initial = start[axis + "_cm"]
            step = end[axis + "_cm"] - initial
            minimum, maximum = bounds[f"{axis}_min_cm"], bounds[f"{axis}_max_cm"]
            if step:
                first, last = sorted((Fraction(minimum - initial, step), Fraction(maximum - initial, step)))
                low, high = max(low, first), min(high, last)
            elif not minimum <= initial <= maximum:
                low, high = Fraction(1), Fraction(0)
            if low > high:
                break
        if low <= high:
            intervals.append((low, high))

    covered = Fraction(0)
    for first, last in sorted(intervals):
        if first > covered:
            return False
        covered = max(covered, last)
        if covered == 1:
            return True
    return False


def _layout_errors(entities, facts, points, edges):
    rooms = {k: v.get("bounds") for k, v in entities.items() if v["kind"] == "place"}
    all_bounded = bool(rooms) and all(rooms.values())
    for point_id, point in points.items():
        path = f"/layout/points/{point_id}"
        if point["place_id"] not in rooms:
            yield "REFERENCE_KIND", "Choose the room that contains this point.", path + "/place_id"
            continue
        bounds = rooms[point["place_id"]]
        if bounds and any(
            not bounds[f"{axis}_min_cm"] <= point["at"][axis + "_cm"] <= bounds[f"{axis}_max_cm"]
            for axis in ("x", "y")
        ):
            yield "POINT_OUTSIDE_ROOM", "Place this point inside its room bounds.", path + "/at"

    for edge_id, edge in edges.items():
        path = f"/layout/edges/{edge_id}"
        start, end = points.get(edge["from_point_id"]), points.get(edge["to_point_id"])
        if start is None or end is None:
            yield "REFERENCE_UNAVAILABLE", "Select two existing points for this path.", path
        elif start["id"] == end["id"]:
            yield "INVALID_EDGE", "A path must connect two different points.", path + "/to_point_id"
        elif all_bounded and edge["traversable"] and not _covered_segment(start["at"], end["at"], rooms.values()):
            yield "PATH_OUTSIDE_ROOMS", "A traversable path must stay inside the authored room bounds.", path
        if edge["required_fact_id"] is not None and edge["required_fact_id"] not in facts:
            yield "REFERENCE_UNAVAILABLE", "Select an existing fact that reveals this path.", path + "/required_fact_id"


def _rule_errors(entities, facts, rules):
    for rule_id, rule in rules.items():
        if "parameters" not in rule:
            continue
        p = rule["parameters"]
        path = f"/rules/{rule_id}/parameters"
        match rule["template"]:
            case "search":
                if not _has_kind(entities, p["site_id"], "place"):
                    yield "REFERENCE_KIND", "Select a place to search.", path + "/site_id"
                if set(p["discovery_fact_ids"]) - facts.keys():
                    yield "REFERENCE_UNAVAILABLE", "Select existing facts to discover.", path + "/discovery_fact_ids"
            case "report":
                if any(a != "party" and not _has_kind(entities, a[6:], "actor") for a in p["audiences"]):
                    yield "REFERENCE_UNAVAILABLE", "Select existing report recipients.", path + "/audiences"
            case "cast":
                if not _has_kind(entities, p["target_role_id"], "role"):
                    yield "REFERENCE_KIND", "Select an existing target role.", path + "/target_role_id"
                if p["on_attempt_fact_id"] is not None and p["on_attempt_fact_id"] not in facts:
                    yield "REFERENCE_UNAVAILABLE", "Select an existing stimulus fact.", path + "/on_attempt_fact_id"
            case "progress":
                if p["unlock_rule_id"] not in rules:
                    yield "REFERENCE_UNAVAILABLE", "Select an existing rule to unlock.", path + "/unlock_rule_id"


def _start_errors(start, entities, facts, rules, points):
    actors = start["actors"]
    occupied = set()
    for actor_id, actor in actors.items():
        path = f"/start/actors/{actor_id}"
        if not _has_kind(entities, actor_id, "actor"):
            yield "REFERENCE_KIND", "Select an existing character.", path
        if actor["point_id"] not in points:
            yield "REFERENCE_UNAVAILABLE", "Select a starting point on the layout.", path + "/point_id"
        if actor["hp"] > actor["hp_max"] or actor["focus"] > actor["focus_max"]:
            yield "RESOURCE_ABOVE_MAXIMUM", "Starting HP and Focus must be within their maximums.", path
        if actor["occupies"]:
            if actor["point_id"] in occupied:
                yield "OCCUPIED_START", "Two occupying characters cannot start at the same point.", path + "/point_id"
            occupied.add(actor["point_id"])
        if set(actor["extra_rule_ids"]) - rules.keys():
            yield "REFERENCE_UNAVAILABLE", "Select existing extra rules.", path + "/extra_rule_ids"

    for field in ("controlled_player_id", "sentry_id"):
        if start[field] not in actors:
            yield "REFERENCE_UNAVAILABLE", "Give this character a starting position and stats.", "/start/" + field
    if set(start["scout_ids"]) - actors.keys():
        yield "REFERENCE_UNAVAILABLE", "Give each scout a starting position and stats.", "/start/scout_ids"
    if not _has_kind(rules, start["progress_rule_id"], "progress", "template"):
        yield "REFERENCE_KIND", "Choose a progression rule for the encounter.", "/start/progress_rule_id"

    for item_id, point_id in start["item_positions"].items():
        if not _has_kind(entities, item_id, "item") or point_id not in points:
            yield "REFERENCE_UNAVAILABLE", "Select an existing item and starting point.", f"/start/item_positions/{item_id}"
    seen = set()
    for observation in start["initial_observations"]:
        audience, fact_id = observation["audience"], observation["fact_id"]
        if fact_id not in facts or (audience != "party" and audience[6:] not in actors):
            yield "REFERENCE_UNAVAILABLE", "Choose an existing fact and a character in the encounter or the party.", "/start/initial_observations"
        if (audience, fact_id) in seen:
            yield "DUPLICATE_OBSERVATION", "List each audience and fact pair once.", "/start/initial_observations"
        seen.add((audience, fact_id))


def reference_errors(document):
    entities, links, facts, rules = (document[name] for name in ("entities", "links", "facts", "rules"))
    layout = document["layout"] or {}
    points, edges = layout.get("points", {}), layout.get("edges", {})
    collections = (
        ("entities", entities), ("links", links), ("facts", facts), ("rules", rules),
        ("layout/points", points), ("layout/edges", edges),
    )
    references = set()
    for group, records in collections:
        for key, record in records.items():
            if key != record["id"]:
                yield "IMMUTABLE_IDENTITY", "The record ID must match its collection key.", f"/{group}/{key}"
            if key in references:
                yield "DUPLICATE_ID", "Use a separate ID for each record.", f"/{group}/{key}"
            references.add(key)

    yield from _entry_errors(entities, links, rules, facts, points)
    yield from _fact_errors(facts, entities, references)
    yield from _layout_errors(entities, facts, points, edges)
    yield from _rule_errors(entities, facts, rules)
    if document["start"] is not None:
        yield from _start_errors(document["start"], entities, facts, rules, points)
