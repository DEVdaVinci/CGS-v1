# CGS sprint checkpoints

## User instructions and approval

- Follow the owner's explicit requirements for scope, sequence, design, and completion. A previous assistant plan, implementation, or test suite records progress. Use the owner's instructions to resolve any conflict with those artifacts. Flag the conflicting text so it cannot silently govern the next sprint.
- Treat exploratory examples as tests of the general-purpose world model. Preserve the full source requirement when planning an increment. For Wiki design, apply the owner's Lucidchart documents and conversation decisions first, World Anvil second, and Fandom third. Add compatible features from the references.
- Ask a focused question when a genuine ambiguity affects the deliverable. Get explicit approval before a material departure, including changing the requested sequence, deferring a requested feature or UI change, substituting a prototype, or changing a source-backed field or relationship's meaning. State the proposed change, why, what the owner would see, and its downstream effect. General approval to proceed covers the stated scope. A departure needs to be identified when asking for approval. Make routine implementation decisions within the agreed scope.

## Before coding and before reporting completion

- In the existing milestone or sprint notes, tie every affected requirement to the owner's source or explicit decision and a verifiable result. State the browser starting point, what the owner will see and be able to do, and any approved deferrals. Identify a deferral's real prerequisite or state that it is a sequencing choice. If a source is unavailable, mark the affected requirement unverified and resolve any ambiguity that changes the deliverable.
- For Wiki UI work, design the affected pages, navigation, layout and workflows first. Use World Anvil for the relevant builder workflows and Fandom for the relevant encyclopedia workflows, with original CGS styling and the owner's world-model decisions as authority. Deliver a working piece of that structure with its required Django and PostgreSQL support. Define the requested visual differences against the shipped screen and verify them in the browser.
- Verify the agreed workflow through the normal browser entry points. For a visual change, inspect the actual affected screen against the design. For a write, inspect what was saved and reopened. Include alternate entry points affected by a shared change. Record the build and tested cases, including whether checks ran against a disposable environment or the local rollout.
- Report delivered, partial, deferred, and unverified requirements by name or check ID. A milestone closes after its agreed requirements have evidence. A fixture or a passing suite establishes the cases it exercises. Keep the open status visible in the plan and in the handoff.

## GitHub delivery

After each coding sprint, review the changed files, commit the sprint with a detailed message, and push the feature branch to the configured GitHub origin. Include the implemented behavior, relevant design decisions, and verification results in the commit message. Check that the remote branch points to the commit and report the branch and commit ID. Report any open or unverified milestone checks with the sprint result.

## Wiki design and implementation

Use the [Wiki source trace and design decisions](docs/CGS_Wiki_Reference_Design.md#source-trace-and-design-decisions) for each affected entity, field, connection, or reference workflow. Record the rationale and immediate and long-term impact of each departure. A deferred design item needs its target and prerequisite. Temporary behavior also needs its replacement and saved-data path. Show the [browser, service and storage evidence](docs/CGS_Wiki_Reference_Design.md#delivery-order-and-proof) for the pass.
