from dataclasses import dataclass
from decimal import Decimal

from rest_framework import serializers

from cgs.api import StrictSerializer, TextField

from .draft_validation import canonical_input
from .models import WikiCausalTerm, WikiEntry, WikiEvent


MAX_CLOCK = 9_007_199_254_740_991
ACTORS = ("person", "organism")
EVENT_PERFORMERS = (*ACTORS, "group", "item")
DEFINITIONS = ("class", "species")
ENTITY_KINDS = tuple(WikiEntry.Kind.values)
VISUAL_ASSETS = ("image", "model_3d", "texture", "animation", "map")
PHYSICAL_ENTITIES = (*ACTORS, *DEFINITIONS, "item", "place")
RESOURCE_HOLDERS = (*ACTORS, "group", "place", "item")
DECLARATION_KINDS = ("role", "status_def", "relation_def", "relation", "rel_term")
RELATIONSHIP_ROLES = (
    ("first_party", "allowed_first_party_kind", "first_party_limit"),
    ("second_party", "allowed_second_party_kind", "second_party_limit"),
)
NONLIVING = ("item", "place", "group", "culture", "territory", *VISUAL_ASSETS)
LIFESPAN_START_FIELDS = {
    "death_tick": "birth_tick",
    "destruction_tick": "creation_tick",
    "extinction_tick": "creation_tick",
}
DATE_WINDOW_FIELDS = {
    "birth_tick": "birth_window",
    "death_tick": "death_window",
    "creation_tick": "creation_window",
    "destruction_tick": "destruction_window",
    "extinction_tick": "extinction_window",
}
EXACT_DATE_FIELDS = {window: exact for exact, window in DATE_WINDOW_FIELDS.items()}
MEASURED_FIELDS = (
    "resource_amount", "declared_reward", "declared_cost", "actual_rating", "physical_average", "physical_distribution",
    "power_average", "power_distribution", "physical_measure",
    "processing_speed", "mental_bandwidth", "processing_efficiency", "processing_cost",
    "processing_overload", "emotional_stress", "weight_measure", "movement_amount", "health_severity", "context_difficulty",
)
IDENTITY = "Identity and classification"
PHYSICAL = "Physical traits and condition"
RELATIONSHIPS = "Relationships and affiliations"
RESOURCES = "Resources and inventory"
MIND = "Mind and goals"
SPATIAL = "Spatial relationships"
VISUALS = "Visual references"
SPECIES_PROFILE = "Species population"


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
    minimum: int | None = None
    maximum: int | None = None
    initial_only: bool = False

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
            "uses_unit": self.key in MEASURED_FIELDS,
            "initial_only": self.initial_only,
            "minimum": self.minimum,
            "maximum": self.maximum,
        }


