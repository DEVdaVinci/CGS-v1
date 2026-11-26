from hashlib import sha256
import json

from django.contrib.auth import get_user_model
from django.db import transaction

from cgs.api import CgsError, resource_unavailable, sign_in_required

from .models import DraftPolicy, DraftRevision, MutationReceipt, World, WorldAccess, WorldDraft


OWNER_CAPABILITIES = (
    "edit_world", "delegate_draft", "manage_guardrails", "publish_world", "manage_run", "read_source",
)


def digest_json(value):
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(canonical.encode("utf-8")).hexdigest()


def visible_worlds(account_id):
    return WorldAccess.objects.filter(account_id=account_id, enabled=True).select_related("world")


def get_membership(account_id, world_id, *, include_draft=False):
    memberships = visible_worlds(account_id)
    if include_draft:
        memberships = memberships.select_related("world__draft")
    try:
        return memberships.get(world_id=world_id)
    except WorldAccess.DoesNotExist as exc:
        raise resource_unavailable() from exc


def summarize_world(membership):
    return {
        "id": str(membership.world_id),
        "name": membership.world.title,
        "role": membership.role,
        "capabilities": (
            list(OWNER_CAPABILITIES)
            if membership.role == WorldAccess.Role.OWNER
            else membership.capabilities
        ),
    }


def create_world(account_id, request_key, name):
    input_digest = digest_json({"name": name})
    receipt_key = {
        "principal_id": account_id,
        "operation": "create_world",
        "scope_key": f"account:{account_id}",
        "request_key": request_key,
    }
    account_model = get_user_model()
    with transaction.atomic():
        # The account is the lock target because the world does not exist on a fresh request.
        try:
            account_model.objects.select_for_update().only("id").get(pk=account_id, is_active=True)
        except account_model.DoesNotExist as exc:
            raise sign_in_required() from exc
        receipt = MutationReceipt.objects.filter(**receipt_key).first()
        if receipt is None:
            world = World.objects.create(owner_id=account_id, title=name)
            WorldAccess.objects.create(
                world=world, account_id=account_id, role=WorldAccess.Role.OWNER,
                capabilities=list(OWNER_CAPABILITIES), enabled=True,
            )
            draft = WorldDraft.objects.create(world=world, head_revision=0, active_policy_version=1)
            document = {
                "schema_version": 1, "entities": {}, "facts": {}, "links": {}, "layout": None,
                "rules": {}, "start": None,
            }
            DraftRevision.objects.create(
                draft=draft, world_id=world.id, revision=0, author_id=account_id, document=document,
                digest=digest_json(document),
                provenance={"mode": "initial", "proposal_id": None, "source_refs": [], "edits": []},
            )
            DraftPolicy.objects.create(
                draft=draft, world_id=world.id, version=1, updated_by_id=account_id,
                policy={"rules": [], "read_sources": [], "locked": [], "reserved": [], "preferences": []},
            )
            receipt = MutationReceipt.objects.create(
                **receipt_key, input_digest=input_digest, response_status=201, world=world,
                result={"kind": "world", "resource_id": str(world.id), "revision": 0, "alias_assignments": []},
            )

    membership = get_membership(account_id, receipt.world_id, include_draft=True)
    if receipt.input_digest != input_digest:
        raise CgsError(409, "KEY_REUSED", "This idempotency key was used for a different request.")
    return receipt.response_status, {
        "world": summarize_world(membership),
        "draft_id": str(membership.world.draft.id),
        "head_revision": receipt.result["revision"],
        "receipt_id": str(receipt.id),
    }
