from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.db import IntegrityError, OperationalError, connection, connections, transaction
from django.test import Client, TestCase, TransactionTestCase
from django.utils import timezone

from .models import DraftPolicy, DraftRevision, MutationReceipt, World, WorldAccess, WorldDraft
from .services import digest_json


SESSION = "/api/v1/session"
WORLDS = "/api/v1/worlds"
PASSWORD = "a-unique-test-password"


def provision(username):
    return get_user_model().objects.create_user(username=username, password=PASSWORD)


def create_world(client, token, key=None, name="First dungeon"):
    return client.post(
        WORLDS,
        {"name": name},
        content_type="application/json",
        headers={"X-CSRFToken": token, "Idempotency-Key": str(key or uuid4())},
    )


class PrivateWorldTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = provision("owner")
        cls.other = provision("other")

    def setUp(self):
        self.owner_client = Client(enforce_csrf_checks=True)
        self.owner_client.force_login(self.owner)
        self.token = self.owner_client.get(SESSION).json()["csrf_token"]

    def test_login_session_logout_and_expired_session(self):
        browser = Client(enforce_csrf_checks=True)
        anonymous = browser.get(SESSION)
        self.assertEqual(anonymous.status_code, 200)
        self.assertEqual(set(anonymous.json()), {"authenticated", "csrf_token"})
        self.assertFalse(anonymous.json()["authenticated"])

        credentials = {"username": "owner", "password": PASSWORD}
        rejected = browser.post(SESSION + "/login", credentials, content_type="application/json")
        self.assertEqual((rejected.status_code, rejected.json()["code"]), (403, "CSRF_FAILED"))

        input_headers = {"X-CSRFToken": anonymous.json()["csrf_token"]}
        signed_in = browser.post(
            SESSION + "/login", credentials, content_type="application/json", headers=input_headers,
        )
        self.assertEqual(signed_in.status_code, 200)
        self.assertTrue(signed_in.json()["authenticated"])
        self.assertEqual(signed_in.json()["account_id"], str(self.owner.pk))
        self.assertEqual(signed_in.json()["display_name"], "owner")
        self.assertIn("no-store", signed_in.headers["Cache-Control"])

        created = create_world(browser, signed_in.json()["csrf_token"]).json()
        detail = WORLDS + "/" + created["world"]["id"]
        self.assertEqual(browser.get(detail).status_code, 200)
        bad_logout = browser.post(SESSION + "/logout", headers={"X-CSRFToken": "invalid"})
        self.assertEqual((bad_logout.status_code, bad_logout.json()["code"]), (403, "CSRF_FAILED"))
        logged_out = browser.post(
            SESSION + "/logout", headers={"X-CSRFToken": signed_in.json()["csrf_token"]},
        )
        self.assertEqual(logged_out.status_code, 204)
        denied = browser.get(detail)
        self.assertEqual((denied.status_code, denied.json()["code"]), (401, "SIGN_IN_REQUIRED"))

        browser.force_login(self.owner)
        Session.objects.filter(session_key=browser.session.session_key).update(
            expire_date=timezone.now() - timedelta(minutes=1),
        )
        expired = browser.get(detail)
        self.assertEqual((expired.status_code, expired.json()["code"]), (401, "SIGN_IN_REQUIRED"))

    def test_login_failure_is_generic(self):
        browser = Client(enforce_csrf_checks=True)
        token = browser.get(SESSION).json()["csrf_token"]
        failures = [
            browser.post(
                SESSION + "/login",
                {"username": username, "password": "incorrect-password"},
                content_type="application/json",
                headers={"X-CSRFToken": token},
            )
            for username in ("owner", "nonexistent")
        ]
        self.assertEqual([response.status_code for response in failures], [403, 403])
        self.assertEqual(failures[0].json(), failures[1].json())
        self.assertEqual(failures[0].json()["code"], "LOGIN_FAILED")

    def test_creates_world_and_all_initial_records_and_replays(self):
        key = uuid4()
        response = create_world(self.owner_client, self.token, key)
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["head_revision"], 0)

        world = World.objects.get(pk=body["world"]["id"])
        grant = WorldAccess.objects.get(world=world)
        draft = WorldDraft.objects.get(world=world)
        revision = DraftRevision.objects.get(draft=draft, revision=0)
        policy = DraftPolicy.objects.get(draft=draft, version=1)
        receipt = MutationReceipt.objects.get(pk=body["receipt_id"])
        self.assertEqual(world.owner_id, self.owner.pk)
        self.assertEqual((grant.account_id, grant.role, grant.enabled), (self.owner.pk, "owner", True))
        self.assertEqual(str(draft.pk), body["draft_id"])
        self.assertEqual((draft.head_revision, draft.active_policy_version), (0, 1))
        self.assertEqual(
            revision.document,
            {"schema_version": 1, "entities": {}, "facts": {}, "links": {}, "layout": None,
             "rules": {}, "start": None},
        )
        self.assertEqual(revision.digest, digest_json(revision.document))
        self.assertIsNone(revision.previous_revision)
        self.assertEqual(revision.provenance["mode"], "initial")
        self.assertEqual(policy.policy, {"rules": [], "read_sources": [], "locked": [],
                                         "reserved": [], "preferences": []})
        self.assertEqual((receipt.world_id, receipt.principal_id, receipt.request_key),
                         (world.pk, self.owner.pk, key))

        retry = create_world(self.owner_client, self.token, key)
        self.assertEqual((retry.status_code, retry.json()), (201, body))
        conflict = create_world(self.owner_client, self.token, key, name="Changed")
        self.assertEqual((conflict.status_code, conflict.json()["code"]), (409, "KEY_REUSED"))
        for model in (World, WorldAccess, WorldDraft, DraftRevision, DraftPolicy, MutationReceipt):
            self.assertEqual(model.objects.count(), 1, model.__name__)

    def test_replay_rechecks_access(self):
        key = uuid4()
        self.assertEqual(create_world(self.owner_client, self.token, key).status_code, 201)
        WorldAccess.objects.filter(account=self.owner).update(enabled=False)
        replay = create_world(self.owner_client, self.token, key)
        self.assertEqual((replay.status_code, replay.json()["code"]), (404, "RESOURCE_UNAVAILABLE"))
        self.assertEqual(World.objects.count(), 1)

    def test_ungranted_world_cannot_be_distinguished_from_missing_world(self):
        world = create_world(self.owner_client, self.token).json()["world"]
        other_browser = Client(enforce_csrf_checks=True)
        other_browser.force_login(self.other)

        self.assertEqual(self.owner_client.get(WORLDS).json()["items"], [world])
        self.assertEqual(other_browser.get(WORLDS, {"q": world["name"]}).json(),
                         {"items": [], "next_cursor": None})
        hidden = other_browser.get(WORLDS + "/" + world["id"])
        missing = other_browser.get(WORLDS + "/" + str(uuid4()))
        self.assertEqual((hidden.status_code, hidden.content), (404, missing.content))
        self.assertEqual(missing.status_code, 404)

    def test_world_list_cursor_is_bound_to_account_and_filter(self):
        key = uuid4()
        create_world(self.owner_client, self.token, key)
        create_world(self.owner_client, self.token, name="Second dungeon")
        first = self.owner_client.get(WORLDS, {"limit": 1, "q": "dungeon"}).json()
        cursor = first["next_cursor"]
        self.assertIsNotNone(cursor)
        second = self.owner_client.get(WORLDS, {"limit": 1, "q": "dungeon", "cursor": cursor}).json()
        self.assertIsNone(second["next_cursor"])
        self.assertNotEqual(first["items"][0]["id"], second["items"][0]["id"])
        self.assertEqual(self.owner_client.get(WORLDS, {"q": "different", "cursor": cursor}).status_code, 400)

        other_browser = Client(enforce_csrf_checks=True)
        other_browser.force_login(self.other)
        other_token = other_browser.get(SESSION).json()["csrf_token"]
        self.assertEqual(create_world(other_browser, other_token, key).status_code, 201)
        rejected = other_browser.get(WORLDS, {"q": "dungeon", "cursor": cursor})
        self.assertEqual((rejected.status_code, rejected.json()["code"]), (400, "INVALID_INPUT"))

    def test_invalid_body_or_csrf_creates_nothing(self):
        headers = {"X-CSRFToken": self.token, "Idempotency-Key": str(uuid4())}
        for body in ({"name": 123}, {"name": "Valid", "extra": True}, {}, {"name": ""}):
            with self.subTest(body=body):
                response = self.owner_client.post(
                    WORLDS, body, content_type="application/json", headers=headers,
                )
                self.assertEqual((response.status_code, response.json()["code"]), (400, "INVALID_INPUT"))
        missing_key = self.owner_client.post(
            WORLDS, {"name": "Valid"}, content_type="application/json",
            headers={"X-CSRFToken": self.token},
        )
        self.assertEqual((missing_key.status_code, missing_key.json()["code"]), (400, "INVALID_INPUT"))
        bad_csrf = create_world(self.owner_client, "invalid")
        self.assertEqual((bad_csrf.status_code, bad_csrf.json()["code"]), (403, "CSRF_FAILED"))
        self.assertFalse(World.objects.exists())

    def test_failure_before_receipt_rolls_back_and_same_key_can_retry(self):
        key = uuid4()
        with patch.object(MutationReceipt.objects, "create", side_effect=OperationalError("simulated")):
            failure = create_world(self.owner_client, self.token, key)
        self.assertEqual((failure.status_code, failure.json()["code"]), (503, "DEPENDENCY_UNAVAILABLE"))
        for model in (World, WorldAccess, WorldDraft, DraftRevision, DraftPolicy, MutationReceipt):
            self.assertFalse(model.objects.exists(), model.__name__)
        self.assertEqual(create_world(self.owner_client, self.token, key).status_code, 201)