FIELDS = {
    field.key: field
    for field in (
        WikiField("status", "Status", tuple(WikiEntry.Kind.values)),
        WikiField("description", "Description", tuple(WikiEntry.Kind.values)),
        WikiField("height_cm", "Height (cm)", PHYSICAL_ENTITIES, "integer",
                  section=PHYSICAL, inherited=True),
        WikiField("width_cm", "Width (cm)", PHYSICAL_ENTITIES, "decimal",
                  section=PHYSICAL, inherited=True),
        WikiField("length_cm", "Length (cm)", PHYSICAL_ENTITIES, "decimal",
                  section=PHYSICAL, inherited=True),
        WikiField("located_in", "Location", (*ACTORS, "place", "group", "item"), "reference", "place",
                  section=SPATIAL),
        WikiField("affiliation", "Primary affiliation", (*ACTORS, "group"), "reference", "group",
                  section=RELATIONSHIPS),
        WikiField("appearance", "Appearance", (*PHYSICAL_ENTITIES, "body_part"), section=PHYSICAL, inherited=True),
        WikiField("background", "Background", ACTORS, section=IDENTITY),
        WikiField("character_class", "Class", ACTORS, "reference", "class", section=IDENTITY),
        WikiField("place_type", "Place type", ("place",), section=SPATIAL,
                  choices=("Area", "Region", "Settlement", "Terrain", "Building", "Wing", "Floor", "Room", "Landmark")),
        WikiField("place_purpose", "Place purpose", ("place",), section=SPATIAL, many=True),
        WikiField("alias", "Alias", ENTITY_KINDS, section=IDENTITY, many=True),
        WikiField("epithet", "Epithet", ENTITY_KINDS, section=IDENTITY, many=True),
        WikiField("birth_tick", "Birth time", ACTORS, "integer", section=IDENTITY),
        WikiField("death_tick", "Death time", ACTORS, "integer", section=IDENTITY),
        WikiField("creation_tick", "Creation time", (*NONLIVING, "species"), "integer", section=IDENTITY),
        WikiField("destruction_tick", "Destruction time", NONLIVING, "integer", section=IDENTITY),
        WikiField("extinction_tick", "Extinction time", ("species",), "integer", section=IDENTITY),
        WikiField("birth_window", "Birth date window", ACTORS, "time_window", section=IDENTITY),
        WikiField("death_window", "Death date window", ACTORS, "time_window", section=IDENTITY),
        WikiField("creation_window", "Creation date window", (*NONLIVING, "species"), "time_window", section=IDENTITY),
        WikiField("destruction_window", "Destruction date window", NONLIVING, "time_window", section=IDENTITY),
        WikiField("extinction_window", "Extinction date window", ("species",), "time_window", section=IDENTITY),
        WikiField("era_start", "Period start", ("era",), "integer", section=IDENTITY),
        WikiField("era_end", "Period end", ("era",), "integer", section=IDENTITY),
        WikiField("species", "Species", ACTORS, "reference", "species", section=IDENTITY),
        WikiField("extra_class", "Additional class", ACTORS, "reference", "class", section=IDENTITY, many=True),
        WikiField("inherits_from", "Parent definition", DEFINITIONS, "reference",
                  section=IDENTITY, targets=DEFINITIONS, many=True, acyclic=True, inverse="Derived definitions"),
        WikiField("birthplace", "Birthplace", ACTORS, "reference", "place", section=IDENTITY),
        WikiField("origin", "Place of origin", ACTORS, "reference", "place", section=IDENTITY),
        WikiField("nationality", "Nationality or citizenship", ACTORS, "reference",
                  section=IDENTITY, targets=("group", "place"), many=True, inverse="Citizens and nationals"),
        WikiField("residence", "Residence", ACTORS, "reference", "place", section=SPATIAL),
        WikiField("destination", "Destination", ACTORS, "reference", "place", section=SPATIAL),
        WikiField("mass_kg", "Mass (kg)", PHYSICAL_ENTITIES, "decimal", section=PHYSICAL, inherited=True),
        WikiField("weight_measure", "Weight", (*PHYSICAL_ENTITIES, "body_part"), "decimal", section=PHYSICAL,
                  qualifier_kind="trait", qualifier_required=True, minimum=0),
        WikiField("physical_trait", "Physical trait", (*ACTORS, *DEFINITIONS), section=PHYSICAL,
                  qualifier_kind="trait", qualifier_required=True, inherited=True),
        WikiField("physical_measure", "Physical measurement", (*PHYSICAL_ENTITIES, "body_part"), "decimal",
                  section=PHYSICAL, qualifier_kind="trait", qualifier_required=True, inherited=True),
        WikiField("anatomy", "Body part", (*ACTORS, *DEFINITIONS), "reference", "body_part",
                  section=PHYSICAL, many=True, inherited=True),
        WikiField("part_parent", "Enclosing body part", ("body_part",), "reference", "body_part",
                  section=PHYSICAL, many=True, acyclic=True, inverse="Constituent body parts"),
        WikiField("body_function", "Body function", (*ACTORS, *DEFINITIONS, "body_part"), "reference", "body_fn",
                  section=PHYSICAL, many=True, inverse="Performs this function"),
        WikiField("condition", "Physical condition", ACTORS, section=PHYSICAL,
                  qualifier_kind="body_part", qualifier_required=True),
        WikiField("functionality", "Physical function", ACTORS, section=PHYSICAL,
                  qualifier_kind="body_part", qualifier_required=True),
        WikiField("health_pct", "Overall health (%)", ACTORS, "decimal", section=PHYSICAL, minimum=0, maximum=100),
        WikiField("part_damage_pct", "Part damage (%)", ACTORS, "decimal", section=PHYSICAL,
                  qualifier_kind="body_part", qualifier_required=True, minimum=0, maximum=100),
        WikiField("part_function_pct", "Part functionality (%)", ACTORS, "decimal", section=PHYSICAL,
                  qualifier_kind="body_part", qualifier_required=True, minimum=0, maximum=100),
        WikiField("health_subject", "Affected individual", ("health_case",), "reference", section=PHYSICAL,
                  targets=ACTORS, inverse="Health records", initial_only=True),
        WikiField("health_part", "Affected body part", ("health_case",), "reference", "body_part", section=PHYSICAL,
                  inverse="Health records involving this part"),
        WikiField("health_course", "Course status", ("health_case",), section=PHYSICAL,
                  choices=("Ongoing", "Resolved")),
        WikiField("health_severity", "Severity", ("health_case",), "decimal", section=PHYSICAL,
                  qualifier_kind="trait", qualifier_required=True),
        WikiField("parent", "Parent", ACTORS, "reference", section=RELATIONSHIPS,
                  targets=ACTORS, many=True, inverse="Children", acyclic=True),
        WikiField("sibling", "Sibling", ACTORS, "reference", section=RELATIONSHIPS, targets=ACTORS, many=True),
        WikiField("family", "Other family relationship", ACTORS, "reference", section=RELATIONSHIPS,
                  targets=ACTORS, qualifier_kind="role", many=True, inverse="Family links"),
        WikiField("personal_link", "Personal relationship", ACTORS, "reference", section=RELATIONSHIPS,
                  targets=ACTORS, qualifier_kind="role", many=True, inverse="Personal links"),
        WikiField("membership", "Membership", ACTORS, "reference", "group",
                  section=RELATIONSHIPS, many=True, inverse="Members"),
        WikiField("culture", "Cultural affiliation", (*ACTORS, "group"), "reference", "culture",
                  section=RELATIONSHIPS, many=True, inverse="Affiliated entries"),
        WikiField("place_affiliation", "Place affiliation", (*ACTORS, "group", "item"), "reference", "place",
                  section=RELATIONSHIPS, many=True, inverse="Affiliated entries"),
        WikiField("group_type", "Group type", ("group",), section=IDENTITY,
                  choices=("Organization", "Society", "Family", "Government", "Nation", "Community")),
        WikiField("item_type", "Item type", ("item",), section=IDENTITY,
                  choices=("Vehicle", "Furniture", "Tool", "Weapon", "Clothing", "Device", "Structure",
                           "Storage", "Container", "Material")),
        WikiField("group_place", "Group place", ("group",), "reference", "place",
                  section=SPATIAL, many=True, inverse="Associated groups"),
        WikiField("era", "Era", ("culture",), "reference", "era",
                  section=RELATIONSHIPS, many=True, inverse="Cultures"),
        WikiField("territory", "Territory", ("place", "group"), "reference", "territory",
                  section=SPATIAL, many=True, inverse="Places and groups in this territory"),
        WikiField("map", "Map", ("place", "group", "territory"), "reference", "map",
                  section=SPATIAL, many=True, inverse="Mapped entries"),
        WikiField("landscape", "Landscape", ("territory",), section=SPATIAL),
        WikiField("terrain", "Terrain reference", ("territory",), "reference", "place",
                  section=SPATIAL, many=True),
        WikiField("role", "Assigned role", ACTORS, "reference", "role",
                  section=RELATIONSHIPS, qualifier_kind="group", many=True, inverse="Role holders"),
        WikiField("job", "Job", ACTORS, "reference", "role",
                  section=RELATIONSHIPS, qualifier_kind="group", many=True, inverse="Job holders"),
        WikiField("title", "Title", ENTITY_KINDS, "reference", "role",
                  section=RELATIONSHIPS, qualifier_kind="group", many=True, inverse="Title holders"),
        WikiField("assigned_status", "Status definition", ENTITY_KINDS, "reference", "status_def",
                  section=RELATIONSHIPS, many=True, inverse="Status holders"),
        WikiField("relationship_type", "Relationship type", ("relation",), "reference", "relation_def",
                  section=RELATIONSHIPS, inverse="Relationships of this type"),
        WikiField("first_party", "First party", ("relation",), "reference", section=RELATIONSHIPS,
                  targets=ENTITY_KINDS, inverse="Relationships as first party"),
        WikiField("second_party", "Second party", ("relation",), "reference", section=RELATIONSHIPS,
                  targets=ENTITY_KINDS, inverse="Relationships as second party"),
        WikiField("first_party_role", "First party's role", ("relation", "relation_def"), section=RELATIONSHIPS),
        WikiField("second_party_role", "Second party's role", ("relation", "relation_def"), section=RELATIONSHIPS),
        WikiField("relationship_direction", "Direction", ("relation_def",), section=RELATIONSHIPS,
                  choices=("Directed", "Mutual")),
        WikiField("allowed_first_party_kind", "Allowed first party type", ("relation_def",), "entry_kind",
                  section=RELATIONSHIPS, choices=ENTITY_KINDS, many=True),
        WikiField("allowed_second_party_kind", "Allowed second party type", ("relation_def",), "entry_kind",
                  section=RELATIONSHIPS, choices=ENTITY_KINDS, many=True),
        WikiField("first_party_limit", "First party's maximum active relationships", ("relation_def",), "integer",
                  section=RELATIONSHIPS),
        WikiField("second_party_limit", "Second party's maximum active relationships", ("relation_def",), "integer",
                  section=RELATIONSHIPS),
        WikiField("term_for", "Relationship or type", ("rel_term",), "reference", section=RELATIONSHIPS,
                  targets=("relation", "relation_def"), inverse="Term sets"),
        WikiField("term_party", "Applies to", ("rel_term",), section=RELATIONSHIPS,
                  choices=("First party", "Second party", "Whole relationship")),
        WikiField("role_category", "Definition type", ("role",), section=IDENTITY,
                  choices=("Role", "Profession", "Rank", "Title", "Office")),
        WikiField("parent_role", "Parent role or title", ("role",), "reference", "role", section=RELATIONSHIPS,
                  many=True, acyclic=True, inverse="Subordinate definitions"),
        WikiField("definition_issuer", "Issuing authority", ("role", "status_def"), "reference", section=IDENTITY,
                  targets=(*ACTORS, "group"), inverse="Issued definitions"),
        WikiField("status_duration", "Typical duration (world time units)", ("status_def",), "integer", section=IDENTITY),
        WikiField("role_duty", "Duty or expectation", DECLARATION_KINDS, section=RELATIONSHIPS, many=True),
        WikiField("declared_authority", "Declared authority", DECLARATION_KINDS, section=RELATIONSHIPS, many=True),
        WikiField("authority_scope", "Where authority applies", DECLARATION_KINDS, "reference",
                  section=RELATIONSHIPS, targets=ENTITY_KINDS, many=True),
        WikiField("declared_capability", "Declared capability", DECLARATION_KINDS, "reference",
                  section=RELATIONSHIPS, targets=("ability", "skill", "process", "behavior", "body_fn"),
                  many=True, inverse="Declared by"),
        WikiField("declared_cost", "Declared cost", DECLARATION_KINDS, "decimal", section=RESOURCES,
                  qualifier_kind="resource", qualifier_required=True, minimum=0),
        WikiField("declared_reward", "Declared reward", DECLARATION_KINDS, "decimal", section=RESOURCES,
                  qualifier_kind="resource", qualifier_required=True, minimum=0),
        WikiField("declared_benefit", "Declared benefit", DECLARATION_KINDS, section=RELATIONSHIPS, many=True),
        WikiField("declared_limitation", "Limitation", DECLARATION_KINDS, section=RELATIONSHIPS, many=True),
        WikiField("acquire_requirement", "Requirement to attain", DECLARATION_KINDS, "reference", "requirement",
                  section=RELATIONSHIPS, many=True, inverse="Required to attain"),
        WikiField("retain_requirement", "Requirement to maintain", DECLARATION_KINDS, "reference", "requirement",
                  section=RELATIONSHIPS, many=True, inverse="Required to maintain"),
        WikiField("actual_rating", "Actual rating", (*ACTORS, *DEFINITIONS, "item"), "decimal",
                  section=PHYSICAL, qualifier_kind="trait", qualifier_required=True, inherited=True),
        WikiField("registered_rating", "Registered rating", ACTORS, "reference", "role",
                  section=RELATIONSHIPS, qualifier_kind="group", many=True),
        WikiField("owner", "Owner", ("item",), "reference", section=RESOURCES,
                  targets=(*ACTORS, "group"), inverse="Owned items"),
        WikiField("possessor", "Possessor", ("item",), "reference", section=RESOURCES,
                  targets=(*ACTORS, "group"), inverse="Held items"),
        WikiField("worn_by", "Worn by", ("item",), "reference", section=RESOURCES,
                  targets=ACTORS, many=True, inverse="Worn items"),
        WikiField("equipped_by", "Equipped by", ("item",), "reference", section=RESOURCES,
                  targets=(*ACTORS, "item"), many=True, inverse="Equipped items"),
        WikiField("carried_by", "Carried by", ("item",), "reference", section=RESOURCES,
                  targets=(*ACTORS, "item"), many=True, inverse="Carried items"),
        WikiField("item_affiliation", "Related item", (*ACTORS, "group", "place"), "reference", "item",
                  section=RESOURCES, qualifier_kind="role", many=True, inverse="Related entries"),
        WikiField("item_container", "Contained in item", ("item",), "reference", "item",
                  section=SPATIAL, inverse="Contents", acyclic=True),
        WikiField("material", "Material or component", ("item",), "reference", "item",
                  section=PHYSICAL, many=True, inverse="Used in items"),
        WikiField("inventory", "Inventory quantity", (*ACTORS, *DEFINITIONS, "group"), "integer",
                  section=RESOURCES, qualifier_kind="item", qualifier_required=True, inherited=True),
        WikiField("resource_amount", "Resource amount", (*ACTORS, "group"), "decimal",
                  section=RESOURCES, qualifier_kind="resource", qualifier_required=True),
        WikiField("movement_sender", "From holder", ("resource_mv",), "reference", section=RESOURCES,
                  targets=RESOURCE_HOLDERS, inverse="Outgoing resource movements"),
        WikiField("movement_recipient", "To holder", ("resource_mv",), "reference", section=RESOURCES,
                  targets=RESOURCE_HOLDERS, inverse="Incoming resource movements"),
        WikiField("movement_amount", "Amount moved", ("resource_mv",), "decimal", section=RESOURCES,
                  qualifier_kind="resource", qualifier_required=True, minimum=0),
        WikiField("unit", "Unit", ("resource", "trait"), section=RESOURCES),
        WikiField("image", "Image", ENTITY_KINDS, "reference", "image", section=VISUALS, many=True),
        WikiField("model_3d", "3D model", ENTITY_KINDS, "reference", "model_3d", section=VISUALS, many=True),
        WikiField("texture", "Texture", ENTITY_KINDS, "reference", "texture", section=VISUALS, many=True),
        WikiField("animation", "Animation", ENTITY_KINDS, "reference", "animation", section=VISUALS, many=True),
        WikiField("asset_location", "Asset location", VISUAL_ASSETS, section=VISUALS),
        WikiField("typical_ability", "Typical ability", DEFINITIONS, "reference", "ability",
                  section=SPECIES_PROFILE, many=True),
        WikiField("typical_item", "Typical item", DEFINITIONS, "reference", "item",
                  section=SPECIES_PROFILE, many=True, inverse="Typical for these definitions"),
        WikiField("typical_item_share", "Typical item population share (0–1)", ("species",), "decimal",
                  section=SPECIES_PROFILE, qualifier_kind="item", qualifier_required=True, minimum=0, maximum=1),
        WikiField("ability_type", "Ability type", ("ability",), section=IDENTITY,
                  choices=("Power", "Ability", "Technique")),
        WikiField("ability_domain", "Ability domain", ("ability",), section=IDENTITY,
                  choices=("Physical", "Mental", "Financial"), many=True),
        WikiField("physical_average", "Average physical measurement", ("species",), "decimal",
                  section=SPECIES_PROFILE, qualifier_kind="trait", qualifier_required=True),
        WikiField("physical_distribution", "Physical measurement distribution", ("species",), "distribution",
                  section=SPECIES_PROFILE, qualifier_kind="trait", qualifier_required=True),
        WikiField("power_average", "Average power rating", ("species",), "decimal",
                  section=SPECIES_PROFILE, qualifier_kind="trait", qualifier_required=True),
        WikiField("power_distribution", "Power rating distribution", ("species",), "distribution",
                  section=SPECIES_PROFILE, qualifier_kind="trait", qualifier_required=True),
        WikiField("personality_average", "Typical personality", ("species",), section=SPECIES_PROFILE,
                  qualifier_kind="trait", qualifier_required=True),
        WikiField("personality", "Personality trait", (*ACTORS, *DEFINITIONS), section=MIND,
                  qualifier_kind="trait", qualifier_required=True, inherited=True),
        WikiField("values", "Value", ACTORS, section=MIND, many=True),
        WikiField("preference", "Preference", ACTORS, section=MIND, many=True),
        WikiField("actor_value", "Held value", ACTORS, "reference", "value_def",
                  section=MIND, many=True, inverse="Actors who hold this value"),
        WikiField("preference_holder", "Preference holder", ("preference",), "reference", section=MIND,
                  targets=ACTORS, inverse="Preferences"),
        WikiField("preferred_entry", "Preferred entry", ("preference",), "reference", section=MIND,
                  targets=ENTITY_KINDS, many=True, inverse="Preferred by these records"),
        WikiField("avoided_entry", "Avoided entry", ("preference",), "reference", section=MIND,
                  targets=ENTITY_KINDS, many=True, inverse="Avoided by these records"),
        WikiField("motivation_value", "Motivating value", ("motivation",), "reference", "value_def",
                  section=MIND, many=True, inverse="Motivations"),
        WikiField("motivation_preference", "Motivating preference", ("motivation",), "reference", "preference",
                  section=MIND, many=True, inverse="Motivations"),
        WikiField("motivation_subject", "Subject of the motivation", ("motivation",), "reference",
                  section=MIND, targets=ENTITY_KINDS),
        WikiField("mood", "Emotional state", ACTORS, section=MIND),
        WikiField("reported_mood", "Mood", ACTORS, section=MIND),
        WikiField("mental_state", "Mental state", ACTORS, section=MIND),
        WikiField("mental_process", "Mental process", ACTORS, "reference", "process", section=MIND, many=True),
        WikiField("skill", "Skill", ACTORS, "reference", "skill", section=MIND, many=True),
        WikiField("available_behavior", "Available behavior", ENTITY_KINDS, "reference", "behavior",
                  section=MIND, many=True, inverse="Holders of this behavior"),
        WikiField("behavior_capability", "Capability used", ("behavior",), "reference", section=MIND,
                  targets=("ability", "skill", "process", "body_fn"), many=True, inverse="Behaviors using this capability"),
        WikiField("behavior_target", "Possible target", ("behavior",), "reference", section=MIND,
                  targets=ENTITY_KINDS, many=True),
        WikiField("behavior_context", "Applicable context", ("behavior",), "reference", section=MIND,
                  targets=ENTITY_KINDS, many=True),
        WikiField("behavior_grant", "Grant source", ("behavior",), "reference", section=MIND,
                  targets=ENTITY_KINDS, many=True, inverse="Granted behaviors"),
        WikiField("behavior_goal", "Intended goal", ("behavior",), "reference", "goal",
                  section=MIND, many=True, inverse="Behaviors for this goal"),
        WikiField("success_probability", "Success probability (0–1)", ACTORS, "decimal", section=MIND,
                  qualifier_kind="skill", qualifier_required=True, minimum=0, maximum=1),
        WikiField("context_actor", "Measured actor", ("context",), "reference", section=MIND,
                  targets=ACTORS, inverse="Capability contexts"),
        WikiField("context_capability", "Measured capability", ("context",), "reference", section=MIND,
                  targets=("ability", "skill", "process"), inverse="Capability contexts"),
        WikiField("context_circumstance", "Related circumstance", ("context",), "reference", section=MIND,
                  targets=ENTITY_KINDS),
        WikiField("context_probability", "Success probability (0–1)", ("context",), "decimal", section=MIND,
                  minimum=0, maximum=1),
        WikiField("context_probability_range", "Success probability range (0–1)", ("context",),
                  "probability_range", section=MIND),
        WikiField("context_difficulty", "Difficulty", ("context",), "decimal", section=MIND,
                  qualifier_kind="trait", qualifier_required=True),
        WikiField("processing_speed", "Processing speed", (*ACTORS, "process", "skill", "context"), "decimal", section=MIND,
                  qualifier_kind="trait", qualifier_required=True, minimum=0),
        WikiField("mental_bandwidth", "Mental bandwidth", (*ACTORS, "context"), "decimal", section=MIND,
                  qualifier_kind="trait", qualifier_required=True, minimum=0),
        WikiField("processing_efficiency", "Processing efficiency", (*ACTORS, "process", "skill", "context"), "decimal", section=MIND,
                  qualifier_kind="trait", qualifier_required=True, minimum=0),
        WikiField("processing_cost", "Processing cost", (*ACTORS, "process", "skill", "context"), "decimal", section=MIND,
                  qualifier_kind="trait", qualifier_required=True, minimum=0),
        WikiField("processing_overload", "Processing overload", (*ACTORS, "context"), "decimal", section=MIND,
                  qualifier_kind="trait", qualifier_required=True, minimum=0),
        WikiField("emotional_stress", "Emotional stress", (*ACTORS, "context"), "decimal", section=MIND,
                  qualifier_kind="trait", qualifier_required=True, minimum=0),
        WikiField("goal_owner", "Goal owner", ("goal",), "reference", section=MIND, targets=ACTORS, inverse="Goals"),
        WikiField("parent_goal", "Parent goal", ("goal",), "reference", "goal",
                  section=MIND, inverse="Subgoals", acyclic=True),
        WikiField("shared_parent_goal", "Additional parent goal", ("goal",), "reference", "goal",
                  section=MIND, many=True, inverse="Subgoals", acyclic=True),
        WikiField("shared_goal_order", "Position within another goal", ("goal",), "integer", section=MIND,
                  qualifier_kind="goal", qualifier_required=True),
        WikiField("goal_subject", "Related subject", ("goal",), "reference",
                  section=MIND, targets=tuple(WikiEntry.Kind.values)),
        WikiField("priority", "Priority", ("goal",), "integer", section=MIND),
        WikiField("goal_mode", "Goal type", ("goal", "milestone"), section=MIND, choices=("Achieve", "Maintain")),
        WikiField("goal_motivation", "Motivation", ("goal", "milestone"), "reference", "motivation",
                  section=MIND, many=True, inverse="Goals supported"),
        WikiField("goal_order", "Order within the plan", ("goal",), "integer", section=MIND),
        WikiField("milestone_goal", "Goal", ("milestone",), "reference", "goal", section=MIND, inverse="Milestones"),
        WikiField("milestone_order", "Order within goal", ("milestone",), "integer", section=MIND),
        WikiField("plan_requirement", "Requirement", ("goal", "milestone"), "reference", "requirement",
                  section=MIND, many=True, inverse="Needed for"),
        WikiField("requirement_mode", "Requirements needed", ("goal", "milestone"), section=MIND,
                  choices=("All listed", "Any listed")),
        WikiField("method_requirement", "Requirement", ("method",), "reference", "requirement",
                  section=MIND, inverse="Methods"),
        WikiField("method_order", "Order within the requirement", ("method",), "integer", section=MIND),
        WikiField("alternative_method", "Alternative method", ("requirement",), "reference", "method",
                  section=MIND, many=True, inverse="Alternative for"),
        WikiField("step_method", "Method", ("method_step",), "reference", "method", section=MIND, inverse="Steps"),
        WikiField("step_order", "Position within the method", ("method_step",), "integer", section=MIND, minimum=0),
        WikiField("step_subject", "Related entry", ("method_step",), "reference", section=MIND, targets=ENTITY_KINDS),
        WikiField("source_medium", "Medium", ("source",), section="Source details",
                  choices=("Document", "Artifact", "Recording", "Person", "Other")),
        WikiField("source_locator", "Locator", ("source",), section="Source details"),
        WikiField("source_excerpt", "Excerpt", ("source",), section="Source details"),
        WikiField("source_person", "Recorded person", ("source",), "reference", section="Source details", targets=ACTORS),
        WikiField("source_tick", "Created or recorded at time", ("source",), "integer", section="Source details"),
        WikiField("source_creator", "Creator or reporter", ("source",), "reference", section="Source details",
                  targets=(*ACTORS, "group"), inverse="Sources created or reported"),
        WikiField("source_custodian", "Custodian", ("source",), "reference", section="Source details",
                  targets=(*ACTORS, "group", "place"), inverse="Sources held"),
    )
}


