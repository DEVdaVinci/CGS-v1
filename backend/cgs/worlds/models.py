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
