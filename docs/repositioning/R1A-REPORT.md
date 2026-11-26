# R1a report: interoperability and governed composition

**Status:** delivered 2026-11-26; reviewed independently the same day ([R1A-REVIEW.md](R1A-REVIEW.md)) and accepted by the owner with targeted revisions. **Corrected** after that review (section 2): six code corrections, each with a test that failed first, four evidence replacements, and the reporting below. M1 stops here, at R1a, for the owner's final merge decision. No hosted AI, paid inference or sibling repository was involved in R1a.

## 1. Result

The two riskiest claims of the repositioning hold on this stack.

1. **One definition, many governed instances.** Two compositions (hotel search, hotel results) were instantiated across nine data sets and a recorded walk. Every instance passed S1 to S3 under its state's purpose, A1 to A3 for both A2UI versions, and a binding-layout check. Data the rules refuse is refused with the rule's own rationale: a single result fails `rule.review-offers-alternatives`, "A choice of one is not a comparison". Nothing in a template names a hotel.
2. **Rendering outside Composer.** The messages pass upstream's own Python implementation under strict validation (levels 1a and 1b, 55 checks with expectations derived from the data), and a recorded walk replays through one long-lived processor in both upstream implementations. They render, accept typing and send what the data says in a standalone host on upstream `@a2ui/react` 0.16.1 (level 2), and identically on Composer's own canvas.

The k-th repeated button is proven to send item k's payload four ways:
- by structure;
- by witness;
- by a property test;
- by pressing the drawn buttons in two renderers.

The host refuses:
- stale actions;
- duplicate confirmations;
- forged or tampered payloads;
- consequential actions outside their confirmation step;
- invalid inputs;
- any action after a rule it depends on changes, until a re-check passes;
- any action on a surface governed under rules other than the current approval's, even after a re-approval.

One mismatch between the contract and a component was found (section 6). The contract requires each option card's `label` and treats it as the option's visible name; Astryx's `SelectableCard` renders it as an accessible label only, as designed. The owner approved drawing it as a visible heading in Composer's renderer adapter, separately (decision D1).

**Recommendation:** #122 is ready for the owner's final merge decision once PR #123 (the deployment-security correction) has merged. Then proceed with the remainder of M1 as recommended in R1A-REVIEW §9, starting with the host-hardening follow-up (section 10).

## 2. Independent review and corrections

The independent review ([R1A-REVIEW.md](R1A-REVIEW.md)) accepted R1a with targeted revisions. Every finding in its Part A is now resolved. Each code correction has a regression test in `packages/composer-core/src/compositions/corrections.test.ts` that failed against `3036584` (`spikes/r1a/evidence/failing-first.txt`: 8 of 8 failed).

| Finding | What was wrong | Disposition |
|---|---|---|
| H1 | After a re-approval under changed rules, a surface governed under the old rules ran again | **Fixed.** `act` refuses unless the current surface's pins equal the current approval's pins; the surface must be replaced (`host.ts`) |
| H2 | A governor held the caller's contract by reference, so an in-place edit changed the rules without changing the pin | **Fixed.** The governor snapshots and deep-freezes its contract and profile (`governance.ts`) |
| M1 | Two overlapping `show` calls orphaned a surface | **Fixed.** Replacements run one at a time; each batch deletes the surface actually shown (`host.ts`) |
| M2 | Two literal ids that emit the same id bound the wrong field, silently | **Fixed.** Refused at load (`load.ts`); a declared node the emitter renames is refused at instantiation (`instantiate.ts`) |
| M5 | The 0.1 upcast dropped block constraints | **Fixed for constraints:** carried and checked through the composition path (`load.ts`, `expand.ts`). Block **actions** are still not mapped, so upcast blocks are expansion-compatible, not instantiation-compatible (section 10) |
| M6 | A consequential action could carry typed input | **Fixed.** Refused at load (`load.ts`) |
| E1 | Two "garbage changes nothing governed" checks compared values a write cannot alter | **Replaced.** Level 1b resolves every property of every component before and after the writes, with a positive control that sees the bound input values change. The host test now asserts the refusal, and the binding layout gets six negative tests (`instantiate.test.ts`) |
| E2 | The structure test used the implementation's own traversal | **Replaced** with the test's own traversal |
| E3 | Levels 1b and 2 took expected payloads from the implementation's action table | **Replaced.** Expectations come from the data and the page's structure: the control in the k-th drawn option card sends `data.hotels[k].id`, a confirmation sends `data.selection.id`, a search sends what was typed. A negative control (two hotels swapped in a copy of the data) fails exactly those two checks |
| E4 | No replacement walk through one long-lived processor | **Added**, in both upstream implementations (`evidence/level-1.json`, `evidence/level-1-web-core-walk.json`) |
| A8 | Reporting | This report, ADR R1 and R4, the pilot report's task-fit correction, and the committed review |
| A9 | No test held the composition runtime out of the applications | **Added:** `apps/composer/lib/compositions-isolation.test.mjs` (shown to fail when an import is added) |

