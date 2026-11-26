# CGS First Playable Technical Design

This design specifies the first playable CGS release from private world authoring through a saved and resumed tabletop session. It connects the workflow diagrams to application operations, persisted data, API contracts and expected behavior. Use this revised handoff with `CGS_First_Playable_Contracts.zip`. Its API and domain schemas, PostgreSQL dictionary, behavioral contracts and fixed dungeon fixture specify the fields and cases referenced below. The editable architecture has the corresponding logical, data and runtime views.

| Source | Governs |
| --- | --- |
| This document | First-release scope, architecture decisions, software ownership, coverage and build order |
| `openapi.json` and `domain.schema.json` | Complete wire and domain shapes within the supported first-release types |
| `Persistence.md` and `Behavior_and_Acceptance.md` | Physical keys and lifecycle, rules, access and test expectations |
| `dungeon_fixture.json` | Fixed IDs, two deterministic geometry versions and expected outputs |
| Editable architecture | Visual views identified by the same logical IDs |

## Contents

- [Release boundary](#release-boundary)
- [Authority and shared records](#authority-and-shared-records)
- [PostgreSQL design](#postgresql-design)
- [Application and API contracts](#application-and-api-contracts)
- [Authoring and publishing](#authoring-and-publishing)
- [Context and campaign turns](#context-and-campaign-turns)
- [Model contracts](#model-contracts)
- [Dungeon fixture and expected results](#dungeon-fixture-and-expected-results)
- [Acceptance and release coverage](#acceptance-and-release-coverage)
- [Build sequence and feasibility](#build-sequence-and-feasibility)

## Release boundary

**Deliver one complete playable dungeon.** An author can create a private scenario manually or delegate supported work to the drafting assistant, review edits and publish a valid wiki revision. A player can start a run from that revision, send exact instructions or a bounded goal, uncover information, resolve an encounter, allocate earned points and return to the saved map, sheet and log. Structured forms cover the full scenario and provide a usable recovery path during generation failures.

The first release combines Phase 1 world authoring, Phase 2 shared event processing, and Phase 3 tabletop play. **AI-assisted drafting is core in this release.** This decision supersedes the earlier follow-on placement of assisted drafting in the cross-phase review. Later uses can extend the same scoped proposal and review workflow to more wiki areas and other CGS content. The first-playable design governs delivery precedence. The capability IDs in the coverage matrix refer to the cross-phase review.

Supported first-release content includes places and links, room bounds and connections, actors and roles, items and placements, supported action templates, bounded actor decision policies, typed facts and starting observations. The editor supports fields, individual records and scoped encounter completion. Later releases extend the ontology, pressure-test large-scale retrieval, add richer play and speech, and consume authored revisions and accepted events in visual and editorial workflows. The interview and deal remain paper checks for sourced claims and institutional authority.

### Implementation decisions

| Decision | First-release choice | Reason |
| --- | --- | --- |
| Application | React with TypeScript and Vite, Django 6 and DRF, PostgreSQL 17. Same-origin production app with Django sessions and CSRF protection. | Use the existing project stack and a single application boundary for authorization, rules and persistence. |
| World geometry | Two-dimensional metric layout with authored room bounds, traversal points and connections. Store coordinates in whole centimeters and show meters in the UI. | Keep authoritative geometry stable and path validation exact at the scenario scale. |
| Versioning | Immutable validated world snapshots and small per-step run frames. Relational keys represent identity, ownership, references, commands and history. | Direct, reproducible reads simplify the first dungeon. Schema-tagged payloads leave a migration path when size or query patterns justify changing the storage. |
| Timing | Resolve one accepted action per step. Every advance names the run head, immutable plan revision and exact step ID. | Preserve accepted work through interruption and distinguish the player’s observed plan from a replan at the same head. |
| Roles | Authenticated user access, fictional actor control or knowledge, and delegated authoring scope are separate checks. | A person can be an author and a player. A player endpoint still uses the permitted player view. |
| Rule and model split | Python templates decide legal actions, costs, rolls and effects. Models propose edits and interpretations and can draft scoped narration. | The same recorded event drives the sheet, map, log and later media. |
| Hosting and operations | One API, one deterministic rules loop and one inference worker share PostgreSQL and one application image. The client uses a private world list and author-assigned access. | A waiting provider call cannot hold up an owed system action. One database supplies recovery and scheduling. |

## Authority and shared records

### Logical identities and clocks

| Stable logical ID | Application representation | Authority and important fields |
| --- | --- | --- |
| `world.identity` | `WorldIdentity` | World UUID, owner, title and authorization epoch. Membership controls real project access. |
| `world.draft` and `world.draft_revision` | `DraftHead`, `DraftWorld` | Mutable head and active guardrail version over immutable typed draft snapshots. Draft entries can omit publish-required values. Expose diagnostics separately. |
| `world.published_revision` | `PublishedWorld`, `WorldSource` | Immutable approved source, publication number, parent, exact originating draft and typed geometry, rules and start state. |
| `world.entity_identity` | `EntityKey`, `Entity` | Stable UUID and kind in the world with a first issued revision. Corrections change values in later sources. |
| `access.authoring_scope` and `author.proposal` | `DraftPolicy`, `DraftGroup` | Active authority, allowed operations, sources and locked or reserved fields. Each proposal pins policy, base and source and has one exact immutable group and digest. |
| `run.identity` and `run.frame` | `RunRef`, `FrameBody` | Run UUID, pinned publication, exact head and immutable frame state. Attach observations to the audiences that learn them. |
| `run.accepted_event` and `run.step_receipt` | `EventBody`, `StepResult` | One durable event per accepted action with pinned rule, frame, draws and effects. Scoped step receipts cover executed, blocked and stale attempts. |
| `run.order` and `run.plan_version` | `OrderInput`, `PlanSteps` | Raw submission, pinned authorization and budget and exact proposed actions. Each published plan has its own revision and stable step IDs. |
| `run.store` | `CampaignRepository` | Software component that reads and commits campaign records. Distinct from a run identity. |
| `run.observations` | `Observation`, `Fact` | Dated observations, truth and attributed claim records separate from access grants. |
| `model.jobs` | `JobSubject`, `JobResult` | Scoped persisted intake and leases. The inference worker attaches typed proposals and readouts. |
| `run.actor_turn` | Pending or resolved system response | One durable trigger for the originating event and actor. The rules loop resolves it independently of inference. |
| `storage.postgres` | PostgreSQL database | Stores shared authority records for the API, rules loop and inference worker. |

Track draft, publication, run and planning revisions separately from the fictional tick. Accepted game actions advance the run by one revision and tick in the first release. A blocked action can pause an order at the same game revision. A new plan can also appear at the same game revision with a higher plan revision and fresh pending step IDs. Read older frames through immutable pins. Apply current authorization to the actual caller and fictional knowledge at the requested frame. A direct event and each log row use their own resulting frame. An attempted action without a new event uses its before frame.

Use domain types for internal data and the OpenAPI projection types for client data. The domain schema closes entry variants, rule parameter shapes, validity intervals, statuses and typed effects. Interval overlap, temporary aliases, referenced kinds, geometry and scope are checked on the complete candidate. A missing required property in a supported draft entry is a reported omission. Published records satisfy the full variant schema. Approved layouts store integer centimeters and project in meters. The same scoped rules govern readers, players, provider context and recovered receipts. The session and authorization matrix in the companion contracts governs their exact permissions.

## PostgreSQL design

The companion PostgreSQL data dictionary specifies column types, nullability, relationship cardinality, indexes, constraints and ownership. Use immutable validated JSONB snapshots for first-release world and frame bodies and relational keys for identity, history, authorization, plan pointers and receipts. Validate JSONB against the domain schema and enforce cross-record invariants in the writer. Full snapshots are bounded at 200 entities, 500 authored facts and 100 traversal points per layout, with the remaining limits in the exact schemas. Keep historical data across a correction. Measure size, reads and restore before choosing a different storage format.

Serialize authoritative writes against one world row and acquire nested locks in order world, subject, then job. At initial world creation only, lock the account. The coordinated world writes include access changes. Inference jobs use a short job-only lease acquisition, then separately recheck scope and pins before dispatch and finalization. Network inference stays outside write transactions. For scoped read assembly use a read-only Repeatable Read transaction with a single committed authorization snapshot and explicit frame selection. [Django transactions](https://docs.djangoproject.com/en/6.0/topics/db/transactions/) · [Django row locks](https://docs.djangoproject.com/en/6.0/ref/models/querysets/#select-for-update) · [PostgreSQL 17 isolation](https://www.postgresql.org/docs/17/transaction-iso.html)

For each mutation, check current access and look up the scoped idempotency key before fresh-request checks. A matching input reuses the saved receipt. A different input for a stored key returns `KEY_REUSED`. Apply effects and save durable receipts atomically. For a newly stale advance persist its typed rejected result but accept no event. A due actor, invalid request shape or disallowed audience returns a safe status without creating a step receipt. Reproject result references using current access and the exact saved event boundary.

## Application and API contracts

### Process to software mapping

| Process ID | Implementing component and operations | Input to output |
| --- | --- | --- |
| `access.check` | `cgs.access` functions `require_world_access`, `resolve_run_audience`, `require_actor_control` | Authenticated principal, resource, requested capability and purpose to effective grant or safe refusal. |
| `author.edit` and `author.apply` | `cgs.authoring` services `create_world`, `apply_draft_edits(command, principal)`, `validate_world(document, purpose)` | Typed manual edit group or authenticated approval of a proposal to a draft receipt, errors or conflict. Both paths share validation and transactional writer. |
| `author.draft_assistant` | `cgs.authoring` service `queue_draft_generation` and `cgs.ai` worker `generate_draft` | Scoped brief and draft version to a durable proposal and diff or targeted question. |
| `author.publish` | `cgs.worlds` service `publish_world` | Expected draft revision and explicit publish command to immutable published revision and receipt or validation summary. |
| `context.read` | `cgs.context` functions `read_world_entry`, `read_run_frame`, `build_context`, `project_run_view` | Scope, stable IDs, revisions, tick, audience and purpose to authorized entries or game view. |
| `run.start` and `run.resume` | `cgs.campaigns` services `start_run`, `set_run_access`, `resume_run` | Published world and actor assignments to a starting frame and session, or a saved authorized view and pending order. |
| `run.plan` and `run.plan_version` | `cgs.campaigns` services `submit_order`, `plan_order`, `confirm_order_plan`, `replan_order` | Structured action or text command plus authorized context to a typed plan, clarification or bounded wait. Confirmation and a request to replan use the exact plan revision. |
| `run.actor_decision` and `run.actor_turn` | `cgs.campaigns.choose_actor_step`, `advance_due_actor` and the rules management command | Due policy trigger and actor knowledge to a committed system result. After checking actor work, the loop reaps a bounded batch of expired jobs through `cgs.ai.reap_jobs`. |
| `run.resolve` and `run.commit` | `cgs.rules.resolve_step` and `cgs.campaigns.advance_order` or `advance_due_actor` | Typed action, current frame, pinned templates and injected draw source to effects or denial. Commit locks, checks authorization, applies the effects and saves state, history, cursor and receipt. |
| `run.project` | `cgs.context.project_run_view` and `cgs.campaigns.describe_event` | Exact saved frame and accepted event to map, sheet, log and a deterministic readout. An AI readout can be requested through the same scoped projection. |
| `model.invoke` | `cgs.ai.invoke_structured`, provider adapter and leased worker | Validated task request to typed result, refusal, timeout or invalid response. A Django management command runs the worker in a separate process. |
| `ui.author` and `ui.play` | React feature modules `worlds`, `authoring` and `campaigns` | Form values, review and control inputs to DRF requests. Update views from returned revisions. UI does not compute authoritative effects. |

Use Python typed records for service inputs and outputs and DRF serializers for HTTP validation. Keep rule handlers pure over a supplied state, rule configuration and draw source. Repository operations query and commit records. Provider configuration, test fakes and payload validation live at the model adapter boundary.

### HTTP and client integration

All routes, request discriminators, complete response envelopes and error shapes are in `openapi.json`, with base `/api/v1`. Use Django session authentication and CSRF for the same-origin React app. Session endpoints cover masked CSRF token, login, logout and expired login. World authority is distinct from author-facing and play-facing projections. Require the caller's approved target, run and audience on each relevant route. Browser session errors link back to sign-in and reload saved run state.

The author sees linked typed forms, layout preview, guardrail controls, exact grouped diff and a separate publish action. The tabletop workspace shows the selected source revision, map, sheet, prior log and the next readable order step. Scope and fixed coordinates drive geometry. Offer typed controls, exact text and a bounded goal. Display confirmations, pending, stale, blocked and terminal failures as text, with keyboard navigation and focus recovery. The client stores opaque request pins for network replay and can reload the latest run, order and last receipt from the server.

| Representative operation | Input and result |
| --- | --- |
| Apply draft edit | `POST W/draft/edits` takes expected revision and a manual patch or exact approved proposal ID and digest. Save a draft revision and receipt. Publish via its own endpoint. |
| Confirm exact interpretation | `POST R/orders/{order_id}/confirm` takes current run head and exact candidate plan revision. Only that candidate can become ready. |
| Request a delegated replan | `POST R/orders/{order_id}/replan` takes current head and plan revision and queues one planning job under remaining limits. Saved accepted steps retain their original plan. |
| Advance step | `POST R/orders/{order_id}/advance` takes `expected_run_revision`, `plan_revision` and `step_id`. An exact authorized retry returns its stored result. A replan at the same head cannot substitute steps for an earlier request. |
| Recover | `GET R/view` returns the selected frame and any currently active readable order. The exact receipt is available at the scoped receipt route. Use job GETs for provider progress and terminal recovery. |

## Authoring and publishing

The author can compose the whole scenario manually, request a focused fill, or delegate a linked encounter group within explicit controls. Create begins with a draft at revision zero and a stored guardrail version 1 with no AI delegation. The editor marks missing required fields and distinguishes them from allowed null values. The author can name locked fields, reserved unknowns, allowed sources, target prefixes, allowed operations and review preferences.

Assisted intake validates the project and policy before gathering context. It uses only authorized slices of this world and the built-in catalog version. Store a single immutable review group per successful proposal. The proposal ID and canonical digest bind edits to one base revision, authorization epoch, guardrail version and source references. The UI displays the full group including assumptions and questions. If the author wants to approve a smaller part, request and review that smaller group. The writer resolves temporary IDs consistently, checks every touched field against current grants and commits all edits or none. A failed linked edit is a safe validation result. Manual forms submit through the same writer and can resolve unknowns that were reserved specifically from AI completion.

Separate publication validates complete records, live references, geometry, valid starting path, rule support and required domain facts. Publish creates a sealed snapshot and receipt, leaving prior versions readable. New runs can pin the correction. Existing runs and later presentations retain the original source.

## Context and campaign turns

Read the exact role, audience and revision before retrieving context. Start with the permitted projection and follow relevant links or bounded text matching. The resolver can access the authoritative source. It emits safe explanations instead of private facts. Party play can control the scout through approved actions without seeing its private discoveries. SEARCH at the authored junction creates scout observations. REPORT can use the server's authorized `new_discoveries` choice and transfers the selected facts to party knowledge. Reading the earlier search after the later report still uses what the party knew at the earlier event.

Create a run from one approved source, validate actor grants and save frame zero. A typed order builds an exact plan. The system can parse supported exact text deterministically. A model interpretation with unproven equivalence is held for confirmation of that exact plan. A delegated goal supplies allowed actions or actors, stop criterion and budgets. It can vary its steps inside those limits. After a replan, confirm or resume against the new immutable plan and new pending step IDs. An old request cannot play the new plan accidentally.

Advance takes the world lock, checks access, looks up receipt and then validates the head, order status, exact plan and current step. A fresh legal action creates its event, effects and frame alongside the order cursor and receipt. A blocked action stores a scoped disposition and preserves accepted history. Any system response gets a distinct causal identity and continues under the separate rules loop. The provider worker cannot block it while waiting on inference. Terminal plan failure frees the player's active order slot so typed play can continue. A restart resumes from the newest saved frame, outstanding actor trigger and order/receipt data. The companion transition tables govern pending, terminal, stale, confirm, cancel and replay outcomes.

Rule parameters and typed effects are in the domain schema and exact behavior document. Movement is bounded on the known walkable layout, with occupied endpoints rejected. A blocked move rolls no die and costs no fictional time. A legal cast spends Focus on a hit or miss. Save any draw and all effects in one event. Defeating the sentry clears its occupancy and can award XP, level, unlock and attribute points once under the pinned rule. Separate allocation spends unassigned points within the defined attribute bounds. The Ward Step unlock is a supported MOVE variant of up to 300 cm costing one Focus. The map and sheet display saved results. Narration retries read saved evidence.

## Model contracts

The first hosted adapter targets the OpenAI Responses interface with Structured Outputs. Its configured model and prompt version must pass the release measurements. The companion files specify finite provider packets and how they normalize to approved application records. A proposal packet contains operation, restricted pointer and candidate value as JSON text. The server parses by target type, validates the complete staged edit group, and binds approval to the resulting normalized content. A plan packet uses typed actions with explicit arguments. The server checks legality and scope and uses independent parsing or exact-plan confirmation for intended meaning. A well-formed model result alone establishes output shape. [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)

| Task | Processing boundary |
| --- | --- |
| Draft suggestion | Scoped author job proposes one atomic review group or an explicit question. Only current authorized approval can apply it through the shared writer. |
| Turn interpretation | Plan job uses a pinned party/actor projection and the stored command intent. A stale or failed job frees or releases the corresponding planning state according to the transition table. Typed play remains available after terminal failure. |
| NPC decisions | The rules loop reads policy and scoped actor knowledge and owns a deterministic system step. It persists its trigger/disposition independently of model tasks. |
| Readout | The application renders verified outcome facts immediately. The optional model selects a permitted template. Retrying it reads that same event and produces no additional play step. |

Use a 25-second provider call timeout, a 40-second lease, at most two attempts per job and a 70-second user-facing deadline. The rules process closes exhausted work even when inference is down. One delegated order may consume up to three planning jobs and eight accepted player steps. Keep retries and blocked actions separate from accepted-step count and the permitted cumulative Focus budget. Store typed provenance and safe outcome metrics. The job lifecycle and all late-output conditions are specified in the companion behavior document.

## Dungeon fixture and expected results

Use a fixed layout with rooms and metric traversal points. The player starts at the junction `(0, 0)` m and the scout starts at `(-1, 0)` m. The companion fixture supplies all place bounds, point and edge IDs, initial facts, rules, actor state and evidence. The west entry is known initially. A hidden passage connects the junction to the threshold at `(0, 6)` m. The sentry occupies the adjacent reachable point `(0, 8)` m. Movement budget is six meters. The initial party observes the west entry and junction. A successful authorized scout search can discover the hidden connection and sentry. The report delivers both observations to the party. Use immutable authored IDs for the junction, threshold, sentry point, passage, and sentry.

Initial player values are Focus 4, XP 8, level 4, rank C and zero unspent points. The sentry has 6 HP and a hold profile for the reference branch. The cast uses range three meters, cost 1 Focus and a d20 hit at 12–20 for 3 damage. The clear awards 2 XP once. At 10 XP the qualifying class reaches level 5, gains two allocatable points, and unlocks Ward Step. Rank follows separate criteria and stays C. The author can lock room geometry, specify the encounter rule, reserve the builder's identity, and let the assistant fill the sentry's name, equipment and ordinary capabilities.

| Paper case | Action | Saved or returned result |
| --- | --- | --- |
| **D0** | Publish version 1 and start a run. | Frame 0 uses version 1, Focus 4, XP 8, sentry HP 6, start position `(0, 0)` and initial party knowledge. No accepted event exists. |
| **D1** | Scout searches under its assigned control. | Revision and tick 1. Scout gains passage and sentry facts. The party projection still omits them. |
| **D2** | Scout reports the new discoveries. | Revision and tick 2. Party learns the source-bearing observations. Reveal the existing connection on the same projection geometry. |
| **D3** | Use first step of the exact order to move to the threshold. | Revision and tick 3. Reach `(0, 6)`. Focus, XP and sentry HP stay at starting values. |
| **D4** | Attempt the next ordered move into the occupied sentry point. | Block with a permitted reason. Save the attempt and pause the order at head 3. The prior report and move are still included in the view. |
| **D5** | Replace the remaining order with a two-cast order. First fixed draw is 14. | Revision and tick 4. Focus 3, sentry HP 3, XP 8. |
| **D6** | Second cast fixed draw is 16. Simulate lost response and identical retry. | Revision and tick 5. Focus 2, sentry HP 0, XP 10, level 5, rank C, two points and Ward Step. The authorized retry still names expected head 4 and returns revision 5 and the same draw. Reward and events occur once. |
| **D7** | Allocate 1 agility and 1 perception, then close and reopen. | Revision and tick 6. Each attribute increases by 1 and unspent points are 0. The selected source, head, map, sheet, observations and log match revision 6. |
| **D8** | Replay from head 3 in an independent case with draws 9 then 16. | Two accepted casts spend 2 Focus total. Head 5 has Focus 2, sentry HP 3, XP 8 and no progression change. A later legal hit would produce the reward once. |
| **D9** | Begin a separate run using “Scout the junction and report what you find. Stop before moving the party.” | A valid bounded plan respects control and disclosure. It stops after reporting. Party position and permanent geometry are unchanged through the search and report. |
| **D10** | In another run vary the sentry's permitted observations and standing order. | Holding and a verified-disturbance response differ under the authored policy. The response may move only along a legal route toward an authored alarm point in its budget, and the resulting step has its own event and receipt. |
| **D11** | Publish an approved correction with threshold `(0, 7)` m and sentry point `(0, 9)` m. | Existing sessions still use source version 1. A new run uses version 2. The single 700 cm move exceeds the 600 cm budget. Two 350 cm edges through the authored midpoint allow a legal approach. Both reads use their exact saved layouts. |

For authoring concurrency, approve the precise sentry group at draft head 12. A successful save returns head 13 and a receipt. An identical retry after the successful save returns the existing receipt while access permits. A different new save against head 12 receives a conflict. Change the policy while the proposal is pending. The proposed edit keeps its original review provenance and requires a fresh authorized proposal under the new policy. Revocation must win if serialized before the write. Failure injected before commit makes the previous draft or campaign state the visible outcome.

## Acceptance and release coverage

The rows below define the required capability trace. The companion behavior document contains exact named cases with starting states, input actions and observed outcomes. The fixed JSON fixture supplies versions, data and expected results. Integration, browser and live-model evidence is collected during build and release verification.

| Check | Evidence and expected outcome |
| --- | --- |
| **T01 World access and identity** | Create and reopen a private draft. Follow a linked entry by exact ID with a duplicate display name present. Unassigned private and absent resources yield the same outward shape. |
| **T02 Draft types and relationships** | Save valid actor, room, portal, item, role, fact and rule records. Invalid units, types, occupancy setup or dependencies produce precise errors under authorized view. Reopen by version and inspect linked entries. |
| **T03 Manual and assisted parity** | Author the dungeon through the manual editor and through the scoped assistant. Apply the reviewed group via the same writer, store provenance and validate equivalent playable interiors. Manual authoring uses the authorized manual mode. |
| **T04 Scope, locks and approval** | Reject out-of-scope and reserved changes, modified proposal digests, old scope pins and revoked rights. Exercise manual validation and explicit publish permission separately. After each rejected apply the next read presents the previous draft head. |
| **T05 Publication and historical reads** | Invalid or incomplete sources stay in draft with validation messages. Valid publication returns immutably identified revision. Resume pinned history and compare worlds and timelines in D0 and D11. |
| **T06 Access and context matrix** | Read the scenario as author, player, scout, sentry, unassigned user and worker with task scope. Exercise exact and linked retrieval, older frame and time, prompt context, layout projection and safe rejection in D1/D2/D11. Use the interview claim to check speaker attribution against authoritative fact. |
| **T07 Setup and controller rights** | Create two independent runs from one published version. Assign controller and scout rights and reject a mismatched actor. Reopen source and starting knowledge together. |
| **T08 Orders, clarification and partial completion** | Preserve exact order in D1–D4. Check vague/delegated mode in D9 plus an ambiguous actor and impossible goal. Use revised or cancelled orders to continue without reapplying accepted steps. |
| **T09 Rules and progress** | Confirm D3–D8, including valid miss cost, cast range, actual occupancy, once-only clear, unlock, rank, attributes and bounds. Assert frame and event effects match every accepted receipt. |
| **T10 Transactions, conflict and recovery** | Run parallel new writes and same-request retries with separate database connections. Verify one receipt per accepted request, reject reused key with different normalized payload, simulate rollback and a lost response. Test revoke-before-write and replay after revocation. |
| **T11 View and save/resume** | Verify D2/D3/D7 from React. A token move preserves layout bounds and scale. Display sheet, actor facts and log from one selected revision. Reopening exposes pending work and matches that frame. |
| **T12 Narration and job recovery** | A failed model readout shows the deterministic outcome. A new attempt never changes the accepted event. Exercise expired lease, timeout, invalid output, provider refusal, stale plan and recovery after restart. |
| **T13 NPC policy and role boundaries** | Verify D10 with controlled evidence and one scheduled response. Reopening an owed response resolves once. Walk the deal case through role authority and scoped statements on paper. |
| **T14 Release checks** | Verify private authorized entry, migration and seed order, backup/restore, bounded jobs, app health and documented author/player flows. Restore a saved frame and replay its existing receipt. |
| **T15 Generated behavior quality** | For representative author briefs and ordered/delegated inputs, sample valid output, direction preservation and author repair effort. Exercise injected or misleading prose as data. Review measured latency and cost with the proposed operating limits. |

### Capability coverage matrix

Each inherited playable capability has a design trace and expected acceptance evidence. `1.5.3` advances into the first release under the assisted drafting decision. The first release accepts an author brief and scoped context for that workflow. Broader source extraction and imports retain their later scope. Grouped verification rows above also cover release work such as restore and deployment.

| Capability | Workflow and implementation | Data | Exact acceptance cases |
| --- | --- | --- | --- |
| 1.1.1 Create and reopen | `author.edit`, world list and draft view | World and draft head | T01.1 |
| 1.1.2 Browse linked entries | `context.read`, linked entry routes | Stable scoped IDs and source pins | T01.1, T02.2 |
| 1.1.3 Permissions | `access.check`, world and run access settings | Current grants and policy versions | T01.2, T04.2, T06.2 |
| 1.2.1 Entity types and facts | `author.apply`, typed entry validation | EntityKey, facts and draft document | T02.1, T02.2 |
| 1.2.2 Relationships | `author.apply`, linked edits | Versioned identity references | T02.1, T02.2 |
| 1.2.3 Approved layout | `author.apply`, layout preview, publish checks | Room bounds, traversal points and placements | T02.1, T05.1, T09.3 |
| 1.3.1 Action rules | `author.apply`, `run.resolve` | ActionRule templates and source rule versions | T02.1, T09.1 |
| 1.3.2 Actor knowledge and roles | `author.apply`, `run.start` | Observations and role/control grants | T06.1, T07.1, T13.1 |
| 1.4.1 Publish approved world | `author.publish` | Draft and sealed published revision | T03.1, T05.1 |
| 1.4.2 Read by time and revision | `context.read` and historical view | Frame histories, time bounds, current grants | T02.2, T05.1, T06.1 |
| 1.4.3 Authorized corrections | `author.publish`, parent publication | Exact source and prior revision references | T05.1, T09.3 |
| 1.5.3 Review a bounded addition | `author.draft_assistant`, `model.invoke`, diff and approval | Policy, job, exact proposal group and receipt | T03.1, T03.2, T04.1, T15.1 |
| 1.6.1 Find exact and linked records | `context.read` | Scoped versions and stable IDs | T01.1, T06.1 |
| 1.6.2 Assemble context | `context.read`, `run.plan` | Run/source pins, observation and action context | T06.1, T06.2 |
| 2.1.1 Start from an approved source | `run.start` | CampaignRun and initial RunFrame | T05.1, T07.1 |
| 2.2.1 Choose scoped actions | `run.plan`, `run.actor_decision` | Actor profile, permitted inputs and plan | T08.2, T13.1 |
| 2.3.1 Check action | `run.resolve` | Preconditions and authoritative frame | T08.1, T09.3 |
| 2.3.2 Apply costs and rolls | `run.resolve`, `run.commit` | Draws and typed resource effects | T09.1, T09.2 |
| 2.3.3 Conditional rewards | `run.resolve`, `run.commit` | Pinned threshold, class, rank and reward flag | T09.1, T09.2 |
| 2.3.5 Atomic commit | `run.commit` with world transaction | Event, frame, order cursor, head and receipt | T10.1, T10.2 |
| 2.4.1 Accepted results by viewpoint | `run.project` | Scoped events and frames | T06.1, T11.1 |
| 2.5.1 Conflicting proposals | `run.plan`, `run.commit` | Expected head and scoped dispositions | T08.3, T10.1 |
| 2.5.2 Retry and resume | `run.commit`, `run.resume` | Step receipts, head and order history | T10.2, T11.1, T14.1 |
| 3.1.1 Required ordered steps | `run.plan`, command panel | Typed ordered plan | T08.1, T08.2 |
| 3.1.2 Bounded delegated goal | `run.plan`, model adapter | Guardrails, budget and stop predicate | T08.2, T15.1 |
| 3.1.3 Clarify or pause | `run.plan`, `run.commit`, order UI | Pending plan reason and cursor | T08.1, T08.2, T12.1 |
| 3.1.4 Retrieve turn context | `context.read` | Scoped map, observation and outcome references | T06.1, T08.2 |
| 3.2.1 Session and actor assignment | `run.start`, `access.check` | RunAccess and actor-control grants | T07.1 |
| 3.2.2 Advance encounter | `run.commit` | Step, turn entitlement and clock | T08.1, T09.1, T13.1 |
| 3.2.3 Resources and conditions | `run.resolve`, `run.project` | Effects, frame resources and status values | T09.1, T09.2, T11.1 |
| 3.2.4 Progress and allocate | `run.resolve`, sheet UI | XP, class unlock and spent points | T09.1, T09.2 |
| 3.2.6 Save and resume | `run.resume`, run view | Frame head, fixed source and pending order | T11.1, T14.1 |
| 3.3.1 Inspect permitted actors | `run.project`, sheet UI | Permitted actor facts and observations | T06.1, T11.1 |
| 3.3.2 Inspect log | `run.project`, event API | Ordered accepted event summaries | T06.1, T11.1 |
| 3.4.1 Authoritative map and tokens | `run.project`, map UI | Layout source and frame positions | T05.1, T11.1 |
| 3.4.2 Exploration and fog | `run.project`, scoped map filter | Audience observations | T06.1 |
| 3.5.1 Narrate outcomes | `run.project`, deterministic readout, optional narration job | Accepted effects and permitted references | T09.2, T12.1 |
| 3.5.2 Recover readout | Event API, `model.invoke` | Saved event and separate presentation job | T12.1, T12.2 |

## Build sequence and feasibility

| Build increment | Dependencies and definition of done |
| --- | --- |
| 1. World and access foundation | Set up stack and app interfaces, stable identities, database constraints, accounts and test fixture. Verify world create, manual edit, publication and time/version reads through DRF and React. Covers T01 T02 T05. |
| 2. Deterministic dungeon | Add source-pinned run, controlled actor permissions, context projection, typed orders and transactional engine. Complete D0–D8 and conflict/recovery cases with scripted draws and jobs. Verify T06–T11 and T13. |
| 3. Assisted authoring and command interpretation | Implement versioned generation jobs, provider adapter, guarded requests, validated proposal/diff and planner output. Prove T03 T04 T08 T12 T15 with fixed and real model cases. Link model quality proof to the reliability decision below. |
| 4. Private release | Integrate author and player paths, document setup/controls, package UI and API with Compose, verify status and structured logs, migration and restore, and browser acceptance. Complete T14 and rerun the full suite. |

Start with the Cedar Gate prototype's demonstrated ideas for temporal reads, scoped projections and locked writes. Its results are evidence for those pieces. It is a separate wiki experiment. Port the concepts into the shared world/run ownership and data design above.

### Evidence and decisions

| Uncertainty | Evidence needed and fallback |
| --- | --- |
| Model quality and safe grounding | Use the same dungeon and repeat fully manual, hybrid and minimally specified author briefs, plus ordered and delegated turns. Record proposals that pass schema and domain validation, intent preservation, forbidden proposals blocked, and time spent repairing results. Require every unauthorized write or disclosure attempt in the fixture to be rejected. Use approved templates, tighter scopes and structured player controls to recover from model failures while retaining the core assisted authoring path. |
| Latency and inference cost | Record first useful feedback and completion latency, usage per request, retries, and cost per complete session. Start with targets of job status immediately, one complete typical request within 25 seconds, and deterministic ready-step execution within 500 ms at representative local fixture loads. Measure before agreeing to paid usage and capacity. Use narrower inputs and bounded attempts if the candidate misses its target. |
| Snapshot and query feasibility | Inspect revised-world and run-frame sizes, query plan and restore time with representative larger fixture history. Verify old and new versions give bounded reads. First-release size limits and publishing diagnostics provide a boundary. Normalize hot queries or change storage in a subsequent planned migration when evidence warrants it. |
| Concurrency and reuse | Run real PostgreSQL two-connection tests for receipt races, revoke versus write, rollback and stale proposals. Confirm supported version locks and history with the same cases. Document which invariants Cedar Gate already demonstrated and which are exercised by the new implementation. |
| Later media handoff | Before changing source or event formats, trace versioned entity and layout references, audience, event time and accepted outcome into a panel/shot selection on paper. A media product can choose pacing or reveal order from those references and repeat its source-pinned read. |

Initial deployment uses one private application image with API, inference and deterministic rules process roles and one database. Apply migrations, seed the named QA fixture in a separate environment, validate configured model credentials in the worker, and start the app only after its database is ready. Use structured event codes, timings and request correlation without logging raw sensitive prompts. Verify restore and smoke test the authored dungeon before release.

For solo planning, budget roughly **160–275 focused hours** using the familiar stack, one dungeon, fixture-driven tests, basic private hosting and one hosted provider. That is about 8–14 weeks at 20 project hours per week. This is the initial estimate before implementation evidence. Update it with the first world-and-access increment and provider trials. Budget separately for hosting, backups and inference once the session usage measurement is available.

| Increment | Initial sizing |
| --- | --- |
| World and access foundation | 40–65 hours |
| Deterministic dungeon | 55–90 hours |
| Assisted authoring and command interpretation | 45–80 hours |
| Private release and verification | 20–40 hours |

### Audit closure

| Finding | Exact design reference |
| --- | --- |
| Unclear types, keys and APIs | Companion domain and OpenAPI schemas and PostgreSQL data dictionary |
| Replanned action ambiguity | Immutable plan revision and step ID, advance contract, T08.3 |
| Failed order and job recovery | Order and inference transitions, separate process roles, T12.1, T12.2 and T13.1 |
| Historical disclosure | Session access and projection rules across direct reads, logs, jobs and receipts, T06.1 and T06.2 |
| AI boundaries | Exact proposal digest, guarded encounter draft, verified parse or plan confirmation and deterministic readout |
| Runnable dungeon fixture and later media | Fixed geometry and corrected intermediate route, T09.3 and the D2 scene handoff |

### Design references

- [CGS First Playable Design](https://chatgpt.com/library?file_id=libfile_1c156338e05481919db2c8098e4ae87e&account_id=personal)
- [CGS Cross Phase Design Review](https://chatgpt.com/library?file_id=libfile_aeeb93b5a0308191af5a8ba8b14e6060&account_id=personal)
- [CGS First Playable Architecture](https://chatgpt.com/library?file_id=libfile_cf89f7e938b8819185fac8787ca847a7&account_id=personal)
- [CGS Architecture Design Strategy](https://chatgpt.com/library?file_id=libfile_944afb11292881918bb8578b73cc9b33&account_id=personal)
- [Cedar Gate prototype](https://chatgpt.com/library?file_id=libfile_ddeeb0f10cb08191930208db7ba6f70f&account_id=personal)
