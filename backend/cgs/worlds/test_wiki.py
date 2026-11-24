from uuid import uuid4

from django.test import Client, TransactionTestCase, override_settings

from .drafts import apply_draft_edits
from .models import MutationReceipt, WikiEntry, WikiEvent, WikiFinding, WikiWorld, WorldAccess
from .services import create_world, digest_json
from .tests import SESSION, provision


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class WikiTests(TransactionTestCase):
    def setUp(self):
        self.owner = provision("wiki-owner")
        _, created = create_world(self.owner.pk, uuid4(), "Cedar World")
        self.world = created["world"]["id"]
        self.path = f"/api/v1/worlds/{self.world}/wiki"
        self.browser, self.token = self.sign_in(self.owner)
        self.edit = 0

    def sign_in(self, account):
        browser = Client(enforce_csrf_checks=True)
        browser.force_login(account)
        return browser, browser.get(SESSION).json()["csrf_token"]

    def post(self, command, *, expected=None, key=None, browser=None, token=None):
        return (browser or self.browser).post(
            self.path + "/changes",
            {"expected_edit": self.edit if expected is None else expected, "command": command},
            content_type="application/json",
            headers={"X-CSRFToken": token or self.token, "Idempotency-Key": str(key or uuid4())},
        )

    def apply(self, command):
        response = self.post(command)
        self.assertEqual(response.status_code, 200, response.json())
        self.edit = response.json()["edit_counter"]
        return response.json()["record_id"]

    def entry(self, name, kind="place", **fields):
        return self.apply({"op": "create_entry", "name": name, "kind": kind, **fields})

    def fact(self, entry, field, value, start=0, **fields):
        return self.apply({
            "op": "record_fact", "entry_id": entry, "field": field, "value": value,
            "from_tick": start, **fields,
        })

    def event(self, name, time, *changes):
        return self.apply({"op": "record_event", "name": name, "tick": time, "changes": [
            {"entry_id": entry, "field": field, "value": value}
            for entry, field, value in changes
        ]})

    def article(self, entry, at=0, observer=None):
        params = {"at": at}
        if observer is not None:
            params["view_as"] = observer
        response = self.browser.get(self.path + "/entries/" + entry, params)
        self.assertEqual(response.status_code, 200, response.json())
        return response.json()["article"]

    def values(self, entry, at):
        return {item["field"]: item.get("value", item["state"]) for item in self.article(entry, at)["values"]}

    def test_dated_truth_and_scoped_evidence_stay_distinct_through_corrections(self):
        gate = self.entry("Cedar Gate")
        mira = self.entry("Mira", "person")
        speaker = self.entry("Harbor witness", "person")
        secret = self.entry("Sealed letter", author_only=True)
        self.fact(secret, "description", "Confidential account")
        self.fact(gate, "description", "Reserved reason for opening", author_only=True)
        self.fact(gate, "status", "Closed")
        self.event("The gate opens", 10, (gate, "status", "Open"))
        self.event("The gate closes unseen", 20, (gate, "status", "Closed"))
        self.assertEqual(self.values(gate, 9)["status"], "Closed")
        self.assertEqual(self.values(gate, 10)["status"], "Open")
        opened = next(fact for fact in self.article(gate)["assertions"] if fact["from_tick"] == 10)
        learned = self.apply({
            "op": "record_observation", "observer_id": mira, "source_kind": "assertion",
            "source_id": opened["id"], "learned_at": 11,
        })
        claim = self.apply({
            "op": "record_claim", "entry_id": gate, "field": "status", "value": "Barricaded",
            "speaker_id": speaker, "tick": 12, "source": "Witness statement",
        })
        self.apply({
            "op": "record_observation", "observer_id": mira, "source_kind": "claim",
            "source_id": claim, "learned_at": 13,
        })
        self.assertEqual(self.article(gate, 10, mira)["observations"], [])
        known = self.article(gate, 11, mira)
        self.assertEqual([(o["id"], o["value"]) for o in known["observations"]], [(learned, "Open")])
        self.assertNotIn("assertions", known)
        self.assertNotIn("source_id", known["observations"][0])
        self.assertEqual(self.values(gate, 21)["status"], "Closed")
        self.assertEqual([o["value"] for o in self.article(gate, 21, mira)["observations"]], ["Open", "Barricaded"])
        self.assertEqual(self.article(gate)["findings"], [])
        self.assertEqual(self.browser.get(self.path + "/entries/" + secret, {"view_as": mira}).status_code, 404)
        self.assertNotIn("Sealed letter", self.browser.get(self.path, {"view_as": mira}).content.decode())
        private = next(a["id"] for a in self.article(gate)["assertions"] if a["author_only"])
        denied = self.post({"op": "record_observation", "observer_id": mira, "source_kind": "assertion", "source_id": private, "learned_at": 11})
        self.assertEqual(denied.json()["field_errors"][0]["code"], "PRIVATE_EVIDENCE")

        self.apply({"op": "correct_fact", "assertion_id": opened["id"], "value": "Ajar"})
        article = self.article(gate, 10)
        self.assertEqual(self.values(gate, 10)["status"], "Ajar")
        self.assertEqual(len(article["events"]), 2)
        self.assertEqual(article["claims"][0]["source"], "Witness statement")
        self.assertEqual(article["findings"][0]["code"], "OBSERVATION_SOURCE_CHANGED")
        self.assertEqual(self.article(gate, 11, mira)["observations"][0]["value"], "Open")

    def test_retimes_a_linked_transfer_as_one_correction(self):
        mira = self.entry("Mira", "person")
        tower, harbor = self.entry("East Tower"), self.entry("Cedar Harbor")
        watch, guild = self.entry("Watch", "group"), self.entry("Harbor Guild", "group")
        self.fact(mira, "located_in", tower)
        self.fact(mira, "affiliation", watch)
        transfer = self.event("Transfer", 12, (mira, "located_in", harbor), (mira, "affiliation", guild))
        self.assertEqual(self.values(mira, 11)["located_in"], tower)
        self.assertEqual(self.values(mira, 12)["affiliation"], guild)
        self.apply({"op": "correct_event_date", "event_id": transfer, "tick": 11})
        self.assertEqual(self.values(mira, 10)["affiliation"], watch)
        self.assertEqual(self.values(mira, 11)["located_in"], harbor)
        self.assertEqual(self.values(mira, 11)["affiliation"], guild)
        self.assertEqual([event["id"] for event in self.article(mira)["events"]], [transfer])
        self.event("Return", 15, (mira, "located_in", tower))
        rejected = self.post({"op": "correct_event_date", "event_id": transfer, "tick": 15})
        self.assertEqual((rejected.status_code, rejected.json()["field_errors"][0]["code"]), (422, "INTERVENING_BOUNDARY"))
        self.assertEqual(self.values(mira, 11)["located_in"], harbor)

    def test_conflicting_canon_is_flagged_and_resolution_is_recorded(self):
        gate = self.entry("Cedar Gate")
        self.fact(gate, "status", "Closed")
        overlap = self.fact(gate, "status", "Open", 7, until_tick=10)
        self.assertEqual(self.values(gate, 6)["status"], "Closed")
        self.assertEqual(self.values(gate, 7)["status"], "conflict")
        self.assertEqual(self.values(gate, 10)["status"], "Closed")
        issue = self.article(gate)["findings"][0]
        self.assertEqual((issue["code"], issue["from_tick"], issue["until_tick"]), ("CANON_CONFLICT", 7, 10))
        self.apply({"op": "correct_fact", "assertion_id": overlap, "value": "Closed"})
        self.assertEqual(self.values(gate, 7)["status"], "Closed")
        self.assertEqual(self.article(gate)["findings"], [])
        self.assertEqual(WikiFinding.objects.get(pk=issue["id"]).resolved_at_edit, self.edit)

    def test_invalid_link_rolls_back_other_changes_and_the_event(self):
        mira, gate = self.entry("Mira", "person"), self.entry("Cedar Gate")
        self.fact(gate, "status", "Closed")
        self.fact(mira, "located_in", gate)
        rejected = self.post({
            "op": "record_event", "name": "Invalid transfer", "tick": 10, "changes": [
                {"entry_id": gate, "field": "status", "value": "Open"},
                {"entry_id": mira, "field": "located_in", "value": str(uuid4())},
            ],
        })
        self.assertEqual(rejected.status_code, 422, rejected.json())
        self.assertFalse(WikiEvent.objects.filter(wiki_id=self.world).exists())
        self.assertEqual(self.values(gate, 10)["status"], "Closed")
        self.assertEqual(self.browser.get(self.path).json()["edit_counter"], self.edit)

    def test_receipts_stale_writes_and_grants(self):
        command = {"op": "create_entry", "name": "Cedar Gate", "kind": "place"}
        key = uuid4()
        accepted = self.post(command, expected=0, key=key)
        self.assertEqual(accepted.status_code, 200, accepted.json())
        self.edit = accepted.json()["edit_counter"]
        self.entry("Mira", "person")
        self.assertEqual(self.post(command, expected=0, key=key).json(), accepted.json())
        self.assertEqual(self.post({**command, "name": "Altered"}, expected=0, key=key).json()["code"], "KEY_REUSED")
        self.assertEqual(self.post(command, expected=0).json()["code"], "STALE_WIKI")
        self.assertEqual(self.browser.get(self.path, {"view_as": accepted.json()["record_id"]}).status_code, 404)

        outsider = provision("wiki-outsider")
        other, token = self.sign_in(outsider)
        self.assertEqual(other.get(self.path).status_code, 404)
        self.assertEqual(self.post(command, browser=other, token=token).status_code, 404)
        WorldAccess.objects.create(
            world_id=self.world, account=outsider, role=WorldAccess.Role.EDITOR, capabilities=[], enabled=True,
        )
        self.assertFalse(other.get(self.path).json()["can_edit"])
        self.assertEqual(self.post(command, browser=other, token=token).status_code, 403)

    def test_wiki_authoring_preserves_existing_draft_data_and_identity(self):
        draft_path = self.path.removesuffix("/wiki") + "/draft"
        old_id = str(uuid4())
        apply_draft_edits(self.world, self.owner.pk, uuid4(), {
            "mode": "manual", "expected_revision": 0, "edits": [
                {"op": "add", "pointer": "/entities/" + old_id, "value": {
                    "id": old_id, "kind": "place", "name": "Existing dungeon", "visibility": "author",
                }},
            ],
        })
        baseline = self.browser.get(draft_path).json()
        gate = self.entry("Cedar Gate")
        self.fact(gate, "status", "Closed")
        self.assertEqual(self.browser.get(draft_path).json(), baseline)
        self.assertEqual(list(baseline["source"]["entities"]), [old_id])
        self.assertNotEqual(gate, old_id)

    def test_worldbuilding_records_keep_identity_across_same_time_events(self):
        hall = self.entry("Harbor Hall", initial_values=[{"field": "place_type", "value": "Building"}])
        landing = self.entry("Upper Landing", initial_values=[
            {"field": "place_type", "value": "Room"}, {"field": "located_in", "value": hall},
        ])
        quay = self.entry("Quay")
        ranger = self.entry("Ranger", "class")
        step = self.entry("Ward Step", "ability")
        bell = self.entry("Tide Bell", "item")
        keeper = self.entry("Keeper", "person")
        mira = self.entry("Mira", "person", initial_values=[
            {"field": "description", "value": "A watch recruit."},
            {"field": "located_in", "value": hall},
            {"field": "character_class", "value": ranger},
        ])
        learned = self.apply({
            "op": "record_learned_ability", "character_id": mira, "ability_id": step,
            "learned_at": 3, "source": "Training notes",
        })
        traversal = self.apply({
            "op": "record_event", "name": "Arrival upstairs", "tick": 10,
            "description": "Mira crosses the last span.", "source": "Watch log",
            "participant_ids": [mira], "place_ids": [landing],
            "ability_use": {"ability_id": step, "actor_id": mira},
            "changes": [{"entry_id": mira, "field": "located_in", "value": landing}],
        })
        ringing = self.apply({
            "op": "record_event", "name": "Evening bell", "tick": 10, "participant_ids": [keeper],
            "place_ids": [quay], "item_ids": [bell],
        })
        data = self.browser.get(self.path + "/timeline").json()["timeline"]
        self.assertEqual({(event["id"], event["tick"]) for event in data}, {(traversal, 10), (ringing, 10)})
        unused_state = next(event for event in data if event["id"] == ringing)
        self.assertEqual(unused_state["changes"], [])
        self.assertEqual({(link["entry_id"], link["role"]) for link in unused_state["links"]},
                         {(keeper, "participant"), (quay, "place"), (bell, "item")})
        self.assertEqual([event["id"] for event in self.article(bell, 10)["events"]], [ringing])
        self.assertEqual([event["id"] for event in self.article(step, 10)["events"]], [traversal])
        self.assertEqual(self.values(mira, 9)["located_in"], hall)
        self.assertEqual(self.values(mira, 10)["located_in"], landing)
        self.assertEqual({entry["id"] for entry in self.article(hall, 9)["contents"]}, {mira, landing})
        self.assertEqual([entry["id"] for entry in self.article(hall, 10)["contents"]], [landing])
        self.assertEqual(self.article(mira, 2)["learned_abilities"], [])
        self.assertEqual(self.article(mira, 3)["learned_abilities"][0]["ability_id"], step)
        self.apply({"op": "correct_learned_ability", "learned_ability_id": learned, "learned_at": 4})
        self.assertEqual(self.article(mira, 3)["learned_abilities"], [])
        self.assertEqual(self.article(mira, 4)["learned_abilities"][0]["source"], "Training notes")
        self.assertNotIn("learned_abilities", self.article(mira, 10, mira))
        self.assertEqual(self.browser.get(self.path + "/timeline", {"view_as": mira}).json()["timeline"], [])
        self.apply({"op": "rename_entry", "entry_id": ranger, "name": "Harbor Ranger"})
        self.assertEqual(self.article(ranger)["entry"]["name"], "Harbor Ranger")
        self.assertEqual(self.values(mira, 10)["character_class"], ranger)
        self.apply({"op": "edit_event", "event_id": traversal, "name": "Arrives upstairs", "participant_ids": [mira, keeper]})
        revised = self.article(mira, 10)["events"][0]
        self.assertEqual((revised["id"], revised["name"], revised["tick"]), (traversal, "Arrives upstairs", 10))
        self.assertEqual(revised["ability_use"], {"ability_id": step, "actor_id": mira})
        self.assertEqual(revised["source"], "Watch log")
        self.assertEqual(self.values(mira, 10)["located_in"], landing)

    def test_event_links_are_scoped_and_conflicting_same_time_changes_roll_back(self):
        mira = self.entry("Mira", "person")
        hall = self.entry("Harbor Hall")
        _, other = create_world(self.owner.pk, uuid4(), "Other world")
        foreign_wiki = WikiWorld.objects.create(world_id=other["world"]["id"])
        foreign = str(WikiEntry.objects.create(wiki=foreign_wiki, name="Distant harbor", kind="place").pk)
        action = {"op": "record_event", "name": "An event", "tick": 10,
                  "changes": [{"entry_id": mira, "field": "located_in", "value": hall}]}
        for links, code in (({"item_ids": [hall]}, "INVALID_EVENT_LINK"), ({"place_ids": [foreign]}, "INVALID_ENTRY")):
            with self.subTest(links=links):
                reply = self.post({**action, **links})
                self.assertEqual((reply.status_code, reply.json()["field_errors"][0]["code"]), (422, code))
                self.assertFalse(WikiEvent.objects.filter(wiki_id=self.world).exists())
        self.apply({**action, "place_ids": [hall]})
        duplicate = self.post({**action, "name": "Conflicting event"})
        self.assertEqual((duplicate.status_code, duplicate.json()["field_errors"][0]["code"]),
                         (422, "AMBIGUOUS_TRANSITION"))
        self.assertEqual(WikiEvent.objects.filter(wiki_id=self.world).count(), 1)

    def test_previous_event_receipt_still_replays(self):
        gate = self.entry("Cedar Gate")
        command = {
            "op": "record_event", "name": "The gate opens", "tick": 10, "source": "",
            "changes": [{"entry_id": gate, "field": "status", "value": "Open", "author_only": False}],
        }
        original_edit = self.edit
        event_id = self.apply(command)
        key = uuid4()
        receipt = MutationReceipt.objects.create(
            principal=self.owner, operation="wiki_change", scope_key=f"wiki:{self.world}", request_key=key,
            world_id=self.world, response_status=200, result={"record_id": event_id, "edit_counter": self.edit},
            input_digest=digest_json({"expected_edit": original_edit, "command": command}),
        )
        replayed = self.post(command, expected=original_edit, key=key)
        self.assertEqual(replayed.json()["receipt_id"], str(receipt.pk))
        self.assertEqual(replayed.json()["record_id"], event_id)
        self.assertEqual(WikiEvent.objects.filter(wiki_id=self.world).count(), 1)