Part B of the review (host hardening) is separately authorized and not started. Its recommended scope is in section 10.

**PR #121** (the live pilot) merged on 2026-11-26 at `a09e1b0`, as `1b3b08e`. Its automatic deploy exposed hosted generation for about 1 minute 44 seconds, with no generation requests. The incident and its prevention are recorded separately in `docs/incidents/2026-11-26-hosted-ai-inherited.md`, on PR #123.

## 3. Amended decisions

The ADR amendments from R0-REVIEW §6.1:

- [R4](adr/R4-expansion-first-instantiation.md) is rewritten: instance identity, repeated-element identity, input binding, payloads, replacement, renderer assumptions, pins, verification levels.
- [R1](adr/R1-composition-as-evolved-block.md) and [R2](adr/R2-lifting-the-data-boundary.md) carry amendment notes: sidecar 0.2, and the narrowed data boundary.

None introduces a mechanism the owner has not approved. Four points were flagged for review. The independent review accepted all four, and the owner's decisions are in [R1A-REVIEW.md](R1A-REVIEW.md) §10 (F1 as D5, F3 as D4).

| # | Point | What the spike does | Why |
|---|---|---|---|
| F1 | Carrying entered values across a **state** change within one composition | Carried (search `ready` to `invalid`). Across compositions, nothing is carried | R0-REVIEW §3.2 said a state change carries nothing. The invalid state exists to show an error next to what the person typed, so dropping it would defeat the state. The owner's condition was "where appropriate". A clarification, not a new mechanism |
| F2 | A3 runs with a cached validator | Same algorithm as dspack-emit's gate 3, compiled once per contract and profile. `instantiate.test.ts` proves the same verdict, instance by instance, as `validateCatalog`, for valid and broken messages | Uncached, the gates alone take 51 ms (p50) per 20-item instance, over the 50 ms budget (A12). Adds `ajv` and `ajv-formats` as declared dependencies of `composer-core`; they were already in the tree through dspack-emit |
| F3 | The empty state's purpose | `data-collection` (a "search again" field and button) | Astryx has no purpose for empty or result states (ASTRYX-D5B.md). A vocabulary gap, recorded rather than worked around in the contract |
| F4 | Version coexistence (A10) | Explicitly deferred: the loader refuses two compositions with one id | Owed before any "draft, approved, v-number" interface |

## 4. What was built

All under `packages/composer-core/src/compositions/`. It is exported only as `@dspack-studio/composer-core/compositions`, and nothing in `apps/` imports it.

