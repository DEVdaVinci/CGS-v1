# CGS First Playable Implementation Contracts

Use this package with the revised CGS First Playable Technical Design and editable architecture. It specifies the first release from authoring one private dungeon through a saved tabletop run. It contains design contracts and test data.

| File | Authority |
| --- | --- |
| `openapi.json` | Wire requests, projected responses, route parameters, status codes and format definitions for the Django/DRF and React boundary. |
| `domain.schema.json` | Versioned authored, draft, plan, frame, event and provider record shapes, including discriminated variants. Its default type is the published world source. Select other named types through `$defs`. Pending drafts have nullable whole layout/start values and may omit publish-required entry properties. |
| `Persistence.md` | Normative PostgreSQL table fields, scope keys, deferred heads, indexes and uniqueness rules. |
| `Behavior_and_Acceptance.md` | Authority checks, precise state transitions, game rules, recovery, acceptance cases and presentation handoff. |
| `dungeon_fixture.json` | Stable test UUIDs, public and secret fixture records, two approved geometry versions and independent deterministic branches. Keep the fixture source in the verification environment and use scoped projections in the client. |

Use the schema types at the authority they describe. Shape validation, referential integrity and safe projection are independent checks. A patch's value is validated through its registered JSON pointer and the full resulting typed record. UUID aliases in a pending group are resolved by the writer before storage. Provider packet shapes normalize into the validated application record. For generation, use the configured provider's supported schema subset and apply the complete app-side schema and behavior validation after return. The optional readout adapter selects approved safe templates; authoritative game facts come from the saved result.

The fixture uses centimeters, stable IDs and a fictional tick starting at zero. D1–D7 form the reference sequence. The miss branch starts at reference head 3. The corrected branch uses an independent v2 run and starts after that run's own SEARCH and REPORT. The alert variants use independent v1 instances with a configured sentry response and begin with a legal scripted miss at head 3. Test orchestration allocates distinct request keys and inserts the expected run and plan pins; IDs in the fixture are domain entities, layouts, rules and facts, not the IDs of real sessions.

During design verification, validate the schemas, resolved IDs, reference and alternative fixture traces, current scope and the diagram relationships. During build verification, exercise real database races, job leases, scoped HTTP responses, browser recovery and the measured provider workload. See the technical design for the build increments and 38-capability trace.
