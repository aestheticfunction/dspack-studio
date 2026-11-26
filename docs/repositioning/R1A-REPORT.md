# R1a report: interoperability and governed composition

**Status:** delivered 2026-11-26; reviewed independently the same day ([R1A-REVIEW.md](R1A-REVIEW.md)) and accepted by the owner with targeted revisions. **Corrected** after that review (section 2): six code corrections, each with a test that failed first, four evidence replacements, and the reporting below; merged as #122. **Hardened** in the review's Part B (section 2.1): the consequential lifecycle, sensitive inputs, session and instance integrity, and the remaining low findings, with 30 tests written to fail first and a browser check of the demonstration. No hosted AI, paid inference or sibling repository was involved in R1a.

## 1. Result

The two riskiest claims of the repositioning hold on this stack.

1. **One definition, many governed instances.** Two compositions (hotel search, hotel results) were instantiated across nine data sets and a recorded walk. Every instance passed S1 to S3 under its state's purpose, A1 to A3 for both A2UI versions, and a binding-layout check. Data the rules refuse is refused with the rule's own rationale: a single result fails `rule.review-offers-alternatives`, "A choice of one is not a comparison". Nothing in a template names a hotel.
2. **Rendering outside Composer.** The messages pass upstream's own Python implementation under strict validation (levels 1a and 1b, 57 checks with expectations derived from the data), and a recorded walk replays through one long-lived processor in both upstream implementations. They render, accept typing and send what the data says in a standalone host on upstream `@a2ui/react` 0.16.1 (level 2), and identically on Composer's own canvas.

The k-th repeated button is proven to send item k's payload four ways:
- by structure;
- by witness;
- by a property test;
- by pressing the drawn buttons in two renderers.

The host refuses:
- stale actions;
- a repeated consequential action, naming the same idempotency key;
- anything on a surface after it has accepted a consequential action, until it is replaced;
- any replacement while that action's outcome is pending or unknown;
- forged or tampered payloads;
- consequential actions outside their confirmation step;
- invalid inputs, while keeping what was typed for the next state;
- any action after a rule, or the lint or emitter version, it depends on changes, until a re-check passes;
- any action on a surface governed under rules other than the current approval's, even after a re-approval.

A sensitive input's value reaches the caller once, in the action that carries it, and is in nothing recorded.

One mismatch between the contract and a component was found (section 6). The contract requires each option card's `label` and treats it as the option's visible name; Astryx's `SelectableCard` renders it as an accessible label only, as designed. The owner approved drawing it as a visible heading in Composer's renderer adapter, separately (decision D1).

**Recommendation:** merge the host-hardening follow-up, then experimental storage isolation and version coexistence before the first visible workspace increment (section 10).

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

### 2.1 Part B: host hardening

Authorized by the owner after #123 and #122 merged and their deploys were verified. Each item below has a test in `packages/composer-core/src/compositions/hardening.test.ts`; 28 of its 30 tests failed against `main` at `939cdb5` (`spikes/r1a/evidence/failing-first-part-b.txt`). The two that passed guard properties that already held: M6, and an over-length value is never kept.

