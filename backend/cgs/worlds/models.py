from uuid import uuid4

from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Now


class CreatedRecord(models.Model):
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        abstract = True


class World(CreatedRecord):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.RESTRICT)
    title = models.CharField(max_length=100)
    auth_epoch = models.PositiveBigIntegerField(db_default=0)
    published_seq = models.PositiveBigIntegerField(db_default=0)

    class Meta:
        db_table = "world"


class WorldAccess(CreatedRecord):
    class Role(models.TextChoices):
        OWNER = "owner"
        EDITOR = "editor"
        READER = "reader"
        PLAYER = "player"

    pk = models.CompositePrimaryKey("world_id", "account_id")
    world = models.ForeignKey(World, on_delete=models.RESTRICT, db_index=False)
    account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.RESTRICT, db_index=False)
    role = models.CharField(max_length=12, choices=Role)
    capabilities = models.JSONField()
    enabled = models.BooleanField()

    class Meta:
        db_table = "world_access"
        indexes = [models.Index(fields=["account", "enabled", "world"], name="world_access_by_account")]
        constraints = [
            models.CheckConstraint(
                condition=Q(role__in=["owner", "editor", "reader", "player"]),
                name="world_access_valid_role",
            ),
            models.UniqueConstraint(fields=["world"], condition=Q(role="owner"), name="one_world_owner_grant"),
        ]


class WorldDraft(CreatedRecord):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    world = models.OneToOneField(World, on_delete=models.RESTRICT, related_name="draft")
    head_revision = models.PositiveBigIntegerField(db_default=0)
    active_policy_version = models.PositiveBigIntegerField(db_default=1)

    class Meta:
        db_table = "world_draft"
        constraints = [
            models.UniqueConstraint(fields=["world", "id"], name="world_draft_scope"),
            models.CheckConstraint(condition=Q(active_policy_version__gte=1), name="draft_policy_pin_positive"),
        ]


class DraftRevision(CreatedRecord):
    pk = models.CompositePrimaryKey("draft_id", "revision")
    draft = models.ForeignKey(WorldDraft, on_delete=models.RESTRICT, db_constraint=False, db_index=False)
    world_id = models.UUIDField()
    revision = models.PositiveBigIntegerField()
    previous_revision = models.PositiveBigIntegerField(null=True)
    policy_version = models.PositiveBigIntegerField(db_default=1)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.RESTRICT)
    document = models.JSONField()
    digest = models.CharField(max_length=64)
    provenance = models.JSONField()

    class Meta:
        db_table = "draft_revision"
        constraints = [
            models.UniqueConstraint(fields=["world_id", "draft", "revision"], name="draft_revision_scope"),
            models.CheckConstraint(
                condition=Q(revision=0, previous_revision__isnull=True)
                | Q(
                    revision__gt=0,
                    previous_revision__isnull=False,
                    previous_revision=F("revision") - 1,
                ),
                name="draft_revision_previous",
            ),
        ]


class DraftPolicy(CreatedRecord):
    pk = models.CompositePrimaryKey("draft_id", "version")
    draft = models.ForeignKey(WorldDraft, on_delete=models.RESTRICT, db_constraint=False, db_index=False)
    world_id = models.UUIDField()
    version = models.PositiveBigIntegerField()
    policy = models.JSONField()
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.RESTRICT)

    class Meta:
        db_table = "draft_policy"
        constraints = [
            models.CheckConstraint(condition=Q(version__gte=1), name="draft_policy_version_positive")
        ]


class MutationReceipt(CreatedRecord):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    principal = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.RESTRICT)
    operation = models.CharField(max_length=40)
    scope_key = models.CharField(max_length=128)
    request_key = models.UUIDField()
    input_digest = models.CharField(max_length=64)
    response_status = models.PositiveIntegerField()
    result = models.JSONField()
    draft_response = models.JSONField(null=True)
    world = models.ForeignKey(World, on_delete=models.RESTRICT, null=True, db_index=False)

    class Meta:
        db_table = "mutation_receipt"
        indexes = [models.Index(fields=["world", "created_at"], name="receipt_by_world_created")]
        constraints = [
            models.UniqueConstraint(
                fields=["principal", "operation", "scope_key", "request_key"],
                name="unique_scoped_mutation_request",
            )
        ]