class ExactInteger(serializers.IntegerField):
    def to_internal_value(self, data):
        if type(data) is not int:
            self.fail("invalid")
        return super().to_internal_value(data)


class ExactClock(ExactInteger):
    def __init__(self, **kwargs):
        super().__init__(min_value=0, max_value=MAX_CLOCK, **kwargs)


class WikiRef(serializers.UUIDField):
    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        return str(super().to_internal_value(data))


class WikiLocationQuery(StrictSerializer):
    at = serializers.IntegerField(min_value=0, max_value=MAX_CLOCK, required=False)
    view_as = WikiRef(required=False)
    overview = serializers.BooleanField(default=False)

    def validate(self, attrs):
        if attrs["overview"] and ("at" in attrs or "view_as" in attrs):
            raise serializers.ValidationError("Use a dated read to select a time or character viewpoint.")
        attrs["at"] = None if attrs["overview"] else attrs.get("at", 0)
        return attrs


class WikiSearchQuery(StrictSerializer):
    q = serializers.CharField(max_length=100)


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
    overview = TextField(max_length=1500, allow_blank=True, required=False)
    catalog_type = serializers.ChoiceField(choices=WikiEntry.CatalogType.values, required=False)
    variant_of_id = WikiRef(required=False, allow_null=True)
    initial_at = ExactClock(required=False)
    initial_values = DefinedValue(many=True, required=False, max_length=len(FIELDS))

    def validate(self, attrs):
        if "catalog_type" in attrs and attrs["kind"] != WikiEntry.Kind.ITEM:
            raise serializers.ValidationError({"catalog_type": "This catalog type is supported on items."})
        # Legacy API clients can still replay the original create command.
        values = attrs.get("initial_values", ())
        health_record = attrs["kind"] == WikiEntry.Kind.HEALTH_CASE
        if health_record and not any(value["field"] == "health_subject" for value in values):
            raise serializers.ValidationError({"initial_values": "Choose the character or organism affected by this condition."})
        workspace_entry = health_record or "overview" in attrs or "catalog_type" in attrs
        if workspace_entry and values and "initial_at" not in attrs:
            raise serializers.ValidationError({"initial_at": "Choose when the initial facts apply."})
        return attrs


