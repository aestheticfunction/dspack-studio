# R1a report: interoperability and governed composition

**Status:** delivered 2026-11-26 for the product owner's review. M1 stops here, at R1a. Nothing was merged, deployed or changed in Cloudflare, no hosted AI and no paid inference were used, and no sibling repository was touched.

## 1. Result

The two riskiest claims of the repositioning hold on this stack.

1. **One definition, many governed instances.** Two compositions (hotel search, hotel results) were instantiated across nine data sets and a recorded walk. Every instance passed S1 to S3 under its state's purpose, A1 to A3 for both A2UI versions, and a binding-layout check. Data the rules refuse is refused with the rule's own rationale: a single result fails `rule.review-offers-alternatives`, "A choice of one is not a comparison". Nothing in a template names a hotel.
2. **Rendering outside Composer.** The messages pass upstream's own Python implementation under strict validation (levels 1a and 1b, 55 checks). They render, accept typing and send the right payloads in a standalone host on upstream `@a2ui/react` 0.16.1 (level 2), and identically on Composer's own canvas.

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
- any action after a rule it depends on changes, until a re-check passes.

One renderer-fidelity gap was found and is reported, not fixed (section 6): Astryx's `SelectableCard` does not draw its governed `label` as visible text.

**Recommendation:** proceed with the remainder of M1, re-scoped as in section 9, starting with the storage decision (R0-REVIEW A7) and the composition's place in the workspace.

## 2. Pilot closeout and PR #121

