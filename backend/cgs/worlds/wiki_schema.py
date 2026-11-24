from dataclasses import dataclass

from rest_framework import serializers

from cgs.api import StrictSerializer, TextField

from .draft_validation import canonical_input
from .models import WikiEntry


MAX_CLOCK = 9_007_199_254_740_991
ACTORS = ("person", "organism")
DEFINITIONS = ("class", "species")
IDENTITY = "Identity and classification"
PHYSICAL = "Physical traits and condition"
RELATIONSHIPS = "Relationships and affiliations"
RESOURCES = "Resources and inventory"
MIND = "Mind and goals"
SPATIAL = "Spatial relationships"


@dataclass(frozen=True)
class WikiField:
    key: str
    label: str
    kinds: tuple[str, ...]
    value_kind: str = "text"
    target_kind: str | None = None
    choices: tuple[str, ...] = ()
    section: str = ""
    targets: tuple[str, ...] = ()
    qualifier_kind: str | None = None
    qualifier_required: bool = False
    many: bool = False
    inherited: bool = False
    inverse: str = ""
    acyclic: bool = False

    @property
    def target_kinds(self):
        return (self.target_kind,) if self.target_kind else self.targets

    def describe(self):
        return {
            "key": self.key,
            "label": self.label,
            "kinds": self.kinds,
            "value_kind": self.value_kind,
            "target_kind": self.target_kind,
            "choices": self.choices,
            "section": self.section,
            "target_kinds": self.target_kinds,
            "qualifier_kind": self.qualifier_kind,
            "qualifier_required": self.qualifier_required,
            "many": self.many,
        }


