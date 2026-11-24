from dataclasses import dataclass

from rest_framework import serializers

from cgs.api import StrictSerializer, TextField

from .draft_validation import canonical_input
from .models import WikiEntry


MAX_CLOCK = 9_007_199_254_740_991


@dataclass(frozen=True)
class WikiField:
    key: str
    label: str
    kinds: tuple[str, ...]
    value_kind: str = "text"
    target_kind: str | None = None
    choices: tuple[str, ...] = ()

    def describe(self):
        return {
            "key": self.key,
            "label": self.label,
            "kinds": self.kinds,
            "value_kind": self.value_kind,
            "target_kind": self.target_kind,
            "choices": self.choices,
        }


FIELDS = {
    field.key: field
    for field in (
        WikiField("status", "Status", tuple(WikiEntry.Kind.values)),
        WikiField("description", "Description", tuple(WikiEntry.Kind.values)),
        WikiField("height_cm", "Height (cm)", ("person", "place"), "integer"),
        WikiField("located_in", "Location", ("person", "place", "group", "item"), "reference", "place"),
        WikiField("affiliation", "Primary affiliation", ("person", "group"), "reference", "group"),
        WikiField("appearance", "Appearance", ("person",)),
        WikiField("background", "Background", ("person",)),
        WikiField("character_class", "Class", ("person",), "reference", "class"),
        WikiField("place_type", "Place type", ("place",), choices=("Area", "Settlement", "Building", "Room", "Landmark")),
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


class RecordEvent(EventDetails):
    op = serializers.ChoiceField(choices=("record_event",))
    tick = ExactClock()
    source = TextField(max_length=500, allow_blank=True, default="")
    changes = StateValue(many=True, required=False, max_length=40)


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
