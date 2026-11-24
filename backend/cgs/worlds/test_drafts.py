from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

from django.db import OperationalError, connection, connections
from django.test import Client, TransactionTestCase, override_settings

from .draft_validation import candidate_draft
from .models import DraftLinkKey, DraftPolicy, DraftRevision, EntityKey, MutationReceipt, World, WorldAccess, WorldDraft
from .services import create_world, digest_json
from .tests import provision, SESSION


def edit_entry(name=None, *, kind="place", record_id=None):
    record_id = record_id or str(uuid4())
    value = {"id": record_id, "kind": kind, "visibility": "author"}
    if name is not None:
        value["name"] = name
    return {"op": "add", "pointer": "/entities/" + record_id, "value": value}


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class DraftEditorTests(TransactionTestCase):
    def setUp(self):
        self.owner = provision("draft-owner")
        _, created = create_world(self.owner.pk, uuid4(), "Draft test world")
        self.world_id = created["world"]["id"]
        self.url = "/api/v1/worlds/" + self.world_id + "/draft"
        self.client, self.token = self.browser(self.owner)

    @staticmethod
    def browser(account):
        browser = Client(enforce_csrf_checks=True)
        browser.force_login(account)
        return browser, browser.get(SESSION).json()["csrf_token"]

    def save(self, edits, revision=0, key=None, browser=None, token=None):
        return (browser or self.client).post(
            self.url + "/edits",
            {"mode": "manual", "expected_revision": revision, "edits": edits},
            content_type="application/json",
            headers={"X-CSRFToken": token or self.token, "Idempotency-Key": str(key or uuid4())},
        )

    def test_alias_batch_link_identity_historical_values_and_exact_replay(self):
        key = uuid4()
        first = edit_entry("Hall", record_id="@first")
        second = edit_entry("Hall", record_id="@second")
        item = edit_entry("Lantern", kind="item", record_id="@item")
        link = {
            "op": "add", "pointer": "/links/@placement", "value": {
                "id": "@placement", "kind": "located_in", "from_id": "@item", "to_id": "@second",
                "visibility": "author",
            },
        }
        edits = [first, second, item, link]
        accepted = self.save(edits, key=key)
        self.assertEqual(accepted.status_code, 200, accepted.json())
        receipt = accepted.json()
        ids = {pair["alias"]: pair["id"] for pair in receipt["alias_assignments"]}
        self.assertEqual(receipt["revision"], 1)
        self.assertEqual(set(receipt["changed_entry_ids"]), {ids["@first"], ids["@second"], ids["@item"]})
        self.assertEqual(EntityKey.objects.filter(world_id=self.world_id).count(), 3)

        changed = {"op": "set", "pointer": "/entities/" + ids["@second"] + "/name", "value": "East Hall"}
        self.assertEqual(self.save([changed], revision=1).status_code, 200)
        old = self.client.get(self.url, {"revision": 1}).json()
        self.assertEqual(old["source"]["entities"][ids["@second"]]["name"], "Hall")
        detail = self.client.get(self.url + "/entries/" + ids["@item"]).json()
        self.assertEqual(detail["links"][0]["to_id"], ids["@second"])
        self.assertNotEqual(detail["links"][0]["to_id"], ids["@first"])
        self.assertEqual(self.client.get(self.url).json()["source"]["entities"][ids["@second"]]["name"], "East Hall")
        self.assertEqual(self.save(edits, key=key).json(), receipt)
        self.assertEqual(self.save([first], key=key).json()["code"], "KEY_REUSED")

    def test_incomplete_records_and_invalid_candidates_leave_history_unchanged(self):
        place = edit_entry()
        accepted = self.save([place])
        self.assertEqual(accepted.status_code, 200)
        problems = accepted.json()["problems"]
        self.assertTrue(any(problem.get("pointer") == place["pointer"] + "/name" for problem in problems))
        invalid = (
            {"op": "add", "pointer": place["pointer"] + "/name", "value": None},
            {"op": "add", "pointer": place["pointer"] + "/parent_place_id", "value": str(uuid4())},
            {"op": "add", "pointer": place["pointer"] + "/bounds", "value": {
                "x_min_cm": "5", "x_max_cm": 50, "y_min_cm": 0, "y_max_cm": 100,
            }},
            {"op": "set", "pointer": place["pointer"], "value": {**place["value"], "kind": "actor"}},
        )
        for failure in invalid:
            with self.subTest(failure=failure):
                rejected = self.save([edit_entry("Would be rolled back"), failure], revision=1)
                self.assertEqual((rejected.status_code, rejected.json()["code"]), (422, "VALIDATION_FAILED"))
                self.assertEqual(WorldDraft.objects.get(world_id=self.world_id).head_revision, 1)
                self.assertEqual(EntityKey.objects.count(), 1)

    def test_link_removal_requires_a_complete_group(self):
        place, item = edit_entry("Hall"), edit_entry("Lantern", kind="item")
        link_id = str(uuid4())
        link = {
            "op": "add", "pointer": "/links/" + link_id, "value": {
                "id": link_id, "kind": "located_in", "from_id": item["value"]["id"],
                "to_id": place["value"]["id"], "visibility": "author",
            },
        }
        self.assertEqual(self.save([place, item, link]).status_code, 200)
        remove_place = {"op": "remove", "pointer": place["pointer"]}
        self.assertEqual(self.save([remove_place], revision=1).status_code, 422)
        self.assertEqual(self.save([remove_place, {"op": "remove", "pointer": link["pointer"]}], revision=1).status_code, 200)
        self.assertEqual(self.save([place], revision=2).json()["field_errors"][0]["code"], "IDENTITY_ALREADY_ISSUED")
        self.assertIn(place["value"]["id"], self.client.get(self.url, {"revision": 1}).json()["source"]["entities"])

    def test_policy_pin_and_all_writes_lock(self):
        record = edit_entry("Locked place")
        self.assertEqual(self.save([record]).status_code, 200)
        draft = WorldDraft.objects.get(world_id=self.world_id)
        policy = DraftPolicy.objects.get(draft=draft, version=1).policy
        policy["locked"] = [{"pointer": record["pointer"] + "/name", "all_writes": True}]
        DraftPolicy.objects.create(draft=draft, world_id=self.world_id, version=2, policy=policy, updated_by=self.owner)
        WorldDraft.objects.filter(pk=draft.pk).update(active_policy_version=2)
        self.assertEqual(self.client.get(self.url).json()["guardrail_version"], 2)
        self.assertEqual(self.client.get(self.url, {"revision": 1}).json()["guardrail_version"], 1)

        replacement = {"op": "set", "pointer": record["pointer"], "value": {**record["value"], "name": "Changed"}}
        self.assertEqual(self.save([replacement], revision=1).json()["field_errors"][0]["code"], "LOCKED_FIELD")
        restore = {"op": "set", "pointer": record["pointer"] + "/name", "value": "Locked place"}
        self.assertEqual(self.save([replacement, restore], revision=1).json()["field_errors"][0]["code"], "LOCKED_FIELD")
        self.assertEqual(self.save([edit_entry("Open place")], revision=1).status_code, 200)
        self.assertEqual(self.client.get(self.url, {"revision": 2}).json()["guardrail_version"], 2)

    def test_provenance_replays_even_when_later_edits_touch_the_same_object(self):
        entry = edit_entry(record_id="@hall")
        add_name = {"op": "add", "pointer": "/entities/@hall/name", "value": "Hall"}
        result = self.save([entry, add_name])
        self.assertEqual(result.status_code, 200, result.json())
        draft = WorldDraft.objects.get(world_id=self.world_id)
        before = DraftRevision.objects.get(draft=draft, revision=0)
        saved = DraftRevision.objects.get(draft=draft, revision=1)
        edits = saved.provenance["edits"]
        self.assertNotIn("name", edits[0]["value"])
        replay, _, _ = candidate_draft(before.document, edits, DraftPolicy.objects.get(draft=draft, version=1).policy)
        self.assertEqual(replay, saved.document)
        self.assertEqual(digest_json(replay), saved.digest)

    def test_rejects_invalid_and_discarded_edits_before_commit(self):
        entry = edit_entry(record_id="@hall")
        for field, value, code in (
            ("unregistered", "text", "UNKNOWN_PATH"),
            ("name", False, "INVALID_VALUE"),
        ):
            with self.subTest(field=field):
                pointer = entry["pointer"] + "/" + field
                rejected = self.save([entry, {"op": "add", "pointer": pointer, "value": value}, {"op": "remove", "pointer": pointer}])
                self.assertEqual(rejected.json()["field_errors"][0]["code"], code)
        discarded = self.save([entry, {"op": "remove", "pointer": entry["pointer"]}])
        self.assertEqual(discarded.json()["field_errors"][0]["code"], "ALIAS_NOT_RETAINED")
        self.assertEqual(DraftRevision.objects.count(), 1)
        self.assertFalse(EntityKey.objects.exists())
        self.assertEqual(MutationReceipt.objects.count(), 1)  # World creation only.

    def test_link_identity_cannot_be_reissued_or_retargeted(self):
        room, item = edit_entry("Hall"), edit_entry("Lantern", kind="item")
        link_id = str(uuid4())
        link = {"op": "add", "pointer": "/links/" + link_id, "value": {
            "id": link_id, "kind": "located_in", "from_id": item["value"]["id"],
            "to_id": room["value"]["id"], "visibility": "author",
        }}
        self.assertEqual(self.save([room, item, link]).status_code, 200)
        original = self.client.get(self.url).json()["source"]
        remove = {"op": "remove", "pointer": link["pointer"]}
        replacement = {**link, "value": {**link["value"], "kind": "requires"}}
        self.assertEqual(self.save([remove, replacement], revision=1).status_code, 422)
        self.assertEqual(self.save([{**replacement, "op": "set"}], revision=1).status_code, 422)
        self.assertEqual(self.save([remove], revision=1).status_code, 200)
        self.assertEqual(self.save([replacement], revision=2).json()["field_errors"][0]["code"], "IDENTITY_ALREADY_ISSUED")
        self.assertEqual(DraftLinkKey.objects.get(link_id=link_id).first_revision, 1)
        self.assertEqual(self.client.get(self.url, {"revision": 1}).json()["source"], original)

    def test_reference_dungeon_saves_and_validates_the_complete_group(self):
        fixture = json.loads(Path(__file__).with_name("testdata").joinpath("reference_dungeon.json").read_text(encoding="utf-8"))
        source, ids = fixture["source"], fixture["aliases"]
        edits = [
            {"op": "add", "pointer": f"/{collection}/{key}", "value": value}
            for collection in ("entities", "links", "facts", "rules")
            for key, value in source[collection].items()
        ] + [{"op": "set", "pointer": "/" + key, "value": source[key]} for key in ("layout", "start")]
        accepted = self.save(edits)
        self.assertEqual(accepted.status_code, 200, accepted.json())
        self.assertEqual(accepted.json()["problems"], [])
        self.assertEqual(self.client.get(self.url).json()["source"], source)
        overlap = {"op": "set", "pointer": f"/facts/{ids['gate_open']}/effective_from_tick", "value": 2}
        outside = {"op": "set", "pointer": f"/layout/points/{ids['threshold']}/at/y_cm", "value": 1300}
        for edit, issue in ((overlap, "OVERLAPPING_TRUTH"), (outside, "POINT_OUTSIDE_ROOM")):
            result = self.save([edit], revision=1)
            self.assertEqual(result.status_code, 422, result.json())
            self.assertIn(issue, {error["code"] for error in result.json()["field_errors"]})
        self.assertEqual(self.client.get(self.url).json()["source"], source)

    def test_typed_aliases_resolve_in_layout_and_fact_values(self):
        place = edit_entry("Room", record_id="@room")
        place["value"]["bounds"] = {"x_min_cm": 0, "x_max_cm": 100, "y_min_cm": 0, "y_max_cm": 100}
        layout = {"op": "set", "pointer": "/layout", "value": {
            "frame_id": str(uuid4()), "unit": "cm", "origin": {"x_cm": 0, "y_cm": 0}, "grid_cm": 100,
            "points": {}, "edges": {},
        }}
        point = {"op": "add", "pointer": "/layout/points/@point", "value": {
            "id": "@point", "label": "@point", "place_id": "@room", "at": {"x_cm": 0, "y_cm": 0},
            "visibility": "author",
        }}
        fact = {"op": "add", "pointer": "/facts/@fact", "value": {
            "id": "@fact", "kind": "truth", "subject_id": "@room", "predicate": "entrance",
            "value": {"kind": "reference", "value": "@point"}, "visibility": "author",
            "effective_from_tick": 0, "effective_until_tick": None, "source_ref_ids": [],
        }}
        result = self.save([place, layout, fact, point])
        self.assertEqual(result.status_code, 200, result.json())
        ids = {pair["alias"]: pair["id"] for pair in result.json()["alias_assignments"]}
        source = self.client.get(self.url).json()["source"]
        self.assertEqual(source["layout"]["points"][ids["@point"]]["label"], "@point")
        self.assertEqual(source["facts"][ids["@fact"]]["value"]["value"], ids["@point"])

    def test_grants_and_revoked_retry(self):
        editor = provision("editor")
        reader = provision("reader")
        other = provision("unassigned")
        world = World.objects.get(pk=self.world_id)
        WorldAccess.objects.create(world=world, account=editor, role="editor", capabilities=["edit_world"], enabled=True)
        WorldAccess.objects.create(world=world, account=reader, role="editor", capabilities=[], enabled=True)
        writer, token = self.browser(editor)
        read_only, read_token = self.browser(reader)
        denied, _ = self.browser(other)
        self.assertEqual(read_only.get(self.url).status_code, 200)
        self.assertEqual(self.save([edit_entry()], browser=read_only, token=read_token).status_code, 403)
        missing = denied.get("/api/v1/worlds/" + str(uuid4()) + "/draft")
        self.assertEqual((missing.status_code, missing.content), (404, denied.get(self.url).content))

        key, edits = uuid4(), [edit_entry("Authorized entry")]
        self.assertEqual(self.save(edits, key=key, browser=writer, token=token).status_code, 200)
        WorldAccess.objects.filter(world=world, account=editor).update(enabled=False)
        self.assertEqual(writer.get(self.url, {"revision": 1}).content, missing.content)
        self.assertEqual(self.save(edits, key=key, browser=writer, token=token).content, missing.content)

    def test_receipt_failure_rolls_back_revision_and_identity(self):
        key, record = uuid4(), edit_entry("Retry")
        with patch.object(MutationReceipt.objects, "create", side_effect=OperationalError("simulation")):
            self.assertEqual(self.save([record], key=key).status_code, 503)
        self.assertEqual(DraftRevision.objects.count(), 1)
        self.assertFalse(EntityKey.objects.exists())
        self.assertEqual(WorldDraft.objects.get(world_id=self.world_id).head_revision, 0)
        self.assertEqual(self.save([record], key=key).status_code, 200)

    def test_concurrent_distinct_saves_reject_stale_revision(self):
        barrier = Barrier(2, timeout=15)

        def worker(title):
            try:
                browser, token = self.browser(self.owner)
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    pid = cursor.fetchone()[0]
                barrier.wait()
                result = self.save([edit_entry(title)], browser=browser, token=token)
                return pid, result.status_code, result.json()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = sorted(pool.map(worker, ("First", "Second")), key=lambda row: row[1])
        self.assertNotEqual(results[0][0], results[1][0])
        self.assertEqual([row[1] for row in results], [200, 409])
        self.assertEqual(results[1][2]["code"], "STALE_DRAFT")
        self.assertEqual(results[1][2]["conflict_revision"], 1)
        self.assertEqual(EntityKey.objects.count(), 1)

    def test_concurrent_exact_replays_save_once(self):
        barrier = Barrier(2, timeout=15)
        key, edits = uuid4(), [edit_entry("Once")]

        def worker():
            try:
                browser, token = self.browser(self.owner)
                barrier.wait()
                result = self.save(edits, key=key, browser=browser, token=token)
                return result.status_code, result.json()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = [future.result(timeout=30) for future in (pool.submit(worker), pool.submit(worker))]
        self.assertEqual(first, second)
        self.assertEqual(first[0], 200)
        self.assertEqual(EntityKey.objects.count(), 1)
