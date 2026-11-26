# Independent R1a review

**Status:** reviewed 2026-11-26 against PR #122 at `3036584` and PR #121 at `a09e1b0`. **Accepted by the owner with targeted revisions** (2026-11-26); the decisions are in §10 and the disposition of every finding is in [R1A-REPORT.md](R1A-REPORT.md) §2. This is the review as delivered, with session-specific wording removed. Findings are not edited to reflect the fixes made since.

## Context

A focused, read-only review was requested of the M1 work through R1a before the rest of M1 is authorized: the implemented architecture, the interoperability evidence, the regression coverage, findings F1 to F4, and what to do next. Nothing was changed, pushed, merged or deployed, and no model was called.

**How it was done.** The reviewer read the composition modules, the tests, the verification scripts and the bridge. It reproduced each suspected defect with inline scripts that write no files, cross-checked the committed evidence against the data sets, ran a replacement walk through one long-lived processor in both upstream implementations, and drove the delivered `demo.html` in Chromium.

**State verified.** PR #122 is a draft at `3036584`, mergeable, CI green. PR #121 is at `a09e1b0`, ready, CI green. Both branch from `main` at `6bc33a6` and share no file.

**Evidence tags.** **[V]** verified: reproduced, or read at the line cited. **[I]** inference from verified facts. **[P]** design preference.

---

## 1. Verdict

**Accept R1a with targeted revisions.**

The two claims R1a exists to test hold. One definition produces many governed instances, and those instances are accepted by upstream's Python implementation and render and behave correctly on upstream `@a2ui/react` 0.16.1. The central claim was checked independently of the implementation: on both renderers, all 30 "choose" buttons send the id of the hotel at their drawn position in the data set **[V]**.

The host runtime has two defects that make a stated guarantee false, and four smaller ones. All are small fixes; none calls the architecture into question. Several evidence items cannot fail and should be replaced. The selectable-card label gap is real, older than R1a, and already in production.

---

## 2. Acceptance criteria

The thirteen criteria of R0-REVIEW §7, then the items of the M1 authorization that they do not cover.

| # | Criterion | Status | Why |
|---|---|---|---|
| 1 | Every screen in a recorded walk equals a fresh governed emission | Partially verified | Same input gives the same bytes (tested). "Emission plus the two attachments" is tested only on an instance with no inputs. No committed evidence renders a replacement in a long-lived processor; a reviewer run does (§5) |
| 2 | No `updateComponents` or `updateDataModel` to a surface already shown | Verified | Static test on the walk transcript; one live surface after every batch in a single-processor run |
| 3 | The five §3.4 paths each have a negative test | Partially verified | Stale, collection change and parent-path: verified. Rule dependency: see H1 and H2. Local renderer writes: the refusal is tested, but both "nothing governed changes" checks cannot fail (E1). The guarantee itself is sound: it rests on the binding-layout check, which I read |
| 4 | One result refused with the rule's reason; none selects the empty state | Verified | |
| 5 | Each button's payload names its own item, shown four ways | Verified, with caveats | The structure test reuses the implementation's own traversal (E2). The witness is satisfied by a property that is not drawn (§5). A data-derived cross-check passes |
| 6 | Replacement keeps values and focus; a change of step keeps neither | Partially verified | Values: at message level, and only after an accepted action (M4). Focus: the host returns a hint; applying it is demo code and untested. Level 2 never asserts that a carried value is displayed |
| 7 | No two instances share a `surfaceId`, within or across sessions | Partially verified | Within a host: by construction. Across sessions: depends on a caller-supplied session id that nothing generates or validates (L5); the test passes distinct names in, so it cannot fail |
| 8 | Every result reported as "messages correct" or "renderer fidelity" | Verified, one mislabel | The label gap is filed as a renderer fidelity gap. It is the upstream component's designed behaviour (§5) |
| 9 | A consequential action is refused without confirmation, and a second time | Verified | The specified behaviour holds. Its limits are M3 and M6 |
| 10 | A rule change forces a re-check before anything runs | Partially verified | Refusal after the change: verified. After re-approval the old surface runs again without being re-governed (H1). An in-place contract edit changes the rules without changing the pin (H2) |
| 11 | Timing within budget | Verified in Node | 2.6 ms warm p95, 219 ms cold. Not measured in a browser |
| 12 | Levels 1a, 1b and 2 reported, bridge described | Verified | Caveats in §5 |
| 13 | Goldens unchanged; default artifact has none of the new code | Verified by tests and import graph | Block-bench ratchet and CI pass; nothing in `apps/` imports `compositions`. The built bundle was not inspected |
| | Sidecar 0.2 with in-memory 0.1 compatibility | Partially verified | Expansion is byte-identical. Instantiation of every packaged block is refused, and block constraints are dropped (M5) |
| | Data-aware expansion, deterministic state selection | Verified | First guard that holds; a requested state only if its own guard holds |
| | Hotel search with working input bindings | Verified | Typing, keeping and sending, on both renderers |
| | Hotel results with per-item payloads | Verified | |
| | Version coexistence; template child lists; binding by tracing | Deferred by approved scope | |