| Module | Contract |
|---|---|
| `schema.ts` | **Sidecar 0.2:**<br>- parameters, data, inputs (text, date or integer, with bounds), actions (repeat, witness, literal payload, carried inputs, consequential), states (purpose, closed guard, template) and scenarios;<br>- prop specs are checked by the 0.1 parser, so the value-type language stays one language |
| `load.ts` | **The dispatcher:**<br>- 0.1 is upcast in memory and never rewritten;<br>- 0.2 is parsed and bound to the base contract's digest;<br>- load-time checks: inputs are text fields outside repeats; a repeated action's list holds exactly one `$each` yielding one node per item; per-item payloads read only the item; purposes exist; ids are unique |
| `expand.ts` | Data and parameter validation; state selection by guard (first that holds; a requested state only if its own guard holds); expansion through the block expander unchanged; per-item payload and witness evaluation |
| `governance.ts` | S1 to S3 injected (dspack-gen `lintSurface`); emit with the instance's `surfaceId`; A1 and A2 once per contract, profile and version; A3 per instance against a cached validator |
| `bindings.ts` | The two attachments; the structural and witness proof of item association; the binding-layout check |
| `instantiate.ts` | The pipeline with per-stage refusals and timings; pins; `surfaceIdFor` |
| `host.ts` | Approvals by re-check; pins; `show` (replacement, carried values, focus, announcement, the last valid instance kept on refusal); `act` (the seven refusal codes) |

The compositions, data sets and evidence script are in `compositions/spike/`. The standalone host is in `docs/repositioning/spikes/r1a-host/` (section 6).

## 5. Data sets and negative tests

Data sets for `hotel-results` (synthetic Lisbon hotels):

| Set | Outcome |
|---|---|
| Three | Instance, `ready` under transactional review; 3 buttons, payloads h-101, h-102, h-103 by structure |
| Two | Instance; 2 buttons |
| One | **Refused** at S3 by `rule.review-offers-alternatives`, with the rule's rationale; nothing emitted; the last valid instance stays |
| None | Instance, `empty` under data collection, selected by its guard |
| Reordered (the three) | Instance; payloads follow the new order (h-103, h-101, h-102); the k-th drawn button sends the k-th hotel now on screen |
| Removed (the middle one) | Instance; 2 buttons, h-101 and h-103 |
| Twenty | Instance; 20 buttons, all associated |
| Duplicate names | **Refused**: two items render the same name, so a person could not tell them apart (I3) |
| Confirm (a selection) | Instance, `confirm` under destructive action; `reserve` consequential with the selection's literal payload |

`hotel-search` was also instantiated in its `ready` and `invalid` states, with entered values carried.

Negative tests. Each is refused, the last valid instance stays, and the reason is recorded. All are in `host.test.ts` unless noted; the recorded walk is in `evidence/walk.json`.

| R0-REVIEW §3.4 and §7 path | Test |
|---|---|
| Stale action | An action from a replaced instance gives `stale`; the current surface is unchanged |
| Duplicate confirmation | A second `reserve` on the same surface gives `duplicate` |
| Consequential action without its confirmation step | A forged `reserve` from the results surface gives `needs-confirmation` |
| Unauthorized | An undeclared action name, or a declared one from another component, gives `unauthorized` |
| Tampered or extended payload | Another hotel's id, or an extra key, gives `payload-mismatch` |
| Invalid inputs | A short destination, an impossible date, free text for a date and 12 guests give `invalid-input`, with each field's reason |
| Local renderer writes | Garbage written into `/input/destination` and over `/input` itself:<br>- changes no resolved property except bound input values (level 1b, every property of every component, with a positive control);<br>- the next search carrying it is refused as `invalid-input`;<br>- the binding layout refuses six ways a governed property could read `/input` (`instantiate.test.ts`) |
| Collection changes | Three, then two, then the same three reordered:<br>- each screen is byte-equal to a fresh emission;<br>- each button's payload names its own item (`instantiate.test.ts`) |
| Parent-path updates | Static check on the recorded walk: no `updateComponents` or `updateDataModel` reaches a surface already shown; exactly one `updateComponents` and at most one `updateDataModel` per surface, in its creation batch |
| Rule-dependency change | Editing `rule.review-offers-alternatives` to require four options:<br>- `show` and `act` give `needs-recheck`;<br>- the re-check fails for "three" and "two" and restores nothing.<br>An edit that keeps every scenario passing is restored by its re-check |
| Re-approval under changed rules (H1) | A rule the scenarios never exercise makes the twenty-hotel surface fail; the re-check passes and re-approves; an action on the old surface gives `needs-recheck` until it is replaced (`corrections.test.ts`) |
| In-place rule edit (H2) | Editing the caller's contract object after the governor is made changes nothing it decides (`corrections.test.ts`) |
| Concurrent replacement (M1) | Two overlapping shows: each batch deletes the surface shown before it; none is orphaned (`corrections.test.ts`) |
| Identity | 12 instances across 3 sessions: 12 distinct surface ids |
| Replacement | Within a composition, values and focus are carried; inside a repeat, focus follows the same payload, or goes to the heading when that item is gone; across compositions, nothing is carried and focus goes to the heading |

