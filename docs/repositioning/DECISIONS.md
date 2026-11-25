# Decision register

Product-owner decisions on the Composer repositioning, recorded 2026-11-24, with the conditions attached and what M0 found that bears on each. The full analysis each decision was made on is in PROPOSAL.md, section F. These decisions do not authorize M1 or any later milestone.

| # | Decision | Condition or limit | M0 evidence since |
|---|---|---|---|
| D1 | Accepted: interface blocks evolve into compositions | | ADR draft R1 |
| D2 | Accepted: the interaction boundaries evolve | Composer stays an authoring, simulation, governance and publishing environment, never a production workflow execution platform | ADR draft R2 |
| D3 | Accepted: project-level interaction contracts | | ADR draft R3 |
| D4 | Accepted: expansion-first instantiation with verified bindings | Later data updates must not get around governance, with negative tests | ADR draft R4 sets the three rules and the tests; the Playground exploration shows a refused agent update |
| D5 | Accepted: Astryx as contracted (D5a) is the initial reference | D5b investigated and documented only; owner-authored purposes for the vertical identified | ASTRYX-D5B.md: two purposes needed (`loading-state`, `status-feedback`), one ruling (is a booking `destructive-action`?) |
| D6 | Accepted: staged protocol migration | Verified final A2UI 1.0 is required for the revised public release; 0.9.1-only during experimental development | PROTOCOL.md: 0.9.1 output passes an independent validator (17 of 17); the "1.0" output fails final 1.0 three ways and is upstream work |
| D7 | Accepted: AG-UI upgrade and live agent execution deferred | | |
| D8 | Deterministic and offline baseline only | A separately costed live evaluation proposal | BASELINE.md; LIVE-EVALUATION-PROPOSAL.md proposes a pilot of about $1 under a $5 ceiling |
| D9 | Accepted in principle: model tiering experiment | Execution and cost need separate authorization | Folded into the pilot's decision table |
| D10 | Accepted as a direction for prototyping | Not a final UI specification; three workspace approaches explored first | UX-EXPLORATION.md and the clickable prototype: recommends one workspace with three coordinated views |
| D11 | Accepted: experimental rollout | | |
| D12 | Cross-repository investigation and RFC drafts only | Implementation needs separate approval | M1 scope lists the drafts |
| D13 | The name Composer is kept | Qualified as Aesthetic Function Composer where appropriate | |
| D14 | Accepted in principle: IndexedDB persistence | Migration and backward-compatibility strategy reviewed before implementation | M1 starts with that design, not the migration |
| D15 | M0 on a working branch | Release freeze and production deployment boundaries stand | Five draft pull requests, nothing merged or deployed |
| D16 | Accepted: deterministic task-completeness checks | Supplemented by offline evaluation rubrics | The pilot's task-fit checklist is such a rubric |

## M0 execution choices made by the owner

| Date | Question | Answer |
|---|---|---|
| 2026-11-24 | How to package M0's pull requests | Separate branches, one draft pull request per concern |
| 2026-11-24 | May the Cloudflare configuration be read to verify the hosted AI cause | Yes, read-only (GET requests only) |

## Decisions now needed (for R0)

| # | Decision | Recommendation | Why now |
|---|---|---|---|
| N1 | Whether hosted AI should be turned back on, and for whom | Re-apply Access first, or accept public generation bounded only by the gateway's daily limit (HOSTED-AI-AVAILABILITY.md) | The public site can only replay samples today |
| N2 | Authorize the live pilot | Yes, at $5, after N1 | Every model-dependent threshold is provisional without it |
| N3 | Ship the example-integrity review (detect, then keep, restore or leave out) | Yes, in M1 | Existing projects may hold mis-attributed examples; fix (a) only stops new ones |
| N4 | Author `loading-state` and `status-feedback` for the Astryx project, and rule on whether booking is `destructive-action` | Author both; booking is not destructive | Needed before the hotel vertical's state surfaces exist |
| N5 | Adopt "one workspace, three coordinated views" | Yes, as the prototyping direction for M1 | Settles the Compose layout before M1 builds it |
| N6 | Authorize M1 as scoped in M1-SCOPE.md | | Stop point |