---

## 3. Findings

Each was reproduced on `3036584` unless tagged otherwise. Paths are under `packages/composer-core/src/compositions/`.

### High

**H1. Re-approval makes a surface that fails the current rules executable again. [V]**
- **Where:** `host.ts:213`. `act` asks only whether the composition's approval is current. It never compares the live instance's own pins with the approval's.
- **Reproduction:** show twenty hotels. Add a rule forbidding the label "Oriente Tower". The same data is now refused, yet every declared scenario still behaves as declared, so the re-check passes and re-approves. Pressing a button on the old surface is accepted. The instance's contract pin differs from the approval's.
- **Effect:** the last valid instance is kept on screen, correctly, but after a re-approval it is no longer valid and still runs.
- **Fix:** in `act`, require the current instance's pins to equal the current approval's pins; otherwise refuse `needs-recheck` until the surface is replaced. A failing-first test with a data-dependent rule.

**H2. A governor holds the contract by reference, so an in-place edit changes the rules without changing the pin. [V]**
- **Where:** `governance.ts`, `createGovernor`. `lint` and `emit` read the caller's object; the hashes and catalogs are computed once.
- **Reproduction:** "one hotel" is refused. Set the rule's minimum to 1 on the same contract object. "One hotel" is now accepted, with the contract pin unchanged, so every approval still counts as current.
- **Effect:** pin integrity depends on callers never mutating. A project store that edits rules in place would defeat it silently.
- **Fix:** deep-copy and freeze the contract and profile in `createGovernor`. Test as above.

### Medium

**M1. Two overlapping `show` calls orphan a surface. [V]**
- **Where:** `host.ts:173-197`. `previous` is read before two awaits and used after them.
- **Reproduction:** `Promise.all` of two shows. Both batches delete the first surface; the surface the first call created is never deleted.
- **In the demo:** two quick presses on two "Choose" buttons are both accepted and create two confirmation surfaces. The demo hides the orphan because it mounts a fresh processor for every batch.
- **Fix:** run shows one at a time (a promise chain), or refuse a show while one is in flight.

**M2. Two node ids that reduce to the same emitted id bind the wrong field, silently. [V]**
- **Where:** `bindings.ts`, `attach` looks a component up by `slug(node id)`; `load.ts` compares raw ids for duplicates.
- **Reproduction:** add an undeclared field with id `check_in` before the declared `check-in`. No load issue. The "Promo code" field is bound to `/input/checkIn` and the real check-in field is left unbound. Every gate passes.
- **Fix:** at load, require unique slugs of literal ids per state. At instantiation, refuse when the emitter's `surface-id-deduplicated` warning names a declared node.

**M3. After a consequential action is accepted, its surface stays fully live. [V]**
- **Where:** `host.ts:234-236`. Single use is per action and surface, as R0 specified.
- **Reproduction:** reserve (accepted); "Back" on the same surface (accepted); a new confirmation; reserve again (accepted, same hotel). Also in the demo.
- **Effect:** while a reservation is in flight nothing stops the flow continuing, and the agent gets no key to make the tool call idempotent.
- **Fix:** once a consequential action is accepted, refuse every further action on that surface until it is replaced, and return an idempotency key (surface id plus action name).
- Two presses cannot interleave inside `act`: it is synchronous, and the second gets `duplicate`. **[V by reading]**

**M4. Typed values are lost after an `invalid-input` refusal. [V]**
- **Where:** `host.ts:233` returns before the values are recorded at `:238`.
- **Reproduction:** search with an impossible date (refused), then show the search's `invalid` state: every field is carried as an empty string.
- **Effect:** F1's retention works only after an accepted action. The demo shows field errors only in its own notice, outside the governed surface.
- **Fix:** on `invalid-input` for a bound action, record each carried string that is within its maximum length.