**Repeated-element identity, four ways** (`instantiate.test.ts`):
- **structure:** item roots are the list's ordered SelectableCards, and no button sits outside them;
- **witness:** item k's subtree renders its name and no other item's;
- **property test:** 60 seeded trials over 2 to 16 items, four item shapes and injected duplicate names; every run was associated correctly or refused for duplicates, with no misassociation;
- **behaviour:** level 2, below.

## 6. Independent verification

| Level | Claim | Result |
|---|---|---|
| 1a | **Messages are correct** | Upstream Python `a2ui-core` (A2UI repository at `1dbe86a`) loads the 0.9.1 catalog and accepts all 9 instances' creation batches under strict validation |
| 1b | **Messages are correct** | The same implementation, 55 checks, all pass:<br>- each input resolves its bound value from the creation batch, then a typed value;<br>- each of the 40 actions dispatches what the **data** says it must (the k-th list child sends `data.hotels[k].id`; a confirmation sends `data.selection.id`), with carried inputs as typed;<br>- with every property of every component resolved before and after garbage writes into `/input`, only bound input values change, and a positive control confirms the comparison sees those changes |
| 1b' | **Messages are correct, across replacements** | The recorded walk (5 replacements) replayed through **one** long-lived processor, in upstream Python `a2ui-core` and in `@a2ui/web_core` 0.16.1: after each batch exactly one surface is live, the new one, and its first option card sends the new data's first hotel (after the reorder, `h-103`) |
| 2 | **Renderer fidelity**, for the renderers tested | Two stacks, identical results:<br>- **A standalone host outside `apps/composer`:** upstream `@a2ui/react` and `@a2ui/web_core` 0.16.1, Composer's Astryx renderer files unchanged, and a bridge written for the spike (`Catalog.fromJson`, `createComponentImplementation`, and the bound-setter rule);<br>- **Composer's own canvas:** `a2ui-ingest` on the pinned 0.10 stack.<br>On both: every input accepts typing and keeps it (9 of 9); every control, found in drawn order, sends what the data says (40 of 40); the control in the k-th drawn option card is item k's; no page errors. Of 288 governed literals, 249 are drawn as visible text inside their own component and 39 only as an accessible name or attribute |

The 39 not drawn as visible text:
- **The 30 `SelectableCard.label` values (the hotel names): a mismatch between the contract and the component.** The renderer is faithful: it passes the label to Astryx's `SelectableCard`, which documents it as an accessibility label and renders it as `aria-label`, by design. The contract treats the same label as the option's visible name (`rule.option-carries-label`: how an alternative is "identified, compared, and announced"). So no gate can see that it is not drawn. In the hotel cards the name is visible only because the composition repeats it in the button label. It predates R1a: the contract's own plan-comparison example and the live pilot's hotel surfaces show unnamed cards too, and the pilot's task fit has been corrected for it. The owner approved drawing the label as a visible heading in Composer's Astryx renderer adapter, as a separately scoped correction (D1).
- **The 9 placeholders** are attributes by nature, as expected.

**What each level does not show.** Level 1 says nothing about pixels. Level 2 covers these two renderers, the 12 Astryx components and the 0.9.1 envelope only. A2UI 1.0 messages are not claimed; that is protocol track P1.

## 7. Performance (R0-REVIEW A12)

Measured in Node 22, `evidence/performance.json`, regenerated after the corrections. Figures vary with machine load; the first run measured 2.58 ms and 219 ms.

