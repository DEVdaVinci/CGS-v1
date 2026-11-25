# CGS milestone delivery plan

[Read the quick reference](CGS_Milestones_Quick_Reference.md)

**Current position** — The working foundation is verified. W1 is being updated against the shared world-model requirements. Its [revision sequence](CGS_W1_Core_Worldbuilding.md#w1-revision-sequence) lists the authoring, evidence, and consumer checks required before W2. The complete Wiki, the event engine, and the first playable tabletop release each have their own finish lines.

## How to read a completion report

- **B0** records evidence already gathered. **W1–W5** are Phase 1. **P2** and **P3** are Phase 2 and Phase 3. **S1** is the proposed first downstream story workflow. The milestone IDs refer to this plan.
- Each milestone names what an author or player can actually do, what is complete at that point, and where later work belongs. A design checkpoint delivers a design. A browser feature is complete when the normal workflow saves, reloads, and passes the listed checks.
- A milestone is **partial** while any required check is open, blocked, or unverified. The completion report lists each check ID and its result, the build tested, how to find the feature, and any remaining discrepancy. A successful fixture walkthrough proves the behavior it exercised.
- The scope of an agreed milestone can change. Before counting a moved or dropped requirement as resolved, record the requirement, the reason, its new milestone or disposition, and the effect on the user workflow. Update both versions of this plan and confirm material scope changes with the project owner.

Use the established React browser UI, Django/DRF, PostgreSQL, and Docker Compose. Work and verify in the CGS repository. Distinguish a passing isolated build from a build running in the user's normal Compose app. Schema changes include a data upgrade check. Each coding sprint ends with a detailed commit and a verified push of the feature branch to GitHub. [Sprint checkpoint instructions](../AGENTS.md)

## Design sources and boundaries

| Source | What it controls in this plan |
| --- | --- |
| Lucidchart **Wiki.pdf**, especially pages 1–2 | The source inventory for people, organisms and species, places and their parts, objects, institutions and cultures, and events. W1 covers the core character, place, and timeline records. W3 covers the remaining first-release families. |
| Lucidchart **CGS 2.0 Brainstorm.pdf**, especially pages 2, 4, and 5 | Character identity, traits, relationships and state, beliefs and goals, and the links from conditions and actions to outcomes. W1 covers authored data. W2 covers rule definitions and checks. P2 covers execution and bounded decision-making. |
| Lucidchart **CGS.pdf** and the roadmap decisions carried into the [Wiki design](CGS_Phase_1_Wiki_Design.md) | Canon, consequences, chronology, and downstream editorial use, together with browser-first authoring and the separation of canon from viewpoint. W5 checks the downstream read contract. S1 exercises it in a story workflow. |
| Fandom and World Anvil | Additive references for the readability of articles and the usability of world authoring and navigation. W3 checks specific tasks. The Lucidchart requirements and the project owner's decisions govern CGS scope. |
| [First-playable technical design](CGS_Codex_Local_Handoff/CGS_First_Playable_Technical_Design.md) and [behavior cases](CGS_Codex_Local_Handoff/contracts/Behavior_and_Acceptance.md) | The reference dungeon and expected behavior for P2 and P3. Reconcile old publication and draft terms with the current Wiki and the internal run-source contract in P2. Preserve the fixture outcomes or document any agreed change to them by case ID. |

Author-facing revision browsing, branching, and restoration are scheduled after this Wiki release. Dated fictional history, current-canon corrections, export, and operational recovery are part of this plan. The first three phases culminate in a full playable dungeon. MMORPG, broader franchise production, and a full story production suite are outside this delivery sequence.

## B0 Working foundation

**Status and finish line** — Verified in the earlier build. Basic Wiki authoring and the dated-state model are usable in the browser. This is the starting implementation for W1.

**What you can do** — Open a signed-in world and select **Open Wiki**. Create basic character, place, class, item, and ability articles. Link a room to a building, record learning an ability, and create dated events with links and optional state changes. Inspect a character or place at a selected time and preview a character's recorded observations.

**Existing evidence**

- **B0-01** — The browser walkthrough created linked characters and rooms, attached a learned ability, and saved two independent events at one time. An event link opened the same character before and after a recorded move. [Browser checks](../frontend/e2e/wiki.spec.ts)
- **B0-02** — The prior release run passed 33 PostgreSQL-backed tests and 11 browser tests. The upgrade retained the existing volume and matched contents across the 15 inventoried tables. These are historical results for B0. [Wiki backend checks](../backend/cgs/worlds/test_wiki.py)

**Remaining work** — Character and place articles use a small field catalog. W1 owns their core design coverage, W2 owns ability behavior and rule validation, and W3–W5 complete and verify the Wiki.

## W1 Core worldbuilding

The [W1 implementation plan](CGS_W1_Core_Worldbuilding.md) contains the record and browser contracts, build order, and verification cases for this milestone. The [Lucidchart field trace](CGS_Wiki_Field_Trace.md) records each named source field, its prior coverage, and the reason for the representation or schedule.

**Status and finish line** — The prior build provides core character, place, and timeline workflows. The W1 revision closes their gaps against the general-purpose world model, including biography and family, linked history, spatial state, and historical evidence. Acceptance requires verification of the revised browser workflows, record ownership, and outstanding correctness checks.

**What you will see in the browser**

| Workflow | Required deliverable |
| --- | --- |
| Create and inspect characters | Named **Characters** access and a quick **New entry** route to the same records. Establish birth and death, birthplace and origin, nationality, and family in the character workflow. Read the same identity through its biography and related timeline. Dated physical state has its own authoring path. Age is derived when the timeline data supports it. |
| Author character relationships and state | Searchable links for family, personal and organism relationships, cultural or organizational affiliations, jobs, roles and titles, and items. Distinguish ownership from possession. Record dated assignments, resources, inventory quantities or individual items as applicable, and condition changes with sources. Provide reusable class and species definitions with supported typed defaults and explicit overrides. |
| Author cognition records | Store personality traits, values, preferences, goals, beliefs, reported claims, learned observations, and dated mental or emotional state. Show belief holder, proposition, supporting source when known, and effective or learning time. Provide author and character views. |
| Create and inspect places | Create regions or settlements, terrain features, buildings and named parts such as wings, floors and rooms. Edit parent and contents links, physical whereabouts, and connections or entrances as separate relationships. Record simple measured two-dimensional bounds and connection points for a layout. Open a place and see its immediate context and occupants at the selected time. W3 adds the richer browsing and map presentation. |
| Author and inspect history | Organize a named event into nested segments with actions or occurrences at the leaves. Record performers independently of participants and read the same histories from related articles with their enclosing groups. Keep an event's venue, effects, source, and date precision distinct. |

**Design commitments** — Subjects keep stable IDs. Use typed quantities where rules or consumers need values and searchable references where they need identities. Keep explanatory prose alongside those records. Shared relationship definitions specify endpoint types, direction, cardinality, time, and visibility. Physical whereabouts, place containment, connectivity, residence, and a witness's last sighting answer different questions. A correction revises the current authored account. A dated transition preserves the prior in-world state. Effective intervals include their start and exclude their end. Canon, claims, observations, and beliefs have distinct records so that an inaccurate report remains usable evidence without replacing canon.

Build in two internal passes. First deliver character profiles, relationships, cognition records, and the minimum reusable definitions they reference. Then deliver places, layout, and timeline integration and rerun the combined workflow. Record the midpoint as partial W1.

**Completion checks**

- **W1-01 · Design coverage.** Trace each character, place, and timeline concept in the source inventory to a typed field, relationship, derived value, or authored prose. Record value type, unit where meaningful, allowed targets, time semantics, visibility, authoring control, and test case. Identify dependencies with a named milestone. For example, an authored goal is W1, an NPC choosing actions to pursue it is P2. Verify the affected record and consumer connections in the [editable architecture](CGS_Codex_Local_Handoff/CGS_First_Playable_Architecture.drawio) before changing the schema.
- **W1-02 · Character browser coverage.** Save and reopen every character field group in the table above. Verify separate birthplace and origin, dated nationality, an authored parent and sibling, and their inverse reads. Check identity and dates independently of physical whereabouts. Verify age, incomplete dates, cultural and organizational links, titles, ownership and possession, quantities, goals, and beliefs. Exercise inherited, overridden, and ambiguous defaults. Enter an invalid reference and verify its field error and no partial save.
- **W1-03 · Spatial relationships.** Build Harbor Hall, an upper floor, a landing, and a corridor with named connection endpoints and a measurable layout. On the same date set Mira's physical location to the landing, her residence somewhere else, and her destination to the corridor. Verify direct occupants, the place hierarchy, and the independent route on reload. A self-link or a containment cycle on the same active dates produces a structural error with no change to the prior layout.
- **W1-04 · Dated state.** At time 10, record one event that moves Mira from the landing to the corridor and changes her ankle condition. Add a simultaneous bell event with a different participant and no changes. Time 9 shows the prior facts, time 10 shows both new facts, and the same Mira ID appears throughout. Correct an erroneous initial height without creating a fictional event. Correct the move date to time 11. Verify both state changes now begin at 11 and the bell stays at 10. An invalid member of a grouped edit leaves both facts and the event list unchanged.
  - **Hierarchy evidence for W1-04.** Save, reload, expand, and rearrange a nested outline. Verify action IDs, dates, performers, participants, and effects. Compare effective group dates across the world and a related article while the article shows only its directly related records and enclosing groups. Show concurrent branches filtered by involvement or place. Reject a cycle, a cross-world parent, and a move outside fixed parent dates, preserving the prior outline and state.
  - **Date precision for W1-04.** Represent an occurrence whose date is only known within a range, separately from an occurrence with an exact duration. Return the recorded precision and evidence to a reader. Require an exact effective boundary to apply a state transition.
- **W1-05 · Viewpoint.** Record that the exit is open and that Mira believes it is locked after receiving a false report. In the author view see truth, report, evidence, and dated belief. In Mira's preview see her evidence from the learning time onward. A second actor without it receives none of the restricted evidence. The in-world belief creates no canonical contradiction. Two conflicting exclusive canonical values receive the applicable conflict finding.
  - **Provenance for W1-05.** Link two conflicting historical accounts to separate sources, including a source without a known speaker. Verify that source, claim, accepted state, and actor knowledge resolve independently and that hidden records stay out of the viewpoint directory.
- **W1-06 · Upgrade.** Verify the same IDs, dates, and values for existing character, place, and event records after migration, including the old location field. Existing flat events open as standalone occurrences with the same direct links and correctable effects. Any field whose meaning cannot be mapped safely is visible for review. An existing draft still opens. Test the new browser flow against a fresh world and an upgraded copy.

## W2 Actions, powers, and rule checking

**Status and finish line** — Planned after W1. Completion is browser authoring and explainable validation of the Phase 1 action and rule catalog. P2 executes supported effects in play. Rich physical simulation and unconstrained automation remain later extensions.

**First deliver the design, then implement it.** Specify action, ability, power, and related skill definitions, actors and targets, requirements, acquisition and progression, costs, activation, effects, exceptions, effective dates, and evidence. A learned ability, a recorded use, and the reusable definition stay independently traceable. Separate acquisition, retention, and use rules. Describe how authors compose typed predicates and effect operations in the browser. For the first supported toolbox include conditional eligibility, resource costs and quantities, bounded formulas, typed value or condition changes, changes to relationships or possessions, and movement between defined places. Specify units, target applicability, ordering, and expected errors. Record capabilities that need finer spatial or simulation semantics, with an example of what the initial toolbox can and cannot express.

**What you will see in the browser** — Create and edit definitions, prerequisites, parameters, formulas within the supported operators, grants, and exceptions. Preview a rule on example inputs. World policy offers **save and flag** and **block confirmed contradictions**. Findings link the affected records, rule, effective dates, actual and required values, and evidence. Clear evidence, missing evidence, and pending or failed checks have distinct visible states. Structural type, reference, and authorization errors reject saves under both policies. Define precedence when rules and exceptions overlap. Use the same evaluator across domains.

**Completion checks**

- **W2-01 · Toolbox design.** Record browser input and expected stored definition, check result, and eventual state change for one simple action, a composed power with multiple effects, and a non-power rule. Show how a reusable primitive applies to several entity types. Give each accepted primitive a positive, invalid-input, and unsupported-case example. The design checkpoint can be reported before implementation with W2 still open.
- **W2-02 · Prerequisite and exception.** Author Ward Step with two prerequisites at levels 5 and 10. Grant it to a character at 5 and 5 without an exception. The finding names the failed prerequisite, actual 5, required 10, grant date, and character. Add a permitted, sourced quest reward route and verify the evaluator records why the grant is valid. Preview activation cost and targets, and prove it returns the expected typed inputs and effects.
- **W2-03 · Time and dependencies.** A grant made during an earlier 5-and-5 rule stays valid when a later acquisition rule changes to 5-and-10. Correcting the earlier rule rechecks that grant and reports the lack of an exception. A separately authored retention condition controls continuing eligibility. Repeat a check after adding a previously absent fact and verify the finding updates.
- **W2-04 · Reuse outside powers.** Author and evaluate a credential or authority requirement and a bridge or equipment load constraint through the same browser rule system. Verify pass, fail, and missing-evidence outcomes with the same evaluator and issue format. No domain-specific code is needed for these three fixtures once the supported operations exist.
- **W2-05 · Save and recover.** Exercise both policies, a retry, a stale input, and fixing an existing conflict. A blocked change has no partial canon effects. A saved conflict can be reopened and resolved with an explanation. If checks are queued, restart during a check and verify recovery and stale-result rejection. If checks remain synchronous, confirm the completed response and affected-record status agree.

## W3 Full catalog and discovery

**Status and finish line** — Planned after W2. Completion is the full agreed manual Wiki authoring catalog, with usable browsing and discovery. W4 supplies assisted authoring and data exchange. W5 is the release gate.

**What you will see in the browser** — Author the remaining record families in the source inventory, including organisms and species details beyond W1, items and equipment, vehicles and technology, resources, organizations and groups, cultures, territories and geographic features, and sources or referenced assets. Link these records through the same authored facts, relationships, rules and timeline. Include organization membership, hierarchy, authority and obligations in the catalog. Reference supported abilities or assets from articles. Browse through article sections, searchable typed links, backlinks, filters, a layered map and a timeline, with time and viewpoint carried through links.

**Design commitments** — Catalog definitions state their supported fields, defaults, required values, units, and relationship meanings. Authors can create reusable definitions and use available typed properties through the browser. Developer changes govern core data constraints. The discovery interface uses the same authorized values as articles, including at an earlier date. Use Fandom and World Anvil to evaluate comparable authoring and reader tasks, with an original CGS design and no promise to duplicate the platforms' unrelated features.

**Completion checks**

- **W3-01 · Catalog trace.** Each accepted Phase 1 family in the source inventory has a browser form and article, typed properties and relationships, and a verified create, edit, reload, and historical-read case where values are dated. List additional ideas with their planned disposition. Open source gaps are visible in the release checklist.
- **W3-02 · General-purpose scenario.** Build a non-dungeon flood-response world with a route, vehicle, relief inventory, organization, delegated role, and a capacity rule. Record a resource transfer and a changed assignment using the same Wiki operations as the dungeon. Read the before-and-after quantity and the effective authority without a custom handler.
- **W3-03 · Discovery.** Find the same record by search, an incoming relationship, and a map or timeline link. Each opens the same identity at the intended time. With an earlier date or restricted viewpoint, a hidden record or detail stays absent from the directory, search, backlinks, map, timeline, and direct reads.
- **W3-04 · Reference tasks.** Compare finding a related article, creating a character and linking a place, retrieving a dated event, and finding a place on a map against the relevant Fandom or World Anvil workflow. Record the start, steps, result, and any friction. In CGS, start with the signed-in world page, demonstrate all four through normal browser controls, and verify navigable links, readable article sections, and the expected values and dates. A task that requires an API client, database edits, or a separate editor is open. Carry the results and any proposed usability changes into W5.

## W4 Assisted authoring and data exchange

**Status and finish line** — Planned after the catalog and rule interfaces are established. Completion means the approved Wiki feature set is available for release testing. W5 verifies the complete feature set together.

**What you will see in the browser** — Supply a brief or structured import, inspect a proposed group with sources and affected records, edit or reject the proposal, and approve the exact group. The first assisted tasks are drafting or completing a character or place and filling a scoped, linked encounter. An import screen shows invalid data and duplicate or unmapped references before applying changes. Export current canon and dated history and restore a copy with its permitted links, dates, and evidence. Carry supported old Draft records into the Wiki using an explicit mapping and preview. The old source stays readable.

**Design commitments** — Manual, imported, and assisted changes use the same authority, validation, and transactional writer. Model input uses scoped records. Locks and reserved details constrain suggestions. Only the reviewed, current proposal may be applied. Long-running inference runs outside the save transaction, provides observable status, and supports recovery. Implement a model boundary usable by a hosted API or a local runtime, a test adapter, and one configured real provider for the first release. Provider choice and any spending require a decision when live trials are due. Manual browser authoring remains available independently.

**Completion checks**

- **W4-01 · Review.** Submit a brief for a sentry and equipment while locking room geometry and reserving the builder's identity. Show sources and the proposed links. Reject a forbidden change, edit a permitted field, approve the reviewed group, and see exactly those records written once. After an intervening edit or access change, the old review cannot apply as current.
- **W4-02 · Model and recovery.** Run both supported assisted task families with fixed test responses and a configured real model. For live evidence, use the handoff's T15.1 sample and usable-output threshold, and require zero unauthorized writes or disclosures. Record time, usage, and corrections. Simulate timeout and rejected output. Verify a visible outcome, no unapproved canon change, and a successful manual save while the model is unavailable.
- **W4-03 · Import.** Stage a valid two-record group and an invalid group containing a dangling link or unsupported Draft field. A valid confirmed group saves with stable references. An invalid or unmapped value is identified before application and cannot change canon by accident. Reimport the same confirmed group safely. Verify the original Draft remains readable.
- **W4-04 · Round trip.** Export an authorized test world, restore into a separate environment, and compare stable IDs, types, dates, relationships, events, observations, rules, and sources. Exercise a restricted projection or attempted export and verify it cannot disclose author-only data. Exercise an invalid archive and verify no partial restore.

## W5 Phase 1 Wiki release

**Status and finish line** — Planned. This is the milestone where the complete Phase 1 Wiki is expected to meet the agreed CGS design and usability requirements. Playable resolution and story generation follow.

**What you will see in the browser** — Use the Wiki from a clean start for each required author task. Create and navigate a world, edit dated canon, build a layout and timeline, author and validate rules, review proposals and imports, and export data with the expected access. Use the same controls after upgrading a copy of an existing workspace.

**Completion checks**

- **W5-01 · Coverage.** Every agreed Phase 1 requirement from the Lucidchart trace and project decisions has a named record or workflow and a passing check, or an explicitly agreed later disposition. Re-run W1–W4 checks, including the comparative tasks. Report any unresolved failure, omission or discrepancy as an open requirement and keep W5 open.
- **W5-02 · Browser acceptance.** Complete the full author walkthrough on a dungeon world and on the non-dungeon world using ordinary navigation. Test keyboard access to required controls, validation feedback, and recovery after refresh. Verify that a second browser account without access cannot read private articles, events, exports, or proposal data.
- **W5-03 · Installation and durability.** Start a fresh Compose app and complete a save and reload. Upgrade a copied existing database and compare representative record IDs, facts, links, and dates. Restore from backup and repeat an author workflow against restored data. Capture database and browser test results and the build identity.
- **W5-04 · Downstream read.** Run a consumer check that reads a named event, its actors, place, linked before-and-after facts and evidence at the requested time. Match the Wiki view's IDs and values. Repeat as a restricted audience and compare what it can see. Show that a downstream consumer can use the authoritative records without recreating them in its own content store.
- **W5-05 · Workload evidence.** Run the same article, search, and affected-rule edit checks on the reference worlds and a larger generated history. Record dataset size, timings, and any queue or failure behavior. All checks must return correct scoped results without lost writes or indefinitely pending work. Establish any release latency target against the intended environment before using it to judge the release. Report actual measurements with their conditions.

## P2 Shared event and decision engine

**Status and finish line** — Planned after W5. The engine executes the supported first-playable action set and bounded actor policies. The browser test run demonstrates execution. P3 delivers the full author-to-player loop.

**What you will see in the browser** — Select an approved scenario for a test run, enter a supported structured action, and see its event or a reason it was blocked. Inspect the resulting permitted state and event log. Test a bounded actor policy using authored goals, state, resources, and recorded knowledge.

**Design commitments** — Settle the run-source contract before implementing execution. On run creation capture the authorized world state, relevant rules and layout at a known effective time with stable source IDs. Keep that internal starting source fixed for the run. A later Wiki correction can affect a new run. This internal reproducibility requirement leaves author-facing Wiki version control to its later milestone. Separate fictional time, run progress, and author edits. Check actor authority, targets, costs, geometry, and effects. Commit state changes, disclosure, and event receipts together. Model output can propose actions. The engine decides rule outcomes and can run when inference is unavailable.

**Completion checks**

- **P2-01 · Contract and first operations.** Document the typed input, rule source, outcome, state changes, observations, and recovery for move, search, report, use an item or ability, and allocate earned points. Trace the required engine operations to the dungeon fixture and record any old handoff mapping needed for current records.
- **P2-02 · Deterministic and atomic.** Replay fixed draws and inputs to get the same range checks, movement, resource balances, damage, rewards and event order. An illegal step spends nothing and advances no tick. Retry a committed step after a lost response and verify one accepted event and one charge. Try a stale or unauthorized step and verify that it creates no accepted event.
- **P2-03 · Knowledge and decisions.** An actor with no evidence holds in the reference case. Give that actor verified evidence and an alarm goal under an authored policy and observe a different legal decision. Verify it uses the permitted route, reason and budget. Compare actor and party views before and after a report. Restart with a due system response and verify exactly one eligible response while a model job is pending.
- **P2-04 · Source change and reuse.** Run the corrected-route case with a new internal source while the old run keeps its original distances and outcomes. Apply the same event operations to a route or transfer outside the dungeon using the non-dungeon world. Verify that play changes run state and promotion to Wiki canon would require a separate author operation.

## P3 First playable tabletop

**Status and finish line** — Planned after P2. Deliver one complete playable dungeon with browser-based scenario preparation, play, and recovery. This is the first complete tabletop release. More scenarios and a broader action and simulation catalog can follow.

**What you will see in the browser** — Open an authored Wiki world, prepare and validate a dungeon, assign actor control and start a run. Use map, sheet and log, explore and reveal information, enter exact instructions or review a bounded goal plan, play an encounter, spend earned points, and resume the saved run. See which state came from the approved source and what changed in play.

**Design commitments** — Use Wiki records and the engine at the normal browser entry points. Preserve the first-playable fixture and its time, source, and disclosure checks. Model-assisted planning can request clarification and is constrained by actor control, action budget, and stop conditions. Provide structured controls and a rule-derived result summary if inference fails. Keep secret details out of both UI reads and model context until authorized.

**Completion checks**

- **P3-01 · Author to player.** Build or import the reference dungeon through the normal Wiki path. Validate that required layout, rules, starting state and actor assignments are present. Start it as an authorized player. An account without the appropriate access cannot run commands or receive private scenario data.
- **P3-02 · Complete the dungeon.** Run the handoff's D0–D11 cases against the current records, with browser evidence for the complete playthrough. Include search and report, an occupied destination that pauses an order, a hit and a miss case, one-time rewards, separate rank and level, granted Ward Step, point allocation, and the alternate route. Match exact saved values or attach the agreed change to the relevant case.
- **P3-03 · Goal and failure.** Submit the D9 scout-and-report goal and verify it stops after reporting and before party movement. Exercise an ambiguous exact order, a prohibited request and a failed planner. Present clarification or a permitted fallback, preserve earlier steps, and allow a structured step. Run the live-model evidence cases T15.1 and the T15.2 runtime and usage measurements for the enabled model flows.
- **P3-04 · Resume.** Close after accepting a step and while an order is paused in a separate test. Reopen and verify source, map, sheet, observations, event log, and pending order agree at the saved head. Reproduce the accepted result after a retry. Restore a test run and verify one pending system response can finish exactly once.
- **P3-05 · Wiki impact.** Correct the reference layout so a former six-meter move becomes seven meters against a six-meter limit. A new run blocks the direct move and accepts the two authored shorter legs. The prior run retains its original source and path. The changed behavior is visible from the browser in both runs.

## S1 First story workflow

**Status and finish line** — Proposed bounded follow-on. It needs the authorized Wiki read contract and can use authored history directly. Accepted play events can be an additional input. Deliver a short sourced outline and scene with a reviewable result in the browser.

**What you will see in the browser** — Select events and an audience or character viewpoint, generate an outline and a short scene, inspect the sources, change presentation order, and edit or reject the result. Story content can refer back to the exact characters, places, rules, and events on which it depends. Proposed facts use the Wiki review path.

**Design commitments** — Keep world chronology, audience reveal order, and a generated draft separate. Carry stable event, source, layout, and viewpoint references. Record uncertain or invented text visibly for author review. Authoring a scene does not silently change the Wiki or the saved run.

**Completion checks**

- **S1-01 · Source continuity.** Generate a two-beat outline and short scene from authored events, with links to the original IDs, times, relevant places, and cited records. Reorder the beats and verify that the world timestamps remain intact. Exercise the same source contract with accepted play events when available.
- **S1-02 · Audience and review.** Compare two authorized viewpoints with different knowledge of an event. Verify which details can be shown at each beat. Reject an invented or hidden detail and verify the saved world can be read with the original values. Submit a permitted proposed addition through the normal Wiki review.

Long-form generation, automated editing or shot production, and broader publishing workflows can build on this handoff.