**M5. 0.1 compatibility is expansion-only. [V]**
- **Where:** `load.ts`, `upcastBlock` drops a block's `actions` and `constraints`.
- **Reproduction:** each of the three packaged Astryx blocks, instantiated with its own example, is refused at attachment because its buttons dispatch undeclared actions. Four of the six packaged blocks declare constraints, which `expand.ts` never checks.
- **Fix now:** carry `constraints` and check them (`checkConstraints` exists in `blocks/call.ts`), and say in the report and ADR R1 that upcast blocks expand but are not yet instantiable. Mapping block actions can follow.

**M6. A consequential action may carry typed input. [V]**
- **Where:** `schema.ts` and `load.ts` accept `consequential` with `carries`.
- **Effect:** R0 A5 requires a consequential payload to be all literals, so that what the confirmation shows is what is sent.
- **Fix:** refuse the combination at load.

### Evidence that cannot fail, or leans on the code under test

| # | Item | Problem | Replacement |
|---|---|---|---|
| E1 | `verify_python.py` "garbage changes no governed property"; `host.test.ts` messages snapshot | Both compare values that a data-model write cannot alter (static properties; a messages array nothing mutates) **[V]** | Resolve every dynamic property before and after the write and compare; or drop the line and cite the binding-layout check |
| E2 | `instantiate.test.ts` `payloadsByStructure` | Imports `subtree` from the implementation **[V]** | A small traversal of its own in the test |
| E3 | Levels 1b and 2 expected payloads | Taken from the implementation's own action table, not the data **[V]** | Assert that the button at drawn position k sends `data.hotels[k].id`. The committed results were checked this way: 30 of 30 on both stacks |
| E4 | Replacement in a renderer | Every case and every demo batch uses a fresh processor (`bridge-016.tsx:81`) **[V]** | Add a walk through one processor. A reviewer run: five batches, upstream Python and `web_core` 0.16.1, all accepted, exactly one live surface after each |
| E5 | Surface-id uniqueness | Distinct session names are passed in | Generate session ids in core and test the generator |
| E6 | "Differs from plain emission only by the attachments" | Run only on an instance with no inputs | Run it on the search as well |
| E7 | Carried values | Level 2 clears each field before typing | Assert the prefilled value first |

### Low

- **L1.** An exception in lint escapes `show` as a rejection (an unknown rule type throws). It fails closed but is not reported as a refusal **[V]**. Catch it in `instantiate`.
- **L2.** Pins omit the emitter and lint versions, so a toolchain upgrade keeps approvals valid **[I]**.
- **L3.** `recheck` counts any refusal for an "expect refused" scenario. Record the expected rule.
- **L4.** `approve` takes any object, and pins are compared through an asynchronously refreshed set. No exploitable race was found: a governor change marks everything stale synchronously, which fails closed **[V by reading]**. Hashing each composition once and comparing synchronously would remove the mechanism **[P]**.
- **L5.** The session id is caller-supplied with no charset rule; the demo uses six random characters. Use `crypto.randomUUID` and a restricted charset.
- **L6.** Instances are mutable objects handed out by reference. Freeze them.
- **L7.** A confirmation's selection is not checked against the hotels: the id and name pairing is whatever the caller supplies. Governance covers form, not the truth of data. State this in the report **[I]**.
- **L8.** The same literal id in both branches of an `$if` is refused as a duplicate.

### What held up

- **State selection** is deterministic and data-driven.
- **The pipeline** fails closed at every stage, with the rule and rationale.
- **The binding layout** (inputs only at `/input/<leaf>`, only as a field value or an action context) is enforced on every instance, and is what keeps renderer writes away from governed content.
- **The validator cache** has no global state: a governor is the cache, and a contract change means a new governor. With H2 fixed there is nothing to invalidate. It resolves the same Ajv version as dspack-emit (8.20.0), and its verdict matches `validateCatalog` in the committed test.

---

## 4. F1 to F4

