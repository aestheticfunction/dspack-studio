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

## After R0: the independent review (2026-11-25)

The owner accepted the independent review ([R0-REVIEW.md](R0-REVIEW.md)) with conditions, then gave final approval for the M0 remediation. Numbers are the review's section 8. They refine D4, D10 and D14 above and settle N5 and N6.

| # | Decision | Owner's answer | Condition or limit |
|---|---|---|---|
| 1 | Accept R0 with the revisions in the review's section 2 | Accepted | |
| 2 | Make the M0 revisions on the existing draft branches | Accepted | Replay provenance and ancestry; no duplicate or misleading examples; browser and agent paths consistent; availability messaging; production smoke stable with hosted AI on or off; headings; Checks; documents; corpus hash portability |
| 3 | Merge as #117 and one combined trust-fix pull request, in place of five | Accepted | The four original pull requests stay open as review records until the combined one is approved |
| 4 | Trust fixes may ship ahead of the repositioning | Accepted | The merge stays the owner's act; merging to `main` deploys production |
| 5 | Fix the live form-field defect | Accepted | Separately scoped; upstream behaviour confirmed first; no unrelated shared-renderer change |
| 6 | Immutable instances (one instance, one surface); no binding by tracing, I0, rule coverage or in-place updates in M1 (amends D4) | Accepted as the initial strategy | Not a permanent ban on incremental updates; keep entered data, focus and meaningful state across a replacement where appropriate; surface ids unique across sessions and instances; prove each repeated element's payload, not by position alone; separate message correctness from renderer fidelity; keep deterministic governance, version pins, fail-closed behaviour and confirmation of consequential actions |
| 7 | Verification levels 1a, 1b and 2 | Accepted | |
| 8 | Persist nothing before R1a (refines D14) | Accepted | |
| 9 | M1 only up to R1a | Scope accepted | **Implementation not authorized** |
| 10 | Protocol stages P0, P1, P2 | Separation accepted | P0 accepted in principle as a separately scoped task; P1 and P2 not authorized; final A2UI 1.0 remains a public-release requirement |
| 11 | Unified, canvas-first workspace (refines D10; settles N5) | Approved | Refined exploration in `prototypes/composer-workspace.html` |
| 12 | Uploading a Worker version on every branch push | Keep the current branch-build configuration for this milestone | Minimise pushes; how it could be turned off is documented in `docs/deployment.md`; no Cloudflare change authorized |
| 13 | Commit the review | Accepted | Without private links, session identifiers or inappropriate deployment details |
| 14 | Storage before the experimental build writes new shapes | Separate storage keys for the experimental application | Implementation deferred to the appropriate post-R1a milestone |
| 15 | Approved versions and newer drafts of one composition | May coexist | Approved versions are immutable; editing one creates a new draft; implementation deferred |
| 16 | An unbound input field | Keeps its local value for the lifetime of the surface and dispatches nothing | Verified against the pinned and current upstream renderers before the fix; no conflict found |
| 17 | When M1 to R1a and P0 may start | Not until the M0 remediation has been reviewed and verified | Supersedes N6 |
| 18 | One side panel below 1440 px, with the inspector breadcrumb | Keep the prototype's behaviour | Revisit through usability evaluation, not another design exercise |

All architectural conditions recorded above remain in effect.


## Library acceptance and the designer-first refinement (2026-11-26)

The owner accepted the corrected Library and decided the following. #128 (list semantics) and #127 (the Library, with R1 to R4) are merged and verified in production.

| # | Decision | Owner's answer | Condition or limit |
|---|---|---|---|
| 19 | Refine the workspace designer-first (D0) before any authoring | Approved | On the existing workspace; no new shell and no parallel governance; not merged or deployed without further approval. Record: [m1/d0/README.md](m1/d0/README.md) |
| 20 | First-run task T3 | Corrected: "Identify the approved version and explain whether it has been published for external agent consumption" | Passing checks, human approval and future publication stay distinct |
| 21 | Usability evaluation of D0 | Three to five designers, the five tasks ([m1/d0/USABILITY-SCRIPT.md](m1/d0/USABILITY-SCRIPT.md)) | Observations are kept apart from engineering verification. No AI evaluation is presented as a human usability test, and no participant is contacted without the owner |
| 22 | The af-site theme compiler | Intended to graduate into `dspack-gen` as the shared compiler | Subject to explicit licensing, ownership and cross-repository authorization. No duplicate generator, and no private af-site code in this repository. Plan: [THEME-INTEGRATION-PROPOSAL.md](THEME-INTEGRATION-PROPOSAL.md) |
| 23 | AF brand identity, workspace appearance and canvas design-system styling | Kept separate | Workspace themes never modify composition definitions, governance outcomes, design-system tokens or computed canvas styling |
| 24 | Workspace themes | AF dark during D0, as a temporary scope decision | Dark-only is not a permanent restriction. A later increment supports original AF, neutral light, neutral dark and custom themes through the shared compiler |
| 25 | Getting-started documentation | A future requirement: concise getting-started docs with working examples | Not an extensive documentation suite, and not part of D0 |