| | Budget | Measured |
|---|---|---|
| Warm `instantiate`, 20 items, 95th percentile | 50 ms | **4.04 ms** (p50 2.05 ms, n = 200) |
| Cold: governor setup plus the first 20-item instance | 500 ms | **240 ms** (setup 207 ms, first instance 33 ms) |
| Warm, 3 items, 95th percentile | | 0.96 ms |
| The same 20-item instance with uncached A gates, both versions | | 74 ms p50, 85 ms p95: over budget, hence F2 |

Not measured in a browser.

The demonstration runs the same pipeline in the browser. Instantiation runs in the browser, Node and, later, ds-mcp; never in the Worker.

## 8. Regression and CI

Run locally on `claude/m1-r1a` after the corrections, with `main` (including #121) merged in.

| Suite | Result |
|---|---|
| Workspace unit tests (`pnpm test`) | All pass:<br>- composer-core 523, including the 58 compositions tests;<br>- apps/composer 526, including the isolation test;<br>- block-bench 292, including the Phase 1B goldens and request-hash ratchet, unchanged;<br>- every other package |
| Workspace typecheck | Clean |
| Upcast equivalence | Every packaged example in both the Astryx and shadcn/ui v3 sidecars expands byte for byte as the block expander does |
| Unchanged | The Gateway corpus and its goldens, the default catalog export, the replay fixtures, `apps/composer`, the Worker, the renderers, `a2ui-ingest` |
| Default build | Imports nothing from `compositions/`, held by `apps/composer/lib/compositions-isolation.test.mjs`. The built bundle itself was not inspected. The lockfile adds `ajv` and `ajv-formats` to composer-core, plus the dev-only `dspack-gen` and `tsx` |

GitHub CI on the PR is reported in the PR.

## 9. Pilot findings, sorted (from LIVE-PILOT-REPORT.md)

| Category | Pilot finding | Where it stands after R1a |
|---|---|---|
| **Data consistency and interaction: R1a lays the foundation** | Steps invented their own hotels and prices; no button carried an action; list items were told apart only by position | Compositions take data at instantiation, so one data set drives every screen; buttons carry literal payloads proven per item; inputs are bound and validated. Wiring this into flows and the Playground is later M1 work |
| **Task completeness and semantic planning: later work** | A card asked for and a table produced (corpus 10); "convert to project" planned as "convert to invoice" (corpus 5); one hotel flow without an explicit confirmation | Not addressed by R1a. Needs the task plan, plan checks and completeness checks beyond I3 (M1 step 14 and after). R1a's I3 refusal for indistinguishable items is the first completeness check, not the whole of it |
| **Astryx vocabulary gaps** | No date, number or select input; no purpose for empty or result states | Unchanged, and confirmed again: dates and guests are text inputs validated by the host by kind; the empty state borrows data collection (F3) |
| **Model-generation weaknesses not yet isolated** | Seven repairs whose cause the pilot did not record | Not addressable without the first-attempt gate-failure evidence the pilot report now requires; no model was called in R1a |

## 10. Acceptance criteria as they stand, limitations and next steps

The R0-REVIEW §7 criteria for R1a, after the corrections:

| Criterion | Status |
|---|---|
| Every screen in a recorded walk equals a fresh governed emission | **Verified** for the messages: byte-equal re-emission, and a one-processor walk in both upstream implementations. Renderer replacement inside one React session is not separately evidenced (the pages mount a processor per batch) |
| No updates to a surface already shown | **Verified** (static transcript check; one live surface after every batch) |
| The five §3.4 paths each have a negative test | **Verified** (stale, renderer writes via the binding layout and level 1b, parent-path updates, collection changes, rule-dependency changes including H1 and H2) |
| One result refused with its rule's reason; none selects the empty state | **Verified** |
| Each button names its own item, shown four ways | **Verified** (own traversal, witness, property test, data-derived behaviour in two renderers). The witness is satisfied by the button label; the card's own label is not drawn (section 6) |
| Replacement keeps values and focus; a change of step keeps neither | **Partially verified.** Values are verified at message level after an accepted action; after an `invalid-input` refusal they are not yet kept (Part B, M4). Focus is a hint the host returns; applying it is demonstration code, not tested |
| No two instances share a surface id | **Partially verified.** Unique within a host by construction; across sessions it depends on a caller-supplied session id (Part B, L5) |
| Results reported as messages or renderer fidelity | **Verified**, with the label mismatch now described correctly |
| A consequential action refused without confirmation, and a second time | **Verified.** The surface itself is not yet locked after acceptance (Part B, M3, decision D3) |
| A rule change forces a re-check before anything runs | **Verified,** including after a re-approval (H1) and against in-place edits (H2) |
| Timing within budget | **Verified** in Node; not measured in a browser |
| Levels 1a, 1b and 2 reported, bridge described | **Verified** |
| Goldens unchanged; default artifact has none of the new code | **Verified** by tests and the isolation test; the built bundle was not inspected |
| Sidecar 0.2 with 0.1 compatibility | **Partially verified:** expansion-compatible, constraints enforced; block actions not mapped, so upcast blocks are not instantiable |
| Version coexistence, template child lists, binding by tracing | **Deferred** by approved scope |

Limitations:

- One design system (Astryx); two compositions; no nested repeats, no template child lists.
- The hotel tool is simulated.
- A2UI 0.9.1 only. Upstream 0.16.1 is a renderer version, not verified final A2UI 1.0 compatibility.
- Governance covers the form of data, not its truth: a confirmation's selection is whatever the caller supplies (R1A-REVIEW L7).
- The empty state borrows the data-collection purpose through M1, as a documented limitation and not permanent governance semantics (D4).
- Emitted ids are positional with suffixes (`choose`, `choose_2`, …). The spike never relies on them. An id map from dspack-emit would replace the structural step: a sibling-repository change, not authorized.
- `createSurface.theme` is still emitted. Nothing depends on it.

**Recommended scope for the host-hardening follow-up (Part B, not authorized).**

1. **M3 / D3: lock the surface** once a consequential action is accepted, until a governed replacement is shown. Return an idempotency key (surface id and action name). Model the outcome as pending, succeeded, failed or unknown for later agent integration, without claiming exactly-once external execution.
2. **M4: keep typed values after an `invalid-input` refusal,** so the invalid state shows what the person typed.
3. **D5: sensitive inputs.** An input flag that is never carried into a replacement, never written into a recorded batch or transcript, and kept apart from retained evaluation evidence. Required before application integration and before any real interaction transcript is recorded.
4. **E5 to E7.** Generate session ids in core with a restricted charset (L5); run the attachment-difference test on the search composition; assert a prefilled carried value in level 2.
5. **Low findings.**
   - L1: report a lint exception as a refusal.
   - L2: pin the emitter and lint versions.
   - L3: record the expected rule for scenarios that expect a refusal.
   - L4: synchronous pin comparison.
   - L6: freeze instances.
   - L8: allow one literal id in both branches of an `$if`.

The rest of M1, in the order R1A-REVIEW §9 recommends, stays unauthorized: experimental storage isolation, version coexistence, the selectable-card correction (D1), then Library, approval, authoring, Playground groundwork and task planning in visible slices. Protocol P0 stays separately scoped; P1 and P2 unauthorized.

## 11. Try it

The demonstration is one self-contained page, `demo.html`. It was delivered to the owner with this report and can be rebuilt with `node build.mjs --demo` in `docs/repositioning/spikes/r1a-host/` (written to `dist/`). Open it from disk in a browser. It runs the real pipeline and host on upstream 0.16.1.

1. Type a destination, dates as `YYYY-MM-DD` and a number of guests.
2. Search with check-out before check-in: the error appears and your values stay.
3. Fix the date and search again to get results.
4. Choose a hotel, then reserve it, then press Reserve again.

The "Try to break it" panel replays a stale action, tampers with a payload, forges a reservation, writes garbage into an input and edits a rule. The panel's data-set picker swaps in what the simulated tool returns, including the sets the rules refuse. "Payloads" shows each button's literal payload; "Messages" shows the exact batch rendered.