FIELDS = {
    field.key: field
    for field in (
        WikiField("status", "Status", tuple(WikiEntry.Kind.values)),
        WikiField("description", "Description", tuple(WikiEntry.Kind.values)),
        WikiField("height_cm", "Height (cm)", (*ACTORS, *DEFINITIONS, "place"), "integer",
                  section=PHYSICAL, inherited=True),
        WikiField("located_in", "Location", (*ACTORS, "place", "group", "item"), "reference", "place",
                  section=SPATIAL),
        WikiField("affiliation", "Primary affiliation", (*ACTORS, "group"), "reference", "group",
                  section=RELATIONSHIPS),
        WikiField("appearance", "Appearance", (*ACTORS, *DEFINITIONS), section=PHYSICAL, inherited=True),
        WikiField("background", "Background", ACTORS, section=IDENTITY),
        WikiField("character_class", "Class", ACTORS, "reference", "class", section=IDENTITY),
        WikiField("place_type", "Place type", ("place",), section=SPATIAL,
                  choices=("Area", "Region", "Settlement", "Terrain", "Building", "Wing", "Floor", "Room", "Landmark")),
        WikiField("alias", "Alias", ACTORS, section=IDENTITY, many=True),
        WikiField("birth_tick", "Birth time", ACTORS, "integer", section=IDENTITY),
        WikiField("death_tick", "Death time", ACTORS, "integer", section=IDENTITY),
        WikiField("species", "Species", ACTORS, "reference", "species", section=IDENTITY),
        WikiField("extra_class", "Additional class", ACTORS, "reference", "class", section=IDENTITY, many=True),
        WikiField("inherits_from", "Parent definition", DEFINITIONS, "reference",
                  section=IDENTITY, targets=DEFINITIONS, many=True, acyclic=True, inverse="Derived definitions"),
        WikiField("origin", "Place of origin", ACTORS, "reference", "place", section=IDENTITY),
        WikiField("nationality", "Nationality or citizenship", ACTORS, "reference",
                  section=IDENTITY, targets=("group", "place"), many=True),
        WikiField("residence", "Residence", ACTORS, "reference", "place", section=SPATIAL),
        WikiField("destination", "Destination", ACTORS, "reference", "place", section=SPATIAL),
        WikiField("mass_kg", "Mass (kg)", (*ACTORS, *DEFINITIONS), "decimal", section=PHYSICAL, inherited=True),
        WikiField("physical_trait", "Physical trait", (*ACTORS, *DEFINITIONS), section=PHYSICAL,
                  qualifier_kind="trait", qualifier_required=True, inherited=True),
        WikiField("anatomy", "Body part", (*ACTORS, *DEFINITIONS), "reference", "body_part",
                  section=PHYSICAL, many=True, inherited=True),
        WikiField("condition", "Physical condition", ACTORS, section=PHYSICAL,
                  qualifier_kind="body_part", qualifier_required=True),
        WikiField("functionality", "Physical function", ACTORS, section=PHYSICAL,
                  qualifier_kind="body_part", qualifier_required=True),
        WikiField("parent", "Parent", ACTORS, "reference", section=RELATIONSHIPS,
                  targets=ACTORS, many=True, inverse="Children", acyclic=True),
        WikiField("family", "Other family relationship", ACTORS, "reference", section=RELATIONSHIPS,
                  targets=ACTORS, qualifier_kind="role", many=True, inverse="Family links"),
        WikiField("personal_link", "Personal relationship", ACTORS, "reference", section=RELATIONSHIPS,
                  targets=ACTORS, qualifier_kind="role", many=True, inverse="Personal links"),
        WikiField("membership", "Membership", ACTORS, "reference", "group",
                  section=RELATIONSHIPS, many=True, inverse="Members"),
        WikiField("culture", "Cultural affiliation", ACTORS, "reference", "culture",
                  section=RELATIONSHIPS, many=True, inverse="Affiliated people and organisms"),
        WikiField("role", "Assigned role", ACTORS, "reference", "role",
                  section=RELATIONSHIPS, qualifier_kind="group", many=True, inverse="Role holders"),
        WikiField("job", "Job", ACTORS, "reference", "role",
                  section=RELATIONSHIPS, qualifier_kind="group", many=True, inverse="Job holders"),
        WikiField("title", "Title", ACTORS, "reference", "role",
                  section=RELATIONSHIPS, qualifier_kind="group", many=True, inverse="Title holders"),
        WikiField("actual_rating", "Actual rating", ACTORS, "decimal",
                  section=PHYSICAL, qualifier_kind="trait", qualifier_required=True),
        WikiField("registered_rating", "Registered rating", ACTORS, "reference", "role",
                  section=RELATIONSHIPS, qualifier_kind="group", many=True),
        WikiField("owner", "Owner", ("item",), "reference", section=RESOURCES,
                  targets=(*ACTORS, "group"), inverse="Owned items"),
        WikiField("possessor", "Possessor", ("item",), "reference", section=RESOURCES,
                  targets=(*ACTORS, "group"), inverse="Held items"),
        WikiField("inventory", "Inventory quantity", (*ACTORS, "group"), "integer",
                  section=RESOURCES, qualifier_kind="item", qualifier_required=True),
        WikiField("resource_amount", "Resource amount", (*ACTORS, "group"), "decimal",
                  section=RESOURCES, qualifier_kind="resource", qualifier_required=True),
        WikiField("unit", "Unit", ("resource",), section=RESOURCES),
        WikiField("personality", "Personality trait", (*ACTORS, *DEFINITIONS), section=MIND,
                  qualifier_kind="trait", qualifier_required=True, inherited=True),
        WikiField("values", "Value", ACTORS, section=MIND, many=True),
        WikiField("preference", "Preference", ACTORS, section=MIND, many=True),
        WikiField("mood", "Emotional state", ACTORS, section=MIND),
        WikiField("mental_state", "Mental state", ACTORS, section=MIND),
        WikiField("goal_owner", "Goal owner", ("goal",), "reference", section=MIND, targets=ACTORS, inverse="Goals"),
        WikiField("parent_goal", "Parent goal", ("goal",), "reference", "goal",
                  section=MIND, inverse="Subgoals", acyclic=True),
        WikiField("goal_subject", "Related subject", ("goal",), "reference",
                  section=MIND, targets=tuple(WikiEntry.Kind.values)),
        WikiField("priority", "Priority", ("goal",), "integer", section=MIND),
    )
}


class ExactClock(serializers.IntegerField):
    def __init__(self, **kwargs):
        super().__init__(min_value=0, max_value=MAX_CLOCK, **kwargs)

    def to_internal_value(self, data):
        if type(data) is not int:
            self.fail("invalid")
        return super().to_internal_value(data)


class WikiRef(serializers.UUIDField):
    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        return str(super().to_internal_value(data))


class WikiLocationQuery(StrictSerializer):
    at = serializers.IntegerField(min_value=0, max_value=MAX_CLOCK, default=0)
    view_as = WikiRef(required=False)


class DefinedValue(StrictSerializer):
    field = serializers.ChoiceField(choices=tuple(FIELDS))
    value = serializers.JSONField()
    author_only = serializers.BooleanField(default=False)
    qualifier_id = WikiRef(required=False, allow_null=True)


class CreateEntry(StrictSerializer):
    op = serializers.ChoiceField(choices=("create_entry",))
    kind = serializers.ChoiceField(choices=WikiEntry.Kind.values)
    name = TextField(max_length=100)
    author_only = serializers.BooleanField(default=False)
    initial_at = ExactClock(required=False)
    initial_values = DefinedValue(many=True, required=False, max_length=len(FIELDS))


class RenameEntry(StrictSerializer):
    op = serializers.ChoiceField(choices=("rename_entry",))
    entry_id = WikiRef()
    name = TextField(max_length=100)


class StateValue(DefinedValue):
    entry_id = WikiRef()


