# CGS Phase 1 Wiki Design

Design draft for a standalone browser Wiki. The Phase 1 release delivers the world model, authoring, consistent reads, and conflict review that later CGS phases depend on. The first implementation increment proves a small part of that design through an ordinary browser workflow.

Use the [milestone quick reference](CGS_Milestones_Quick_Reference.md) and [detailed delivery plan](CGS_Milestones_Delivery_Plan.md) for the current sequence, deliverables, and completion checks.

The Phase 1 pages in the [editable architecture](CGS_Codex_Local_Handoff/CGS_First_Playable_Architecture.drawio) show the application and its consumers, the record relationships, the validation and save flow, and the core authoring workflow. The earlier first-playable handoff is evidence for the reference dungeon and for integrations that already have design work.

## Decisions that govern Phase 1

| Decision | Behavioral consequence |
| --- | --- |
| Complete the general-purpose Wiki before building out play | Cover the world model, its authoring workflows, and its read contract across the agreed requirements. Use several fixtures to exercise the same interfaces. |
| Author current canon and dated world history | A correction changes what the current canon says about an existing time interval. A fictional change has an effective time and preserves what was true before it. |
| Schedule author version control later | Keep stable logical identities and internal concurrency checks now. Author comparison, restoration, branching, and the source policy for long-lived runs are separate design work. |
| Track facts, reports, and knowledge separately | A false statement and the belief it creates remain representable. An actor view receives evidence that actor has obtained by the requested time. |
| Check consistency continuously | Validate the impact of an edit, explain findings with evidence, and make unresolved findings and pending checks visible. The author’s conflict policy determines how representable contradictions affect saving. |
| Give authors reusable definitions | Author types, attributes, rules, relationships, and exceptions through browser forms appropriate to each supported record. Developers maintain identity, type, and reference constraints. |
| Keep rule definitions reusable | Role grants, certifications, ability prerequisites, and bridge limits can use the same condition and evidence structure. The detailed powers and actions toolbox has its own design track. |
| Review delegated work | Manual edits, staged imports, and approved AI proposals use the same write and validation path. Preserve sources and honor the author’s locks and reserved details. |

The earlier handoff’s immutable published snapshots, author-facing named revision reads, and dungeon-specific limits belong to its first-playable design. Phase 1 now uses current canon and effective fictional time. An internal edit counter detects stale work. The tabletop design will settle how a continuing run handles a changed source before that workflow ships.

## Requirements and evidence

| Source and requirement | Design responsibility | Evidence to obtain |
| --- | --- | --- |
| Wiki.pdf pages 1–2. People, organisms and species, objects, places and their parts, organizations, cultures, powers, geography, and dated events | Typed entities, properties, relationships, sources, and time-aware articles. Map, timeline, and article views resolve stable identities. | A record catalog traces each agreed category to fields, relationships, authoring controls, consumer uses, and browser checks. |
| CGS 2.0 Brainstorm.pdf. Properties, inputs, effects, beliefs, values, goals, expectations, and group decision-making | Author state, knowledge, roles, rule inputs and applicability, and explanations of changes. Actor and institutional decision execution comes through later consumer contracts. | Compare two actors with different evidence and compare eligibility, behavior, and recorded consequences. Exercise the same condition evaluator across domains. |
| CGS.pdf and the workflow overview. Events feed editorial selection, goals and subgoals, assets, and scenes and shots | Preserve event, place, actor, and asset references. Fictional chronology, author corrections, and audience reveal order each have their own meaning. | A consumer uses the same event in two presentation orders and keeps identity and authorized disclosure consistent. |
| CGS Capability Map and Phase 1 Plan. F01–F16 and Cedar Gate | Carry forward authoring, relationships, time reads, scope, imports, AI review, export, and recovery. Adapt the original correction checks to the current-canon decision. | Create and inspect Cedar Gate in React on PostgreSQL, check a linked transfer, prove disclosure by date, then expand the browser acceptance set. |
| CGS Development Roadmap and later Wiki conversations. Full-stack browser use and guarded AI participation | React for the primary workflows. Django REST Framework for commands and scoped reads. Review AI changes before the shared writer applies them. | Complete author tasks in the browser. Exercise manual use with inference unavailable and verify authorized review of a linked proposal group. |
| Fandom and World Anvil reference review | Add readable articles, summaries built from records, discovery and backlinks, prompts, layered maps, and audience previews where they improve the author workflow. | Navigate a world by article, relationship, map, and time. Open the same fact through these paths and compare its approved values and visibility. |
| Latest author decisions. Durable conflicts, optional blocking, and general-purpose systems | Apply deterministic structural and rule checks where expressible. Store findings, tag affected records, and explain pending and uncertain state. | Fix a contradiction, grant a valid exception, try both save policies, and repeat with data from a different domain. |