[aestheticfunction/dspack-studio#121](https://github.com/aestheticfunction/dspack-studio/pull/121) is ready for the owner's merge decision. It is not merged.

- Its head is `a09e1b0`.
- The report's counts were reconciled against the evidence and corrected openly in a Corrections section: 7 single builds and 27 flow steps, 5 flow plans, 27 first-pass builds and 7 repairs. The evidence files are unchanged.
- Verified governance results are now distinguished from reviewer-assessed task fit.
- First-attempt gate-failure evidence is recorded as a requirement before any further paid evaluation.
- The full baseline is recorded as deferred.
- Block-bench passes 292 tests and typecheck is clean.
- Changes are confined to `packages/block-bench`, `acceptance/live-pilot` and `docs/repositioning`.
- The committed evidence was scanned: no credentials, account, token or version identifiers, or personal data.

## 3. Amended decisions

The ADR amendments from R0-REVIEW §6.1:

- [R4](adr/R4-expansion-first-instantiation.md) is rewritten: instance identity, repeated-element identity, input binding, payloads, replacement, renderer assumptions, pins, verification levels.
- [R1](adr/R1-composition-as-evolved-block.md) and [R2](adr/R2-lifting-the-data-boundary.md) carry amendment notes: sidecar 0.2, and the narrowed data boundary.

None introduces a mechanism the owner has not approved. Four points are flagged for review.

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
| Local renderer writes | Garbage written into `/input/destination` and over `/input` itself:<br>- leaves every governed property unchanged (level 1b, compared on every component);<br>- the next search carrying it is refused |
| Collection changes | Three, then two, then the same three reordered:<br>- each screen is byte-equal to a fresh emission;<br>- each button's payload names its own item (`instantiate.test.ts`) |
| Parent-path updates | Static check on the recorded walk: no `updateComponents` or `updateDataModel` reaches a surface already shown; exactly one `updateComponents` and at most one `updateDataModel` per surface, in its creation batch |
| Rule-dependency change | Editing `rule.review-offers-alternatives` to require four options:<br>- `show` and `act` give `needs-recheck`;<br>- the re-check fails for "three" and "two" and restores nothing.<br>An edit that keeps every scenario passing is restored by its re-check |
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
| 1b | **Messages are correct** | The same implementation, 55 checks, all pass:<br>- each input resolves its bound value from the data model, before and after a write;<br>- each of the 40 actions resolves and dispatches exactly the payload the host expects, with carried inputs as typed;<br>- garbage in `/input` changes no governed property |
| 2 | **Renderer fidelity**, for the renderers tested | Two stacks, identical results:<br>- **A standalone host outside `apps/composer`:** upstream `@a2ui/react` and `@a2ui/web_core` 0.16.1, Composer's Astryx renderer files unchanged, and a bridge written for the spike (`Catalog.fromJson`, `createComponentImplementation`, and the bound-setter rule);<br>- **Composer's own canvas:** `a2ui-ingest` on the pinned 0.10 stack.<br>On both: every input accepts typing and keeps it (9 of 9); every control sends exactly its expected payload (40 of 40); the k-th drawn button is item k's; no page errors. Of 288 governed literals, 249 are drawn as visible text inside their own component and 39 only as an accessible name or attribute |

The 39 not drawn as visible text:
- **The 30 `SelectableCard.label` values (the hotel names): a fidelity gap.** The renderer passes the label to Astryx's `SelectableCard`, which exposes it as an accessible name but does not draw it. In the hotel cards, the name is visible only because the composition repeats it in the button label. A rule (`rule.option-carries-label`) requires that label, and no gate can see that it is not drawn. This is reported, not fixed: fixing it means changing the shared renderer (`packages/astryx-renderers`), which R1a does not touch.
- **The 9 placeholders** are attributes by nature, as expected.

**What each level does not show.** Level 1 says nothing about pixels. Level 2 covers these two renderers, the 12 Astryx components and the 0.9.1 envelope only. A2UI 1.0 messages are not claimed; that is protocol track P1.

## 7. Performance (R0-REVIEW A12)

Measured in Node 22, `evidence/performance.json`.

| | Budget | Measured |
|---|---|---|
| Warm `instantiate`, 20 items, 95th percentile | 50 ms | **2.58 ms** (p50 1.34 ms, n = 200) |
| Cold: governor setup plus the first 20-item instance | 500 ms | **219 ms** (setup 197 ms, first instance 22 ms) |
| Warm, 3 items, 95th percentile | | 0.55 ms |
| The same 20-item instance with uncached A gates, both versions | | 51 ms p50, 55 ms p95: over budget, hence F2 |

The demonstration runs the same pipeline in the browser. Instantiation runs in the browser, Node and, later, ds-mcp; never in the Worker.

## 8. Regression and CI

Run locally on `claude/m1-r1a`.

| Suite | Result |
|---|---|
| Workspace unit tests (`pnpm test`) | All pass:<br>- composer-core 513, including the 48 new;<br>- apps/composer 524;<br>- block-bench 268, including the Phase 1B goldens and request-hash ratchet, unchanged;<br>- every other package |
| Workspace typecheck | Clean |
| Upcast equivalence | Every packaged example in both the Astryx and shadcn/ui v3 sidecars expands byte for byte as the block expander does |
| Unchanged | The Gateway corpus and its goldens, the default catalog export, the replay fixtures, `apps/composer`, the Worker, the renderers, `a2ui-ingest` |
| Default build | Imports nothing from `compositions/`. The lockfile adds `ajv` and `ajv-formats` to composer-core, plus the dev-only `dspack-gen` and `tsx` |

GitHub CI on the PR is reported in the PR.

## 9. Pilot findings, sorted (from LIVE-PILOT-REPORT.md)

| Category | Pilot finding | Where it stands after R1a |
|---|---|---|
| **Data consistency and interaction: R1a lays the foundation** | Steps invented their own hotels and prices; no button carried an action; list items were told apart only by position | Compositions take data at instantiation, so one data set drives every screen; buttons carry literal payloads proven per item; inputs are bound and validated. Wiring this into flows and the Playground is later M1 work |
| **Task completeness and semantic planning: later work** | A card asked for and a table produced (corpus 10); "convert to project" planned as "convert to invoice" (corpus 5); one hotel flow without an explicit confirmation | Not addressed by R1a. Needs the task plan, plan checks and completeness checks beyond I3 (M1 step 14 and after). R1a's I3 refusal for indistinguishable items is the first completeness check, not the whole of it |
| **Astryx vocabulary gaps** | No date, number or select input; no purpose for empty or result states | Unchanged, and confirmed again: dates and guests are text inputs validated by the host by kind; the empty state borrows data collection (F3) |
| **Model-generation weaknesses not yet isolated** | Seven repairs whose cause the pilot did not record | Not addressable without the first-attempt gate-failure evidence the pilot report now requires; no model was called in R1a |

## 10. Findings, limitations and the rest of M1

Findings:

- **Selectable cards hide their governed label** (section 6). The shared renderer should draw it, or the contract should say how a selectable card names itself visibly. It needs its own scoped fix and the owner's call; it affects the default build too.
- **Emitted ids are positional with suffixes** (`choose`, `choose_2`, …). The spike never relies on them. An id map from dspack-emit (R0 A18) would replace the structural step: a sibling-repository change, not authorized.
- **`createSurface.theme` is still emitted.** Nothing depends on it.

Limitations:

- One design system (Astryx).
- Two compositions, no nested repeats, no template child lists.
- The hotel tool is simulated.
- A2UI 0.9.1 only.
- Focus is a hint the host applies; screen-reader behaviour was not tested beyond the live region.

**Recommended scope for the rest of M1.** Re-scoped from these results; still not authorized.

1. **The storage decision (A7, decision 14)** before anything persists a composition: separate storage keys for the experimental build, as recommended.
2. **Version coexistence (A10)**, decided on paper.
3. **The renderer fix** for selectable-card labels, as its own small PR.
4. **Compositions in the experimental workspace.** The Library entry and a Compose preview with scenario and state pickers, following the approved unified workspace prototype, behind the experimental flag.
5. **The Playground**, driven by the host built here: the recorded walk is already its test.
6. **Planning:** the task plan and plan checks (pilot category 2). Any further paid evaluation waits for the gate-failure evidence requirement.

Protocol P0 can run alongside these; P1 and P2 remain unauthorized.

## 11. Try it

The demonstration is one self-contained page, `demo.html`. It was delivered to the owner with this report and can be rebuilt with `node build.mjs --demo` in `docs/repositioning/spikes/r1a-host/` (written to `dist/`). Open it from disk in a browser. It runs the real pipeline and host on upstream 0.16.1.

1. Type a destination, dates as `YYYY-MM-DD` and a number of guests.
2. Search with check-out before check-in: the error appears and your values stay.
3. Fix the date and search again to get results.
4. Choose a hotel, then reserve it, then press Reserve again.

The "Try to break it" panel replays a stale action, tampers with a payload, forges a reservation, writes garbage into an input and edits a rule. The panel's data-set picker swaps in what the simulated tool returns, including the sets the rules refuse. "Payloads" shows each button's literal payload; "Messages" shows the exact batch rendered.
