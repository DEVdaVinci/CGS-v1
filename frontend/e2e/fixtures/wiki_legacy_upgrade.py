"""Seed the disposable W1 upgrade database after migrating worlds to 0005."""

import os
from uuid import UUID, uuid4

from django.contrib.auth import get_user_model
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor

from cgs.worlds.drafts import apply_draft_edits
from cgs.worlds.models import WorldAccess
from cgs.worlds.services import create_world


def seed():
    if connection.settings_dict["NAME"] != "cgs_w1_legacy":
        raise ValueError("Use the disposable cgs_w1_legacy PostgreSQL database.")
    base = ("worlds", "0005_wiki_foundation")
    executor = MigrationExecutor(connection)
    if {name for app, name in executor.loader.applied_migrations if app == "worlds"} != {
        "0001_initial", "0002_scoped_constraints", "0003_manual_draft_history", "0004_draft_link_keys", base[1],
    }:
        raise ValueError("Seed only while the database is at worlds.0005.")
    apps = executor.loader.project_state([base]).apps
    users = get_user_model().objects
    password = os.environ["CGS_CLOSEOUT_PASSWORD"]

    owner = users.create_user(username="e2e-owner", password=password)
    viewer = users.create_user(username="e2e-reader", password=password)
    users.create_user(username="e2e-other", password=password)
    _, result = create_world(owner.pk, uuid4(), "Legacy harbor archive")
    world_id = result["world"]["id"]
    WorldAccess.objects.create(world_id=world_id, account=viewer, role="editor", capabilities=[], enabled=True)
    draft_entry = str(uuid4())
    apply_draft_edits(world_id, owner.pk, uuid4(), {"mode": "manual", "expected_revision": 0, "edits": [{
        "op": "add", "pointer": f"/entities/{draft_entry}", "value": {
            "id": draft_entry, "kind": "place", "name": "Archived berth plan", "visibility": "author",
        },
    }]})

    with transaction.atomic():
        wiki = apps.get_model("worlds", "WikiWorld").objects.create(world_id=world_id)
        entries = apps.get_model("worlds", "WikiEntry").objects
        facts = apps.get_model("worlds", "WikiAssertion").objects
        place = entries.create(wiki=wiki, kind="place", name="Archive landing")
        quay = entries.create(wiki=wiki, kind="place", name="Archive quay")
        crew = entries.create(wiki=wiki, kind="group", name="Archive crew")
        worker = entries.create(wiki=wiki, kind="person", name="Archive worker")
        event = apps.get_model("worlds", "WikiEvent").objects.create(
            id=UUID("00000000-0000-4000-8000-000000000201"), wiki=wiki, tick=8, name="Archive arrival", source="Old ledger",
        )
        facts.create(entry=crew, field="located_in", value=str(quay.pk), from_tick=2, source="Ambiguous ledger entry")
        previous = facts.create(entry=worker, field="located_in", value=str(quay.pk), from_tick=2, until_tick=8, closed_by=event)
        facts.create(entry=worker, field="located_in", value=str(place.pk), from_tick=8, opened_by=event)
        apps.get_model("worlds", "WikiObservation").objects.create(
            observer=worker, assertion=previous, value=str(quay.pk), about_tick=2, learned_at=3,
        )


seed()