class EntityKey(CreatedRecord):
    id = models.UUIDField(primary_key=True, editable=False)
    world = models.ForeignKey(World, on_delete=models.RESTRICT, db_index=False)
    draft = models.ForeignKey(WorldDraft, on_delete=models.RESTRICT, db_constraint=False, db_index=False)
    kind = models.CharField(max_length=16)
    first_revision = models.PositiveBigIntegerField()

    class Meta:
        db_table = "entity_key"
        constraints = [
            models.UniqueConstraint(fields=["world", "id"], name="entity_key_world_scope"),
            models.CheckConstraint(
                condition=Q(kind__in=["place", "actor", "item", "role"]),
                name="entity_key_valid_kind",
            ),
        ]


class DraftLinkKey(CreatedRecord):
    pk = models.CompositePrimaryKey("draft_id", "link_id")
    draft = models.ForeignKey(WorldDraft, on_delete=models.RESTRICT, db_constraint=False, db_index=False)
    link_id = models.UUIDField()
    first_revision = models.PositiveBigIntegerField()

    class Meta:
        db_table = "draft_link_key"


class WikiWorld(models.Model):
    world = models.OneToOneField(World, primary_key=True, on_delete=models.RESTRICT)
    edit_counter = models.PositiveBigIntegerField(default=0)
    days_per_year = models.PositiveIntegerField(null=True, blank=True)
    introduction = models.CharField(max_length=3000, blank=True, default="", db_default="")
    featured_entry_ids = models.JSONField(default=list, db_default=models.Value([], output_field=models.JSONField()), blank=True)
    cover_map = models.ForeignKey("WikiEntry", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")


class WikiEntry(CreatedRecord):
    class Kind(models.TextChoices):
        PERSON = "person", "Person"
        PLACE = "place", "Place"
        GROUP = "group", "Group"
        CLASS = "class", "Class"
        ABILITY = "ability", "Ability"
        ITEM = "item", "Item"
        SPECIES = "species", "Species"
        ORGANISM = "organism", "Organism"
        CULTURE = "culture", "Culture"
        ROLE = "role", "Role"
        RESOURCE = "resource", "Resource"
        BODY_PART = "body_part", "Body part"
        TRAIT = "trait", "Trait"
        GOAL = "goal", "Goal"
        IMAGE = "image", "Image"
        MODEL_3D = "model_3d", "3D model"
        TEXTURE = "texture", "Texture"
        ANIMATION = "animation", "Animation"
        MAP = "map", "Map"
        TERRITORY = "territory", "Territory"
        ERA = "era", "Era"
        SOURCE = "source", "Source"
        PROCESS = "process", "Mental process"
        SKILL = "skill", "Skill"
        MILESTONE = "milestone", "Goal milestone"
        REQUIREMENT = "requirement", "Requirement"
        METHOD = "method", "Method"
        STATUS_DEF = "status_def", "Status definition"
        CONTEXT = "context", "Capability context"
        RELATION_DEF = "relation_def", "Relationship type"
        RELATION = "relation", "Relationship"
        METHOD_STEP = "method_step", "Method step"
        BODY_FUNCTION = "body_fn", "Body function"
        RESOURCE_MOVEMENT = "resource_mv", "Resource movement"
        VALUE_DEFINITION = "value_def", "Value"
        PREFERENCE = "preference", "Preference"
        MOTIVATION = "motivation", "Motivation"

    class CatalogType(models.TextChoices):
        VEHICLE = "vehicle", "Vehicle"

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    wiki = models.ForeignKey(WikiWorld, on_delete=models.RESTRICT)
    kind = models.CharField(max_length=12, choices=Kind)
    name = models.CharField(max_length=100)
    overview = models.CharField(max_length=1500, blank=True, default="")
    article_sections = models.JSONField(default=list, db_default=models.Value([], output_field=models.JSONField()), blank=True)
    catalog_type = models.CharField(max_length=12, choices=CatalogType, blank=True, default="")
    variant_of = models.ForeignKey("self", on_delete=models.RESTRICT, null=True, blank=True, related_name="variants")
    author_only = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=["wiki", "name", "id"], name="wiki_entry_directory")]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(catalog_type="") | models.Q(kind="item", catalog_type="vehicle"),
                name="wiki_entry_catalog_type_matches_kind",
            ),
            models.CheckConstraint(
                condition=models.Q(variant_of__isnull=True) | (
                    models.Q(kind__in=("person", "organism")) & ~models.Q(id=models.F("variant_of_id"))
                ),
                name="wiki_entry_actor_variant",
            ),
        ]


class WikiDiscovery(CreatedRecord):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    observer = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, related_name="discoveries")
    subject = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, related_name="discovered_by")
    learned_at = models.PositiveBigIntegerField()
    source = models.CharField(max_length=500, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["observer", "subject"], name="wiki_discovery_observer_subject"),
        ]