class RecordFact(StateValue):
    op = serializers.ChoiceField(choices=("record_fact",))
    from_tick = ExactClock()
    until_tick = ExactClock(allow_null=True, default=None)
    source = TextField(max_length=500, allow_blank=True, default="")


class CorrectFact(StrictSerializer):
    op = serializers.ChoiceField(choices=("correct_fact",))
    assertion_id = WikiRef()
    value = serializers.JSONField()
    source = TextField(max_length=500, allow_blank=True, required=False)
    author_only = serializers.BooleanField(required=False)


class AbilityUse(StrictSerializer):
    ability_id = WikiRef()
    actor_id = WikiRef()


class EventDetails(StrictSerializer):
    name = TextField(max_length=120)
    source = TextField(max_length=500, allow_blank=True, required=False)
    description = TextField(max_length=1500, allow_blank=True, required=False)
    participant_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    place_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    item_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    ability_use = AbilityUse(allow_null=True, required=False)


class EventChange(StateValue):
    mode = serializers.ChoiceField(choices=("set", "add", "end"), required=False)
    source = TextField(max_length=500, allow_blank=True, required=False)


class RecordEvent(EventDetails):
    op = serializers.ChoiceField(choices=("record_event",))
    tick = ExactClock()
    source = TextField(max_length=500, allow_blank=True, default="")
    changes = EventChange(many=True, required=False, max_length=40)


class EditEvent(EventDetails):
    op = serializers.ChoiceField(choices=("edit_event",))
    event_id = WikiRef()


class RecordLearnedAbility(StrictSerializer):
    op = serializers.ChoiceField(choices=("record_learned_ability",))
    character_id = WikiRef()
    ability_id = WikiRef()
    learned_at = ExactClock()
    source = TextField(max_length=500, allow_blank=True, default="")


class CorrectLearnedAbility(StrictSerializer):
    op = serializers.ChoiceField(choices=("correct_learned_ability",))
    learned_ability_id = WikiRef()
    learned_at = ExactClock()
    source = TextField(max_length=500, allow_blank=True, required=False)


class CorrectEvent(StrictSerializer):
    op = serializers.ChoiceField(choices=("correct_event_date",))
    event_id = WikiRef()
    tick = ExactClock()


class RecordClaim(StateValue):
    op = serializers.ChoiceField(choices=("record_claim",))
    speaker_id = WikiRef()
    tick = ExactClock()
    source = TextField(max_length=500, allow_blank=True, default="")


class RecordObservation(StrictSerializer):
    op = serializers.ChoiceField(choices=("record_observation",))
    observer_id = WikiRef()
    source_kind = serializers.ChoiceField(choices=("assertion", "claim"))
    source_id = WikiRef()
    learned_at = ExactClock()
    about_tick = ExactClock(required=False)


class RecordProposition(StateValue):
    op = serializers.ChoiceField(choices=("record_proposition",))
    holder_id = WikiRef()
    from_tick = ExactClock()
    until_tick = ExactClock(allow_null=True, default=None)
    about_tick = ExactClock(allow_null=True, required=False)
    evidence_id = WikiRef(allow_null=True, required=False)
    source = TextField(max_length=500, allow_blank=True, default="")


class CorrectProposition(RecordProposition):
    op = serializers.ChoiceField(choices=("correct_proposition",))
    proposition_id = WikiRef()


class SetCalendar(StrictSerializer):
    op = serializers.ChoiceField(choices=("set_calendar",))
    days_per_year = serializers.IntegerField(allow_null=True, min_value=1, max_value=1_000_000)


COMMANDS = {
    "create_entry": CreateEntry,
    "rename_entry": RenameEntry,
    "record_fact": RecordFact,
    "correct_fact": CorrectFact,
    "record_event": RecordEvent,
    "edit_event": EditEvent,
    "correct_event_date": CorrectEvent,
    "record_claim": RecordClaim,
    "record_observation": RecordObservation,
    "record_proposition": RecordProposition,
    "correct_proposition": CorrectProposition,
    "set_calendar": SetCalendar,
    "record_learned_ability": RecordLearnedAbility,
    "correct_learned_ability": CorrectLearnedAbility,
}


class WikiWriteInput(StrictSerializer):
    expected_edit = ExactClock()
    command = serializers.JSONField()

    def to_internal_value(self, data):
        return super().to_internal_value(canonical_input(data))

    def validate_command(self, value):
        if not isinstance(value, dict) or not isinstance(value.get("op"), str):
            raise serializers.ValidationError("Choose a Wiki operation.")
        serializer = COMMANDS.get(value["op"])
        if serializer is None:
            raise serializers.ValidationError("Choose a supported Wiki operation.")
        form = serializer(data=value)
        form.is_valid(raise_exception=True)
        return form.validated_data