## The independent D0 audit and D0.1 (2026-11-27)

The owner accepted the independent designer-first audit of D0 as the authoritative review for this increment, with targeted corrections before authoring (D0.1, [m1/d0/d01/README.md](m1/d0/d01/README.md)). The architecture is not reopened, and no further comprehensive review is commissioned.

| # | Decision | Owner's answer | Condition or limit |
|---|---|---|---|
| 26 | Layout criteria | 200 px stays the preferred desktop target at 1280 × 800, for approved **and** draft versions. The phone target becomes a provisional **about 300 px** (was 260). At least 60% canvas at 1280 with one panel | Readable controls come before any pixel target; deviations are reported, never bought with smaller type or targets. One consistent measurement reference before and after |
| 27 | Readability floors in the experimental workspace | 12 px labels and toolbar text, 14 px guide and inspector reading text, 44 px primary phone targets, contrast at least 4.5:1, sentence case preferred, a quieter workspace that recedes behind the design | The solid accent is for meaningful primary actions only. Draft status is said separately from passing checks. The legacy production application is not redesigned |
| 28 | A neutral, customizable working environment | A product requirement before broad external designer evaluation | It covers type scale, face and weight, case and tracking, spacing and density, elevation and borders, semantic status colours, and an independent canvas surround, through the shared compiler plan ([THEME-INTEGRATION-PROPOSAL.md](THEME-INTEGRATION-PROPOSAL.md)), subject to its own authorization |
| 29 | The Compositions panel and first run | The list comes before the guide, which stays compact and expandable and can be hidden at any time | Usability task 1 names Hotel results and still starts on Projects. A minimal contextual Library entry on the experimental Projects page is allowed; no landing-page redesign |

## D0.1 acceptance and the first authoring increment (2026-11-27)

The owner accepted D0 and D0.1 as the experimental workspace foundation. #129 is merged and verified in production. Engineering acceptance is not human usability validation: the sessions are still to be held.

| # | Decision | Owner's answer | Condition or limit |
|---|---|---|---|
| 30 | D0.1's layout trade-offs | Accepted | Readability, target sizes and hierarchy come before canvas-position targets. Kept: sentence-case workspace type, the minimum sizes, contextual onboarding, list prominence, the checks, approval and publication distinction, plain refusals, progressive disclosure, canvas first. Measurement references stay consistent |
| 31 | Composition authoring A1 to A4 | Authorized after #129's production verification | Extend the workspace; no parallel editor, pipeline or shell. No template editing, input or action declaration, block promotion, Playground, publication, theme work or paid inference. Not merged or deployed without approval. Record: [m1/authoring/README.md](m1/authoring/README.md) |
| 32 | An authoring walkthrough for designers | Prepared alongside the first-run script ([m1/authoring/AUTHORING-WALKTHROUGH.md](m1/authoring/AUTHORING-WALKTHROUGH.md)) | Human observations kept apart from tests and AI assessments; no one recruited or contacted; it may run alongside development |
| 33 | Authoring before the shared theme compiler | Accepted | The neutral, customizable workspace stays a requirement before broad external designer evaluation (decision 28). The compiler's graduation into `dspack-gen` stays subject to its own authorization |

## A1–A4 acceptance and shared workspace theming (2026-11-27)

The owner accepted A1 to A4. #130 is merged and verified in production. The shared theme compiler and a customizable workspace come next, before structure authoring. Record: [m1/appearance/README.md](m1/appearance/README.md).