| Finding | Disposition |
|---|---|
| **M3 / D3: consequential lifecycle** | **Fixed.** Accepting a consequential action returns a commitment: an idempotency key (`<surfaceId>/<action>/<component>`) and an outcome, `pending`. Until a replacement, the surface accepts nothing (`duplicate` with the same key for a repeat, `locked` for anything else). While the outcome is `pending` or `unknown`, `show` refuses (`outcome-pending`). `settle(key, outcome)` moves it forward only; `succeeded` and `failed` are final. After `unknown`, recovery is by reconciling the same key; only a known failure allows a new attempt, on a new surface under a new key. No transaction or tool is executed anywhere (`host.ts`) |
| **M4: values after `invalid-input`** | **Fixed.** Each carried value that fits its field is kept after the refusal, so the invalid state shows it. Over-length values are not kept. `carried` lists only non-empty values |
| **D5 / F1: sensitive inputs** | **Added.** `sensitive: true` on an input (`schema.ts`). Its value is returned once, in the accepted action's `values`; never kept by the host, never carried, refused in a creation batch (`instantiate.ts`), absent from the log, the instance, refusal reasons and commitments. `redactEvent` and `host.redact` give the recordable form. The search composition gains an optional loyalty-number field marked sensitive, to exercise it end to end |
| **L5 / E5: session ids** | **Fixed.** `createSessionId`: 128 bits from the platform's cryptographic generator, 26 base32 characters. `createHost` generates one unless given one, and validates a given one (16 to 64 lowercase letters and digits). Tested: 5,000 ids unique with `Math.random` pinned; generated hosts give distinct sessions and surface ids; seven malformed ids refused. `recheck` uses a fresh session too |
| **L6: instances** | **Fixed.** Instances, their batches, pins, commitments and approvals are deeply frozen. An accepted action no longer replaces the instance; what the person typed is kept by the host apart from it. The host governs frozen snapshots of the compositions it is given |
| **L4: approval integrity** | **Simplified, fail-closed kept.** `createHost` is now `async` and hashes each composition once, so pin comparisons are synchronous. The generation-counted asynchronous refresh is gone, and with it a window in which a correct approval, or an unchanged governor, was refused for a moment (the test "an action right after approval" failed on `main`). Approvals are issued only by `recheck`, frozen, and accepted only as issued and only for their own composition (`approve` returns the reason otherwise) |
| **L2: toolchain** | **Fixed.** Pins gain `toolchainSha256`: the lint and emitter versions the caller names (required by `createGovernor`) and `COMPOSITIONS_RUNTIME_VERSION`, a constant raised with any change to what an instance is accepted as. No version-management machinery beyond that |
| **L3: expected rule** | **Fixed.** A refused scenario names `refusedBy`, a rule id or a stage, and the re-check passes only if that is what refused it. A refused scenario without it is a load issue |
| **L1: lint exceptions** | **Fixed.** An exception in any stage is a refusal at that stage, with its message |
| **E6** | **Added.** The plain-emission test now runs on three instances with bound inputs and reconstructs both attachments from the declarations, not from the implementation (`instantiate.test.ts`) |
| **E7** | **Added.** Level 2 asserts each field displays its creation batch's value before anything is typed; 11 of 11 on both stacks |
| **F2 refinement** | **Added.** The cached gates are compared with dspack-emit's `validateCatalog` on every data set and six mutations of each, both versions: at least 100 comparisons, as a ratchet against drift |
| **L7** | **Documented** as a limitation (section 10): governance covers the form of data, not its truth or provenance, and not the business logic behind it |
| **L8** | **Kept documented.** No approved acceptance criterion needs one literal id in both branches of an `$if` |