class WikiMapImage(CreatedRecord):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    wiki = models.ForeignKey(WikiWorld, on_delete=models.RESTRICT)
    entry = models.OneToOneField(WikiEntry, on_delete=models.RESTRICT, null=True, related_name="base_map_image")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.RESTRICT)
    request_key = models.UUIDField()
    storage_key = models.CharField(max_length=100)
    digest = models.CharField(max_length=64)
    content_type = models.CharField(max_length=12)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["wiki", "uploaded_by", "request_key"], name="wiki_map_upload_request_key",
            ),
        ]


class WikiMapPin(CreatedRecord):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    map_entry = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, related_name="map_pins")
    place = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, null=True, related_name="map_place_pins")
    label = models.CharField(max_length=100)
    x = models.FloatField()
    y = models.FloatField()

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(x__gte=0, x__lte=1, y__gte=0, y__lte=1), name="wiki_map_pin_image_bounds",
            ),
        ]


class WikiLayout(CreatedRecord):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    place = models.OneToOneField(WikiEntry, on_delete=models.RESTRICT, related_name="wiki_layout")


class WikiLayoutFrame(CreatedRecord):
    layout = models.ForeignKey(WikiLayout, on_delete=models.RESTRICT, related_name="frames")
    from_tick = models.PositiveBigIntegerField()
    name = models.CharField(max_length=100)
    left_cm = models.BigIntegerField()
    top_cm = models.BigIntegerField()
    width_cm = models.PositiveBigIntegerField()
    height_cm = models.PositiveBigIntegerField()
    points = models.JSONField(default=list)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["layout", "from_tick"], name="wiki_layout_unique_time"),
            models.CheckConstraint(condition=Q(width_cm__gt=0, height_cm__gt=0), name="wiki_layout_positive_bounds"),
        ]


class WikiConnection(CreatedRecord):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    from_layout = models.ForeignKey(WikiLayout, on_delete=models.RESTRICT, related_name="outgoing_connections")
    from_point = models.UUIDField()
    to_layout = models.ForeignKey(WikiLayout, on_delete=models.RESTRICT, related_name="incoming_connections")
    to_point = models.UUIDField()
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=500, blank=True)
    source = models.CharField(max_length=500, blank=True)
    bidirectional = models.BooleanField(default=True)
    length_cm = models.PositiveBigIntegerField(null=True)
    from_tick = models.PositiveBigIntegerField()
    until_tick = models.PositiveBigIntegerField(null=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(until_tick__isnull=True) | Q(until_tick__gt=F("from_tick")),
                name="wiki_connection_interval",
            ),
        ]


class WikiEvent(CreatedRecord):
    class Kind(models.TextChoices):
        OCCURRENCE = "occurrence", "Occurrence"
        GROUP = "group", "Event group"
        ACTION = "action", "Recorded action"

    class Precision(models.TextChoices):
        EXACT = "exact", "Exact"
        BOUNDED = "bounded", "Approximate range"
        UNKNOWN = "unknown", "Unknown"

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    wiki = models.ForeignKey(WikiWorld, on_delete=models.RESTRICT)
    name = models.CharField(max_length=120)
    tick = models.PositiveBigIntegerField(null=True)
    node_kind = models.CharField(max_length=12, choices=Kind, default=Kind.OCCURRENCE)
    date_precision = models.CharField(max_length=7, choices=Precision, default=Precision.EXACT, db_default="exact")
    parent = models.ForeignKey("self", on_delete=models.RESTRICT, null=True, related_name="children")
    sort_order = models.PositiveBigIntegerField(default=0)
    start_tick = models.PositiveBigIntegerField(null=True)
    end_tick = models.PositiveBigIntegerField(null=True)
    cross_references = models.ManyToManyField("self", symmetrical=False, related_name="mentioned_by", blank=True)
    source = models.CharField(max_length=500, blank=True)
    citation = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, null=True, related_name="+")
    description = models.CharField(max_length=1500, blank=True, default="")
    summary = models.CharField(max_length=500, blank=True, default="")
    method = models.CharField(max_length=1500, blank=True, default="")
    cause_events = models.ManyToManyField("self", symmetrical=False, related_name="caused_events", blank=True)
    cause_assertions = models.ManyToManyField("WikiAssertion", related_name="events_caused", blank=True)
    ability = models.ForeignKey(
        WikiEntry, null=True, on_delete=models.RESTRICT, related_name="wiki_uses",
    )
    performed_by = models.ForeignKey(
        WikiEntry, null=True, on_delete=models.RESTRICT, related_name="wiki_performed_events",
    )

    class Meta:
        indexes = [
            models.Index(fields=["wiki", "tick", "id"], name="wiki_event_timeline"),
            models.Index(fields=["wiki", "parent", "sort_order", "id"], name="wiki_event_outline"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=(Q(ability__isnull=True, performed_by__isnull=True)
                           | Q(ability__isnull=False, performed_by__isnull=False)),
                name="wiki_event_ability_actor_pair",
            ),
            models.CheckConstraint(
                condition=(
                    Q(node_kind="group", date_precision="exact", tick__isnull=True, ability__isnull=True)
                    | (~Q(node_kind="group") & (
                        Q(date_precision="exact", tick__isnull=False)
                        | Q(date_precision="bounded", tick__isnull=True, start_tick__isnull=False, end_tick__isnull=False)
                        | Q(date_precision="unknown", tick__isnull=True, start_tick__isnull=True, end_tick__isnull=True)
                    ))
                ),
                name="wiki_event_kind_clock",
            ),
            models.CheckConstraint(condition=~Q(id=F("parent")), name="wiki_event_no_self_parent"),
        ]