| # | Decision | Owner's answer | Condition or limit |
|---|---|---|---|
| 34 | **Approval withdrawal** | A requirement, recorded now; implementation deferred | An approved definition stays immutable, but its authorization can be withdrawn. Withdrawal keeps the exact version and its history, stops any later authorized consumption and invalidates runtime authorization. Restoring approval needs an explicit human decision. It never silently authorizes a fallback version. It is distinct from supersession. Packaged and local (this-device) approvals stay distinct. **Implemented before external agent consumption or publication** |
| 35 | Workspace theming before structure authoring | Accepted | Template and tree editing, input and action declaration, and block promotion wait for T1 to T4 |
| 36 | The theme compiler graduates into `dspack-gen` | Approved under Apache-2.0, AF keeps ownership (T1, `dspack-gen` 0.6.0, published 2026-11-27 with npm provenance) | Only the compiler, its schema, constraints, solver, tests and documentation move. af-site stays private; no other af-site code, asset, font, credential or configuration moves. The optional hosted natural-language theme generation stays out, and no paid inference is added |
| 37 | One compiler, pinned exactly | af-site (T2) and Composer (T3) consume it; the canvas design system stays independent | Pinned to `npm:@aestheticfunction/dspack-gen@0.6.0` (to the reviewed commit until publication). No consumer copies, forks or re-implements it. Publishing the package needs the owner |
| 38 | Workspace appearances (T4) | Aesthetic Function, Ember and Slate stay; Neutral dark, Neutral light and Custom are added, with density, text size, label case, header type and canvas surround | Experimental build only. Kept as a user preference: a validated closed-enum proposal, never token values. The three governed themes keep `composer.appearance.v1`. Inclusion in project export is deferred. Deterministic controls only; no natural-language generation |
| 39 | What an appearance may never change | Composition definitions, hashes, governance outcomes, approvals, check records, design-system tokens, the canvas's computed styling, and the colour scheme Astryx or shadcn/ui surfaces inherit | Held by test (`e2e/composer-appearance.spec.ts`) |
| 40 | Usability enhancements for later | Side-by-side version comparison, and a mobile preview of a composition | Recorded only; not scheduled |

Still deferred: template and tree editing; input and action declaration; block promotion; the Playground; publication and execution; protocol tracks; paid inference. Synthetic data only.

## Shared theme compiler acceptance and release (2026-11-27)

The owner accepted T0 to T4 as implemented and authorized the sequential release: `dspack-gen` #60 merged and published as 0.6.0, then af-site, then Composer, each pinned to the published package. Record: [m1/appearance/README.md](m1/appearance/README.md).

| # | Decision | Owner's answer | Condition or limit |
|---|---|---|---|
| 41 | Provenance comments in the released compiler | Kept, citing AF's internal decision-record identifiers | Identifiers only: no record contents, sensitive information or credentials. Byte-identity with the incubation compiler is preserved |
| 42 | The six workspace appearances and the five workspace choices | Kept | Experimental only. Readability, accessibility and phone interaction requirements still apply; appearance stays independent of the design system's styling and never alters definitions, governance outcomes, approval records or computed canvas styling. Human visual and usability acceptance is still outstanding |
| 43 | Approval withdrawal (decision 34) | Scheduled before external agent consumption and publication | Withdrawal never mutates or deletes the approved definition |
| 44 | Side-by-side version comparison and mobile split-preview authoring | Future usability enhancements | Neither is a prerequisite for the next advanced-authoring increment |

## Theme integration closeout and advanced composition authoring (2026-11-27)

The owner accepted the shared theme compiler release and its integration: dspack-gen 0.6.0 at `cd8755d`, af-site #131 at `18ca634`, dspack-studio #131 at `c40c83e`. Human visual and usability acceptance remains outstanding. The next increment, interaction authoring, is recorded in [m1/interaction/README.md](m1/interaction/README.md).

| # | Decision | Owner's answer | Condition or limit |
|---|---|---|---|
| 45 | af-site production deployment | A merge to af-site `main` deploys production automatically (Workers Builds), as #131 did | Future merge authorizations for af-site are deployment authorizations; the manual `deploy.yml` is no longer the only path |
| 46 | dspack-gen 0.6.0 changelog wording ("0.6.0 — unreleased") | Corrected in the next appropriate release | No version is published only to correct it |
| 47 | Interaction authoring | Authorized on an isolated branch: Structure view, canvas selection, contextual input and action authoring | Extends A1 to A4. No parallel schema, editor, shell or pipeline; no layout or template-tree editing; not merged or deployed without approval |
| 48 | Element identity | Definition-level: a template node's literal id, or its state and template path | Rendered ids are never stored or used as identities; which item was picked comes from the instance's own binding evidence |
| 49 | Private (sensitive) fields | A private field is masked on screen (the contract's `type: "password"`), and a version with an unmasked private field is not approved here | The packaged approved Hotel search v1 is immutable and stays unmasked; its drafts must mask before approval |
| 50 | Safeguards in the editor | A confirmation cannot be turned off; a consequential action sends fixed values only; a repeated action sends its own item's values only | The editor never relaxes a safeguard; the host's stale-action refusal, once-per-surface and idempotency are unchanged |
| 51 | Declarations are unique | One input per name and per node, one action per name and per node, an action named as the emitter names its node | Added to the core loader; every packaged composition already complies |