class RenameEntry(StrictSerializer):
    op = serializers.ChoiceField(choices=("rename_entry",))
    entry_id = WikiRef()
    name = TextField(max_length=100)


class SetVariantOrigin(StrictSerializer):
    op = serializers.ChoiceField(choices=("set_variant_origin",))
    entry_id = WikiRef()
    variant_of_id = WikiRef(allow_null=True)


class UpdateOverview(StrictSerializer):
    op = serializers.ChoiceField(choices=("update_overview",))
    entry_id = WikiRef()
    overview = TextField(max_length=1500, allow_blank=True)


class UpdateWorldIntroduction(StrictSerializer):
    op = serializers.ChoiceField(choices=("update_world_introduction",))
    introduction = TextField(max_length=3000, allow_blank=True)


class UpdateWorldHome(StrictSerializer):
    op = serializers.ChoiceField(choices=("update_world_home",))
    introduction = TextField(max_length=3000, allow_blank=True)
    cover_map_id = WikiRef(allow_null=True)
    featured_entry_ids = serializers.ListField(child=WikiRef(), max_length=8)

    def validate_featured_entry_ids(self, entries):
        if len(entries) != len(set(entries)):
            raise serializers.ValidationError("Feature each article only once.")
        return entries


class SetDiscovery(StrictSerializer):
    op = serializers.ChoiceField(choices=("set_discovery",))
    entry_id = WikiRef()
    observer_id = WikiRef()
    learned_at = ExactClock(allow_null=True)
    source = TextField(max_length=500, allow_blank=True, default="")