**Found by the browser check, not by the unit tests.** The demonstration marked the locked surface `inert=""`, which React 19 reads as false: the surface stayed pressable. The host still refused both presses (`locked`, `duplicate`), but the page did not show the lock. Fixed (`inert: true`); the check now asserts a press dispatches nothing at all.

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
| `instantiate.ts` | The pipeline with per-stage refusals and timings, exceptions included; frozen instances; pins with the toolchain, synchronous comparison; `createSessionId`, `surfaceIdFor`; a sensitive value refused in a creation batch |
| `host.ts` | Approvals by re-check, issued and frozen; `show` (replacement, carried values, focus, announcement, the last valid instance kept on refusal, no replacement while an outcome is open); `act` (eight refusal codes); the consequential lifecycle (`settle`, `commitment`, `commitments`); `redact` |

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
| Duplicate confirmation | A second `reserve` on the same surface gives `duplicate`, naming the same idempotency key |
| Locked surface (M3) | After `reserve` is accepted, `back` on the same surface gives `locked`, before and after the outcome is known, until a replacement |
| Navigation while open (M3) | `show` gives `outcome-pending` while the outcome is pending or unknown; the locked surface stays |
| Outcomes (M3) | Forward only; `succeeded` and `failed` final; a conflicting report refused; an unknown key refused; after a known failure, a new attempt has a new key |
| Sensitive value (D5) | Not in the next batch, the log, the instance, a refusal or a commitment; refused in a creation batch; replaced by `redactEvent`; not kept after `invalid-input` |
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
| Identity | Generated session ids: 5,000 distinct, from the cryptographic source; 12 instances across 4 generated sessions, 12 distinct surface ids; malformed supplied ids refused |
| Approvals | A forged copy of a real approval, and an approval for another composition, are refused; approvals are frozen; a toolchain change needs a re-check |
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
| 1b | **Messages are correct** | The same implementation, 57 checks, all pass:<br>- each input resolves its bound value from the creation batch, then a typed value;<br>- each of the 40 actions dispatches what the **data** says it must (the k-th list child sends `data.hotels[k].id`; a confirmation sends `data.selection.id`), with carried inputs as typed;<br>- with every property of every component resolved before and after garbage writes into `/input`, only bound input values change, and a positive control confirms the comparison sees those changes |
| 1b' | **Messages are correct, across replacements** | The recorded walk (6 replacements, now including the lifecycle's governed replacement) replayed through **one** long-lived processor, in upstream Python `a2ui-core` and in `@a2ui/web_core` 0.16.1: after each batch exactly one surface is live, the new one, and its first option card sends the new data's first hotel (after the reorder, `h-103`) |
| 2 | **Renderer fidelity**, for the renderers tested | Two stacks, identical results:<br>- **A standalone host outside `apps/composer`:** upstream `@a2ui/react` and `@a2ui/web_core` 0.16.1, Composer's Astryx renderer files unchanged, and a bridge written for the spike (`Catalog.fromJson`, `createComponentImplementation`, and the bound-setter rule);<br>- **Composer's own canvas:** `a2ui-ingest` on the pinned 0.10 stack.<br>On both: every input first displays its creation batch's value, then accepts typing and keeps it (11 of 11); every control, found in drawn order, sends what the data says (40 of 40); the control in the k-th drawn option card is item k's; no page errors. Of 292 governed literals, 251 are drawn as visible text inside their own component and 41 only as an accessible name or attribute |
| 2, demonstration | **Host behaviour in a browser**, one long-lived renderer session | `verify_demo.cjs` drives `demo.html` on upstream 0.16.1, 18 checks, all pass (`evidence/level-2-demo.json`):<br>- session ids generated in the page, different on each load, in every surface id;<br>- after each replacement exactly one surface is in the page;<br>- after a refused search the new fields **display** what was typed, and the sensitive field nothing;<br>- focus stays on the pressed control across a replacement, and moves to the canvas on a change of composition;<br>- after Reserve the surface is inert and busy, a press dispatches nothing, forced events are refused (`locked`, `duplicate` with the key), navigation is refused while pending and unknown, a known failure allows a new attempt under a new key, success releases the page;<br>- the sensitive value typed twice is in no recorded place (page, inputs, messages, log, host state, storage), with a positive control |

The 41 not drawn as visible text:
- **The 30 `SelectableCard.label` values (the hotel names): a mismatch between the contract and the component.** The renderer is faithful: it passes the label to Astryx's `SelectableCard`, which documents it as an accessibility label and renders it as `aria-label`, by design. The contract treats the same label as the option's visible name (`rule.option-carries-label`: how an alternative is "identified, compared, and announced"). So no gate can see that it is not drawn. In the hotel cards the name is visible only because the composition repeats it in the button label. It predates R1a: the contract's own plan-comparison example and the live pilot's hotel surfaces show unnamed cards too, and the pilot's task fit has been corrected for it. The owner approved drawing the label as a visible heading in Composer's Astryx renderer adapter, as a separately scoped correction (D1).
- **The 11 placeholders** are attributes by nature, as expected.

**What each level does not show.** Level 1 says nothing about pixels. Level 2 covers these two renderers, the 12 Astryx components and the 0.9.1 envelope only. A2UI 1.0 messages are not claimed; that is protocol track P1.

## 7. Performance (R0-REVIEW A12)

Measured in Node 22, `evidence/performance.json`, regenerated after the corrections. Figures vary with machine load; the first run measured 2.58 ms and 219 ms.

