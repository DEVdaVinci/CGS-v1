# Start CGS in local Codex

For the current delivery sequence, start with the [milestone quick reference](../CGS_Milestones_Quick_Reference.md) or the [detailed delivery plan](../CGS_Milestones_Delivery_Plan.md). For the world model, see the [Phase 1 Wiki design](../CGS_Phase_1_Wiki_Design.md) and the Phase 1 pages in the [editable architecture](CGS_First_Playable_Architecture.drawio). Use the [current sprint checkpoint instructions](../../AGENTS.md) for Git delivery. The earlier first-playable handoff follows.

Open your local clone of `DEVdaVinci/CGS-v1` in the Codex desktop app. Select **This computer** if asked where to work. Extract this archive into the clone's `docs` folder. From the repository root, the first file should be `docs/START_HERE.md`. You can also add the original ChatGPT conversation as background if the app offers it.

## Approved implementation references

- `docs/CGS_First_Playable_Technical_Design.md` describes the first playable release and the build sequence.
- `docs/contracts/Behavior_and_Acceptance.md` defines rules and test cases. Start with the private-world creation and session portion of T01.1 and T01.2.
- `docs/contracts/openapi.json`, `docs/contracts/domain.schema.json`, and `docs/contracts/Persistence.md` define the exact API, record shapes, and PostgreSQL design. The same folder has the contract guide and dungeon fixture for later steps.
- `docs/CGS_First_Playable_Architecture.drawio` contains the editable architecture views.

The detailed design and contracts govern implementation choices. The first playable release combines world authoring, shared rules and tabletop play. AI-assisted drafting is part of that release and follows the world and access foundation. Author permissions, explicit review and immutable source revisions carry forward into gameplay.

## Read-only context check

Paste this into Codex while the repository folder is open.

> Read `docs/START_HERE.md`, the technical design's build sequence, and the contract sections for T01.1, T01.2, world creation, and sessions. Give me a read-only setup check in six bullets or fewer. List the files you actually opened, identify the relevant API route, and explain the records saved together, what happens on an identical retry, what another account should see, and the scope of the first change. Flag any missing file or conflict and stop for my review.

A correct answer should identify the first slice as authenticated private-world creation. Django and PostgreSQL save the world, owner grant, draft revision `0`, default authoring policy, and request receipt together. Repeating the same scoped request returns the original IDs. An account without a grant receives the same unavailable response as for a missing private world. Account, session and access checks support the first slice. Linked editing, publication, the React authoring UI, gameplay and model jobs come after this initial change.

## First implementation request

After reviewing the context check, paste this as a separate message when you are ready to build.

> Implement the authenticated private-world creation slice on a new local branch. Use Django, DRF and PostgreSQL and follow the approved request, session, permission and persistence contracts. Verify creation, an identical retry and access for an account without a grant. Report the files changed and each test result, including any check that requires a database I have yet to start. Stop at the local diff for review.
