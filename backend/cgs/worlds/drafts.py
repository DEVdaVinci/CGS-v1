from django.db import IntegrityError, connection, transaction

from cgs.api import CgsError, resource_unavailable

from .draft_validation import candidate_draft, changed_entries, draft_problems, invalid, manual_command
from .models import DraftLinkKey, DraftPolicy, DraftRevision, EntityKey, MutationReceipt, World, WorldAccess, WorldDraft
from .services import digest_json, get_membership


def _author(world_id, account_id, *, writing=False):
    membership = get_membership(account_id, world_id)
    if membership.role not in (WorldAccess.Role.OWNER, WorldAccess.Role.EDITOR):
        raise resource_unavailable()
    if writing and membership.role == WorldAccess.Role.EDITOR and "edit_world" not in membership.capabilities:
        raise CgsError(403, "ACTION_UNAVAILABLE", "You can read this draft but cannot edit it.")
    return membership


def _scoped_read():
    with connection.cursor() as cursor:
        cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")


def read_draft(world_id, account_id, revision_number=None, entry_id=None):
    with transaction.atomic():
        _scoped_read()
        membership = _author(world_id, account_id)
        draft = WorldDraft.objects.get(world_id=world_id)
        revision = draft.head_revision if revision_number is None else revision_number
        record = DraftRevision.objects.filter(world_id=world_id, draft=draft, revision=revision).first()
        if record is None:
            raise CgsError(404, "REVISION_UNAVAILABLE", "This draft revision does not exist.")
        if entry_id is not None:
            key = str(entry_id)
            entity = record.document["entities"].get(key)
            if entity is None:
                raise resource_unavailable()
            return {
                "draft_id": str(draft.id), "revision": revision, "entity": entity,
                "links": [link for link in record.document["links"].values() if key in (link["from_id"], link["to_id"])],
                "problems": draft_problems(record.document, key),
            }
        return {
            "draft_id": str(draft.id), "revision": revision, "auth_epoch": membership.world.auth_epoch,
            "guardrail_version": draft.active_policy_version if revision_number is None else record.policy_version,
            "source": record.document,
            "problems": draft_problems(record.document),
        }


def _reserve_new_entries(world, draft, revision, before, after):
    new_ids = after["entities"].keys() - before["entities"].keys()
    if not new_ids:
        return
    if EntityKey.objects.filter(id__in=new_ids).exists():
        invalid("IDENTITY_ALREADY_ISSUED", "A new entry must use a fresh identity.")
    try:
        with transaction.atomic():
            EntityKey.objects.bulk_create([
                EntityKey(
                    id=record_id, world=world, draft=draft, first_revision=revision,
                    kind=after["entities"][record_id]["kind"],
                )
                for record_id in sorted(new_ids)
            ])
    except IntegrityError as exc:
        if getattr(getattr(exc.__cause__, "diag", None), "constraint_name", None) != "entity_key_pkey":
            raise
        invalid("IDENTITY_ALREADY_ISSUED", "A new entry must use a fresh identity.")


def _reserve_new_links(draft, revision, before, after):
    new_ids = after["links"].keys() - before["links"].keys()
    if not new_ids:
        return
    if DraftLinkKey.objects.filter(draft=draft, link_id__in=new_ids).exists():
        invalid("IDENTITY_ALREADY_ISSUED", "A new link must use a fresh identity.")
    DraftLinkKey.objects.bulk_create([
        DraftLinkKey(draft=draft, link_id=link_id, first_revision=revision)
        for link_id in sorted(new_ids)
    ])


def _commit_edit(world, draft, account_id, command, receipt_scope, digest):
    if command["expected_revision"] != draft.head_revision:
        raise CgsError(
            409, "STALE_DRAFT", "This draft changed before your save.",
            conflict_revision=draft.head_revision,
        )
    old = DraftRevision.objects.get(draft=draft, revision=draft.head_revision)
    policy = DraftPolicy.objects.get(draft=draft, version=draft.active_policy_version)
    document, resolved, aliases = candidate_draft(old.document, command["edits"], policy.policy)
    revision = old.revision + 1
    DraftRevision.objects.create(
        draft=draft, world_id=world.id, revision=revision, previous_revision=old.revision,
        policy_version=policy.version, author_id=account_id, document=document,
        digest=digest_json(document),
        provenance={"mode": "manual", "proposal_id": None, "source_refs": [], "edits": resolved},
    )
    _reserve_new_entries(world, draft, revision, old.document, document)
    _reserve_new_links(draft, revision, old.document, document)
    draft.head_revision = revision
    draft.save(update_fields=["head_revision"])
    return MutationReceipt.objects.create(
        **receipt_scope, input_digest=digest, response_status=200, world=world,
        result={
            "kind": "draft_revision", "resource_id": str(draft.id),
            "revision": revision, "alias_assignments": aliases,
        },
        draft_response={
            "changed_entry_ids": changed_entries(old.document, document),
            "problems": draft_problems(document),
        },
    )


def apply_draft_edits(world_id, account_id, key, raw):
    with transaction.atomic():
        world = World.objects.select_for_update().filter(pk=world_id).first()
        if world is None:
            raise resource_unavailable()
        _author(world_id, account_id, writing=True)
        command = manual_command(raw)
        digest = digest_json(command)
        draft = WorldDraft.objects.get(world=world)
        receipt_scope = {
            "principal_id": account_id, "operation": "apply_draft_edits",
            "scope_key": f"draft:{draft.id}", "request_key": key,
        }
        receipt = MutationReceipt.objects.filter(**receipt_scope).first()
        if receipt is None:
            receipt = _commit_edit(world, draft, account_id, command, receipt_scope, digest)
        elif receipt.input_digest != digest:
            raise CgsError(409, "KEY_REUSED", "This idempotency key was used for a different request.")

    # Disclose the immutable receipt only under a fresh current grant.
    with transaction.atomic():
        _scoped_read()
        _author(world_id, account_id, writing=True)
        return {
            "receipt_id": str(receipt.id), "draft_id": receipt.result["resource_id"],
            "revision": receipt.result["revision"],
            "alias_assignments": receipt.result["alias_assignments"],
            **receipt.draft_response,
        }
