from datetime import timedelta
from io import BytesIO
from tempfile import TemporaryDirectory
from uuid import uuid4

from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TransactionTestCase, override_settings
from django.utils import timezone
from PIL import Image

from .drafts import apply_draft_edits
from .models import MutationReceipt, WikiEntry, WikiEvent, WikiFinding, WikiMapImage, WikiMapPin, WikiWorld, WorldAccess
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

    def discover(self, subject, observer, at=0):
        return self.apply({"op": "set_discovery", "entry_id": subject, "observer_id": observer, "learned_at": at})

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

    def upload_map(self, content, *, key=None, browser=None, token=None):
        return (browser or self.browser).post(
            self.path + "/maps/uploads",
            {"image": SimpleUploadedFile("chart.png", content, content_type="image/png")},
            headers={"X-CSRFToken": token or self.token, "Idempotency-Key": str(key or uuid4())},
        )

    @staticmethod
    def map_image_bytes(color="navy", image_format="PNG"):
        with BytesIO() as stream:
            Image.new("RGB", (24, 16), color).save(stream, format=image_format)
            return stream.getvalue()

    def test_image_maps_attach_to_stable_entries_and_protect_media(self):
        with TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            map_id = self.entry("Historic chart", "map")
            self.fact(map_id, "asset_location", "archive/old-chart.png", start=0)
            observer = self.entry("Harbor pilot", "person")
            media_url = self.path + "/maps/" + map_id + "/image"
            content = self.map_image_bytes(image_format="JPEG")
            upload_key = uuid4()
            staged = self.upload_map(content, key=upload_key)
            self.assertEqual(staged.status_code, 200, staged.json())
            upload_id = staged.json()["upload_id"]
            self.assertEqual(self.upload_map(content, key=upload_key).json(), staged.json())
            self.assertEqual(self.upload_map(self.map_image_bytes(), key=upload_key).status_code, 409)
            self.assertEqual(self.browser.get(media_url).status_code, 404)
            self.assertNotIn("image_map", self.article(map_id))

            command = {"op": "attach_map_image", "map_id": map_id, "upload_id": upload_id}
            before = self.edit
            change_key = uuid4()
            saved = self.post(command, key=change_key)
            self.assertEqual(saved.status_code, 200, saved.json())
            self.assertEqual(saved.json()["record_id"], map_id)
            self.edit = saved.json()["edit_counter"]
            self.assertEqual(self.post(command, expected=before, key=change_key).json(), saved.json())
            self.assertEqual(self.values(map_id, 0)["asset_location"], "archive/old-chart.png")
            article = self.browser.get(self.path + "/entries/" + map_id, {"overview": "true"}).json()["article"]
            self.assertEqual(article["image_map"], {"width": 24, "height": 16, "pins": []})

            response = self.browser.get(media_url)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["Content-Type"], "image/jpeg")
            self.assertIn("no-store", response["Cache-Control"])
            self.assertEqual(b"".join(response.streaming_content), content)
            self.assertEqual(Client().get(media_url).status_code, 401)
            stranger, _ = self.sign_in(provision("map-stranger"))
            self.assertEqual(stranger.get(media_url).status_code, 404)
            self.assertEqual(self.browser.get(media_url, {"at": 0, "view_as": observer}).status_code, 404)
            self.discover(map_id, observer)
            self.assertNotIn("image_map", self.article(map_id, observer=observer))

            editor = provision("map-reader")
            WorldAccess.objects.create(world_id=self.world, account=editor, role="editor", capabilities=[], enabled=True)
            read_only, token = self.sign_in(editor)
            response = read_only.get(media_url)
            self.assertEqual(response.status_code, 200)
            response.close()
            self.assertEqual(self.upload_map(content, browser=read_only, token=token).status_code, 403)

    def test_map_pins_keep_coordinates_and_reject_foreign_targets(self):
        with TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            upload = self.upload_map(self.map_image_bytes()).json()["upload_id"]
            map_id = self.apply({"op": "create_image_map", "name": "Coast map", "upload_id": upload})
            place_id = self.entry("Ferry terminal")
            item_id = self.entry("Survey weight", "item")
            _, other = create_world(self.owner.pk, uuid4(), "Other coast")
            foreign = WikiEntry.objects.create(
                wiki=WikiWorld.objects.create(world_id=other["world"]["id"]), name="Foreign site", kind="place",
            )
            pin = {
                "op": "save_map_pin", "map_id": map_id, "label": "Departure", "place_id": place_id,
                "x": 0.125, "y": 1,
            }
            pin_id = self.apply(pin)
            extra_id = self.apply({**pin, "label": "Unlinked point", "place_id": None})
            self.assertEqual(self.post({**pin, "place_id": str(foreign.pk)}).status_code, 422)
            self.assertEqual(self.post({**pin, "place_id": item_id}).status_code, 422)
            for x in (-0.01, 1.01, True, "0.25"):
                self.assertEqual(self.post({**pin, "x": x}).status_code, 400)
            self.assertEqual(self.post({**pin, "map_id": place_id}).status_code, 422)
            self.assertEqual(WikiMapPin.objects.filter(map_entry_id=map_id).count(), 2)
            self.assertEqual(self.apply({**pin, "pin_id": pin_id, "label": "Board here", "x": 0.375}), pin_id)
            self.apply({"op": "remove_map_pin", "map_id": map_id, "pin_id": extra_id})
            self.assertEqual(self.article(map_id)["image_map"]["pins"], [{
                "id": pin_id, "label": "Board here", "place_id": place_id, "x": 0.375, "y": 1,
            }])

    def test_map_staging_validates_images_and_reclaims_expired_uploads(self):
        with TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            self.assertEqual(self.upload_map(b"Not a chart").status_code, 422)
            with BytesIO() as stream:
                Image.new("RGB", (24, 16), "navy").save(
                    stream, format="MPO", save_all=True, append_images=[Image.new("RGB", (24, 16), "green")],
                )
                response = self.upload_map(stream.getvalue())
                self.assertEqual(response.status_code, 422, response.content)
                self.assertIn("still PNG or JPEG", response.json()["field_errors"][0]["message"])
            self.assertFalse(WikiMapImage.objects.exists())
            content = self.map_image_bytes()
            staging = self.upload_map(content)
            self.assertEqual(staging.status_code, 200, staging.json())
            expired = WikiMapImage.objects.get(pk=staging.json()["upload_id"])
            expired.created_at = timezone.now() - timedelta(days=8)
            expired.save(update_fields=["created_at"])
            command = {"op": "create_image_map", "name": "Expired map", "upload_id": str(expired.pk)}
            self.assertEqual(self.post(command).status_code, 422)
            self.assertFalse(WikiEntry.objects.filter(name="Expired map").exists())
            staging = self.upload_map(content)
            self.assertEqual(staging.status_code, 200, staging.json())
            self.assertFalse(WikiMapImage.objects.filter(pk=expired.pk).exists())
            self.assertFalse(default_storage.exists(expired.storage_key))
            command["upload_id"] = staging.json()["upload_id"]
            self.assertEqual(self.post(command, expected=self.edit + 1).status_code, 409)
            self.assertFalse(WikiEntry.objects.filter(name="Expired map").exists())
            self.assertTrue(self.apply({**command, "name": "Recovered chart"}))

    def test_workspace_overviews_and_dates_preserve_legacy_facts(self):
        person = self.entry("Surveyor", "person", overview="A surveyor working on the coast.")
        fact_id = self.fact(person, "description", "Description recorded in the original account.", start=0)
        self.fact(person, "height_cm", 180, start=7)
        self.apply({"op": "update_overview", "entry_id": person, "overview": "Revised biography."})

        url = self.path + "/entries/" + person
        summary = self.browser.get(url, {"overview": "true"}).json()
        self.assertIsNone(summary["at"])
        self.assertEqual(summary["article"]["overview"], "Revised biography.")
        self.assertNotIn("values", summary["article"])
        self.assertNotIn("age_years", summary["article"])
        fact = next(row for row in summary["article"]["assertions"] if row["id"] == fact_id)
        self.assertEqual(fact["value"], "Description recorded in the original account.")
        self.assertEqual(self.values(person, 0)["description"], fact["value"])
        self.assertEqual(self.values(person, 7)["height_cm"], 180)
        self.assertEqual(self.browser.get(url).json()["at"], 0)
        self.assertEqual(self.browser.get(url, {"overview": "true", "at": 0}).status_code, 400)

        incomplete = self.post({
            "op": "create_entry", "name": "Undated facts", "kind": "person", "overview": "",
            "initial_values": [{"field": "height_cm", "value": 180}],
        })
        self.assertEqual(incomplete.status_code, 400, incomplete.json())
        self.assertFalse(WikiEntry.objects.filter(wiki_id=self.world, name="Undated facts").exists())

    def test_workspace_vehicle_catalog_and_name_search_have_author_scope(self):
        origin = self.entry("Survey depot")
        transport = self.entry("Survey ferry", "item", catalog_type="vehicle", overview="A working survey ferry.")
        legacy = self.entry("Legacy survey cart", "item")
        self.fact(legacy, "item_type", "Vehicle", start=4)
        disputed = self.entry("Disputed survey cart", "item")
        self.fact(disputed, "item_type", "Vehicle", start=2, until_tick=6)
        self.fact(disputed, "item_type", "Tool", start=6)
        actor = self.entry("Surveyor", "person")
        _, elsewhere = create_world(self.owner.pk, uuid4(), "Far outside this workspace")
        foreign, _ = WikiWorld.objects.get_or_create(world_id=elsewhere["world"]["id"])
        WikiEntry.objects.create(wiki=foreign, kind="place", name="Foreign survey station")

        path = self.path + "/search"
        matches = self.browser.get(path, {"q": "sURvEy"})
        self.assertEqual(matches.status_code, 200, matches.json())
        index = {entry["id"]: entry for entry in matches.json()["entries"]}
        self.assertEqual(set(index), {origin, transport, legacy, disputed, actor})
        self.assertEqual(index[transport]["catalog_type"], "vehicle")
        self.assertEqual(index[legacy]["catalog_type"], "vehicle")
        self.assertNotIn("catalog_type", index[disputed])
        self.assertTrue(index[disputed]["classification_needs_review"])
        self.assertEqual(self.article(legacy, 4)["entry"]["id"], legacy)
        self.assertEqual(self.values(legacy, 4)["item_type"], "Vehicle")
        self.assertEqual(self.values(disputed, 6)["item_type"], "Tool")
        self.discover(transport, actor)
        self.assertNotIn("catalog_type", self.article(transport, 0, observer=actor)["entry"])

        unauthorized, _ = self.sign_in(provision("workspace-outsider"))
        self.assertEqual(unauthorized.get(path, {"q": "survey"}).status_code, 404)
        outsider = provision("workspace-reader")
        reader, _ = self.sign_in(outsider)
        WorldAccess.objects.create(world_id=self.world, account=outsider, role="editor", capabilities=[], enabled=True)
        self.assertEqual(reader.get(path, {"q": "survey"}).status_code, 403)
        wrong_kind = self.post({"op": "create_entry", "kind": "place", "name": "Invalid vehicle", "catalog_type": "vehicle"})
        self.assertEqual(wrong_kind.status_code, 400, wrong_kind.json())

    def test_editorial_content_persists_in_order_and_stays_out_of_character_views(self):
        subject = self.entry("Dock ledger", "item", overview="The ledger’s summary.")
        observer = self.entry("Dock clerk", "person")
        date_fact = self.fact(subject, "description", "Stored in the archive.", start=7)
        sections = [
            {"id": str(uuid4()), "heading": "Provenance", "body": "Entered by the morning clerk."},
            {"id": str(uuid4()), "heading": "Cargo records", "body": "Three crates of cider."},
        ]
        self.assertEqual(
            self.apply({"op": "update_world_introduction", "introduction": "A world built around river trade."}),
            str(self.world),
        )
        command = {"op": "update_article_sections", "entry_id": subject, "sections": sections}
        self.assertEqual(self.apply(command), subject)
        self.assertEqual(WikiEntry.objects.get(pk=subject).article_sections, sections)
        self.assertEqual(WikiWorld.objects.get(world_id=self.world).introduction, "A world built around river trade.")

        path = self.path + "/entries/" + subject
        response = self.browser.get(path, {"overview": "true"}).json()
        self.assertEqual(response["article"]["sections"], sections)
        self.assertEqual(response["article"]["overview"], "The ledger’s summary.")
        self.assertEqual(response["article"]["assertions"][0]["id"], date_fact)
        self.assertEqual(response["world_introduction"], "A world built around river trade.")
        self.assertEqual(self.post({**command, "sections": [sections[0], sections[0]]}).status_code, 400)
        self.assertEqual(self.post({**command, "sections": [{**sections[0], "heading": "  "}]}).status_code, 400)
        self.assertEqual(self.post(command, expected=self.edit - 1).status_code, 409)
        self.assertEqual(WikiEntry.objects.get(pk=subject).article_sections, sections)
        self.assertEqual(WikiWorld.objects.get(world_id=self.world).edit_counter, self.edit)

        account = provision("wiki-editorial-reader")
        WorldAccess.objects.create(world_id=self.world, account=account, role="editor", capabilities=[], enabled=True)
        reader, token = self.sign_in(account)
        self.assertEqual(self.post(command, browser=reader, token=token).status_code, 403)
        self.assertEqual(reader.get(path, {"overview": "true"}).json()["article"]["sections"], sections)
        self.discover(subject, observer)
        projection = self.browser.get(path, {"at": 7, "view_as": observer}).json()
        self.assertNotIn("sections", projection["article"])
        self.assertNotIn("world_introduction", projection)

    def test_world_home_curation_validates_scope_and_keeps_order(self):
        first = self.entry("Archive")
        second = self.entry("Clerk", "person")
        hidden = self.entry("Reserved", author_only=True)
        command = {
            "op": "update_world_home", "introduction": "Floodplain archive", "cover_map_id": None,
            "featured_entry_ids": [second, first],
        }
        self.apply(command)
        home = self.browser.get(self.path + "/home").json()
        self.assertEqual(home["introduction"], "Floodplain archive")
        self.assertEqual([entry["id"] for entry in home["featured"]], [second, first])
        self.assertEqual(self.post({**command, "featured_entry_ids": [hidden]}).status_code, 422)
        self.assertEqual(self.post({**command, "cover_map_id": first}).status_code, 422)
        self.assertEqual(self.browser.get(self.path + "/home").json(), home)
        self.assertNotIn("world_home", self.browser.get(self.path, {"at": 0, "view_as": second}).json())

    def test_discovery_scopes_names_and_direct_reads_by_observer_and_date(self):
        observer = self.entry("Clerk", "person")
        other = self.entry("Engineer", "person")
        subject = self.entry("Flood archive")
        hidden = self.entry("Reserved", author_only=True)
        link = self.discover(subject, observer, 5)
        path = self.path + "/entries/" + subject
        self.assertEqual(self.browser.get(path, {"at": 4, "view_as": observer}).status_code, 404)
        self.assertEqual(self.browser.get(path, {"at": 5, "view_as": other}).status_code, 404)
        known = self.browser.get(path, {"at": 5, "view_as": observer}).json()
        self.assertEqual({entry["id"] for entry in known["entries"]}, {subject, observer})
        self.assertNotIn("discoveries", known["article"])
        self.assertEqual(self.discover(subject, observer, 6), link)
        self.assertEqual(self.browser.get(path, {"at": 5, "view_as": observer}).status_code, 404)
        self.assertEqual(self.post({
            "op": "set_discovery", "entry_id": hidden, "observer_id": observer, "learned_at": 1,
        }).status_code, 422)

    def test_event_target_can_be_linked_without_changing_state(self):
        performer = self.entry("Inspector", "person")
        target = self.entry("Floodgate", "item")
        event_id = self.apply({
            "op": "record_event", "node_kind": "action", "name": "Inspect gate", "tick": 4,
            "performer_ids": [performer], "target_ids": [target],
        })
        event = self.article(target, 4)["events"][0]
        self.assertEqual(event["id"], event_id)
        self.assertEqual({(link["role"], link["entry_id"]) for link in event["links"]},
                         {("performer", performer), ("target", target)})
        self.assertEqual(event["changes"], [])

    def test_biography_and_family_keep_their_own_meaning_as_of_time(self):
        clinic = self.entry("Clinic")
        home = self.entry("Coast")
        nation = self.entry("Coastal federation", "group")
        parent = self.entry("Eleni", "person")
        shared = self.entry("Ivo", "person")
        declared = self.entry("Kite", "person")
        self.fact(shared, "parent", parent)
        mira = self.entry("Mira", "person", initial_at=2, initial_values=[
            {"field": "birthplace", "value": clinic},
            {"field": "origin", "value": home},
            {"field": "nationality", "value": nation},
            {"field": "parent", "value": parent},
            {"field": "sibling", "value": declared},
        ])
        self.assertEqual(self.article(mira, 1)["family"], {"parents": [], "children": [], "siblings": []})
        values = self.values(mira, 2)
        self.assertEqual((values["birthplace"], values["origin"], values["nationality"]), (clinic, home, nation))
        self.assertEqual(values["located_in"], "unknown")
        family = self.article(mira, 2)["family"]
        self.assertEqual(family["parents"], [parent])
        siblings = {link["entry_id"]: link for link in family["siblings"]}
        self.assertEqual(siblings[shared]["shared_parent_ids"], [parent])
        self.assertFalse(siblings[shared]["declared"])
        self.assertTrue(siblings[declared]["declared"])
        self.assertEqual(set(self.article(parent, 2)["family"]["children"]), {mira, shared})
        self.assertEqual(self.article(declared, 2)["family"]["siblings"][0]["entry_id"], mira)

        self.fact(mira, "located_in", home, 4)
        self.assertEqual(self.values(mira, 4)["birthplace"], clinic)
        self.assertEqual(self.values(mira, 4)["located_in"], home)
        invalid = self.post({"op": "create_entry", "kind": "person", "name": "Invalid identity", "initial_values": [
            {"field": "birthplace", "value": parent},
        ]})
        self.assertEqual(invalid.status_code, 422)
        self.assertFalse(WikiEntry.objects.filter(wiki_id=self.world, name="Invalid identity").exists())

    def test_subject_history_keeps_world_group_dates_and_distinguishes_involvement(self):
        mira = self.entry("Mira", "person")
        machine = self.entry("Level sensor", "item")
        location = self.entry("Reservoir")
        project = self.apply({"op": "record_event_group", "name": "Reservoir inspection"})
        segment = self.apply({"op": "record_event_group", "name": "Readings", "parent_id": project})
        reading = self.apply({
            "op": "record_event", "name": "Log reading", "tick": 2, "node_kind": "action",
            "parent_id": segment, "performer_ids": [machine], "participant_ids": [mira], "place_ids": [location],
        })
        self.apply({"op": "record_event", "name": "Independent log", "tick": 20, "parent_id": segment})
        # Omitted role fields preserve existing links on correction.
        self.apply({"op": "edit_event", "event_id": reading, "name": "Log reading"})
        article = self.article(machine, 2)
        self.assertEqual([item["id"] for item in article["events"]], [reading])
        self.assertIn({"entry_id": machine, "role": "performer"}, article["events"][0]["links"])
        self.assertIn({"entry_id": mira, "role": "participant"}, article["events"][0]["links"])
        self.assertEqual(self.values(mira, 2)["located_in"], "unknown")
        timeline = {item["id"]: item for item in self.browser.get(self.path + "/timeline").json()["timeline"]}
        self.assertEqual({item["id"] for item in article["event_ancestors"]}, {project, segment})
        for ancestor in article["event_ancestors"]:
            self.assertEqual((ancestor["display_start"], ancestor["display_end"]), (2, 20))
            self.assertEqual(ancestor, timeline[ancestor["id"]])
        invalid = self.post({"op": "edit_event", "event_id": segment, "name": "Rejected", "performer_ids": [machine]})
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(invalid.json()["field_errors"][0]["code"], "GROUP_EFFECT")
        self.assertEqual(WikiEvent.objects.get(pk=segment).name, "Readings")

    def test_an_ended_slot_cannot_be_set_again_by_another_event_at_the_same_time(self):
        place = self.entry("Station")
        mira = self.entry("Mira", "person")
        self.fact(mira, "located_in", place)
        self.apply({
            "op": "record_event", "name": "Leave", "tick": 2, "changes": [
                {"entry_id": mira, "field": "located_in", "value": place, "mode": "end"},
            ],
        })
        rejected = self.post({
            "op": "record_event", "name": "Unordered arrival", "tick": 2, "changes": [
                {"entry_id": mira, "field": "located_in", "value": place, "mode": "set"},
            ],
        })
        self.assertEqual(rejected.status_code, 422)
        self.assertEqual(rejected.json()["field_errors"][0]["code"], "AMBIGUOUS_TRANSITION")
        self.assertFalse(WikiEvent.objects.filter(wiki_id=self.world, name="Unordered arrival").exists())
        self.assertEqual(self.values(mira, 1)["located_in"], place)
        self.assertEqual(self.values(mira, 2)["located_in"], "unknown")
        self.event("Later arrival", 3, (mira, "located_in", place))
        self.assertEqual(self.values(mira, 3)["located_in"], place)

    def test_ambiguous_primary_class_cannot_supply_a_certain_default(self):
        first = self.entry("Definition one", "class")
        second = self.entry("Definition two", "class")
        mira = self.entry("Mira", "person")
        self.fact(first, "height_cm", 170)
        self.fact(mira, "character_class", first)
        self.fact(mira, "character_class", second, 2)
        self.assertEqual(self.values(mira, 1)["height_cm"], 170)
        self.assertEqual(self.values(mira, 2)["character_class"], "conflict")
        self.assertEqual(self.values(mira, 2)["height_cm"], "unknown")
        self.fact(mira, "height_cm", 160, 2)
        self.assertEqual(self.values(mira, 2)["height_cm"], 160)

    def test_lucidchart_dimensions_visual_references_lifetimes_and_population_profiles(self):
        mira = self.entry("Mira", "person")
        lantern = self.entry("Lantern", "item")
        species = self.entry("Cliff fox", "species")
        trait = self.entry("Running speed", "trait")
        ability = self.entry("Glide", "ability")
        self.fact(trait, "unit", "m/s")
        self.fact(ability, "ability_type", "Technique")
        self.fact(ability, "ability_domain", "Physical")
        self.fact(ability, "ability_domain", "Mental")
        for field, name in (
            ("image", "Lantern photo"), ("model_3d", "Lantern mesh"),
            ("texture", "Lantern finish"), ("animation", "Lantern swing"),
        ):
            asset = self.entry(name, field)
            self.fact(asset, "asset_location", "assets/lantern/" + field)
            self.fact(lantern, field, asset)
            self.assertEqual(self.values(lantern, 0)[field], asset)
        self.fact(mira, "width_cm", "37.50")
        self.fact(lantern, "length_cm", "3.125")
        self.fact(lantern, "mass_kg", "0.03")
        self.fact(lantern, "creation_tick", 2)
        self.fact(lantern, "destruction_tick", 370)
        self.fact(species, "creation_tick", 0)
        self.fact(species, "extinction_tick", 3600)
        self.apply({"op": "set_calendar", "days_per_year": 360})
        self.assertEqual(self.values(mira, 0)["width_cm"], "37.5")
        self.assertEqual(self.values(lantern, 0)["length_cm"], "3.125")
        self.assertEqual(self.values(lantern, 0)["mass_kg"], "0.03")
        self.assertIsNone(self.article(lantern, 1)["age_years"])
        self.assertEqual(self.article(lantern, 1080)["age_years"], 1)
        self.assertEqual(self.article(species, 7200)["age_years"], 10)
        self.fact(species, "typical_ability", ability)
        self.fact(species, "typical_item", lantern)
        self.fact(species, "physical_average", "1.75", qualifier_id=trait)
        self.fact(species, "personality_average", "Observant", qualifier_id=trait)
        self.fact(species, "power_average", "2", qualifier_id=trait)
        profile = '[{"value":"2.00","weight":"3"},{"value":"1","weight":"1.0"}]'
        self.fact(species, "power_distribution", profile, qualifier_id=trait)
        self.fact(species, "physical_distribution", profile, qualifier_id=trait)
        expected = '[{"value":"1","weight":"1"},{"value":"2","weight":"3"}]'
        values = {value["field"]: value for value in self.article(species)["values"]}
        self.assertEqual((values["physical_distribution"]["value"], values["physical_distribution"]["unit"]), (expected, "m/s"))
        self.assertEqual(values["power_distribution"]["value"], expected)
        self.assertEqual(values["typical_ability"]["value"], ability)
        self.assertEqual(values["typical_item"]["value"], lantern)
        self.fact(mira, "species", species)
        self.assertNotIn("power_distribution", self.values(mira, 0))
        self.assertNotIn("inventory", self.values(mira, 0))
        for field, value, expected_code, extra in (
            ("image", lantern, "INVALID_REFERENCE", {}),
            ("width_cm", "-1", "INVALID_VALUE", {}),
            ("power_distribution", '[{"value":"2","weight":"0"}]', "INVALID_DISTRIBUTION", {"qualifier_id": trait}),
            ("power_distribution", '[{"value":"2","weight":"1"},{"value":"2.0","weight":"1"}]',
             "INVALID_DISTRIBUTION", {"qualifier_id": trait}),
        ):
            response = self.post({
                "op": "record_fact", "entry_id": species, "field": field, "value": value, "from_tick": 0, **extra,
            })
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()["field_errors"][0]["code"], expected_code)

    def test_lucidchart_territory_relationships_and_event_context_are_distinct(self):
        watch = self.entry("Harbor society", "group")
        coast = self.entry("Coastal culture", "culture")
        era = self.entry("Cedar era", "era")
        territory = self.entry("Harbor district", "territory")
        terrain = self.entry("Dunes")
        harbor = self.entry("Harbor gate")
        map_entry = self.entry("Harbor map", "map")
        mira = self.entry("Mira", "person")
        goal = self.entry("Keep the gate open", "goal")
        self.fact(mira, "place_affiliation", harbor)
        for subject, field, value in (
            (watch, "group_type", "Society"), (watch, "culture", coast), (coast, "era", era),
            (era, "era_start", 0), (era, "era_end", 100),
            (watch, "group_place", harbor), (watch, "territory", territory), (watch, "map", map_entry),
            (harbor, "territory", territory), (harbor, "map", map_entry),
            (territory, "landscape", "Dunes and a protected inlet"), (territory, "terrain", terrain),
            (territory, "map", map_entry), (terrain, "place_type", "Terrain"), (goal, "goal_owner", mira),
        ):
            self.fact(subject, field, value)
        self.assertEqual(self.values(watch, 0)["culture"], coast)
        self.assertEqual(self.values(territory, 0)["terrain"], terrain)
        links = self.article(territory)["incoming_links"]
        self.assertEqual({row["entry_id"] for row in links}, {harbor, watch})
        self.assertNotEqual(self.values(mira, 0)["located_in"], harbor)

        blocked = self.fact(harbor, "status", "Blocked", author_only=True)
        report = self.event("Obstruction reported", 1)
        event = self.apply({
            "op": "record_event", "name": "Gate cleared", "tick": 2, "summary": "Passage reopened",
            "description": "The gate opened", "method": "Moved the obstruction with a lever",
            "purpose_ids": [goal], "backstory_ids": [mira, harbor], "era_ids": [era],
            "cause_event_ids": [report], "cause_assertion_ids": [blocked], "participant_ids": [mira],
            "changes": [{"entry_id": harbor, "field": "status", "value": "Open"}],
        })
        self.apply({"op": "edit_event", "event_id": event, "name": "Gate cleared"})
        readback = next(item for item in self.article(mira, 2)["events"] if item["id"] == event)
        self.assertEqual(readback["summary"], "Passage reopened")
        self.assertEqual(readback["method"], "Moved the obstruction with a lever")
        self.assertEqual(readback["cause_event_ids"], [report])
        self.assertEqual(readback["cause_state"][0]["id"], blocked)
        self.assertEqual(readback["cause_state"][0]["value"], "Blocked")
        self.assertEqual(readback["changes"][0]["value"], "Open")
        self.assertIn({"entry_id": goal, "role": "purpose"}, readback["links"])
        self.assertIn({"entry_id": harbor, "role": "backstory"}, readback["links"])
        self.assertIn({"entry_id": era, "role": "era"}, readback["links"])
        for event_id, fields, code in (
            (report, {"cause_event_ids": [event]}, "EVENT_CAUSE_CYCLE"),
            (event, {"cause_event_ids": [str(uuid4())]}, "INVALID_EVENT_CAUSE"),
            (event, {"cause_assertion_ids": [readback["changes"][0]["id"]]}, "INVALID_STATE_CAUSE"),
            (event, {"purpose_ids": [mira]}, "INVALID_EVENT_LINK"),
        ):
            response = self.post({"op": "edit_event", "event_id": event_id, "name": "Rejected edit", **fields})
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()["field_errors"][0]["code"], code)
        after = next(item for item in self.article(mira, 2)["events"] if item["id"] == event)
        self.assertEqual(after, readback)
        preview = self.browser.get(self.path + "/timeline", {"at": 2, "view_as": mira}).json()
        self.assertEqual(preview["timeline"], [])

    def test_world_calendar_and_conflicting_defaults_resolve_without_changing_other_characters(self):
        first = self.entry("Ridge folk", "species")
        second = self.entry("Valley folk", "species")
        child = self.entry("Coastal folk", "species")
        mira = self.entry("Mira", "person")
        partner = self.entry("Ivo", "person")
        self.fact(first, "height_cm", 170)
        self.fact(second, "height_cm", 180)
        self.fact(child, "inherits_from", first)
        self.fact(child, "inherits_from", second, 10)
        self.fact(mira, "species", child)
        self.fact(partner, "species", child)
        self.fact(mira, "birth_tick", 2)
        self.assertEqual(self.values(mira, 9)["height_cm"], 170)
        self.assertEqual(self.values(mira, 10)["height_cm"], "conflict")
        self.fact(mira, "height_cm", 160, 10)
        self.assertEqual(self.values(mira, 10)["height_cm"], 160)
        self.assertEqual(self.values(partner, 10)["height_cm"], "conflict")
        self.assertIsNone(self.article(mira, 7202)["age_years"])
        self.apply({"op": "set_calendar", "days_per_year": 360})
        self.assertEqual(self.article(mira, 7201)["age_years"], 19)
        self.assertEqual(self.article(mira, 7202)["age_years"], 20)
        self.assertEqual(self.values(mira, 7202)["death_tick"], "unknown")
        invalid = self.post({"op": "record_fact", "entry_id": first, "field": "inherits_from", "value": child, "from_tick": 0})
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(invalid.json()["field_errors"][0]["code"], "RELATIONSHIP_CYCLE")

    def test_qualified_changes_and_inverse_ownership_are_independent(self):
        mira = self.entry("Mira", "person")
        borrower = self.entry("Ivo", "person")
        item = self.entry("Lantern", "item")
        energy = self.entry("Energy", "resource")
        funds = self.entry("Funds", "resource")
        self.fact(energy, "unit", "points")
        self.fact(funds, "unit", "credits")
        self.fact(item, "owner", mira)
        self.fact(item, "possessor", mira)
        self.apply({"op": "record_event", "name": "Loan", "tick": 5, "changes": [
            {"entry_id": item, "field": "possessor", "value": borrower},
            {"entry_id": mira, "field": "resource_amount", "qualifier_id": funds, "value": "3.250"},
            {"entry_id": mira, "field": "resource_amount", "qualifier_id": energy, "value": "42"},
        ]})
        self.assertEqual(self.values(item, 5)["owner"], mira)
        self.assertEqual(self.values(item, 5)["possessor"], borrower)
        self.assertEqual({link["label"] for link in self.article(mira, 4)["incoming_links"]}, {"Held items", "Owned items"})
        self.assertEqual({link["label"] for link in self.article(mira, 5)["incoming_links"]}, {"Owned items"})
        self.assertEqual([link["entry_id"] for link in self.article(borrower, 5)["incoming_links"]], [item])
        resources = {value["qualifier_id"]: (value["value"], value["unit"])
                     for value in self.article(mira, 5)["values"] if value["field"] == "resource_amount"}
        self.assertEqual(resources, {funds: ("3.25", "credits"), energy: ("42", "points")})
        invalid = self.post({"op": "record_fact", "entry_id": mira, "field": "resource_amount", "qualifier_id": item,
                             "value": "1", "from_tick": 5})
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(self.article(mira, 5)["findings"], [])

    def test_beliefs_and_goal_targets_do_not_become_canon_or_leak(self):
        gate = self.entry("Gate")
        mira = self.entry("Mira", "person")
        clerk = self.entry("Clerk", "person")
        goal = self.entry("Get inside", "goal")
        self.discover(gate, mira)
        self.discover(gate, clerk)
        self.fact(gate, "status", "Open")
        self.fact(goal, "goal_owner", mira)
        claim = self.apply({"op": "record_claim", "entry_id": gate, "field": "status", "value": "Locked",
                            "speaker_id": clerk, "tick": 10})
        observed = self.apply({"op": "record_observation", "observer_id": mira, "source_kind": "claim",
                               "source_id": claim, "learned_at": 10})
        self.apply({"op": "record_proposition", "holder_id": mira, "entry_id": gate, "field": "status",
                    "value": "Locked", "from_tick": 10, "about_tick": 10, "evidence_id": observed})
        self.apply({"op": "record_proposition", "holder_id": goal, "entry_id": gate, "field": "status",
                    "value": "Open", "from_tick": 0})
        self.assertEqual(self.article(gate, 9, observer=mira)["propositions"], [])
        known = self.article(gate, 10, observer=mira)
        self.assertNotIn("values", known)
        self.assertEqual([p["value"] for p in known["propositions"]], ["Locked"])
        self.assertEqual(known["observations"][0]["id"], observed)
        self.assertEqual(self.article(gate, 10, observer=clerk)["propositions"], [])
        self.assertEqual(self.values(gate, 10)["status"], "Open")
        self.assertEqual(self.article(gate, 10)["findings"], [])
        self.assertEqual(self.article(mira)["incoming_links"][0]["entry_id"], goal)
        self.assertEqual(self.article(goal)["propositions"][0]["kind"], "desired_state")

    def test_measured_connections_and_occupants_read_at_the_requested_time(self):
        hall = self.entry("Harbor Hall")
        landing = self.entry("Landing")
        corridor = self.entry("Corridor")
        mira = self.entry("Mira", "person")
        group = self.entry("Watch", "group")
        ankle = self.entry("Ankle", "body_part")
        self.fact(landing, "located_in", hall)
        self.fact(corridor, "located_in", hall)
        self.fact(mira, "located_in", landing)
        self.fact(mira, "residence", hall)
        self.fact(mira, "destination", corridor)
        self.fact(group, "located_in", landing)
        self.assertTrue(self.article(group)["legacy_location_review"])
        self.assertEqual([entry["id"] for entry in self.article(landing)["occupants"]], [mira])
        self.assertEqual({entry["id"] for entry in self.article(hall)["parts"]}, {landing, corridor})
        for place, name in ((landing, "Upper plan"), (corridor, "Corridor plan")):
            self.apply({
                "op": "save_layout", "place_id": place, "name": name, "from_tick": 0,
                "left_cm": -100, "top_cm": 0, "width_cm": 500, "height_cm": 300,
            })
        first = self.apply({"op": "save_waypoint", "place_id": landing, "name": "Landing door",
                            "x_cm": 125, "y_cm": 150, "from_tick": 0})
        last = self.apply({"op": "save_waypoint", "place_id": corridor, "name": "Entry",
                           "x_cm": 0, "y_cm": 150, "from_tick": 3})
        route = {"op": "save_connection", "name": "Linked doors", "from_place": landing, "from_point": first,
                 "to_place": corridor, "to_point": last, "from_tick": 3, "length_cm": 250}
        self.assertEqual(self.post({**route, "from_tick": 2}).status_code, 422)
        connection = self.apply(route)
        self.assertEqual(self.article(landing, 2)["layout"]["connections"], [])
        self.assertEqual(self.article(corridor, 3)["layout"]["connections"][0]["id"], connection)
        misplaced = self.post({"op": "save_waypoint", "place_id": landing, "point_id": first, "name": "Door",
                              "x_cm": 999, "y_cm": 150, "from_tick": 4})
        self.assertEqual(misplaced.json()["field_errors"][0]["code"], "WAYPOINT_BOUNDS")
        moved = self.apply({"op": "save_waypoint", "place_id": landing, "point_id": first, "name": "Door",
                            "x_cm": 250, "y_cm": 150, "from_tick": 4})
        self.assertEqual(moved, first)
        self.assertEqual(self.article(landing, 3)["layout"]["frame"]["points"][0]["x_cm"], 125)
        self.assertEqual(self.article(landing, 4)["layout"]["frame"]["points"][0]["x_cm"], 250)
        event = self.apply({"op": "record_event", "name": "Move and stumble", "tick": 10, "changes": [
            {"entry_id": mira, "field": "located_in", "value": corridor},
            {"entry_id": mira, "field": "condition", "qualifier_id": ankle, "value": "Sprained"},
        ]})
        self.assertEqual(self.values(mira, 9)["located_in"], landing)
        self.assertEqual(self.values(mira, 10)["condition"], "Sprained")
        changes = self.article(mira, 10)["events"][0]["changes"]
        self.assertEqual({c["field"]: c["previous_value"] for c in changes}, {"located_in": landing, "condition": None})
        self.apply({"op": "correct_event_date", "event_id": event, "tick": 11})
        self.assertEqual(self.article(corridor, 10)["occupants"], [])
        self.assertEqual(self.values(mira, 11)["condition"], "Sprained")
        cycle = self.post({"op": "record_fact", "entry_id": hall, "field": "located_in", "value": landing, "from_tick": 4})
        self.assertEqual(cycle.json()["field_errors"][0]["code"], "RELATIONSHIP_CYCLE")
        self.discover(landing, mira)
        self.assertNotIn("layout", self.article(landing, 10, observer=mira))

    def test_nested_events_keep_independent_order_dates_and_effects(self):
        mira = self.entry("Mira", "person")
        milk = self.entry("Milk", "item")
        self.fact(milk, "status", "On shelf")
        trip = self.apply({"op": "record_event_group", "name": "Grocery trip", "start_tick": 0, "end_tick": 30})
        arrival = self.apply({"op": "record_event_group", "parent_id": trip, "name": "Arrival"})
        dairy = self.apply({"op": "record_event_group", "parent_id": trip, "name": "Dairy"})
        help_group = self.apply({"op": "record_event_group", "parent_id": dairy, "name": "Ask for help"})
        before = self.apply({"op": "record_event", "parent_id": help_group, "node_kind": "action",
                             "name": "Clerk points", "tick": 12, "participant_ids": [mira]})
        cart = self.apply({"op": "record_event", "parent_id": dairy, "node_kind": "action", "name": "Milk in cart",
                           "tick": 12, "changes": [{"entry_id": milk, "field": "status", "value": "In cart"}]})
        self.apply({"op": "edit_event", "event_id": arrival, "name": "Arrival", "cross_reference_ids": [cart]})
        self.apply({"op": "organize_event", "event_id": cart, "parent_id": help_group, "position": 0})
        cycle = self.post({"op": "organize_event", "event_id": trip, "parent_id": help_group})
        self.assertEqual(cycle.json()["field_errors"][0]["code"], "EVENT_CYCLE")
        out_of_range = self.post({"op": "correct_event_date", "event_id": cart, "tick": 32})
        self.assertEqual(out_of_range.json()["field_errors"][0]["code"], "EVENT_OUTSIDE_PARENT")
        timeline = self.browser.get(self.path + "/timeline", {"at": 12}).json()["timeline"]
        records = {event["id"]: event for event in timeline}
        self.assertEqual(records[cart]["parent_id"], help_group)
        self.assertEqual(records[cart]["sort_order"], 0)
        self.assertEqual(records[before]["sort_order"], 1)
        self.assertEqual(records[arrival]["cross_reference_ids"], [cart])
        self.assertEqual(records[dairy]["display_start"], 12)
        self.assertEqual(records[cart]["changes"][0]["previous_value"], "On shelf")
        self.assertEqual({event["id"] for event in timeline if event["tick"] == 12}, {cart, before})
        self.assertEqual(self.values(milk, 11)["status"], "On shelf")
        self.assertEqual(self.values(milk, 12)["status"], "In cart")
        restricted = self.browser.get(self.path + "/timeline", {"at": 12, "view_as": mira}).json()
        self.assertEqual(restricted["timeline"], [])

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
        self.discover(gate, mira)
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

    def test_approximate_and_unknown_events_do_not_create_dated_effects(self):
        actor = self.entry("Records clerk", "person")
        command = {
            "op": "record_event", "name": "Archive transfer", "tick": None, "date_precision": "bounded",
            "start_tick": 8, "end_tick": 14, "participant_ids": [actor],
        }
        forbidden = self.post({**command, "changes": [{"entry_id": actor, "field": "status", "value": "Away"}]})
        self.assertEqual(forbidden.json()["field_errors"][0]["code"], "EFFECT_TIME_REQUIRED")
        approximate = self.apply(command)
        undated = self.apply({
            "op": "record_event", "name": "Uncatalogued delivery", "tick": None, "date_precision": "unknown",
            "participant_ids": [actor],
        })
        exact = self.apply({
            "op": "record_event", "name": "Archive audit", "tick": 20, "start_tick": 18, "end_tick": 22,
            "participant_ids": [actor],
        })
        events = {event["id"]: event for event in self.article(actor)["events"]}
        self.assertEqual((events[approximate]["date_precision"], events[approximate]["tick"]), ("bounded", None))
        self.assertEqual((events[approximate]["display_start"], events[approximate]["display_end"]), (8, 14))
        self.assertEqual((events[undated]["date_precision"], events[undated]["display_start"]), ("unknown", None))
        self.assertEqual((events[exact]["date_precision"], events[exact]["display_end"]), ("exact", 22))
        self.assertEqual(self.post({"op": "correct_event_date", "event_id": approximate, "tick": 10}).status_code, 422)
        self.apply({
            "op": "edit_event", "event_id": approximate, "name": command["name"],
            "date_precision": "exact", "tick": 10, "start_tick": None, "end_tick": None,
        })
        result = WikiEvent.objects.get(pk=approximate)
        self.assertEqual((result.date_precision, result.tick, result.start_tick), ("exact", 10, None))

    def test_structured_sources_preserve_opposing_accounts_and_observation_scope(self):
        place = self.entry("Ferry terminal")
        observer = self.entry("Archivist", "person")
        source = self.entry("Ferry ledger", "source")
        self.fact(source, "source_medium", "Document")
        self.fact(source, "source_locator", "Box 4, folio 11")
        fact_id = self.fact(place, "status", "Open", source="Original margin note", citation_id=source)
        command = {"op": "record_claim", "entry_id": place, "field": "status", "value": "Closed", "tick": 3}
        self.assertEqual(self.post(command).json()["field_errors"][0]["code"], "CLAIM_ATTRIBUTION_REQUIRED")
        self.assertEqual(self.post({**command, "citation_id": place}).status_code, 422)
        claim_id = self.apply({**command, "citation_id": source})
        self.apply({
            "op": "record_observation", "source_kind": "claim", "source_id": claim_id,
            "observer_id": observer, "learned_at": 8,
        })
        event_id = self.apply({
            "op": "record_event", "name": "Ledger read", "tick": 8, "place_ids": [place], "citation_id": source,
        })
        self.apply({"op": "correct_fact", "assertion_id": fact_id, "value": "Open at low water"})
        article = self.article(place, 8)
        self.assertEqual(article["assertions"][0]["citation_id"], source)
        self.assertEqual(article["assertions"][0]["source"], "Original margin note")
        self.assertEqual(article["claims"][0]["citation_id"], source)
        self.assertIsNone(article["claims"][0]["speaker_id"])
        self.assertEqual(article["events"][0]["id"], event_id)
        self.assertEqual(article["events"][0]["citation_id"], source)
        observed = self.article(place, 8, observer)["observations"][0]
        self.assertEqual(observed["value"], "Closed")
        self.assertNotIn("source_id", observed)
        self.assertEqual(self.browser.get(self.path + "/entries/" + source, {"at": 8, "view_as": observer}).status_code, 404)

    def test_physical_and_cognitive_inputs_have_independent_scales_and_dates(self):
        actor = self.entry("Surveyor", "person")
        trait = self.entry("Work rate scale", "trait")
        skill = self.entry("Contour reading", "skill")
        part = self.entry("Left hand", "body_part")
        process = self.entry("Pattern recognition", "process")
        goal = self.entry("Survey the inlet", "goal")
        milestone = self.entry("First contour", "milestone")
        self.fact(trait, "unit", "observations/min", until_tick=10)
        self.fact(trait, "unit", "observations/hour", 10)
        first_speed = self.fact(actor, "processing_speed", "5.25", qualifier_id=trait)
        self.fact(actor, "mental_process", process)
        self.fact(actor, "skill", skill)
        self.fact(actor, "success_probability", "0.6", qualifier_id=skill)
        self.fact(actor, "part_damage_pct", "32.5", qualifier_id=part)
        self.fact(actor, "part_function_pct", "70", qualifier_id=part)
        self.fact(actor, "mood", "Focused")
        self.fact(actor, "reported_mood", "Hopeful")
        self.fact(milestone, "milestone_goal", goal)
        self.fact(milestone, "milestone_order", 1)
        invalid = {
            "op": "record_fact", "entry_id": actor, "field": "success_probability", "value": "1.01",
            "from_tick": 10, "qualifier_id": skill,
        }
        self.assertEqual(self.post(invalid).json()["field_errors"][0]["code"], "INVALID_VALUE")
        self.assertEqual(self.post({**invalid, "qualifier_id": part, "value": "0.2"}).status_code, 422)
        for time in (1, 10):
            values = {item["field"]: item for item in self.article(actor, time)["values"]}
            self.assertEqual((values["processing_speed"]["value"], values["processing_speed"]["unit"]),
                             ("5.25", "observations/min"))
            self.assertEqual(values["success_probability"]["qualifier_id"], skill)
            self.assertEqual(values["part_damage_pct"]["qualifier_id"], part)
            self.assertEqual(values["part_function_pct"]["value"], "70")
            self.assertEqual((values["mood"]["value"], values["reported_mood"]["value"]), ("Focused", "Hopeful"))
        self.assertEqual(self.article(goal)["incoming_links"][0]["entry_id"], milestone)
        learner = self.entry("Field observer", "person")
        observation = self.apply({
            "op": "record_observation", "observer_id": learner, "source_kind": "assertion",
            "source_id": first_speed, "learned_at": 2, "about_tick": 1,
        })
        event = self.apply({
            "op": "record_event", "name": "New reporting standard", "tick": 11,
            "changes": [{"entry_id": actor, "field": "processing_speed", "value": "315", "qualifier_id": trait}],
        })
        article = self.article(actor, 11)
        current = next(item for item in article["values"] if item["field"] == "processing_speed")
        self.assertEqual((current["value"], current["unit"]), ("315", "observations/hour"))
        change = next(item["changes"][0] for item in article["events"] if item["id"] == event)
        self.assertEqual((change["previous_unit"], change["unit"]), ("observations/min", "observations/hour"))
        self.assertEqual(self.article(actor, 11, learner)["observations"][0]["unit"], "observations/min")
        belief = self.apply({
            "op": "record_proposition", "holder_id": learner, "entry_id": actor, "field": "processing_speed",
            "qualifier_id": trait, "value": "5.25", "from_tick": 11, "evidence_id": observation,
        })
        beliefs = self.article(learner, 11, learner)["propositions"]
        self.assertEqual([(item["id"], item["unit"]) for item in beliefs], [(belief, "observations/min")])
        self.apply({"op": "correct_fact", "assertion_id": first_speed, "value": "5"})
        prior = next(item for item in self.article(actor, 9)["assertions"] if item["id"] == first_speed)
        self.assertEqual((prior["value"], prior["unit"]), ("5", "observations/min"))

    def test_declarations_and_goal_order_are_dated_and_independent_of_assignments(self):
        person = self.entry("Survey technician", "person")
        role = self.entry("Survey coordinator", "role")
        status = self.entry("Certified observer", "status_def")
        funds = self.entry("Expense payment", "resource")
        skill = self.entry("Verify a route", "skill")
        harbor = self.entry("Harbor")
        requirement = self.entry("Complete practical training", "requirement")
        goal = self.entry("Finish the survey", "goal")
        alpha = self.entry("Archive the results", "milestone")
        zeta = self.entry("Verify boundary points", "milestone")
        self.fact(person, "job", role)
        self.fact(person, "assigned_status", status, 2)
        self.fact(role, "role_duty", "Review recorded measurements", 2)
        self.fact(role, "declared_authority", "Approve survey routes", 2)
        self.fact(role, "authority_scope", harbor, 2)
        self.fact(role, "declared_capability", skill, 2)
        self.fact(status, "acquire_requirement", requirement, 2)
        self.fact(funds, "unit", "credits")
        self.fact(role, "declared_reward", "12.50", 2, qualifier_id=funds)
        self.assertNotIn("role_duty", self.values(person, 2))
        self.assertNotIn("assigned_status", self.values(person, 1))
        self.assertEqual(self.values(person, 2)["assigned_status"], status)
        self.assertEqual(self.values(role, 2)["authority_scope"], harbor)
        self.assertEqual(self.values(status, 2)["acquire_requirement"], requirement)
        reward = next(value for value in self.article(role, 2)["values"] if value["field"] == "declared_reward")
        self.assertEqual((reward["value"], reward["unit"]), ("12.5", "credits"))
        self.fact(alpha, "milestone_goal", goal)
        self.fact(zeta, "milestone_goal", goal)
        self.fact(alpha, "milestone_order", 2, until_tick=10)
        self.fact(alpha, "milestone_order", 0, 10)
        self.fact(zeta, "milestone_order", 1)
        self.fact(goal, "plan_requirement", requirement)
        before = self.article(goal, 9)["incoming_links"]
        after = self.article(goal, 10)["incoming_links"]
        self.assertEqual([(link["entry_id"], link["order"]) for link in before], [(zeta, 1), (alpha, 2)])
        self.assertEqual([(link["entry_id"], link["order"]) for link in after], [(alpha, 0), (zeta, 1)])

    def test_reported_lifespan_conflict_keeps_both_records_and_resolves_after_correction(self):
        for kind, start_field, end_field in (
            ("person", "birth_tick", "death_tick"),
            ("place", "creation_tick", "destruction_tick"),
            ("species", "creation_tick", "extinction_tick"),
        ):
            with self.subTest(kind=kind):
                subject = self.entry("Subject " + kind, kind)
                old_end = self.fact(subject, end_field, 1, until_tick=5)
                start = self.fact(subject, start_field, 8, 5)
                self.assertFalse(self.article(subject, 5)["findings"])
                ending = self.fact(subject, end_field, 7, 5, until_tick=10)
                findings = self.article(subject, 5)["findings"]
                self.assertEqual(len(findings), 1)
                self.assertEqual(
                    (findings[0]["code"], findings[0]["record_ids"], findings[0]["from_tick"], findings[0]["until_tick"]),
                    ("LIFESPAN_CONFLICT", [start, ending], 5, 10),
                )
                self.assertNotIn(old_end, findings[0]["record_ids"])
                self.apply({"op": "correct_fact", "assertion_id": start, "value": 7})
                self.assertFalse(self.article(subject, 5)["findings"])
                self.assertTrue(WikiFinding.objects.filter(pk=findings[0]["id"], resolved_at_edit=self.edit).exists())

        observer = self.entry("Historical witness", "person")
        character = self.entry("Historical subject", "person")
        self.discover(character, observer, 0)
        self.fact(character, "birth_tick", 9, author_only=True)
        self.fact(character, "death_tick", 4)
        self.assertEqual(self.article(character)["findings"][0]["code"], "LIFESPAN_CONFLICT")
        self.assertNotIn("findings", self.article(character, 0, observer))

    def test_in_world_variants_have_independent_identity_events_and_scoped_reads(self):
        original = self.entry("Lina", "person", overview="Coastal archivist")
        variant = self.entry("Lina of the northern coast", "person", variant_of_id=original)
        other = self.entry("Uncatalogued creature", "organism", author_only=True)
        self.fact(variant, "birth_tick", 2)
        event = self.apply({
            "op": "record_event", "name": "Catalog review", "tick": 10, "performer_ids": [variant],
        })
        self.assertEqual(str(WikiEntry.objects.get(pk=variant).variant_of_id), original)
        self.assertEqual(self.article(original)["variant_ids"], [variant])
        self.assertEqual(self.article(variant)["variant_of_id"], original)
        self.assertFalse(self.article(original, 10)["events"])
        self.assertEqual([item["id"] for item in self.article(variant, 10)["events"]], [event])
        self.assertEqual(self.values(original, 10)["birth_tick"], "unknown")
        self.assertEqual(self.values(variant, 10)["birth_tick"], 2)

        observer = self.entry("Witness", "person")
        self.discover(variant, observer)
        self.assertNotIn("variant_of_id", self.article(variant, 10, observer))
        self.discover(original, observer)
        self.assertNotIn("variant_ids", self.article(original, 10, observer))

        place = self.entry("Harbor")
        _, foreign = create_world(self.owner.pk, uuid4(), "Separate Wiki")
        foreign_wiki = WikiWorld.objects.create(world_id=foreign["world"]["id"])
        foreign_actor = WikiEntry.objects.create(wiki=foreign_wiki, name="Remote actor", kind="person")
        for target, expected_error in (
            (variant, "RELATIONSHIP_CYCLE"), (place, "INVALID_VARIANT"), (str(foreign_actor.pk), "INVALID_ENTRY"),
        ):
            invalid = self.post({"op": "set_variant_origin", "entry_id": variant, "variant_of_id": target})
            self.assertEqual(invalid.status_code, 422)
            self.assertEqual(invalid.json()["field_errors"][0]["code"], expected_error)
        invalid = self.post({"op": "set_variant_origin", "entry_id": original, "variant_of_id": variant})
        self.assertEqual(invalid.json()["field_errors"][0]["code"], "RELATIONSHIP_CYCLE")
        invalid = self.post({"op": "create_entry", "name": "Invalid variant", "kind": "place", "variant_of_id": original})
        self.assertEqual(invalid.status_code, 422)

        self.apply({"op": "set_variant_origin", "entry_id": variant, "variant_of_id": other})
        self.assertFalse(self.article(original)["variant_ids"])
        self.assertEqual(self.article(other)["variant_ids"], [variant])
        self.apply({"op": "set_variant_origin", "entry_id": variant, "variant_of_id": None})
        self.assertIsNone(self.article(variant, 10)["variant_of_id"])
        self.assertEqual([item["id"] for item in self.article(variant, 10)["events"]], [event])

    def test_shared_plan_positions_preserve_both_values_across_rename(self):
        goal = self.entry("Open archive", "goal")
        milestones = [self.entry(name, "milestone") for name in ("Record contents", "List supplies")]
        for entry in milestones:
            self.fact(entry, "milestone_goal", goal)
            self.fact(entry, "milestone_order", 1)
        before = self.article(goal)["incoming_links"]
        self.assertEqual([(link["order"], link["order_shared"]) for link in before], [(1, True), (1, True)])
        self.apply({"op": "rename_entry", "entry_id": milestones[0], "name": "A record of contents"})
        self.assertEqual(self.article(goal)["incoming_links"], before)
        self.event("Reorder plan", 10, (milestones[0], "milestone_order", 2))
        after = self.article(goal, 10)["incoming_links"]
        self.assertEqual([(link["entry_id"], link["order"]) for link in after], [(milestones[1], 1), (milestones[0], 2)])
        self.assertFalse(any(link.get("order_shared") for link in after))

    def test_terminal_requirements_reuse_methods_and_reopen_explicit_fulfillment(self):
        goal = self.entry("Publish a history", "goal")
        first_requirement = self.entry("Verify the account", "requirement")
        second_requirement = self.entry("Confirm the archive", "requirement")
        method = self.entry("Check the source records", "method")
        source = self.entry("Catalog register", "source")
        self.fact(goal, "plan_requirement", first_requirement)
        self.fact(goal, "plan_requirement", second_requirement)
        self.fact(goal, "requirement_mode", "All listed")
        self.fact(method, "method_requirement", first_requirement)
        self.fact(second_requirement, "alternative_method", method, 2, citation_id=source)
        self.assertEqual(self.values(goal, 0)["requirement_mode"], "All listed")
        self.assertNotIn("alternative_method", self.values(second_requirement, 1))
        self.assertEqual(self.values(second_requirement, 2)["alternative_method"], method)
        self.assertEqual(self.values(method, 2)["method_requirement"], first_requirement)

        final_step = self.entry("Archive the note", "method_step")
        first_step = self.entry("Verify the date", "method_step")
        self.fact(final_step, "step_method", method, 2)
        self.fact(first_step, "step_method", method, 3)
        self.fact(final_step, "step_order", 2, 2)
        position = self.fact(first_step, "step_order", 1, 3, citation_id=source)
        steps = [link for link in self.article(method, 3)["incoming_links"] if link["field"] == "step_method"]
        self.assertEqual([(link["entry_id"], link["order"]) for link in steps], [(first_step, 1), (final_step, 2)])
        self.assertEqual(
            next(item["citation_id"] for item in self.article(first_step, 3)["assertions"] if item["id"] == position),
            source,
        )

        event = self.apply({
            "op": "record_event", "name": "Logbook corroborated", "tick": 8,
            "fulfillment_ids": [first_requirement, first_step], "citation_id": source,
        })
        linked = self.article(first_step, 8)["events"][0]
        self.assertEqual(linked["id"], event)
        self.assertEqual({link["entry_id"] for link in linked["links"] if link["role"] == "fulfillment"},
                         {first_requirement, first_step})
        self.assertFalse(linked["changes"])
        self.assertEqual(self.article(first_requirement, 8)["events"][0]["id"], event)
        self.assertFalse(self.article(second_requirement, 8)["events"])
        self.assertEqual(self.values(goal, 8)["requirement_mode"], "All listed")
        wrong_target = self.post({
            "op": "record_event", "name": "Invalid target", "tick": 8, "fulfillment_ids": [goal],
        })
        self.assertEqual(wrong_target.status_code, 422)

    def test_causal_accounts_keep_ordered_beliefs_independent_of_canon_and_knowledge_scope(self):
        investigator = self.entry("Investigator", "person")
        witness = self.entry("Witness", "person")
        signal = self.entry("Harbor signal", "item")
        log = self.entry("Dispatch register", "source")
        self.fact(signal, "status", "Operational")
        self.discover(investigator, witness)
        self.discover(signal, investigator)
        self.discover(log, investigator, at=5)

        def belief(value, *, holder=investigator, start=2, private=False):
            return self.apply({
                "op": "record_proposition", "holder_id": holder, "entry_id": signal,
                "field": "status", "value": value, "from_tick": start, "author_only": private,
            })

        cause, intermediary, outcome = [belief(value) for value in ("Unpowered", "Signal dimmed", "Signal missed")]
        terms = [{"phase": phase, "belief_id": statement} for phase, statement in (
            ("cause", cause), ("intermediary", intermediary), ("outcome", outcome),
        )]
        command = {
            "op": "record_causal_account", "holder_id": investigator, "title": "Loss of illumination",
            "from_tick": 4, "until_tick": 8, "citation_id": log, "terms": terms,
        }
        account = self.apply(command)
        self.assertFalse(self.article(investigator, 3)["causal_accounts"])
        read = self.article(investigator, 4)["causal_accounts"][0]
        self.assertEqual((read["id"], read["citation_id"]), (account, log))
        self.assertEqual([term["belief"]["id"] for term in read["terms"]], [cause, intermediary, outcome])
        self.assertEqual(self.values(signal, 5)["status"], "Operational")
        self.assertFalse(self.article(investigator, 4, investigator)["causal_accounts"])
        self.assertEqual(self.article(investigator, 5, investigator)["causal_accounts"][0]["id"], account)
        self.assertFalse(self.article(investigator, 5, witness)["causal_accounts"])
        self.assertFalse(self.article(investigator, 8, investigator)["causal_accounts"])

        wrong_holder = belief("No reason given", holder=witness)
        future_belief = belief("Replacement planned", start=9)
        for invalid in (wrong_holder, future_belief, str(uuid4())):
            error = self.post({**command, "terms": [{"phase": "cause", "belief_id": invalid}]})
            self.assertEqual(error.status_code, 422)
            self.assertEqual(error.json()["field_errors"][0]["code"], "INVALID_CAUSAL_TERM")

        restricted = belief("Unlisted mechanism", private=True)
        private_account = self.apply({**command, "title": "Restricted account",
                                     "terms": [{"phase": "cause", "belief_id": restricted}]})
        self.assertEqual({record["id"] for record in self.article(investigator, 5)["causal_accounts"]},
                         {account, private_account})
        self.assertEqual([record["id"] for record in self.article(investigator, 5, investigator)["causal_accounts"]],
                         [account])
        self.assertEqual(self.apply({**command, "op": "correct_causal_account", "account_id": account,
                                     "title": "Corrected illumination account", "terms": terms[:2]}), account)
        corrected = self.article(investigator, 5, investigator)["causal_accounts"][0]
        self.assertEqual(corrected["title"], "Corrected illumination account")
        self.assertEqual([term["belief"]["id"] for term in corrected["terms"]], [cause, intermediary])

    def test_contextual_measurements_and_relationship_declarations_keep_dated_references(self):
        actor = self.entry("Inspector", "person")
        capability = self.entry("Safety inspection", "skill")
        site = self.entry("Ferry terminal")
        source = self.entry("Inspection ledger", "source")
        scale = self.entry("Inspections per hour", "trait")
        self.fact(scale, "unit", "inspections/hour")
        contexts = []
        for name, probability in (("Clear visibility", "0.9"), ("Low visibility", "0.4")):
            context = self.entry(name, "context")
            contexts.append(context)
            self.fact(context, "context_actor", actor, 2)
            self.fact(context, "context_capability", capability, 2)
            self.fact(context, "context_circumstance", site, 2)
            self.fact(context, "context_probability", probability, 2)
            self.fact(context, "processing_speed", "2.5", 2, qualifier_id=scale, citation_id=source)
            self.assertEqual(self.values(context, 2)["context_probability"], probability)
            record = next(fact for fact in self.article(context, 2)["assertions"] if fact["field"] == "processing_speed")
            self.assertEqual((record["unit"], record["citation_id"]), ("inspections/hour", source))
        self.assertFalse(self.article(actor, 1)["incoming_links"])
        self.assertEqual({link["entry_id"] for link in self.article(actor, 2)["incoming_links"]}, set(contexts))
        invalid = self.post({
            "op": "record_fact", "entry_id": contexts[0], "field": "context_capability", "value": site, "from_tick": 2,
        })
        self.assertEqual(invalid.status_code, 422)
        _, foreign = create_world(self.owner.pk, uuid4(), "Separate Wiki")
        foreign_wiki = WikiWorld.objects.create(world_id=foreign["world"]["id"])
        foreign_skill = WikiEntry.objects.create(wiki=foreign_wiki, kind="skill", name="Foreign skill")
        invalid = self.post({
            "op": "record_fact", "entry_id": contexts[0], "field": "context_capability",
            "value": str(foreign_skill.pk), "from_tick": 2,
        })
        self.assertEqual(invalid.status_code, 422)

        organization = self.entry("Ferry operator", "group")
        definition = self.entry("Inspection agreement", "relation_def")
        wanted = self.entry("Provide certification", "requirement")
        credits = self.entry("Credits", "resource")
        self.fact(credits, "unit", "credits")
        relationship = self.entry("Terminal inspection", "relation")
        self.fact(relationship, "relationship_type", definition)
        self.fact(relationship, "first_party", actor)
        self.fact(relationship, "second_party", organization)
        self.fact(relationship, "first_party_role", "Inspector")
        self.fact(relationship, "acquire_requirement", wanted)
        self.fact(relationship, "declared_cost", "15", 4, qualifier_id=credits)
        self.fact(relationship, "declared_capability", capability, 4)
        for subject, field in ((actor, "first_party"), (organization, "second_party"), (definition, "relationship_type")):
            self.assertIn(relationship, {link["entry_id"] for link in self.article(subject, 4)["incoming_links"]
                                         if link["field"] == field})
        self.assertNotIn("declared_cost", self.values(relationship, 3))
        self.assertEqual(self.values(relationship, 4)["acquire_requirement"], wanted)
        cost = next(v for v in self.article(relationship, 4)["values"] if v["field"] == "declared_cost")
        self.assertEqual((cost["value"], cost["unit"]), ("15", "credits"))
        invalid = self.post({
            "op": "record_fact", "entry_id": relationship, "field": "relationship_type", "value": site, "from_tick": 4,
        })
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(self.values(relationship, 4)["relationship_type"], definition)

    def test_anatomy_and_weight_keep_separate_definitions_state_and_units(self):
        actor = self.entry("Surveyor", "person")
        organism = self.entry("Mangrove climber", "organism")
        limb = self.entry("Forelimb", "body_part")
        hand = self.entry("Grasping fingers", "body_part")
        grasping = self.entry("Grasping", "body_fn")
        self.fact(hand, "part_parent", limb, 2)
        self.fact(hand, "body_function", grasping, 2)
        for subject in (actor, organism):
            self.fact(subject, "anatomy", hand, 2)
            self.fact(subject, "body_function", grasping, 2)
        self.fact(organism, "part_function_pct", "72.5", 4, qualifier_id=hand)
        self.assertEqual(self.values(organism, 4)["part_function_pct"], "72.5")
        self.assertNotIn("part_function_pct", self.values(organism, 2))
        self.assertEqual(self.values(hand, 4)["part_parent"], limb)
        self.assertFalse(self.article(limb, 1)["incoming_links"])
        self.assertEqual(self.article(limb, 2)["incoming_links"][0]["entry_id"], hand)
        self.assertEqual({link["entry_id"] for link in self.article(grasping, 2)["incoming_links"]},
                         {actor, hand, organism})
        cycle = self.post({"op": "record_fact", "entry_id": limb, "field": "part_parent", "value": hand, "from_tick": 2})
        self.assertEqual(cycle.json()["field_errors"][0]["code"], "RELATIONSHIP_CYCLE")
        self.assertEqual(self.post({
            "op": "record_fact", "entry_id": hand, "field": "body_function", "value": organism, "from_tick": 2,
        }).status_code, 422)

        scale = self.entry("Force gauge", "trait")
        register = self.entry("Scale readings", "source")
        self.fact(scale, "unit", "newtons")
        self.fact(actor, "mass_kg", "70.5")
        first = self.fact(actor, "weight_measure", "691", 2, until_tick=6, qualifier_id=scale, citation_id=register)
        self.event("Change gauge units", 6, (scale, "unit", "pounds-force"))
        self.fact(actor, "weight_measure", "155", 6, qualifier_id=scale)
        latest = self.article(actor, 6)
        historical = next(item for item in latest["assertions"] if item["id"] == first)
        self.assertEqual((historical["value"], historical["unit"], historical["citation_id"]), ("691", "newtons", register))
        self.assertEqual(self.values(actor, 6)["mass_kg"], "70.5")
        self.assertEqual(next(item for item in latest["values"] if item["field"] == "weight_measure")["unit"], "pounds-force")

    def test_item_use_and_resource_movements_are_dated_and_preserve_balances(self):
        owner = self.entry("Survey company", "group")
        borrower = self.entry("Surveyor", "person")
        harness = self.entry("Survey harness", "item")
        self.fact(harness, "owner", owner)
        self.fact(harness, "possessor", owner)
        self.event("Loan the harness", 5, (harness, "possessor", borrower), (harness, "equipped_by", borrower))
        self.fact(harness, "worn_by", borrower, 5)
        self.fact(harness, "carried_by", borrower, 5)
        self.assertEqual(self.values(harness, 4)["possessor"], owner)
        self.assertEqual(self.values(harness, 5)["owner"], owner)
        self.assertEqual({link["field"] for link in self.article(borrower, 5)["incoming_links"]},
                         {"possessor", "equipped_by", "worn_by", "carried_by"})
        water = self.entry("Potable water", "resource")
        credits = self.entry("Survey credits", "resource")
        source = self.entry("Supply docket", "source")
        self.fact(water, "unit", "liters")
        self.fact(credits, "unit", "credits")
        self.fact(owner, "resource_amount", "18", qualifier_id=water)
        self.fact(borrower, "resource_amount", "40", qualifier_id=credits)
        for resource, unit, start in ((water, "liters", 6), (credits, "credits", 7)):
            movement = self.entry("Delivery at " + str(start), "resource_mv")
            self.fact(movement, "movement_sender", owner, start)
            self.fact(movement, "movement_recipient", borrower, start)
            amount_id = self.fact(movement, "movement_amount", "2.5", start, qualifier_id=resource, citation_id=source)
            self.assertFalse(any(link["entry_id"] == movement for link in self.article(owner, start - 1)["incoming_links"]))
            for holder in (owner, borrower):
                self.assertTrue(any(link["entry_id"] == movement for link in self.article(holder, start)["incoming_links"]))
            amount = next(item for item in self.article(movement, start)["assertions"] if item["id"] == amount_id)
            self.assertEqual((amount["value"], amount["unit"], amount["citation_id"]), ("2.5", unit, source))
        self.assertEqual(self.values(owner, 7)["resource_amount"], "18")
        self.assertEqual(self.values(borrower, 7)["resource_amount"], "40")

    def test_uncertain_claim_and_correction_preserve_learned_evidence(self):
        harbor = self.entry("Harbor")
        observer = self.entry("Records clerk", "person")
        source = self.entry("Found register", "source")
        self.fact(harbor, "status", "Open")
        command = {
            "op": "record_claim", "entry_id": harbor, "field": "status", "value": "Closed for repairs",
            "citation_id": source, "tick": None, "date_precision": "bounded", "start_tick": 3, "end_tick": 6,
        }
        claim = self.apply(command)
        learn = {
            "op": "record_observation", "observer_id": observer, "source_kind": "claim",
            "source_id": claim, "learned_at": 2,
        }
        self.assertEqual(self.post(learn).json()["field_errors"][0]["code"], "INVALID_LEARNING_TIME")
        evidence = self.apply({**learn, "learned_at": 8})
        self.assertIsNone(self.article(harbor, 8, observer)["observations"][0]["about_tick"])
        self.assertEqual(self.article(harbor, 8)["claims"][0]["start_tick"], 3)
        self.apply({
            "op": "correct_claim", "claim_id": claim, "value": "Closed for inspection",
            "date_precision": "unknown", "tick": None, "start_tick": None, "end_tick": None,
        })
        article = self.article(harbor, 8)
        self.assertEqual([(item["id"], item["value"], item["date_precision"]) for item in article["claims"]],
                         [(claim, "Closed for inspection", "unknown")])
        self.assertEqual(article["findings"][0]["record_ids"], [claim, evidence])
        self.assertEqual(self.values(harbor, 8)["status"], "Open")
        self.assertEqual(self.article(harbor, 8, observer)["observations"][0]["value"], "Closed for repairs")

    def test_private_units_do_not_leak_via_shareable_measurements(self):
        speaker = self.entry("Survey technician", "person")
        observer = self.entry("Assistant", "person")
        scale = self.entry("Survey benchmarks", "trait")
        private_unit = self.fact(scale, "unit", "Restricted benchmark", author_only=True)
        measurement = self.fact(speaker, "processing_speed", "12", qualifier_id=scale)
        self.apply({
            "op": "record_observation", "observer_id": observer, "source_kind": "assertion",
            "source_id": measurement, "learned_at": 3,
        })
        self.assertEqual(self.article(speaker, 3)["observations"][0]["unit"], "Restricted benchmark")
        projected = self.article(speaker, 3, observer)["observations"][0]
        self.assertEqual(projected["value"], "12")
        self.assertIsNone(projected["unit"])
        self.apply({
            "op": "correct_fact", "assertion_id": private_unit, "value": "Restricted benchmark", "author_only": False,
        })
        self.assertEqual(self.article(speaker, 3, observer)["observations"][0]["unit"], "Restricted benchmark")