class WikiEventLink(models.Model):
    class Role(models.TextChoices):
        PARTICIPANT = "participant", "Participant"
        PERFORMER = "performer", "Performer"
        TARGET = "target", "Target"
        PLACE = "place", "Place"
        ITEM = "item", "Item"
        PURPOSE = "purpose", "Purpose"
        BACKSTORY = "backstory", "Backstory"
        ERA = "era", "Era"
        FULFILLMENT = "fulfillment", "Fulfillment evidence"

    event = models.ForeignKey(WikiEvent, on_delete=models.CASCADE, related_name="links")
    entry = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, related_name="wiki_event_links")
    role = models.CharField(max_length=12, choices=Role)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["event", "entry", "role"], name="wiki_event_unique_link"),
        ]


class WikiLearnedAbility(CreatedRecord):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    character = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, related_name="wiki_learned_abilities")
    ability = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, related_name="wiki_learners")
    learned_at = models.PositiveBigIntegerField()
    source = models.CharField(max_length=500, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["character", "ability"], name="wiki_unique_learned_ability"),
        ]


class WikiAssertion(CreatedRecord):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    entry = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT)
    field = models.CharField(max_length=32)
    qualifier = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, null=True, related_name="+")
    value = models.JSONField()
    recorded_unit = models.CharField(max_length=500, null=True, blank=True)
    unit_source = models.ForeignKey("self", on_delete=models.RESTRICT, null=True, related_name="+")
    from_tick = models.PositiveBigIntegerField()
    until_tick = models.PositiveBigIntegerField(null=True)
    source = models.CharField(max_length=500, blank=True)
    citation = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, null=True, related_name="+")
    author_only = models.BooleanField(default=False)
    opened_by = models.ForeignKey(
        WikiEvent, on_delete=models.RESTRICT, null=True, related_name="opened_assertions",
    )
    closed_by = models.ForeignKey(
        WikiEvent, on_delete=models.RESTRICT, null=True, related_name="closed_assertions",
    )

    class Meta:
        indexes = [
            models.Index(fields=["entry", "field", "from_tick"], name="wiki_assertion_timeline"),
            models.Index(fields=["field", "value", "from_tick"], name="wiki_reverse_reference"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(until_tick__isnull=True) | Q(until_tick__gt=F("from_tick")),
                name="wiki_assertion_interval",
            ),
        ]


class WikiClaim(CreatedRecord):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    entry = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT)
    speaker = models.ForeignKey(WikiEntry, null=True, on_delete=models.RESTRICT, related_name="wiki_testimony")
    field = models.CharField(max_length=32)
    qualifier = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, null=True, related_name="+")
    value = models.JSONField()
    recorded_unit = models.CharField(max_length=500, null=True, blank=True)
    unit_source = models.ForeignKey(WikiAssertion, on_delete=models.RESTRICT, null=True, related_name="+")
    tick = models.PositiveBigIntegerField(null=True)
    date_precision = models.CharField(max_length=7, choices=WikiEvent.Precision, default="exact", db_default="exact")
    start_tick = models.PositiveBigIntegerField(null=True)
    end_tick = models.PositiveBigIntegerField(null=True)
    source = models.CharField(max_length=500, blank=True)
    citation = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, null=True, related_name="+")
    author_only = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=["entry", "tick"], name="wiki_claim_timeline")]
        constraints = [
            models.CheckConstraint(
                condition=Q(speaker__isnull=False) | Q(citation__isnull=False), name="wiki_claim_has_attribution",
            ),
            models.CheckConstraint(
                condition=(
                    Q(date_precision="exact", tick__isnull=False, start_tick__isnull=True, end_tick__isnull=True)
                    | Q(date_precision="bounded", tick__isnull=True, start_tick__isnull=False, end_tick__gt=F("start_tick"),
                        end_tick__isnull=False)
                    | Q(date_precision="unknown", tick__isnull=True, start_tick__isnull=True, end_tick__isnull=True)
                ),
                name="wiki_claim_date_precision",
            ),
        ]


