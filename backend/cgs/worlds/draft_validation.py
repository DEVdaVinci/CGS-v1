from copy import deepcopy
from itertools import islice
from pathlib import Path
import json
import re
from unicodedata import normalize
from uuid import uuid4

from jsonschema import Draft202012Validator

from cgs.api import CgsError, ID_PATTERN

from .draft_references import reference_errors


DEFINITIONS = json.loads(Path(__file__).with_name("authoring.schema.json").read_text(encoding="utf-8"))["$defs"]
ENTITY_REQUIRED = {spec["properties"]["kind"]["const"]: spec["required"] for spec in DEFINITIONS["Entity"]["oneOf"]}
ALIAS = re.compile(r"@[a-z][a-z0-9_]{0,31}")
RECORD_IDENTITIES = {
    ("entities",): ("id", "kind"),
    ("links",): ("id", "kind", "from_id", "to_id"),
    ("facts",): ("id", "kind"),
    ("rules",): ("id", "template", "rule_version"),
    ("layout", "points"): ("id",),
    ("layout", "edges"): ("id",),
}
MISSING = object()


def issue(code, message, pointer=None):
    result = {"code": code, "message": message}
    if pointer and len(pointer) <= 160:
        result["pointer"] = pointer
    return result


def invalid(code, message, pointer=None):
    raise CgsError(422, "VALIDATION_FAILED", "Review the draft changes.", [issue(code, message, pointer)])