class PostgreSQLCreationTests(TransactionTestCase):
    def test_concurrent_retries_commit_once_on_separate_connections(self):
        owner = provision("concurrent-owner")
        key = uuid4()
        start = Barrier(2, timeout=15)

        def send_request():
            try:
                browser = Client(enforce_csrf_checks=True)
                browser.force_login(owner)
                token = browser.get(SESSION).json()["csrf_token"]
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    backend_pid = cursor.fetchone()[0]
                start.wait()
                response = create_world(browser, token, key)
                return backend_pid, response.status_code, response.json()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(send_request) for _ in range(2)]
            first, second = [future.result(timeout=30) for future in futures]
        self.assertNotEqual(first[0], second[0])
        self.assertEqual((first[1], second[1]), (201, 201))
        self.assertEqual(first[2], second[2])
        for model in (World, WorldAccess, WorldDraft, DraftRevision, DraftPolicy, MutationReceipt):
            self.assertEqual(model.objects.count(), 1, model.__name__)

    def test_draft_pointers_require_real_scoped_records(self):
        owner = provision("constraint-owner")
        browser = Client(enforce_csrf_checks=True)
        browser.force_login(owner)
        token = browser.get(SESSION).json()["csrf_token"]
        self.assertEqual(create_world(browser, token).status_code, 201)
        draft = WorldDraft.objects.get()
        other_world = World.objects.create(owner=owner, title="Other scope")
        for updates in ({"head_revision": 99}, {"active_policy_version": 99}):
            with self.subTest(updates=updates), self.assertRaises(IntegrityError), transaction.atomic():
                WorldDraft.objects.filter(pk=draft.pk).update(**updates)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DraftRevision.objects.filter(draft=draft, revision=0).update(world_id=other_world.pk)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DraftPolicy.objects.filter(draft=draft, version=1).update(world_id=other_world.pk)

    def test_owner_grant_cannot_name_a_different_account(self):
        owner = provision("target-owner")
        other = provision("different-account")
        world = World.objects.create(owner=owner, title="Scoped")
        with self.assertRaises(IntegrityError), transaction.atomic():
            WorldAccess.objects.create(
                world=world, account=other, role="owner", capabilities=[], enabled=True,
            )