| | Assessment | Refinement before application integration |
|---|---|---|
| F1. Values kept across a state change within one composition | **Accept.** It is what the owner's "where appropriate" asks for; the invalid state is pointless without it | Fix M4. Add a `sensitive` flag to inputs: never carried, never written into a recorded batch. Carried values travel in the creation batch, so any saved transcript would hold them |
| F2. Cached validators and the Ajv dependency | **Accept.** Same algorithm, same Ajv version, no global cache; the uncached cost is real | Fix H2. Widen the equivalence test to every evidence instance and a handful of mutations, as a ratchet against version drift |
| F3. Empty state under the data-collection purpose | **Accept as temporary.** The borrowed purpose shapes the screen: its rule is why the empty state must carry a field and a button | Note the borrowed purpose on the state. The real fix is contract vocabulary (decision D4) |
| F4. Version coexistence deferred | **Accept the deferral for the spike.** The owner's decision stands: approved versions are immutable and coexist with newer drafts | Implement before the Library: key compositions by id and version; store the composition hash with each approval; editing an approved version starts a draft |

---

## 5. Interoperability and renderer fidelity

**Levels 1a and 1b: the messages are correct.**
- Upstream's Python `a2ui-core` is a separate code base from the TypeScript renderer, run in strict mode at a pinned commit. It is genuinely independent. It follows upstream head, not the 0.10 line Composer pins.
- It accepts all nine instances. Each input resolves its bound value; each action dispatches the payload the host expects.
- Limits: the expectations come from the implementation's own table (E3), and the garbage check cannot fail (E1).

**Level 2: renderer fidelity, for two renderers.**
- The standalone host imports `MessageProcessor` and `Catalog` from `@a2ui/web_core/v0_9` and `A2uiSurface` from `@a2ui/react/v0_9`, both at 0.16.1. That is the 0.9 protocol path of the current packages. **It says nothing about final A2UI 1.0.**
- The bridge is reported honestly: upstream's catalog loader and binder, a copied bound-setter rule, a provenance shim, and Composer's own Astryx renderer files. The processor, binder and surface are independent of Composer; the visuals are not. No `apps/composer` code is involved **[V]**.
- Inputs accept typing (9 of 9). Controls send the expected payload (40 of 40). No page errors.
- Not in evidence: replacement in one processor (E4, which passes when run), a displayed carried value (E7), applied focus, any non-string property.

**The 249 of 288 [V, recounted].**

| Group | Count | Reading |
|---|---|---|
| Drawn as visible text inside their own component | 249 | |
| Placeholders | 9 | Attributes by nature; visible while the field is empty. Correct |
| `SelectableCard.label` | 30 | Every one. None is visible |

**The selectable-card label.**
- **It is upstream's designed behaviour.** Astryx documents `label` as "Accessibility label" and renders it as `aria-label` (`SelectableCard.doc.mjs:23`, `SelectableCard.tsx:192-195, 356`). The renderer is faithful **[V]**.
- **The contract treats it as the visible name.** Its description says "The option's name"; `rule.option-carries-label` says the label is how an alternative is "identified, compared, and announced".
- **It is in production today.** The contract's own worked example, `ex.plan-comparison`, draws two plan cards with no plan name. In the demo, a hotel card without its button reads "Area Alfama, Price per night $142, Guest rating 8.9 / 10" **[V]**.
- **Two things are overstated because of it:**
  - The pilot's task fit. `hotel-single-1` has six cards and no visible name on any, yet "a comparison of at least two hotels" was marked present from the JSON **[V]**.
  - The witness check. It passes on the invisible label, so "a person could tell them apart" is proven for the messages, not for the screen.
- **Classification: a separately scoped correction, not an R1a blocker.** R1a found it and reported it; the composition works around it. It should be fixed before the Library ships compositions with selectable cards. The report should describe it as a mismatch between contract and component, not as renderer infidelity.

---

## 6. The demonstration

The delivered page was driven in Chromium with four probes, with no page errors.

| What | Verdict |
|---|---|
| Composition and governance logic | Real. The same modules the tests use run in the page |
| Protocol rendering | Real, on upstream 0.16.1, with one caveat: a fresh processor per batch, so it does not show replacement inside one renderer session (E4) |
| Hotel tool | Simulated, and labelled so on the page and in its About panel |
| Outside R1a | Stated on the page |

It is credible evidence for the refusals, the payload association, input binding and value retention. It is not evidence for a persistent renderer session, focus, or a real agent. It also reproduces M1, M3 and M4 as shipped.

---

## 7. Required before merging #122