class ArticleSection(StrictSerializer):
    id = WikiRef()
    heading = TextField(max_length=120)
    body = TextField(max_length=8000, allow_blank=True)

    def validate_heading(self, value):
        heading = value.strip()
        if not heading:
            raise serializers.ValidationError("Give each article section a heading.")
        return heading


class UpdateArticleSections(StrictSerializer):
    op = serializers.ChoiceField(choices=("update_article_sections",))
    entry_id = WikiRef()
    sections = ArticleSection(many=True, max_length=20)

    def validate_sections(self, sections):
        if len({section["id"] for section in sections}) != len(sections):
            raise serializers.ValidationError("Article section IDs must be unique within the article.")
        return sections


class StateValue(DefinedValue):
    entry_id = WikiRef()


class RecordFact(StateValue):
    op = serializers.ChoiceField(choices=("record_fact",))
    from_tick = ExactClock()
    until_tick = ExactClock(allow_null=True, default=None)
    source = TextField(max_length=500, allow_blank=True, default="")
    citation_id = WikiRef(allow_null=True, required=False)


class CorrectFact(StrictSerializer):
    op = serializers.ChoiceField(choices=("correct_fact",))
    assertion_id = WikiRef()
    value = serializers.JSONField()
    from_tick = ExactClock(required=False)
    source = TextField(max_length=500, allow_blank=True, required=False)
    citation_id = WikiRef(allow_null=True, required=False)
    bind_unit = serializers.BooleanField(required=False)
    author_only = serializers.BooleanField(required=False)