def canonical_input(value):
    if isinstance(value, str):
        value = normalize("NFC", value)
        try:
            value.encode("utf-8")
        except UnicodeError as exc:
            raise CgsError(400, "INVALID_INPUT", "Use valid Unicode text.") from exc
        if "\x00" in value:
            raise CgsError(400, "INVALID_INPUT", "Text cannot contain a null character.")
        return value
    if isinstance(value, dict):
        return {key: canonical_input(item) for key, item in value.items()}
    if isinstance(value, list):
        return [canonical_input(item) for item in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def validation_errors(value, definition, prefix=""):
    validator = Draft202012Validator({**definition, "$defs": DEFINITIONS})
    errors = []
    for error in validator.iter_errors(value):
        # Registered paths only use simple object keys. Walk back to a safe pointer when needed.
        parts = [str(part) for part in error.absolute_path]
        detail = prefix
        for part in parts:
            if not re.fullmatch(r"[^/~]+", part):
                break
            detail += "/" + part
        if error.validator == "required":
            missing = next((key for key in error.validator_value if key not in error.instance), None)
            if missing:
                detail += "/" + missing
        errors.append(issue("INVALID_VALUE", "Check the value or type of this field.", detail or None))
    return errors[:100]


def manual_command(raw):
    if not isinstance(raw, dict) or raw.get("mode") != "manual":
        raise CgsError(400, "INVALID_INPUT", "Submit a manual draft edit.")
    data = canonical_input(raw)
    schema = DEFINITIONS["DraftWrite"]["oneOf"][0]
    if validation_errors(data, schema):
        raise CgsError(400, "INVALID_INPUT", "Submit a valid revision and a group of 1 to 40 edits.")
    return data


def _definition(schema):
    if "$ref" in schema:
        return DEFINITIONS[schema["$ref"].rsplit("/", 1)[1]]
    return schema


def _variant(schema, value):
    for option in _definition(schema).get("oneOf", ()):
        shape = _definition(option)
        if isinstance(value, dict) and "properties" in shape:
            if all(value.get(key) == prop["const"] for key, prop in shape["properties"].items() if "const" in prop):
                return option
        if value is None and shape.get("type") == "null":
            return option
        if isinstance(value, str) and shape.get("type") == "string":
            return option
        if isinstance(value, list) and shape.get("type") == "array":
            return option
    return schema


def _resolve_alias(value, aliases, pointer):
    if ALIAS.fullmatch(value):
        if value not in aliases:
            invalid("UNDEFINED_ALIAS", "This reference has no matching new record in the save.", pointer)
        return aliases[value][0]
    return value


def _field(schema, key):
    if key in schema.get("properties", {}):
        return schema["properties"][key]
    for pattern, value in schema.get("patternProperties", {}).items():
        if re.fullmatch(pattern, key):
            return value
    return {}


def _resolve(value, schema, aliases, pointer):
    selected = _variant(schema, value)
    ref = selected.get("$ref", "")
    if isinstance(value, str) and ref.endswith("/Id"):
        return _resolve_alias(value, aliases, pointer)
    if isinstance(value, str) and ref.endswith("/Audience") and value.startswith("actor:"):
        return "actor:" + _resolve_alias(value[6:], aliases, pointer)
    shape = _definition(selected)
    if isinstance(value, dict):
        resolved = {}
        for key, item in value.items():
            actual = _resolve_alias(key, aliases, pointer) if shape.get("patternProperties") else key
            if actual in resolved:
                invalid("DUPLICATE_ID", "This object specifies the same record twice.", pointer + "/" + actual)
            resolved[actual] = _resolve(item, _field(shape, actual), aliases, pointer + "/" + actual)
        return resolved
    if isinstance(value, list) and "items" in shape:
        return [_resolve(item, shape["items"], aliases, pointer) for item in value]
    return value


def _edit_target(document, pointer, aliases):
    parts = tuple(pointer[1:].split("/"))
    if len(parts) == 1 and parts in RECORD_IDENTITIES:
        invalid("INVALID_PATH", "Edit the individual records in this collection.", pointer)
    actual = []
    node = document
    schema = DEFINITIONS["DraftWorld"]
    for index, part in enumerate(parts):
        if not isinstance(node, dict):
            invalid("UNKNOWN_PATH", "This field’s parent does not exist.", pointer)
        parent_shape = _definition(_variant(schema, node))
        part = _resolve_alias(part, aliases, pointer) if parent_shape.get("patternProperties") else part
        schema = _field(parent_shape, part)
        if not schema:
            invalid("UNKNOWN_PATH", "Choose a registered draft field.", pointer)
        actual.append(part)
        if index == len(parts) - 1:
            return tuple(actual), node, parent_shape, schema
        node = node.get(part, MISSING)


def _value_at(value, parts):
    for part in parts:
        if not isinstance(value, dict):
            return MISSING
        value = value.get(part, MISSING)
    return value


def _check_policy(parts, before, after, protected):
    for target in protected:
        if parts == target[:len(parts)]:
            relative = target[len(parts):]
            old, new = _value_at(before, relative), _value_at(after, relative)
        elif target == parts[:len(target)]:
            old, new = before, after
        else:
            continue
        if old is MISSING or new is MISSING:
            changed = old is not new
        else:
            changed = json.dumps(old, sort_keys=True) != json.dumps(new, sort_keys=True)
        if changed:
            invalid("LOCKED_FIELD", "This field is protected from all edits.", "/" + "/".join(target))


def _apply(document, edit, aliases, protected, issued):
    parts, node, parent_shape, schema = _edit_target(document, edit["pointer"], aliases)
    pointer = "/" + "/".join(parts)
    field = parts[-1]
    if field in RECORD_IDENTITIES.get(parts[:-2], ()) or parts == ("layout", "frame_id"):
        invalid("IMMUTABLE_IDENTITY", "A record’s identity cannot be edited.", pointer)
    previous = node.get(field, MISSING)
    op = edit["op"]
    if (op == "add") != (previous is MISSING):
        invalid("EDIT_CONFLICT", "The field must be absent for add and present for set or remove.", pointer)

    if op == "remove":
        if field in parent_shape.get("required", ()):
            invalid("REQUIRED_FIELD", "This field belongs to the record’s required shape.", pointer)
        _check_policy(parts, previous, MISSING, protected)
        del node[field]
        return {"op": op, "pointer": pointer}

    value = _resolve(edit["value"], schema, aliases, pointer)
    errors = validation_errors(value, _definition(_variant(schema, value)), pointer)
    if errors:
        raise CgsError(422, "VALIDATION_FAILED", "Review the draft changes.", errors)
    identity = RECORD_IDENTITIES.get(parts[:-1])
    if identity:
        if value["id"] != field:
            invalid("IMMUTABLE_IDENTITY", "The record ID must match its edit path.", pointer)
        if op == "set" and any(previous[k] != value[k] for k in identity):
            invalid("IMMUTABLE_IDENTITY", "Keep the record’s identity and meaning when editing it.", pointer)
        if op == "add" and parts[0] in issued:
            if field in issued[parts[0]]:
                invalid("IDENTITY_ALREADY_ISSUED", "A new record must use a fresh identity.", pointer)
            issued[parts[0]].add(field)
    if parts == ("layout",) and previous is not None and value is not None and previous["frame_id"] != value["frame_id"]:
        invalid("IMMUTABLE_IDENTITY", "Keep the existing layout frame when editing the map.", pointer + "/frame_id")
    _check_policy(parts, previous, value, protected)
    node[field] = value
    return {"op": op, "pointer": pointer, "value": deepcopy(value)}


def candidate_draft(document, edits, policy):
    aliases = {}
    for edit in edits:
        parts = tuple(edit["pointer"][1:].split("/"))
        alias = parts[-1]
        if edit["op"] == "add" and parts[:-1] in RECORD_IDENTITIES and ALIAS.fullmatch(alias):
            if alias in aliases:
                invalid("DUPLICATE_ALIAS", "Use each new record alias once.", edit["pointer"])
            aliases[alias] = (str(uuid4()), parts[:-1])
    protected = [
        tuple(rule["pointer"][1:].split("/")) for field in ("locked", "reserved")
        for rule in policy[field] if rule["all_writes"]
    ]
    issued = {collection: set(document[collection]) for collection in ("entities", "facts", "links", "rules")}
    candidate = deepcopy(document)
    resolved = [_apply(candidate, edit, aliases, protected, issued) for edit in edits]
    if document["layout"] and candidate["layout"] and document["layout"]["frame_id"] != candidate["layout"]["frame_id"]:
        invalid("IMMUTABLE_IDENTITY", "Keep the existing layout frame when editing the map.", "/layout/frame_id")
    for alias, (record_id, parent) in aliases.items():
        if _value_at(candidate, (*parent, record_id)) is MISSING:
            invalid("ALIAS_NOT_RETAINED", "Keep the new record or remove its alias from this save.", "/" + "/".join((*parent, alias)))
    errors = validation_errors(candidate, DEFINITIONS["DraftWorld"])
    if not errors:
        errors = [issue(*failure) for failure in islice(reference_errors(candidate), 100)]
    if errors:
        raise CgsError(422, "VALIDATION_FAILED", "Review the draft changes.", errors)
    return candidate, resolved, [{"alias": alias, "id": value[0]} for alias, value in sorted(aliases.items())]


def draft_problems(document, entry_id=None):
    problems = []
    for entity_id, entity in document["entities"].items():
        if entry_id is not None and entity_id != entry_id:
            continue
        for field in ENTITY_REQUIRED[entity["kind"]]:
            if field not in entity:
                problems.append(issue(
                    "INCOMPLETE_ENTRY",
                    f"Add {field.replace('_', ' ')} before publication.",
                    f"/entities/{entity_id}/{field}",
                ))
    if entry_id is None:
        for record_id, rule in document["rules"].items():
            for field in ("name", "parameters"):
                if field not in rule:
                    problems.append(issue(
                        "INCOMPLETE_RULE", f"Add the rule’s {field} before publication.",
                        f"/rules/{record_id}/{field}",
                    ))
        for field in ("layout", "start"):
            if document[field] is None:
                problems.append(issue("INCOMPLETE_DRAFT", f"Configure {field} before publication.", "/" + field))
    return problems[:100]


def changed_entries(before, after):
    changed = {
        key for key in before["entities"].keys() | after["entities"].keys()
        if before["entities"].get(key) != after["entities"].get(key)
    }
    for key in before["links"].keys() | after["links"].keys():
        earlier, later = before["links"].get(key), after["links"].get(key)
        if earlier != later:
            for link in (earlier, later):
                if link is not None:
                    changed.update((link["from_id"], link["to_id"]))
    return sorted(changed)[:500]