Code, each with a test that fails first:
1. H1: instance pins checked in `act`.
2. H2: governor copies and freezes its contract and profile.
3. M1: shows run one at a time.
4. M2: unique slugs at load; refusal on a deduplicated declared node.
5. M5: carry and check block constraints.
6. M6: refuse `consequential` with `carries`.

Evidence and documents:
7. E1 to E4 replaced or added as in the table.
8. The report corrected: the label gap as a contract and component mismatch that predates R1a; 0.1 compatibility stated as expansion-only; criteria 1, 3, 6, 7 and 10 stated as they stand; L7 as a limitation.
9. An import-isolation test: nothing under `apps/` imports `composer-core/compositions`.

Not required for the merge, but before application integration: M3, M4, E5 to E7, L1 to L6.

---

## 8. Merge sequence

1. **#121 first, as it stands.** It is documents, evidence and the pilot harness. The R1a report links to `LIVE-PILOT-REPORT.md`, which exists only once #121 is merged. No lockfile change; no file shared with #122.
2. **#122 after the §7 corrections and a green CI run on the new head.**

Each merge deploys production with an unchanged application; watch the post-deploy smoke run both times. R0-REVIEW §6.2 said the spike would stay on a branch and never be merged. Merging it is now the better course **[P]**: the rest of M1 builds on it, it is isolated from the default build, and an unmerged base would drift. This is decision D2.

---

## 9. The rest of M1

**Before application integration**

| # | Work | Note |
|---|---|---|
| 1 | The §7 corrections, then M3, M4 and the low findings | On #122 and one follow-up |
| 2 | Experimental storage isolation | Decision in effect: separate keys. Test that the default build neither reads nor writes them |
| 3 | Composition version coexistence | Decision in effect. As in F4 |
| 4 | Selectable-card correction | Its own PR; reaches the default build (D1) |
| 5 | Sensitive inputs | Before any recorded transcript exists |

**Then, in slices that each show something**