class AbilityUse(StrictSerializer):
    ability_id = WikiRef()
    actor_id = WikiRef()


class EventDetails(StrictSerializer):
    name = TextField(max_length=120)
    significance = serializers.ChoiceField(choices=WikiEvent.Significance.values, allow_blank=True, required=False)
    source = TextField(max_length=500, allow_blank=True, required=False)
    citation_id = WikiRef(allow_null=True, required=False)
    description = TextField(max_length=1500, allow_blank=True, required=False)
    summary = TextField(max_length=500, allow_blank=True, required=False)
    method = TextField(max_length=1500, allow_blank=True, required=False)
    participant_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    performer_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    target_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    place_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    item_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    purpose_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    fulfillment_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    behavior_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    backstory_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    era_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    cause_event_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    cause_assertion_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    ability_use = AbilityUse(allow_null=True, required=False)
    start_tick = ExactClock(allow_null=True, required=False)
    end_tick = ExactClock(allow_null=True, required=False)
    cross_reference_ids = serializers.ListField(child=WikiRef(), required=False)


class EventChange(StateValue):
    mode = serializers.ChoiceField(choices=("set", "add", "end"), required=False)
    source = TextField(max_length=500, allow_blank=True, required=False)


class RecordEvent(EventDetails):
    op = serializers.ChoiceField(choices=("record_event",))
    tick = ExactClock(allow_null=True)
    date_precision = serializers.ChoiceField(choices=WikiEvent.Precision.values, required=False)
    source = TextField(max_length=500, allow_blank=True, default="")
    changes = EventChange(many=True, required=False, max_length=40)
    parent_id = WikiRef(allow_null=True, required=False)
    node_kind = serializers.ChoiceField(choices=("occurrence", "action"), required=False)


