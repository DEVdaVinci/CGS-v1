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
        self.assertNotIn("catalog_type", self.article(transport, 0, observer=actor)["entry"])

        unauthorized, _ = self.sign_in(provision("workspace-outsider"))
        self.assertEqual(unauthorized.get(path, {"q": "survey"}).status_code, 404)
        outsider = provision("workspace-reader")
        reader, _ = self.sign_in(outsider)
        WorldAccess.objects.create(world_id=self.world, account=outsider, role="editor", capabilities=[], enabled=True)
        self.assertEqual(reader.get(path, {"q": "survey"}).status_code, 403)
        wrong_kind = self.post({"op": "create_entry", "kind": "place", "name": "Invalid vehicle", "catalog_type": "vehicle"})
        self.assertEqual(wrong_kind.status_code, 400, wrong_kind.json())

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