| # | Slice | Visible result |
|---|---|---|
| 6 | Library, read-only, in the experimental build | A composition opens on the canvas with scenario and state pickers and its governed instance; a refusal uses the designed failure state. First adoption of the approved canvas-first shell: canvas plus inspector |
| 7 | Approval and re-check | Draft and approved versions, "needs re-check" after a rule edit, the scenario results |
| 8 | Authoring | Promote a block to a composition; edit parameters and scenarios; declare inputs and actions |
| 9 | Playground groundwork for M2 | The host is the engine and `walk.json` its first test. Add the committed state and idempotency key (M3), a timeline from the host log, and simulated tool declarations |
| 10 | Task planning and completeness | The task plan and plan checks; completeness beyond I3 (the pilot's card-versus-table and missing-confirmation cases); recording each attempt's failing rule codes |

The selectable-card fix (4) is the one improvement that can reach the public build early. Slices 6 and 7 can ship behind the experimental flag as they land; nothing needs to wait for a single large workspace release.

**Kept separate**
- Protocol P0 is its own scoped task. P1 and P2 stay unauthorized. Verified final A2UI 1.0 remains a public-release requirement; nothing in R1a bears on it.
- No paid evaluation until slice 10 exists: planning, wired interaction and failure-evidence capture are what a baseline would measure.

---

## 10. Decisions for the product owner

| # | Decision | Recommendation |
|---|---|---|
| D1 | Selectable-card label: the renderer draws it as the card's heading; or the contract is changed to say it is an accessible name only and to require visible naming content; or it stays an authoring convention | The renderer draws it. The contract already treats the label as the name, and a rule requires it. A contract edit would change the digest every sidecar is bound to and the Phase 1B request goldens |
| D2 | Merge #122 after the corrections, or keep it unmerged as R0 §6.2 said | Merge |
| D3 | After a consequential action is accepted, lock that surface until it is replaced (M3) | Yes. A person would see "Back" stop responding once they have reserved, until the result arrives |
| D4 | State purposes (empty, loading, error) in the Astryx contract, or keep borrowing through M1 | Keep borrowing through M1 and decide with N4. The same digest and golden cost applies |
| D5 | Confirm F1, with sensitive inputs never carried | Confirm |

F2 and F4 need no decision: F2 is accepted with refinements, and the owner's coexistence decision already governs F4.

**Owner's decisions (2026-11-26).**

| # | Decision |
|---|---|
| D1 | Approved: render the contract's required option label as a visible heading through Composer's Astryx renderer adapter, keeping the upstream component's accessibility semantics and avoiding a duplicate heading where naming content already exists. A separately scoped correction with production regression tests; no change to the upstream component, the contract or historical goldens |
| D2 | Approved in principle: merge #122 after the corrections and verification, superseding the earlier decision to keep the spike on a branch. The composition runtime stays isolated from the default application. Final merge authorization follows review of the corrected head |
| D3 | Approved: lock the whole surface once a consequential action is accepted, until a governed replacement is available, and return an idempotency key. For later agent integration, pending, successful, failed and unknown outcomes are distinguished; locking alone does not guarantee exactly-once external execution. Part of the separately authorized host-hardening follow-up |
| D4 | Approved: keep the borrowed purposes through M1, documented as a limitation and not as permanent governance semantics. Dedicated loading, empty and error purposes are a separate vocabulary decision |
| D5 | Approved (F1): appropriate entered values carry across state changes within one composition. Sensitive values are never carried into replacements or persisted in recorded transcripts; ephemeral runtime input is distinguished from retained evaluation evidence. These safeguards come before application integration and before recording real interaction transcripts |

The decisions that approved versions are immutable and coexist with newer drafts, and that the experimental build uses separate storage keys, remain in effect.

---

## 11. Handoff

**Standing rules.** The owner merges. No deploy, no Cloudflare change, no paid inference, no sibling-repository change, no work beyond what is listed. No test weakened to pass. Corpus, goldens and the default build untouched.

**Part A. Corrections on `claude/m1-r1a` (PR #122).** One commit per finding or a small series; each code change with a test that fails on `3036584`.

| Step | File | Change |
|---|---|---|
| A1 (H1) | `host.ts` `act` | Refuse `needs-recheck` unless the current instance's pins equal the composition's current approval pins. Test: the "Oriente Tower" rule on the twenty-hotel set |
| A2 (H2) | `governance.ts` `createGovernor` | `structuredClone` and deep-freeze the contract and profile JSON. Test: in-place rule edit does not change behaviour |
| A3 (M1) | `host.ts` `show` | Serialize through a promise chain. Test: `Promise.all` of two shows; the second batch deletes the first's surface |
| A4 (M2) | `load.ts` `compositionIssues`; `instantiate.ts` | Unique `slug(id)` per state; refuse when a `surface-id-deduplicated` warning names a declared input, list or action node |
| A5 (M5) | `load.ts` `upcastBlock`; `schema.ts`; `expand.ts` | Carry `constraints`; call `checkConstraints` (`blocks/call.ts`) in `validateInstanceInput`. Test: a packaged block's constraint is enforced through the composition path |
| A6 (M6) | `load.ts` | Refuse `consequential` with `carries` |
| A7 (E1-E4) | `verify_python.py`, `verify_render.cjs`, `instantiate.test.ts`, `host.test.ts`, `spike/evidence.ts` | Replace the two checks that cannot fail; derive expected payloads from `data.hotels[k].id` at drawn position k; give the test its own traversal; add a walk through one processor in both upstream implementations. Regenerate `evidence/` |
| A8 | `R1A-REPORT.md`, ADR R1 | The corrections in §7 item 8 |
| A9 | A new test beside the existing import-isolation checks | Nothing under `apps/` imports `composer-core/compositions` |

Verify: composer-core tests and typecheck, block-bench (the ratchet), then the workspace suite once; levels 1 and 2 re-run; CI green. Update the PR description, mark it ready, stop for the owner.

**Part B. After the merge, one follow-up PR, only when the owner authorizes it.** M3 (if D3 is yes), M4, E5 to E7, L1 to L6, the `sensitive` input flag.

**Part C. Not authorized.** Everything in §9 from item 2 onward.


---

## How to check the main findings

- **H1, H2, M1 to M6:** the reproduction in each finding runs against `packages/composer-core/src/compositions/` with the spike's own fixtures (`spike/fixtures.ts`).
- **The 30 of 30 cross-check:** compare each `choose` entry in `evidence/level-2.json` (its `drawnPosition` and `sent.context.hotelId`) with `data.hotels` in the matching `evidence/results-*.json`.
- **The label:** open the demo, search, and read a hotel card without its button; or open the Astryx sample's plan comparison on the live site.
- **In the demo:** search with `2026-02-30` as check-in (M4: the error appears only in the outer notice); press two "Choose" buttons in quick succession (M1); reserve, go back, choose and reserve again (M3).