class WikiObservation(CreatedRecord):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    observer = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, related_name="wiki_knowledge")
    assertion = models.ForeignKey(WikiAssertion, null=True, on_delete=models.RESTRICT)
    claim = models.ForeignKey(WikiClaim, null=True, on_delete=models.RESTRICT)
    value = models.JSONField()
    recorded_unit = models.CharField(max_length=500, null=True, blank=True)
    unit_source = models.ForeignKey(WikiAssertion, on_delete=models.RESTRICT, null=True, related_name="+")
    about_tick = models.PositiveBigIntegerField(null=True)
    learned_at = models.PositiveBigIntegerField()

    class Meta:
        indexes = [models.Index(fields=["observer", "learned_at"], name="wiki_observation_timeline")]
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(assertion__isnull=False, claim__isnull=True)
                    | Q(assertion__isnull=True, claim__isnull=False)
                ),
                name="wiki_observation_one_source",
            ),
            models.CheckConstraint(
                condition=Q(learned_at__gte=F("about_tick")), name="wiki_observation_after_source",
            ),
        ]


class WikiProposition(CreatedRecord):
    """A belief held by an actor or a desired state attached to a goal."""

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    holder = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, related_name="wiki_propositions")
    subject = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, related_name="wiki_propositions_about")
    qualifier = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, null=True, related_name="+")
    field = models.CharField(max_length=32)
    value = models.JSONField()
    recorded_unit = models.CharField(max_length=500, null=True, blank=True)
    unit_source = models.ForeignKey(WikiAssertion, on_delete=models.RESTRICT, null=True, related_name="+")
    about_tick = models.PositiveBigIntegerField(null=True)
    from_tick = models.PositiveBigIntegerField()
    until_tick = models.PositiveBigIntegerField(null=True)
    evidence = models.ForeignKey(WikiObservation, on_delete=models.RESTRICT, null=True)
    source = models.CharField(max_length=500, blank=True)
    author_only = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=["holder", "from_tick"], name="wiki_proposition_timeline")]
        constraints = [
            models.CheckConstraint(
                condition=Q(until_tick__isnull=True) | Q(until_tick__gt=F("from_tick")),
                name="wiki_proposition_interval",
            )
        ]


class WikiCausalAccount(CreatedRecord):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    holder = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, related_name="causal_accounts")
    title = models.CharField(max_length=100)
    applicability = models.CharField(max_length=500, blank=True)
    citation = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT, null=True, related_name="+")
    from_tick = models.PositiveBigIntegerField()
    until_tick = models.PositiveBigIntegerField(null=True)
    author_only = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=["holder", "from_tick"], name="wiki_causal_account_timeline")]
        constraints = [
            models.CheckConstraint(
                condition=Q(until_tick__isnull=True) | Q(until_tick__gt=F("from_tick")),
                name="wiki_causal_account_interval",
            ),
        ]


class WikiCausalTerm(models.Model):
    class Phase(models.TextChoices):
        CAUSE = "cause", "Cause"
        INTERMEDIARY = "intermediary", "Intermediary"
        OUTCOME = "outcome", "Outcome"

    account = models.ForeignKey(WikiCausalAccount, on_delete=models.CASCADE, related_name="terms")
    belief = models.ForeignKey(WikiProposition, on_delete=models.RESTRICT, related_name="causal_uses")
    phase = models.CharField(max_length=12, choices=Phase)
    position = models.PositiveSmallIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["account", "position"], name="wiki_causal_term_position"),
            models.UniqueConstraint(fields=["account", "phase", "belief"], name="wiki_causal_term_once_per_phase"),
        ]


class WikiFinding(CreatedRecord):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    entry = models.ForeignKey(WikiEntry, on_delete=models.RESTRICT)
    field = models.CharField(max_length=32)
    key = models.CharField(max_length=100, unique=True)
    code = models.CharField(max_length=32)
    record_ids = models.JSONField()
    from_tick = models.PositiveBigIntegerField()
    until_tick = models.PositiveBigIntegerField(null=True)
    resolved_at_edit = models.PositiveBigIntegerField(null=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["entry", "field"], condition=Q(resolved_at_edit__isnull=True),
                name="wiki_open_findings",
            ),
        ]