| | Budget | Measured |
|---|---|---|
| Warm `instantiate`, 20 items, 95th percentile | 50 ms | **4.11 ms** (p50 2.36 ms, n = 200) |
| Cold: governor setup plus the first 20-item instance | 500 ms | **253 ms** (setup 222 ms, first instance 31 ms) |
| Warm, 3 items, 95th percentile | | 1.75 ms |
| The same 20-item instance with uncached A gates, both versions | | 70 ms p50, 80 ms p95: over budget, hence F2 |

Node figures, re-measured after Part B (`evidence/performance.json`, Node 22, one machine; run-to-run variation is of the order of these differences).

**In a browser** (headless Chromium, the demonstration's own instantiations, `evidence/level-2-demo.json`): every instantiation of the walk took 0.7 to 1.5 ms; the first, with the governor already prepared, 0.7 ms. These are separate from the Node figures and few: six instances, not a distribution. Governor setup in the page was not timed.

The demonstration runs the same pipeline in the browser. Instantiation runs in the browser, Node and, later, ds-mcp; never in the Worker.

## 8. Regression and CI

Run locally on the Part B branch, from `main` at `939cdb5`.

| Suite | Result |
|---|---|
| Workspace unit tests (`pnpm test`) | All pass:<br>- composer-core 557, including the 92 compositions tests (30 of them Part B's);<br>- apps/composer 562, including the isolation test, unchanged;<br>- block-bench 292, including the Phase 1B goldens and request-hash ratchet, unchanged;<br>- every other package |
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
| Every screen in a recorded walk equals a fresh governed emission | **Verified** for the messages: byte-equal re-emission, the plain emission plus exactly the two attachments on instances with bound inputs (E6), and a one-processor walk in both upstream implementations. In the browser, the demonstration now renders every replacement in one long-lived processor, with one surface in the page after each |
| No updates to a surface already shown | **Verified** (static transcript check; one live surface after every batch) |
| The five §3.4 paths each have a negative test | **Verified** (stale, renderer writes via the binding layout and level 1b, parent-path updates, collection changes, rule-dependency changes including H1 and H2) |
| One result refused with its rule's reason; none selects the empty state | **Verified** |
| Each button names its own item, shown four ways | **Verified** (own traversal, witness, property test, data-derived behaviour in two renderers). The witness is satisfied by the button label; the card's own label is not drawn (section 6) |
| Replacement keeps values and focus; a change of step keeps neither | **Verified.** Values after an accepted action and after an `invalid-input` refusal (M4), displayed in the browser after the replacement; sensitive values never. Focus: the host's hint, applied by the bridge's `applyFocus` and asserted in the browser for the same control and for a change of composition. Focus following an item inside a repeat is verified at the hint only |
| No two instances share a surface id | **Verified** for generated sessions: 128-bit ids from the cryptographic source, tested for uniqueness and charset, and across hosts. A caller that supplies its own session id is validated for form; its uniqueness is the caller's |
| Results reported as messages or renderer fidelity | **Verified**, with the label mismatch now described correctly |
| A consequential action refused without confirmation, and a second time | **Verified,** with the lifecycle of decision D3: the surface locked until replaced, one idempotency key for every repeat, no navigation while the outcome is pending or unknown, in tests and in the browser |
| A rule change forces a re-check before anything runs | **Verified,** including after a re-approval (H1), against in-place edits (H2), and for a change of lint or emitter version (L2) |
| Timing within budget | **Verified** in Node; measured in the browser for the demonstration's six instantiations (all under 2 ms), not as a distribution |
| Levels 1a, 1b and 2 reported, bridge described | **Verified** |
| Goldens unchanged; default artifact has none of the new code | **Verified** by tests and the isolation test, and in the deployed bundle after #122 merged (12 scripts, no composition code). Part B changes nothing under `apps/` |
| Sidecar 0.2 with 0.1 compatibility | **Partially verified:** expansion-compatible, constraints enforced; block actions not mapped, so upcast blocks are not instantiable |
| Version coexistence, template child lists, binding by tracing | **Deferred** by approved scope |

Limitations:

- One design system (Astryx); two compositions; no nested repeats, no template child lists.
- The hotel tool is simulated.
- A2UI 0.9.1 only. Upstream 0.16.1 is a renderer version, not verified final A2UI 1.0 compatibility.
- **Trusted data and external business logic (L7).** Governance covers the form of data, not its truth or its provenance. A confirmation's selection, its price and the pairing of an id with a name are whatever the caller supplies; that they match the tool's records, and that a reservation is allowed at all, is the agent's and the tool's business logic. The host checks that what is sent is what was shown, not that what was shown is true.
- **The consequential lifecycle stops at the host.** The host guarantees one acceptance per surface, one key for every repeat, and no second attempt while an outcome is pending or unknown. It cannot make a tool honour the key, and it relies on the agent to report each outcome and to reconcile an unknown one by key. There is no timeout: an outcome stays pending until reported. No real tool or transaction exists in this work.
- **Sensitive inputs are protected in what is recorded, not on screen.** The field is drawn as an ordinary text field; masking is a renderer question. The value is in the renderer's data model while typed, as any input value is, and in the one accepted event the agent receives.
- **Session ids supplied by a caller** are checked for form only.
- **Focus inside a repeat** is verified as the host's hint, not in the browser.
- **L8:** the same literal id in both branches of an `$if` is still refused as a duplicate. No acceptance criterion needs it.
- The empty state borrows the data-collection purpose through M1, as a documented limitation and not permanent governance semantics (D4).
- Emitted ids are positional with suffixes (`choose`, `choose_2`, …). The spike never relies on them. An id map from dspack-emit would replace the structural step: a sibling-repository change, not authorized.
- `createSurface.theme` is still emitted. Nothing depends on it.

**Decisions for the owner.**

1. Merge the Part B follow-up.
2. Whether a pending outcome should time out to `unknown` on its own. Recommended: not in the host. The agent knows the tool's timeout; the host should not guess one.
3. Whether a sensitive field should be masked when drawn. Recommended: decide with the selectable-card correction (D1), as one renderer-adapter change, and only for fields that need it (a loyalty number need not be masked; a card number would be).

**Recommended next sequence** (R1A-REVIEW §9, unchanged in substance):

1. **Experimental storage isolation.** Separate keys for anything the experimental build stores, and a test that the default build neither reads nor writes them. Small, and a precondition for anything stateful in the workspace. Sensitive values are already excluded from what a recorded artifact could hold, so this does not need to wait on more host work.
2. **Composition version coexistence (F4).** Compositions keyed by id and version; an approval stores its composition hash (it already does, in its pins); editing an approved version starts a draft. Needed before any "draft, approved, v-number" interface.
3. **The first visible workspace increment: a read-only Library in the experimental build.** A composition opens on the canvas with scenario and state pickers and its governed instance, a refusal shown in its designed failure state, through the host as hardened here. The selectable-card correction (D1) can land alongside, as its own PR, since it reaches the default build.

Approval and re-check, authoring and the Playground groundwork follow as visible slices. Protocol P0 stays separately scoped; P1 and P2 and any paid evaluation stay unauthorized.

## 11. Try it

The demonstration is one self-contained page, `demo.html`. It was delivered to the owner with this report and can be rebuilt with `node build.mjs --demo` in `docs/repositioning/spikes/r1a-host/` (written to `dist/`). Open it from disk in a browser. It runs the real pipeline and host on upstream 0.16.1.

1. Type a destination, dates as `YYYY-MM-DD` and a number of guests.
2. Search with check-out before check-in: the error appears and your values stay.
3. Fix the date and search again to get results.
4. Choose a hotel, then reserve it. The surface locks, and a panel stands in for the hotel tool: report that it succeeded, failed or did not answer. While the outcome is open, nothing on the surface responds and nothing replaces it. After "no answer", reconcile it either way.
5. Type a loyalty number on the search: it is used for that search only. It is not carried to the next state and appears nowhere in the log or the messages.

The "Try to break it" panel replays a stale action, tampers with a payload, sends a reservation or Back from the current surface, navigates away, writes garbage into an input and edits a rule. Everything is rendered in one renderer session; the header shows the session id the host generated. The panel's data-set picker swaps in what the simulated tool returns, including the sets the rules refuse. "Payloads" shows each button's literal payload; "Messages" shows the exact batch rendered.