class RecordEventGroup(EventDetails):
    op = serializers.ChoiceField(choices=("record_event_group",))
    parent_id = WikiRef(allow_null=True, required=False)


class EditEvent(EventDetails):
    op = serializers.ChoiceField(choices=("edit_event",))
    event_id = WikiRef()
    tick = ExactClock(allow_null=True, required=False)
    date_precision = serializers.ChoiceField(choices=WikiEvent.Precision.values, required=False)


class OrganizeEvent(StrictSerializer):
    op = serializers.ChoiceField(choices=("organize_event",))
    event_id = WikiRef()
    parent_id = WikiRef(allow_null=True)
    position = ExactClock(required=False)


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
    anchor_event_id = WikiRef(allow_null=True, required=False)
    speaker_id = WikiRef(allow_null=True, required=False)
    citation_id = WikiRef(allow_null=True, required=False)
    additional_citation_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    tick = ExactClock(allow_null=True)
    date_precision = serializers.ChoiceField(choices=WikiEvent.Precision.values, required=False)
    start_tick = ExactClock(allow_null=True, required=False)
    end_tick = ExactClock(allow_null=True, required=False)
    source = TextField(max_length=500, allow_blank=True, default="")


class CorrectClaim(StrictSerializer):
    op = serializers.ChoiceField(choices=("correct_claim",))
    claim_id = WikiRef()
    anchor_event_id = WikiRef(allow_null=True, required=False)
    value = serializers.JSONField()
    citation_id = WikiRef(allow_null=True, required=False)
    additional_citation_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    source = TextField(max_length=500, allow_blank=True, required=False)
    author_only = serializers.BooleanField(required=False)
    tick = ExactClock(allow_null=True, required=False)
    date_precision = serializers.ChoiceField(choices=WikiEvent.Precision.values, required=False)
    start_tick = ExactClock(allow_null=True, required=False)
    end_tick = ExactClock(allow_null=True, required=False)
    bind_unit = serializers.BooleanField(required=False)


class RecordObservation(StrictSerializer):
    op = serializers.ChoiceField(choices=("record_observation",))
    learning_source_id = WikiRef(required=False, allow_null=True)
    observer_id = WikiRef()
    source_kind = serializers.ChoiceField(choices=("assertion", "claim"))
    source_id = WikiRef()
    learned_at = ExactClock()
    about_tick = ExactClock(required=False)
    learning_note = TextField(max_length=500, allow_blank=True, required=False)
    author_only = serializers.BooleanField(required=False)


class RecordEventReport(StrictSerializer):
    op = serializers.ChoiceField(choices=("record_event_report",))
    event_id = WikiRef()
    observer_id = WikiRef()
    title = TextField(max_length=120)
    account = TextField(max_length=1500, allow_blank=True, default="")
    source = TextField(max_length=500, allow_blank=True, default="")
    learned_at = ExactClock()
    reported_tick = ExactClock(allow_null=True, default=None)
    earliest_tick = ExactClock(allow_null=True, default=None)
    latest_tick = ExactClock(allow_null=True, default=None)
    author_only = serializers.BooleanField(default=False)
    known_entry_ids = serializers.ListField(child=WikiRef(), max_length=40, default=list)


class CorrectEventReport(RecordEventReport):
    op = serializers.ChoiceField(choices=("correct_event_report",))
    report_id = WikiRef()


class RecordProposition(StateValue):
    op = serializers.ChoiceField(choices=("record_proposition",))
    holder_id = WikiRef()
    from_tick = ExactClock()
    until_tick = ExactClock(allow_null=True, default=None)
    about_tick = ExactClock(allow_null=True, required=False)
    evidence_id = WikiRef(allow_null=True, required=False)
    additional_evidence_ids = serializers.ListField(child=WikiRef(), max_length=40, required=False)
    confidence = serializers.DecimalField(
        max_digits=10, decimal_places=9, min_value=Decimal(0), max_value=Decimal(1), allow_null=True, required=False,
    )
    source = TextField(max_length=500, allow_blank=True, default="")

    def validate_confidence(self, value):
        return format(value.normalize(), "f") if value is not None else None