Baseline material includes the [CGS Development Roadmap chat](https://chatgpt.com/g/g-p-6aaebe0e89288191a066fa4caa7f9302-cgs-mmorpg-franchise/c/6aff32ea-19f4-83e8-97d0-538e2b41a403), the three Lucidchart exports, the local CGS project roadmap, the Capability Map and Phase 1 Plan, the Architecture Working Map, the Cross Phase Design Review, and the local first-playable contracts. The comparison uses previously reviewed older roadmap exchanges and the recent exchanges available through the chat reader. A complete reconstruction of every past exchange remains unverified.

## World records and reads

| Record | Minimum meaning |
| --- | --- |
| World and catalog definition | World identity, ordered fictional time, author access and policies. Each supported property and relationship names its type, applicable records, cardinality, and unit where relevant. |
| Entity and relationship | Stable identities for entities and directed, typed relationships. Relationships can have effective intervals, sources, and visibility. A building can have physical parts, owners, and occupants through explicit relationships. |
| Canonical assertion | Subject, property, typed value, effective interval, source, and visibility. Exclusive properties resolve to one value or expose an unresolved conflict to an authorized reader. |
| Event composition and transition | Nest named event groups around dated occurrences and recorded actions. A dated leaf preserves its participants, cause, and any grouped state changes. One transfer can move a character and change their affiliation together. [W1 timeline contract](CGS_W1_Core_Worldbuilding.md#nested-timeline-contract) |
| Claim, observation, and belief | Who claimed, learned, or believes a proposition, from what source, and when. Record the proposition the actor received. The actor’s view can reflect dated evidence even when canon has since changed. |
| Rule and exception | Target scope, conditions, applicable operation, effective time, required evidence, and accepted alternative paths. A grant records the particular path, source, and time used. |
| Candidate change, issue, and check status | Expected current state, authorized proposed changes, and the scope and result of validation. Issues link to the records, inputs, dates, and rule that explain them. |

A read combines the real caller’s current rights with the requested world time and an authorized viewpoint. Author previews may inspect a character’s view. The character view shows what the character learned, when applicable, with source and observation time. When a character last saw a gate open and it later closed out of sight, the previously seen opening is evidence from that date. The current unseen value stays out of the projection. Apply the same scoping to articles, search, backlinks, maps, timeline, exports, issue details, and model context.

An author correction replaces the target assertion’s value in the current canon at its effective interval. Preserve its identity where the same assertion is being corrected. A dated transition updates the affected intervals and records an event. If an edit changes evidence an observation depends on, flag that dependency for review. An independent attributed statement retains the content its source actually recorded.

## Validation and conflict review

### What the checker decides

| Check | Example |
| --- | --- |
| Shape, identity, access, and references | A value matches the declared type, its interval has a valid order, referenced records exist in the right world, and the caller may write them. |
| World invariants | Two incompatible canonical values overlap for a single-valued property. A lower height reported in testimony is an attributed claim and can coexist with canon. |
| Rule applicability and satisfaction | Select the rule active at the relevant operation and time. An acquisition, a continuing eligibility condition, and an activation can have different requirements. |
| Exception or alternative route | Accept a wizard’s grant, wish, or quest reward when it is linked to an authorized exception or another defined acquisition route. Show the specific source and scope. |
| Missing evidence or unsupported check | Record what is missing or outside the supported checker. A check with unknown inputs can be distinguished from a confirmed contradiction and from a completed check with zero findings. |

If an ability required level 5 in two skills when it was acquired, an in-world change to a 5-and-10 requirement applies from its own date and under its specified scope. An acquisition-only change affects new grants. A retention rule can affect existing holders. An author correction that makes 5-and-10 the rule at the earlier acquisition date rechecks the earlier grant. The checker can explain the result with the event date, required levels, actual levels, and any applicable exception.

An author can represent a fictional violation of a regulation when the world permits the action to occur. A rule’s purpose determines whether it checks eligibility, makes an outcome impossible, or describes a prohibition with consequences. This distinction belongs in the rule definition and its explanation.

### Save policy and feedback

1. Parse and authorize the proposed change, then stage its entire effect as a candidate. Check types, links, effective dates, and known affected invariants. Use the same path for manual, imported, and approved AI changes.
2. Find affected assertions, relationships, events, and rules. Use declared rule inputs and time windows to narrow rechecks. Account for queries whose results change when a record is added or removed, including checks for absent records. Widen the check when the affected scope is uncertain.
3. Apply the world’s policy to representable changes. **Save and flag** is the proposed default. Accepted changes can carry confirmed findings or a visible checking status. **Block confirmed contradictions** holds a candidate while required checks are running and stops its application if it would leave a confirmed contradiction in the checked scope. Type, reference, and authorization constraints apply when writing canonical data in either policy. Incomplete working edits can be staged for repair.
4. Commit a linked change, its receipt, and any durable follow-up work together. For a queued check, store the exact candidate and the current edit counter and relevant policy. Before applying a strict candidate or publishing a result, confirm the inputs are still current and recheck authorization. Supersede stale results and recompute against current data. A failure remains visible as an unfinished check. Previously reported issues outside the affected scope stay visible when a separate change is applied.
5. Return a scoped explanation. Include the records and property or relationship at issue, effective time, actual and expected values, the rule, and supporting sources. Preserve an issue’s identity while it is open, and resolve it when a current check verifies the fix. Record findings for blocked attempts separately from issues in current canon.

The author sees affected-record badges, a world issue list, and links to details. Compute badges from current validation results for the relevant scope. Useful states include checking, conflict found, needs evidence, check failed, and checked with no findings in this scope. A boolean on each record cannot distinguish these cases. A downstream consumer receives the state of its required inputs. An ambiguous canonical value receives an explicit conflicted state. Author-only explanations stay out of player and reader projections.

Start with exact structural and temporal checks during save. Measure local checks and whole-world probes on representative data before deciding which checks need background work. The queue and stale-result rules supply the behavior when work moves to a worker. A later language-model review can flag possible contradictions in prose for author review. Deterministic checks decide the supported formal rules.

## Implementation mapping

| Process | Application component | Durability and checks |
| --- | --- | --- |
| Author or review a change | React Wiki article, edit controls, and change review. DRF parses typed Wiki commands. | Reuse session and world access. Require a current write grant and expected edit counter. |
| Find affected data and validate | Python service applies a candidate and runs structural, temporal, and rule checks. Impact lookup uses declared inputs and affected time windows. | Keep policy and permission checks at the write boundary. Use deterministic predicate results and typed diagnostics. |
| Apply or hold a candidate | Django transaction service uses the current world lock, scoped request key, and atomic change group. | PostgreSQL persists stable identities, effective records, issue state, receipts, and any required follow-up job. Check duplicate delivery, stale saves, and rollback. |
| Read at a date and viewpoint | DRF calls one shared query and projection service. React uses it for article, timeline, and later search and map views. | Scope by world, caller and viewpoint first. Index subject, relationship, and time reads. Carry sources and freshness to the view. |
| Review assisted authoring | Provider adapter consumes a purpose-scoped context and returns a candidate group with sources and assumptions. | Validate the reviewed candidate through the shared writer with current authority and guardrails. Repeatable tests use fixed proposals before a live provider trial. |
| Supply other phases | Event resolver, tabletop views, and visual and editorial consumers call scoped reads using stable references. | Exercise a small consumer before the Wiki exit. Preserve sufficient time, geometry, and evidence information for later phases. |

Use Django, DRF, PostgreSQL, React, and the current Compose workflow. The prototype already has private worlds, typed draft edits, durable entity and link keys, and save receipts. Its draft projection reads an author’s whole selected draft. Wiki projections require a new as-of and viewpoint contract. Keep the prototype draft route usable while introducing the Wiki workflow and map existing data explicitly, preserving identities and incomplete status. Verify upgrades against a copy before enabling an import on working worlds.

The write and query contracts belong to the world model. Optimizations such as indexes and caching can evolve behind them. Scope the first groups of persisted records by world and identity. A storage choice for the full catalog remains open to evidence from temporal queries and migration work.

## Earlier build increments and proof

The table records the original sequence and its narrower tests. In the [current delivery plan](CGS_Milestones_Delivery_Plan.md), the demonstrated 2a workflow is B0. W1 adds the remaining core character, place, and timeline coverage before W2. W5 governs Phase 1 release completion.

| Increment | Work | Gate to call it done |
| --- | --- | --- |
| 0. Align requirements and plan the build | Trace user decisions and source documents, update the architecture, and specify the first browser slice and later increments. | Each core requirement has a place in the plan and a proposed check. Known scope changes are explicit. |
| 1. Author and inspect dated canon | Implement stable entries, typed values, linked changes, events, known observations, basic findings, and a scoped reader and editor. | Cedar Gate runs through UI, API, and PostgreSQL. Existing draft data remains readable. Test older world dates, hidden fields, linked rollback, and retry. |
| 2a. Author characters, places, and timeline events | Put subject-specific articles and linked events on top of the tested time and knowledge model. Establish separate records for an ability definition, a character learning it, and an event using it. | Create two events at the same time, follow their participants and places, and check the effects against the same character identity. |
| 2b. Design actions and check general rules | Define ability acquisition, progression, activation, effects, and exception contracts before implementing the checker. Add effective rule selection, dependency checks, save policies, and author issue review. Move expensive checks to durable work if measurements justify it. | The same evaluator handles ability acquisition, institutional eligibility, and a physical or resource constraint. Verify changed rules, stale checks, and useful explanations. |
| 3. Expand authoring coverage | Define the remaining catalog families and relationships, richer viewing and editing, groups and cognition records, geometry, assets, and timeline and discovery navigation. | Trace each accepted catalog requirement to browser behavior and a data contract. Test unfamiliar combinations and at least one case outside the hunter and dungeon examples. |
| 4. Assist, import, and preserve authored work | Add reviewed JSON imports, sourced suggestions and extraction, export of current canon and world history, and recovery. | Exercise manual and assisted saves under the same access and validation. Restore exported or backed-up records with stable links, dates, and evidence. |
| 5. Verify Phase 1 and prepare consumers | Run full acceptance, migration and clean Compose checks, assess retrieval and validation cost on larger fixtures, and validate the consumer contract. | Complete the agreed Wiki checklist and show a downstream consumer reading the same scoped facts and causes as the Wiki. The playable integration follows that gate. |

Each increment crosses the browser, API, and persistence boundaries where its behavior requires them. Each new catalog family or rule feature gets precise fields, constraints, and acceptance examples before its code. Use focused experiments for unresolved performance or retrieval claims and label their results separately from working app behavior.

## First implementation increment

### Data and command contract

The first slice uses typed facts and relationships about people, places, and groups. Build it as an additive Wiki path on existing worlds. The canonical records needed by this slice are stable entities and relation endpoints, property definitions for a small reusable catalog, dated assertions and links, grouped events, attributed observations, and findings tied to the current edit counter. Use explicit truth and evidence records from the first slice.

| Contract | First slice |
| --- | --- |
| Fictional time | Use ordered world positions for comparisons. The Cedar Gate fixture labels those positions in days. A value applies from its starting position until its next boundary, exclusive. Distinct ordered positions express events whose relative order changes the result. |
| Correct value | Target an existing canonical assertion by stable ID. Check its property type and affected intervals and replace the erroneous value. Change the edit counter. The correction adds no fictional event. |
| Record dated change | Supply the event time and a group of affected assertions or relationships with typed values and causes. Update effective intervals and commit or reject the whole change. |
| Correct an event date | Target the existing event and its recorded transitions. Retime the event and the boundaries of its linked changes together within their neighboring intervals. Report dependencies or conflicting boundaries that need an explicit follow-up edit. |
| Record knowledge | Associate the observer with the witnessed or reported proposition, the source and learning time, and allowed disclosure. Scoped reads include that information from the learning time onward. |
| API boundary | GET /api/v1/worlds/{world_id}/wiki lists entries. GET /api/v1/worlds/{world_id}/wiki/entries/{entry_id} also returns an article. Both accept at and a person ID in view_as. POST /api/v1/worlds/{world_id}/wiki/changes accepts the typed command and expected edit counter. |
| Browser | Browse and open an entry, select world date or preview as an authorized actor, and use distinct Correct value and Record dated change controls. Show validation feedback and links an authorized author can inspect. |
| Preservation | Keep the initial Wiki path additive and leave old draft reads available. Explicitly map old draft values, stable IDs, and links before migrating them. An author action determines what becomes canon. |

### Persistence decisions for the first slice

- Reuse the existing World and WorldAccess records. Keep a Wiki edit counter at the world boundary. Treat an identical request as the same operation under the current grant. A distinct request expecting an older counter gets a conflict response.
- Keep a world-scoped logical identity for each canonical record. The prototype EntityKey is tied to a draft revision and allows only its four current kinds. Introduce Wiki identity separately for the additive path. A later import can preserve compatible original IDs by mapping their meaning and checking for collisions before applying any record.
- Store assertion and relationship identities with their effective bounds, property or relationship definition, value or endpoint references, visibility, and source. Index by world, subject, property or relationship, and effective start. Check link endpoints and interval order at write time. A canonical conflict that can be represented is a validation finding, so a database constraint that forbids every overlap would bypass the save policy.
- Link each event to its affected records and the previous and resulting boundaries needed to correct its date. The first slice can retime a linked change within its adjacent bounds. Changes that reorder intervening transitions require an explicit candidate resolving those affected records.
- Store the proposition received by an observer, its source, and learning time. Infer permitted display from the scoped read. A change to an authoritative source can flag a dependent observation. An independent statement can still conflict with truth without producing a canon error.

For the first save path, evaluate affected temporal and reference checks synchronously. Keep structural errors distinct from representable canonical conflicts. Return the save outcome, the checked scope and state, and issue references. An entry read can return a single resolved value, attributed evidence, an unknown value, or an unresolved conflict with the detail allowed for that viewpoint. Add configurable conflict blocking and detailed rule checks in increment 2.

### Initial command fields

The save body carries expected_edit and one command, plus the Idempotency-Key header. A successful receipt carries edit_counter and record_id. The author article returns the active findings, dated fact and claim records, and evidence. An author can use a character viewpoint to see only that person’s recorded knowledge and visible directory entries.

| Operation | Command fields |
| --- | --- |
| create_entry | kind, name, optional author_only |
| record_fact | entry_id, field, value, from_tick, optional until_tick, source, and author_only |
| correct_fact | assertion_id and replacement value |
| record_event | name, tick, optional source, and one or more changes with entry_id, field, value, and optional author_only |
| correct_event_date | event_id and replacement tick |
| record_claim | entry_id, field, value, speaker_id, tick, optional source and author_only |
| record_observation | observer_id, source_kind, source_id, learned_at |

The starting catalog has people, places, and groups with typed status, description, height, location, and primary affiliation fields. Location and primary affiliation point to other entries by UUID. Valid dates use integer world positions. Intervals start inclusively and end exclusively. A correction preserves the original fact ID. A dated event changes all its linked facts together.

### First acceptance cases

- Start Cedar Gate closed, with Mira at East Tower and affiliated with the Watch. Open the gate on day 10. Let Mira learn that on day 11. On day 10 the author sees the gate open while Mira’s view withholds it. On day 11 Mira sees the observation. Repeat the earlier viewpoint after day 11 and verify it still withholds the fact.
- Record a transfer on day 12 that changes both location and affiliation. Correct its authored date to day 11 and check both boundaries. The correction revises canon. A fictional second transfer appears only if an author records one.
- Correct a misentered value within one interval and keep the linked record’s identity. Write a separate dated change and confirm both before and after answers. Add an attributed claim with a different value and verify its source and time.
- Attempt an invalid link in a grouped edit and verify the accepted records stay intact. Repeat an identical authorized save and check it applies once. Try a stale save and an unauthorized world and viewpoint.
- Open a pre-existing reference draft after the change and compare saved entity IDs, links, and values. A migration rehearsal uses copied data and verifies status before any changes to working worlds.

The first build uses the additive Wiki tables from migration 0005. The migration creates its own tables and leaves draft rows in their existing tables. An explicit draft import and mapping have their own work when that workflow is added.

## Core worldbuilding workflow already implemented

The Core Wiki authoring and timeline page in the [editable architecture](CGS_Codex_Local_Handoff/CGS_First_Playable_Architecture.drawio) traces these forms to their shared records and article views. The world timeline reads through GET /api/v1/worlds/{world_id}/wiki/timeline and follows the same authorization checks as articles.

Characters, Places, Timeline, and Library give authors direct ways to find and create world records. The general New entry control remains a quick route to the same typed forms. A character article can show a summary, appearance and background, a class reference, current location, dated attributes, and learned abilities. A place article can show its kind, parent place, and direct contents where their location at the selected time is unambiguous. Class, ability, item, and group articles are reusable or independently linkable world records. Existing person, place, and group IDs carry forward.

| Record or workflow | Contract for this increment |
| --- | --- |
| Character and place creation | Choose a named type and optionally enter an overview and type-appropriate details. Initial facts use the selected world time and save with the identity in one transaction. Link a class or place by ID. |
| Place structure | Represent buildings and rooms with a typed place classification and the same dated location relationship used for people and other entries. Preserve the distinction between the subject's identity and where it is at a particular time. |
| Ability connection | An ability article describes the reusable definition. A separate dated record attaches it to a character. A recorded use of an ability can refer to the character and that definition. These records describe authored canon. The next increment defines acquisition rules, formulas, costs, and effects; the event engine later resolves them in play. |
| Timeline event | An event has its own identity, time, description and source, with typed participant, place, and item links. It can include an authored ability use and an atomic set of dated changes to existing records. Participation can be recorded by itself. Same-time events are allowed, with conflicting writes to one field at the same time handled by the existing date checks. |
| Reading, editing, and visibility | Show linked events on the world timeline and on affected or explicitly linked articles. An author can correct an event's details and date. Character previews continue to return recorded knowledge, with canonical timeline and ability records available in the author view. |

The design uses the relationships and event parts from Wiki.pdf, the distinction between actor capabilities and state changes in CGS 2.0 Brainstorm.pdf, and the later consumption of events in CGS.pdf. The reader-facing article and type-specific creation patterns draw on Fandom and World Anvil. The timeline links support later story and tabletop consumers without adding a story generator or rule resolver in this increment.

Acceptance uses a character linked to a class and learned ability, a building and room, and two events at the same time. One event changes the character's location; the other has participants and an item with no state transition. The browser walkthrough checks both events, the old and new location of the same character, readable linked pages, and the character preview boundary. API checks cover wrong-kind and cross-world references, atomic rollback, same-time conflicts, and the existing save receipts.

### Broader validation cases for increment 2b

| Case | Expected result |
| --- | --- |
| New grant falls short of an active requirement | An ability requires levels 5 and 10. A 5-and-5 grant without an authorized exception has a confirmed issue with exact evidence. |
| Authorized alternative grant | The same character receives the ability through an allowed quest reward. The rule read identifies the alternative acquisition route and source. |
| Rule effective later | A grant was valid under 5-and-5. A dated acquisition rule requiring 5-and-10 checks later grants. A defined retention rule is evaluated separately. |
| Correction affects earlier evidence | Correct the older acquisition rule to 5-and-10. Find the past grant, check the state then, and report any missing exception. Check which observations or later uses rely on it. |
| Non-ability rules reuse the evaluator | Test a credential whose validity is required for an authorized operation and an equipment load limit. Both use the same time-scoped predicates, evidence, and issue handling. |
| Findings are contingent on current data | Test both world save policies, missing evidence, and a stale background result if the worker is implemented. A stale result never replaces the current status. |

## Remaining uncertainties

- **Breadth of the catalog and rule language.** The source-to-workflow trace needs exact fields for the remaining record families and well-chosen tests across unrelated settings. Keep a list of unsupported checks and expand it from concrete cases.
- **Correction impact.** Clarify how each derived record follows its source, especially older observations, effect dependencies, and records that rely on an absence. Test corrections that change both scope and time.
- **Performance and recovery.** Measure large-world reads, dependency selection, and edits affecting many records. Verify any pending check remains recoverable after a restart.
- **Prototype reuse and access.** Rehearse migration and address relevant draft reuse gaps, including access loss through secondary reads, lost staged editing, and meaning of reusable fact and rule IDs.
- **Handoff to later phases.** Choose run source pinning, game-specific effect interpretation, and media staging contracts when those consumers are designed. Prepare typed identities, locations, rules, facts, causes, and scoped evidence now.

This stage produces the architecture and build plan with a bounded first implementation contract. Integration behavior, performance, and full Phase 1 completeness are demonstrated by the later acceptance gates.