class CorrectProposition(RecordProposition):
    op = serializers.ChoiceField(choices=("correct_proposition",))
    proposition_id = WikiRef()


class ChangeBelief(RecordProposition):
    op = serializers.ChoiceField(choices=("change_belief",))
    previous_belief_id = WikiRef()
    until_tick = ExactClock(allow_null=True, required=False)
    author_only = serializers.BooleanField(required=False)


class CausalTermInput(StrictSerializer):
    phase = serializers.ChoiceField(choices=WikiCausalTerm.Phase.values)
    belief_id = WikiRef()


class RecordCausalAccount(StrictSerializer):
    op = serializers.ChoiceField(choices=("record_causal_account",))
    holder_id = WikiRef()
    title = TextField(max_length=100)
    applicability = TextField(max_length=500, allow_blank=True, default="")
    citation_id = WikiRef(allow_null=True, required=False)
    from_tick = ExactClock()
    until_tick = ExactClock(allow_null=True, default=None)
    author_only = serializers.BooleanField(default=False)
    terms = CausalTermInput(many=True, allow_empty=False, max_length=40)


class CorrectCausalAccount(RecordCausalAccount):
    op = serializers.ChoiceField(choices=("correct_causal_account",))
    account_id = WikiRef()


class SetCalendar(StrictSerializer):
    op = serializers.ChoiceField(choices=("set_calendar",))
    days_per_year = serializers.IntegerField(allow_null=True, min_value=1, max_value=1_000_000)


class SaveLayout(StrictSerializer):
    op = serializers.ChoiceField(choices=("save_layout",))
    place_id = WikiRef()
    name = TextField(max_length=100)
    from_tick = ExactClock()
    left_cm = ExactInteger(min_value=-MAX_CLOCK, max_value=MAX_CLOCK)
    top_cm = ExactInteger(min_value=-MAX_CLOCK, max_value=MAX_CLOCK)
    width_cm = ExactInteger(min_value=1, max_value=MAX_CLOCK)
    height_cm = ExactInteger(min_value=1, max_value=MAX_CLOCK)


class SaveWaypoint(StrictSerializer):
    op = serializers.ChoiceField(choices=("save_waypoint",))
    place_id = WikiRef()
    name = TextField(max_length=100)
    from_tick = ExactClock()
    point_id = WikiRef(required=False)
    x_cm = ExactInteger(min_value=-MAX_CLOCK, max_value=MAX_CLOCK)
    y_cm = ExactInteger(min_value=-MAX_CLOCK, max_value=MAX_CLOCK)


class SaveConnection(StrictSerializer):
    op = serializers.ChoiceField(choices=("save_connection",))
    connection_id = WikiRef(required=False)
    name = TextField(max_length=100)
    from_place = WikiRef()
    from_point = WikiRef()
    to_place = WikiRef()
    to_point = WikiRef()
    from_tick = ExactClock()
    until_tick = ExactClock(allow_null=True, default=None)
    bidirectional = serializers.BooleanField(default=True)
    length_cm = ExactClock(allow_null=True, default=None)
    description = TextField(max_length=500, allow_blank=True, default="")
    source = TextField(max_length=500, allow_blank=True, default="")


class CreateImageMap(StrictSerializer):
    op = serializers.ChoiceField(choices=("create_image_map",))
    name = TextField(max_length=100)
    author_only = serializers.BooleanField(default=False)
    upload_id = WikiRef()


class AttachMapImage(StrictSerializer):
    op = serializers.ChoiceField(choices=("attach_map_image",))
    map_id = WikiRef()
    upload_id = WikiRef()


class MapCoordinate(serializers.FloatField):
    default_error_messages = {"invalid": "Provide a number from 0 to 1."}

    def to_internal_value(self, data):
        if type(data) not in (int, float) or not 0 <= data <= 1:
            self.fail("invalid")
        return float(data)


class SaveMapPin(StrictSerializer):
    op = serializers.ChoiceField(choices=("save_map_pin",))
    map_id = WikiRef()
    pin_id = WikiRef(required=False)
    label = TextField(max_length=100)
    place_id = WikiRef(allow_null=True, default=None)
    x = MapCoordinate()
    y = MapCoordinate()


class RemoveMapPin(StrictSerializer):
    op = serializers.ChoiceField(choices=("remove_map_pin",))
    map_id = WikiRef()
    pin_id = WikiRef()


COMMANDS = {
    "create_entry": CreateEntry,
    "rename_entry": RenameEntry,
    "set_variant_origin": SetVariantOrigin,
    "update_overview": UpdateOverview,
    "update_world_introduction": UpdateWorldIntroduction,
    "update_world_home": UpdateWorldHome,
    "set_discovery": SetDiscovery,
    "update_article_sections": UpdateArticleSections,
    "record_fact": RecordFact,
    "correct_fact": CorrectFact,
    "record_event": RecordEvent,
    "record_event_group": RecordEventGroup,
    "edit_event": EditEvent,
    "organize_event": OrganizeEvent,
    "correct_event_date": CorrectEvent,
    "record_claim": RecordClaim,
    "correct_claim": CorrectClaim,
    "record_observation": RecordObservation,
    "record_event_report": RecordEventReport,
    "correct_event_report": CorrectEventReport,
    "record_proposition": RecordProposition,
    "correct_proposition": CorrectProposition,
    "change_belief": ChangeBelief,
    "record_causal_account": RecordCausalAccount,
    "correct_causal_account": CorrectCausalAccount,
    "set_calendar": SetCalendar,
    "save_layout": SaveLayout,
    "save_waypoint": SaveWaypoint,
    "save_connection": SaveConnection,
    "create_image_map": CreateImageMap,
    "attach_map_image": AttachMapImage,
    "save_map_pin": SaveMapPin,
    "remove_map_pin": RemoveMapPin,
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
