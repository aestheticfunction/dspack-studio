# Composer: independent R0 review

Reviewed 2026-11-25. It reviews `PROPOSAL.md`, `R0-REPORT.md` and the five M0 pull requests (#113 to #117).

## Status: accepted with conditions (owner decision, 2026-11-25)

The owner accepted this review with conditions, then gave final approval on the same day, recorded the remaining decisions (section 8), and authorized Parts A, D and E of the handoff (section 9). The conditions are applied in the sections named.

| Owner's condition | Applied in |
|---|---|
| Immutable instances are the initial strategy, not a permanent ban on incremental updates | 3.2 |
| Keep entered data, focus and meaningful interaction state across a replacement where appropriate | 3.2, 7 |
| Surface identities unique across sessions and instances | 3.2, 6.1 |
| Prove the link between a repeated element and its payload; do not rest on position alone | 6.1 item 2, 7 |
| Separate "the messages are correct" from "the renderer drew them faithfully" | 3.4, 3.5 |
| Keep deterministic governance, version pins, fail-closed behaviour and confirmation of consequential actions | 3.3 (A5, A6), 7 |
| Separate replay ancestry from whether a refined result is itself a replay; no misleading attribution, no corpus contamination | 2.3, 9 Part A |
| Narrower M1 through R1a accepted as scope. **M1 implementation remains unauthorized.** | 6, 8 |
| Unified canvas-first workspace approved; build the refined prototype with the stated priorities and a light second scenario | 4.4 |
| P0, P1, P2 separation accepted. P0 is a separately scoped task for Opus. P1 and P2 unauthorized. Final A2UI 1.0 stays a public-release requirement. | 5, 8 |
| M0 revisions accepted; the four trust fixes ship as one combined PR | 2.5, 9 Part A |
| The form-field defect gets its own scoped regression fix, after confirming the intended behaviour, without unrelated shared-renderer changes | 9 Part D |
| The review may be committed later, without private links, session text or operational detail | 9 Part E |

## Context

The owner asked for an independent review of the M0 results, the proposed architecture, the three workspace explorations, the A2UI 1.0 strategy and the M1 scope, before any further implementation is authorized. This is a read-only review. Nothing was merged, deployed, pushed or changed in the repository, in Cloudflare or in a sibling repository, and no model was called.

**How it was done.** Three separate read-only reviews, each briefed to find faults and given the code, not the conclusions: one on the five pull requests, one on what the renderer and emitter really do at run time, one on the gap to final A2UI 1.0. The following were then checked directly: GitHub check results on all five PRs, the Cloudflare version and deployment lists (GET only), the prototype's layout at three widths, and typing into form fields on the live site.

**Evidence tags.** **[V]** verified: read in source at the line cited, or observed running. **[H]** hypothesis or inference from verified facts. **[P]** design preference, arguable.

**Limits.** No live model run. No usability sessions; the persona critique is expert review, not observation of users. Upstream A2UI was read at commit `1dbe86a`.

---

## 1. Executive recommendation

**Accept R0, with revisions.** The baseline reproduces, the four fixes do what they say on the main path, and the direction is sound. Five things should change before anything proceeds.

| Area | Verdict | The one thing to change |
|---|---|---|
| M0 pull requests | Accept after revisions | Fix the refinement hole in #113 and the production-smoke trap in #114; narrow or complete #115's claim; correct the documents in #117. Then merge as two changes, not five. |
| Architecture | Accept the direction, simplify the binding half | Make an instance immutable: one instance is one surface. Drop binding-by-tracing, the equivalence gate, rule coverage and in-place updates from M1. |
| UX/UI | Accept the unified workspace, canvas first | The canvas takes most of the width; conversation, outline and inspector are panels around it, at most one side panel open below 1440 px. |
| A2UI 1.0 | Run it as a parallel, separately authorized track | Start with a pinned conformance check in this repository; start dspack-emit work no earlier than R1a. |
| M1 | Authorize only up to R1a | And settle instance identity, repeated-element identity and the input binding on paper before the spike. |

Two facts the R0 report did not have:

- **Form fields cannot be typed into on the live site.** In Preview, text inputs keep an empty value while you type, in both the Astryx and the shadcn samples **[V, observed]**. This predates M0. It also means the hotel search cannot be demonstrated until inputs are bound (finding A3).
- **Every push to a PR branch uploads a version to the production Worker.** The five M0 branches each did so. None of those versions is deployed: the active deployment predates M0, and `/api/models` still returns only `scripted` **[V]**. `wrangler.jsonc` sets `preview_urls` and `workers_dev` to false, so the uploads have no public address **[V, config; dashboard value not read]**. R0 listed this as assumed.

---

## 2. M0 verification

### 2.1 What holds

- GitHub check `test` passed on all five PRs (#117 at its current head `e16faf7`) **[V]**.
- The combined tree passed locally: 1,377 unit tests; exhibit 106 passed, 4 skipped; composer smoke 44; agent 49; experimental 57 **[V, from the R0 run]**.
- The gateway corpus is untouched and pinned by hash **[V]**.
- "Looks exactly as before" for #115 is supported: no stylesheet rule targets `h1` **[V]**.

### 2.2 What was not verified

- The combined tree never ran in GitHub CI. It exists only as a local branch.
- `e2e/composer-prod-smoke.spec.ts` was not run against a deployment of the combined tree (it cannot be, without deploying).
- No axe run covers the Checks view.
- No end-to-end test shows that a generated (non-replay) build is saved under its own request; that path is covered by unit tests only.

### 2.3 Findings

| Sev. | PR | Finding | Fix |
|---|---|---|---|
| High | #113 | **Refining a demo replay with a real model loses all trace of the replay.** `replayOf` is set only when the provider is `scripted` (`apps/composer/app/state.tsx:1329`). A hosted or local refinement of a replay is saved under the typed request with no notice: the original defect, one step later. **[V]** | Track two separate facts (below the table). |
| High, conditional | #114 | **The new test will fail the production smoke run the day hosted AI is turned on.** "With only the scripted twin…" does not stub `/api/models`, and this spec runs against live production after each deploy (`.github/workflows/deploy-composer.yml:75-76`, `docs/deployment.md:165`). **[V]** | Stub `/api/models` to `["scripted"]` in that test. |
| Medium | #113 | A scripted refinement of a generated turn shows a false fallback notice and saves an instruction that was never applied. **[V]** | Notice only when the turn's surface is a replay. |
| Medium | #113 | Replaying a saved replay stacks "(demo replay) (demo replay)" and its description points at the copy. The suffix can be cut off: titles show 48 characters and the 80-character cut happens after the suffix is added. **[V]** | Point at the root source; reserve room for the suffix before cutting. |
| Medium | #113 | **Every saved replay is a second copy of a prompt and surface pair already in the project**, and dspack-gen passes all same-purpose examples to the model without removing duplicates. **[V]** | Do not offer "Add this sample to project" for an unrefined replay of an example the project already has; say "Already in your project as …". **[P]** |
| Medium | #115 | **"Every working view has one h1" is false.** Component, Mapper and Repository views, the Surfaces editor, Build's not-ready state and the no-contract states have none; the test walks only the eight navigation views. **[V]** | Add the heading to those views and extend the test, or narrow the claim. |
| Medium | #117 | Unsupported or stale statements in the documents (list in 2.4). | Correct them. |
| Low to medium | #114 | `generationAvailability` is missing from the context `useMemo` dependencies (`state.tsx:1746`). Availability can read "available" from remembered providers, and shows a warning for a moment before the probe settles. The fulfilment line is inaccurate for composition and refined turns, and repeats #113's notice. **[V]** | Add the dependency; render nothing while unknown; one notice, not two. |
| Low to medium | #116 | Two regions are both labelled "Findings". The region is a tab stop even when it does not scroll. **[V]** | Distinct labels; add Checks to an axe spec. |
| Low | #113 | Detector edge cases: a prompt-only edit is flagged, an id carrying the refined marker is missed, the pattern is unanchored. The replay label is wrong while a composition streams. **[V]** | Tighten with tests; it only flags, so harm is low. |
| Low | #117 | `corpus-pin.test.ts` hashes working-tree bytes with no `.gitattributes`; a CRLF checkout would change the hash. **[H]** | Pin `eol=lf` for the two files. |

**Replay and replay ancestry are two facts (owner's condition).** A turn's surface either is a replay or is not, and separately it may descend from one.

| Turn | Is it a replay? | Descends from a replay? | Shown as | Saved as |
|---|---|---|---|---|
| Scripted build, or scripted "refinement" of anything | Yes | Not relevant | A sample of the named example; the request or instruction was not applied | Not offered if the project already has that example. Otherwise under the source example's own prompt, marked as a replay. |
| A real model refines a replay | No: a model produced this surface | Yes | A generated refinement of the named sample | Prompt is the source example's prompt plus the refinement instructions. Never the typed request the replay did not answer. Named after the source with "(refined)". Description states the starting sample. Not labelled a demo replay. |
| A real model refines that again | No | Yes, same root | As above | As above, instructions accumulated |
| A real model builds from a request | No | No | Generated from the request | Under the request, as today |

So `replayOf` keeps its meaning (this surface is a replay) and a second field, for example `replayAncestor`, carries the root source through real refinements. The first prevents a replay being presented as an answer. The second prevents a refined pricing card being filed under a hotel request. Neither labels a model's work as a replay.

### 2.4 Claims in the documents that the evidence does not support

- "Replay only" and "every acceptance was a replay": a visitor running the local bridge can generate on production today.
- `docs/deployment.md:90` still says Access protects this hostname. R0 found it does not, and did not correct the line.
- The committed `PROPOSAL.md` still says no test suite was executed and that saving a replay stores the hotel prompt; both were overtaken by M0.
- Counts disagree between documents: 21 against 24 packaged examples; 14 against 16 replay fixture files; "about 60 requests" where the proposal means 12 requests and about 60 model calls; R0 §2 points at section 10 where the decisions are in section 11; R0 §11 says only two PRs need a rebase where `INTEGRATION.md` shows every pair conflicts; ADR R1 says "equal pass rate" where the evidence says "inside the margin".
- `PROTOCOL.md` understates the distance to final A2UI 1.0 (section 5).
- Repository documents contain first-person session text, a private artifact link and version ids that should not be in a committed record.

### 2.5 Merge order, and whether the trust fixes can ship on their own

**They can ship independently of the repositioning.** None depends on a decision D1 to D16, on M1, or on any sibling repository. They change only the default build. The condition is the two High fixes above.

**Recommended order [P]:**

1. **#117 first**, after its corrections. It adds documents and one test. Merging it still triggers a production deploy, of an unchanged application.
2. **One combined pull request for the four fixes**, built from the four branches after their revisions. Every pair of them conflicts in `e2e/composer-prod-smoke.spec.ts`, and a careless resolution there already dropped a test's closing line once during integration. One combined PR means the conflicts are resolved once, GitHub CI runs on the tree that will actually ship, and production deploys once instead of four times. The four draft PRs stay open as the review record and are closed when the combined one merges.

If the owner prefers separate merges: #115, #116, #114, #113, rebasing each on the last and waiting for CI and the post-deploy smoke run between merges. That is five production deploys in total.

After the merge, the post-deploy smoke run is the first execution of the new tests against production; watch it.

---

## 3. Architecture review

### 3.1 Verdict

Four of the five pillars hold up against the code:

| Pillar | Verdict |
|---|---|
| Blocks evolve into compositions | Sound. The reuse is real (signature, closed template, gates, provenance, manifest). Two schema facts need a decision (A10). |
| Interaction contract at project level | Sound. Not needed before R1a (A13). |
| Expand and govern every instance | Sound, and the strongest idea in the proposal. |
| Stateful flows only in the Playground; package and tools for agents | Sound. |
| **Binding by tracing, with equivalence, rule-coverage and update-integrity gates** | **Over-built, and as written it does not hold on the current renderer.** |

The fifth pillar exists to let some content stay live in the renderer while the rules still hold. Reading the emitter and renderer shows that it cannot deliver the two bindings the product needs, that it delivers one the product does not need yet, and that the "send only what changed" update path it protects is unsafe. One simpler rule replaces it.

### 3.2 The simplification: an instance is immutable

**One instance is one surface.** Every instantiation gets a fresh `surfaceId`. When data, state or parameters change, the runtime creates a new instance, shows it, and deletes the old one. Nothing is ever patched in place.

What this removes from M1: the tracing compiler, the bound-mode expansion, gate I0 (equivalence), the rule-coverage analysis, template child lists, and agent data-model writes. "Update integrity" stops being a runtime policy with two permitted kinds of change and becomes a structural property with one test: the runtime never sends `updateComponents` or `updateDataModel` to a surface that is already on screen.

What stays, as two small attachments made after emission:

1. **Input values.** Each input is bound to its own leaf path under `/input/<name>`.
2. **Per-item action payloads.** Each repeated button carries a literal payload, fixed when the instance is made (`{"hotelId": "h-204"}`), not a path.

Why this is reuse and not a new layer: `docs/blocks/HOST-ACTIONS.md` already makes the host responsible for checking `surfaceId` on every action. A fresh `surfaceId` per instance turns that existing check into the revision check the protocol lacks. Final A2UI 1.0 also requires `surfaceId` to be unique, so this is the direction the protocol goes anyway.

**This is the initial strategy, not a permanent rule (owner's condition).** A2UI's incremental updates are not prohibited for good. A narrow class of in-place update can be reintroduced when a scenario demonstrates the need, as a separately reviewed change with its own negative tests.

**What a replacement must keep (owner's condition) [H, to be proven in the spike].** Replacing a surface would otherwise lose what the person typed, where focus was and where they had scrolled. The host, not the agent, carries these across, because only the host has them:

- **Entered values.** When the new instance is of the same composition, the host copies each `/input/<name>` leaf whose name and declared type match into the new instance's creation batch. A value that fails its declared type is dropped and reported. This cannot affect governance: nothing governed reads those paths (A4).
- **Focus.** Input and action nodes outside a repeat have literal ids, so the same node has the same emitted id in both instances; focus returns to it. Inside a repeat, focus returns to the item with the same literal payload, or to the list's heading if that item is gone.
- **Scroll position and open disclosure state**, where the same node exists in both.
- **An announcement** of what changed, in a polite live region.
- When the composition or state changes (a different step), nothing is carried and focus goes to the new surface's heading.

**Surface identity (owner's condition).** A `surfaceId` is `<composition id>-<session id>-<counter>`. The session id is random in use and injected in tests, so goldens stay deterministic and no two sessions or instances can share an id.

### 3.3 Findings

**Critical**

| # | Finding | Evidence | Consequence and fix |
|---|---|---|---|
| A1 | **"Send only the components that changed, which stable ids make possible" is false on this stack.** | Emitted ids are positional (`allocateId`, dspack-emit `src/emit/surface.ts:1795-1826`). In `@a2ui/web_core` 0.10.3, `updateComponents` merges properties and never removes a component that was dropped; a second `createSurface` for a live id throws and the rest of the batch is not processed. **[V]** | A list going from three results to two leaves a stale third card on screen. A reorder silently points `results_choose_2` at a different hotel. Both pass every gate, because the gates saw the new expansion and the screen shows a mixture. Fix: 3.2. |
| A2 | **Repeated elements have no identity of their own.** | N buttons from one `$each` emit the same action name with an empty context; only the positional `sourceComponentId` tells them apart (`surface.ts:497`). The template language rightly forbids deriving action ids from loop data. **[V]** | An agent that resolves "which hotel" from a position can act on the wrong item after any list change. Fix: literal per-item payload fixed at instantiation, plus 3.2 so a position never shifts under an id. |
| A3 | **Inputs do not work, and tracing cannot fix them.** | Unbound text fields drop keystrokes: the renderer's local-state branch is unreachable because the binder always supplies a setter that does nothing unless the property is a path (**[V]**, and observed live). Astryx `text-input` has no `value` property; the emitter omits `TextField.value`; a surface node cannot carry it. The emitter also always writes an empty action context. **[V]** | A marker can only be traced through a value that survives emission. Neither an input's value nor an action's payload is emitted at all, so tracing cannot place either **[H, follows from the above]**. Both must be attached to the emitted messages afterwards. This must be done before the spike or the hotel search cannot be shown. |

**High**

| # | Finding | Evidence | Fix |
|---|---|---|---|
| A4 | **A renderer write is untyped and can replace a whole subtree.** | Writing to the root or a parent path replaces everything beneath it; an omitted value deletes a key; an out-of-range index extends an array; no type is checked for local or remote writes. **[V]** | "Typed, in-bounds writes" cannot be enforced inside the renderer. Enforce by layout instead: inputs bind only to leaf paths under `/input/`; no governed content reads those paths; a typed value returns to governed content only through a validated action payload and a new instance. |
| A5 | **A stale action cannot be recognised.** | The action event carries name, surface, component, timestamp and context, with no sequence or revision; path references in the context are resolved at click time. **[V]** | With 3.2, the `surfaceId` is the revision: refuse any action whose surface is not the current instance. A consequential action is accepted once per surface, and its payload must be all literals, so what the confirmation shows and what is sent come from the same instantiation. |
| A6 | **Nothing ties an approved composition or a live instance to the rules it was checked against.** | The proposal computes hashes at publish only. Rule edits, a repository sync, or a change to a purpose's rules leave earlier approvals looking valid. **[H; no pin exists in code today]** | Record three pins on every approval and every instance: contract hash including project rule edits, interaction-contract hash, composition version. On mismatch the status falls back to "needs re-check" and Playground and Publish refuse until every scenario and state passes again. The re-check is deterministic. `expansionDigest` in `blocks/provenance.ts` is the mechanism to extend. |
| A7 | **The public build destroys project data it does not recognise, and it shares storage with the experimental build.** | Unknown project rows are filtered on read and gone for good on the next write; unknown flow-step keys are stripped and a newer step shape nulls the whole flow; the project manifest is strict; import refuses any export version but `0.1`; no stored record has a version field; both builds run on one hostname and one `localStorage`. **[V]** | Before R1a: persist nothing. After R1a and before the experimental build writes any new shape: give it its own storage keys, or first ship a tolerant reader in the public build (a production change). Leave the IndexedDB migration (D14) to the cutover. **[P]** |

**Medium**

| # | Finding | Evidence | Fix |
|---|---|---|---|
| A8 | **The gate count is higher than the guarantees need.** The proposal adds plan checks, I0 to I3, rule coverage and update integrity. | With 3.2 nothing governed is bound, so I0 and rule coverage have nothing to check. On Astryx only `Text.text`, `TextField.value` and `Dialog.title` are dynamic at all. **[V]** | M1 keeps I1 (inputs only, path layout), I2 (declared actions, payload matches) and I3 (completeness). Plan checks wait for the planning work after R1a. |
| A9 | **Which state applies must be decided by data, deterministically.** The proposal says a refused instance "routes to another state" without saying who chooses. | **[H]** An agent could ask for `ready` with an empty list and receive only a refusal. | Each state declares a guard in the closed constraint forms blocks already use. `instantiate` picks the first state whose guard holds; none holding is a refusal that names the rule. |
| A10 | **Two block-schema facts block states and versions.** | `expandBlock` requires the purpose to be in the block's `intents`, and the loader refuses two blocks with one id whatever their versions. **[V]** | Per-state purposes are a real schema change in sidecar 0.2. Version coexistence (approved v1 beside draft v2) needs a decision before any "draft, approved, v-number" UI. |
| A11 | **"Data is never supplied by a model" is the wrong boundary.** | **[P]** In real use an agent's model produces the data. | Define the two by lifecycle. Parameters are fixed when a composition is authored or approved. Data arrives at instantiation and is validated against its declared type and bounds whoever produced it. |
| A12 | **No performance evidence, and the hot path caches nothing.** | `projectEmit` (`packages/composer-core/src/emit.ts:101-209`) reloads the profile, re-emits every surface, runs the catalog transform for both protocol versions and compiles fresh Ajv validators on every call. The recorded timings are stream offsets, not benchmarks. Ajv cannot run in a Cloudflare Worker. **[V]** | Expansion-first multiplies instantiations (every change, every scenario and state at load, every re-check). Cache compiled validators and the catalog per contract and profile hash. Budget: warm `instantiate` of a 20-item list at the 95th percentile within 50 ms; cold within 500 ms. Instantiation runs in the browser, Node and ds-mcp, never in the Worker. |
| A13 | **The project-level interaction contract is not needed to reach R1a.** | **[P]** | For the spike, declare data and actions in the composition. Move shared types to a project file when a second composition needs them. No store or UI before R1a. |
| A14 | **Client-side A2UI checks are not available on the Astryx stack.** | The profile is version 1 with no functions; none is registered in `buildCatalog.tsx:76`; the renderers ignore validity. **[V]** | Validate on the agent side: invalid dates arrive as an action, are refused or answered with the `invalid` state as a new instance. Drop "input checks in TextField and Button" from M2. |
| A15 | **"An unmodified upstream renderer" needs a bridge, and the claim should say so.** | The Astryx renderer package imports nothing from `@a2ui` and can be reused as is. `a2ui-ingest` imports five symbols from the 0.9 entry point; on upstream 0.16.1 it needs a small port (the basic catalog was removed, custom-element wrappers, a new catalog constructor, child references must be marked). **[V]** | Define the levels as in 3.5 and report the bridge as part of what was tested. |

**Low**

| # | Finding | Fix |
|---|---|---|
| A16 | The replay data-model reducer (`packages/replay/src/player.ts`) merges at the root and has no arrays or deletes, unlike the renderer. **[V]** | Inspectors read the processor's own model, as the proposal already says. |
| A17 | Message examples in a package are only test vectors if they include their inputs. **[P]** | Each example carries composition, version, parameters, state and data beside the expected messages. |
| A18 | The upstream request to dspack-emit can shrink. **[P]** | With 3.2, "dynamic kinds for mapped properties" and "native binding emission" are not needed for M1 or M2. What helps is an id map on the emit result and pass-through for an input's value path and an action's context. |

### 3.4 Can a runtime change silently invalidate governance?

Today and under the proposal as written: yes, in each of the five ways asked about. With the changes above:

| Path | Today, and in the proposal | With the recommendation | Test |
|---|---|---|---|
| Local renderer writes | Untyped; a parent write replaces a subtree. The proposal's typed-write rule is not enforceable in the renderer. | Inputs own leaf paths under `/input/` and nothing governed reads them. | Write garbage to every input path and to `/input` itself: every governed component is unchanged, and the next action is refused for its payload. |
| Stale events | Indistinguishable from current ones. | The surface id is the revision; consequential actions are single-use. | Replay an action from a deleted instance; press Confirm twice. Both are refused and shown. |
| Parent-path updates | Possible from any agent message. | The runtime sends one data-model write, in the creation batch, and none afterwards. | A static check on every golden transcript. |
| Collection changes | Ids shift; merged properties and stale components remain. | A new instance each time; payloads are literal per item. | Three results, then two, then the same three reordered: each screen equals a fresh emission, and each button's payload names its own item. |
| Rule-dependency changes | No pin; approvals go stale silently. | Three pins; fail closed until re-checked. | Edit a rule a composition depends on: status falls back, Playground and Publish refuse, the re-check restores or reports. |

**The guarantee, stated once.** At every moment the messages that make up the live surface are byte-equal to the emission of an expansion that passed S1 to S3 and A1 to A3 under recorded pins. The only thing that can differ from that emission is the content of the user's own input paths.

**That is a guarantee about messages, not about pixels (owner's condition).** Whether a renderer draws those messages faithfully is a second, separate claim. It is tested, not guaranteed, and it is reported per renderer (3.5). Three losses are silent in the renderers today: template children, properties the Astryx renderers ignore, and schema defaults **[V]**; and form fields that accept no typing are a fidelity failure no gate saw.

What remains outside both, and should be said in the product: what a person types into a field is not governed content; a third-party host can send anything to its own renderer.

### 3.5 Independent verification, defined so the claim cannot drift

| Level | What is shown | Independent of |
|---|---|---|
| 1a | Upstream Python `a2ui-core` accepts the catalog and messages under strict processing | Composer's TypeScript renderer |
| 1b | The same Python implementation resolves an input's bound value and an action's payload and dispatches the action (`DataContext.resolve_dynamic_value`, `resolve_action`, `dispatch_action`) **[V that these exist for custom catalogs]** | Composer's binder |
| 2 | A standalone host outside `apps/composer`, on upstream `@a2ui/react` 0.16.1 with the Astryx renderer package and a bridge written for the spike, renders the exported files and returns a correct action | `a2ui-ingest` and all Composer application code |

Levels 1a and 1b are evidence that the **messages are correct**. Level 2 is evidence of **renderer fidelity**, and only for the renderer tested. A fidelity check asserts on what is drawn and what it does: every governed literal in the expansion appears in the page; every input accepts typing and holds the value; pressing the k-th repeated action sends item k's payload; anything a renderer ignored or drew as a wireframe is listed. The same assertions run against Composer's own canvas, so the two renderers can be compared. Reports name which of the two claims each result supports.

Level 1b follows upstream head, not the pinned 0.10.3 behaviour; say so. A pass by a loader is not conformance: `a2ui-core` loads today's "1.0" catalogs only because its name check does not look inside `allOf` **[V]**.

---

## 4. UX/UI review

### 4.1 What in the first prototype works and what is staged

| Works as logic | Staged |
|---|---|
| Switching approach and moment | The conversation and the plan (static text) |
| Selecting an element and seeing its inspector | Generation and refinement |
| The Playground walk (a scripted state machine over fixed hotels) | Every rule refusal (a fixed log line) |
| | Scenario and state pickers in Compose |
| | Library search |
| | Publish: no control is wired |
| | Design system: a tab with nothing behind it |

So the first prototype is good evidence about layout and vocabulary, and no evidence about generation, refinement, governance feedback or publishing.

Measured canvas share of the workspace **[V]**:

| Approach | 1280 px | 1024 px | 390 px: canvas starts |
|---|---|---|---|
| A conversation-led | 47% (573 px) | 32% (317 px) | 640 px down |
| B canvas-led | 55% | 43% | 640 px down |
| C flow-led | 72% | 64% | 467 px down |

An Astryx card needs roughly 480 px to show a form at its intended width. At 1024 px, approaches A and B show the product's main subject smaller than its own inspector.

### 4.2 Four readers

| Persona | Where it works | Where it fails |
|---|---|---|
| First-time product designer | One question to start; plain outcome wording; the simulated banner | The first screen invites a request the site cannot fulfil. "Composition", "purpose", "scenario" and "state" arrive at once, unexplained. Design, Preview and Playground are three near-identical modes. On a phone the canvas is below the fold. |
| Design engineer | Inspector shows what an element sends and where it leads | No structure tree. No view of the template, or of which values are parameters, data or fixed. No undo, history or diff. Nothing to select on the canvas from the keyboard. |
| Design-system owner | Rules with their reasons, where they apply | Design system is unreachable in the prototype. No view of which compositions a rule touches. No designed state for a failed check. "Approved" has no meaning yet. Nowhere to author the purposes that state surfaces need. |
| AI platform engineer | The package contents list | Publish is a picture. Nothing shows what an agent sees: the discovery call, the instantiate call, the messages back, a refusal. No verification level, no CI story, no version or compatibility signal. |

### 4.3 Recommended direction

The owner's preference is right: **one workspace with conversation, canvas, outline and inspector as coordinated views of one document**, not three modes. The explorations support it; no approach is complete alone, and each one's strength is another's gap. Six refinements **[P unless tagged]**:

1. **Canvas first.** The canvas is always visible and keeps at least 60% of the width at 1280 px with one side panel open. Conversation docks left and collapses to a prompt bar. The inspector appears on the right when something is selected. The outline is a strip above the canvas that expands into a flow map with transitions and task state; that expansion replaces approach C as a separate mode.
2. **One side panel at a time below 1440 px.** Below 900 px the panels become tabs under the canvas, with the canvas first in reading order. Panels resize and collapse from the keyboard and remember their state.
3. **The entry point sets the emphasis, not the mode.** Starting from a request opens the conversation; opening from the Library opens the inspector; opening a flow expands the outline.
4. **Two modes, not three.** Compose shows a composition with a chosen scenario and state. Pressing an action there opens a small note: what it sends, where it leads, and "Run in Playground". Only the Playground responds. This keeps "is this live?" answerable at a glance.
5. **A structure tree** beside the outline, synchronised with canvas selection. It is the accessible way to select elements and what the design engineer needs to see.
6. **A designed failure state.** A refused instance keeps the last valid one on screen, with the rule's reason on the canvas and a link to the rule. In the Playground the timeline entry is the real refusal.

**Is Compose, Library, Playground, Publish enough?** Yes for the top level, with **Design system kept as a fifth, quieter, always-visible destination**, and Home. What is missing sits inside them:

| Gap | Where it goes |
|---|---|
| The interaction contract has no home | Library gets a "Data and actions" tab; the inspector shows the entries used by the selection |
| Versions, undo, history | The document header: undo and redo, a version list, draft or approved. An approved version is read-only; editing starts a draft. |
| What an agent sees | Publish gets an "Agent view": discovery, instantiation, messages, a refusal, and the verification level actually reached |
| Parameter, data or fixed | A "Show wiring" toggle on the canvas with three markers |
| Onboarding with no model | The first screen leads with a finished sample that can be played, and says plainly that generation is unavailable. The request box is not the main call to action when it cannot be honoured. |
| Refinement target | "Refine this" on the selection; each turn makes a history entry |
| What direct manipulation covers | Editing text and parameters, choosing a variant, reordering where the template allows. Anything else goes through the conversation, and the product says why. |
| Focus after a view change | Move focus to the view's heading and announce it (missing in #115 too) |

**Type and hierarchy.** Sentence case for navigation, buttons and titles. Uppercase mono only for eyebrows and ids. One accented action per view. Body text in panels no smaller than 14 px.

### 4.4 The refined prototype

Approved by the owner, with priorities. One standalone page, scoped to answer the open questions and no more.

**What it contains**

| Area | In the prototype |
|---|---|
| Workspace | Conversation, canvas, structure tree, journey outline and inspector as views of one project. Canvas dominant. Panels collapse and resize, by pointer and keyboard. One side panel at a time below 1440 px. Canvas first on a phone. |
| Selection | One selection shared by canvas, tree and inspector; selecting a step in the outline changes the canvas |
| Compose and Playground | Visibly different places. In Compose an action shows what it sends and where it leads. Only the Playground responds. |
| States | Loading, empty, error and governance refusal, each designed, each reachable from the scenario and state pickers |
| History | A refinement history with undo and redo, and a side-by-side comparison of two versions |
| Disclosure | Plain words first; protocol detail (messages, ids, gate codes) one step down |
| Publish | Checks, package contents, and an Agent view: discover, instantiate, messages returned, a refusal, verification level |
| Second scenario | Convert Estimate to Project, lightly: its outline, one confirmation step with a consequential action, one failure state. Enough to see whether the same workspace fits a task that is not a search. |
| Look | Aesthetic Function identity kept (dark ground, one green accent, condensed display face for the wordmark). Sentence case throughout. Mono only for ids and code. A text face for everything a person reads. |

**What is real, simulated or staged.** The page carries a permanent "About this prototype" panel that sorts every behaviour into three groups, and marks staged parts where they appear:

- **Functioning:** panel layout and resizing, keyboard operation, shared selection, undo and redo over a small set of real edits, version comparison of those edits, scenario and state switching that re-expands a small composition from data, a rule check computed on the page (one result where two are required is refused and the last valid instance stays), the Playground's instance replacement with a stale action and a double confirmation refused.
- **Simulated:** the agent and its tools (fixed responses, as the product's Playground will have).
- **Staged:** the conversation and anything a model would produce; Library search; the package download; the Agent view's calls and responses (illustrative text, in the shape the tools are proposed to have).

The expander and rule check on the page are written for the prototype. They show the interaction, and prove nothing about dspack-gen, dspack-emit or any renderer. No production code is used or changed.

**Not included, to avoid overbuilding:** onboarding variants, Library and Design system beyond a reachable stub that says what belongs there, real generation, persistence, the full second flow.

### 4.5 What the refined prototype showed

Built after the owner's approval, as one standalone page (`composer-workspace.html`). Checked in a browser at 1440, 1280, 1024 and 390 px, by pointer and keyboard, with no script errors.

| Question | Result |
|---|---|
| Canvas share of the workspace | 60% at 1440 px with both side panels; 76% at 1280 px and 70% at 1024 px with one. The first prototype gave 32% to 55%. |
| Canvas position on a phone | 349 px from the top, down from 467 to 640 px. Reached by moving undo, redo, wiring and the flow map below the canvas. Still more than one screen of chrome above it would be acceptable; the header is the remaining cost. |
| One side panel below 1440 px | Works, with one real conflict: structure tree and inspector are the pair a design engineer wants together. Mitigated by a breadcrumb of the selection's ancestors at the top of the inspector. Worth testing with users before fixing the threshold. |
| Shared selection | Canvas, tree and inspector stay in step, from pointer or arrow keys. |
| Compose against Playground | Holds. Nothing in Compose responds to a press; the inspector says what a press would send and links to the Playground. |
| Governance feedback | Three designed refusals work: data that breaks a rule (last valid surface kept, dimmed), an edit that breaks a rule (not applied, reason on the field), a refinement that breaks a rule (refused in the conversation). |
| Replacement keeps what was typed | Shown: an invalid search returns the same form as a new surface with every value and the focus kept. |
| Stale and repeated actions | Shown: both refused, with the reason in the timeline. |
| Second scenario | Convert Estimate to Project runs on the same workspace and the same runtime, including a timeout with an unknown result that is checked and never retried. Nothing in the layout was specific to the hotel task. |

Not answered by the prototype: generation and refinement quality (staged), anything about dspack-gen, dspack-emit or a real renderer, and whether first-time users understand "composition", "state" and "sample data" without help.

---

## 5. A2UI 1.0 track

**Yes: a parallel track, separately authorized, in three stages.** It should not be folded into M1, and M1 should not wait for it.

**Why it is bigger than R0 said [V].** Today's "1.0" output differs from the final specification in more than the binding spelling:

- Components are wrapped in `allOf` with `unevaluatedProperties: false`; final 1.0 requires flat components.
- The catalog carries `$defs.surfaceProperties`, which no longer exists upstream.
- `functions` has the wrong shape (final needs `@call`, `returnType`, `allowedCallers`).
- Envelope keys are unprefixed (`path`, `call`, `checks` where final uses `@path`, `@call`, `@checks`).
- `createSurface.theme` is present on all 17 emitted streams and is invalid in 1.0.
- shadcn's `aria-label` and `aria-hidden` property names break the 1.0 naming rule.
- The vendored `common_types` file is a pre-release copy.
- dspack-emit's own A2 schema requires the opposite of the final one in places.
- `emitSurface` has no version parameter; surface messages are 0.9 only.

**Why to stage it.** The "stable" 1.0 wire format changed three times in six weeks (2026-10-08, 11-02, 11-17), more breaking entries are unreleased, and upstream has no tags. "Final 1.0" has to mean conformance at a pinned upstream commit, re-verified at release.

| Stage | Where | What | Authorization |
|---|---|---|---|
| P0 | dspack-studio only | Pin the upstream commit and file hashes. A non-blocking conformance job with several validators. Record today's failures as the baseline. Correct `PROTOCOL.md`. | Can run alongside the work to R1a |
| P1 | dspack-emit, then dspack-gen | Replace the home-made 1.0 A2 check with the official schema plus protocol-rule checks. Rebuild the 1.0 catalog emitter. `emitSurface({version})` for 1.0 messages. A3 through the envelope's component schema. Release; update dspack-gen to emit per version. | Separate approval, no earlier than R1a, after re-checking upstream churn |
| P2 | dspack-studio | Renderer upgrade from 0.10 to 0.16 in `a2ui-ingest`, the AG-UI bridge and the replay fixtures | Separate approval; its own PR series |

**Conformance checks to require (more than one, because validators disagree):** the official `catalog_definition.json`; the upstream `specification/v1_0/test` runner; Python `a2ui-core` in strict mode; the Dart `a2ui lint --fatal-warnings`; and `@a2ui/web_core` 0.16.1's catalog loader, message processor and payload validator in plain Node.

**Constraints that must not move:** 0.9.1 output stays byte-identical (dspack-gen's tests pin its digests); the twelve corpus prompts and the request goldens are untouched.

**What M1 must do now so the track stays cheap:** spell a binding in one function; give every instance a unique `surfaceId`; depend on nothing in `createSurface.theme`; do not build on client-side checks.

**Top risks:** further upstream changes; inline definitions against relative references to `common_types.json`; validators that disagree; coupling of the two versions inside one emit call; the size of the renderer upgrade.

The D6 condition stands: no public release without verified final 1.0.

---

## 6. M1 scope and stopping point

**R1a is the right place to stop, and the owner's preference to authorize only up to it is correct.** It is the cheapest point at which the two riskiest claims (one definition, many data sets, every instance governed; and rendering outside Composer) are either shown or not.

### 6.1 Settle on paper before the spike

These are the provisional assumptions that would otherwise be baked into the spike and its goldens:

1. **Instance identity.** One instance, one surface, a `surfaceId` unique across sessions and instances (3.2), with what a replacement carries across written down.
2. **Repeated-element identity, proven and not assumed (owner's condition).** The template node keeps one literal id, so the action name is the same for every item. The link from an emitted button to its item must not rest on the emitter's id suffixes. It is established and checked four ways:
   - **By structure.** The emitted list component names its children in an explicit ordered `children` array. Item k is the k-th entry; its button is the one inside that child's subtree. This uses the protocol's own ordering, the same one that decides what is drawn where.
   - **By witness.** The k-th subtree must contain the literal values the template renders for item k and none that belong only to another item. If a repeat renders nothing that tells its items apart, a person could not tell them apart either: that is a completeness refusal (I3), not something to work around.
   - **By property test.** Randomised lists (lengths, duplicates, nesting, components the emitter wraps or drops) show that the emitter preserves expansion order in `children` and never moves a node out of its item's subtree. Read the emitter to confirm why. If the property fails for any shape, that shape is refused.
   - **By behaviour.** In the independent host and in Composer's canvas, pressing the k-th drawn button sends item k's payload.
   Count mismatches and missing actions are refusals. An id map from the emitter would replace the structural step; that is a sibling-repository change and is not authorized.
3. **Input binding.** Leaf paths under `/input/<name>`, attached after emission, spelled in one function.
4. **Renderer assumptions.** Nothing relies on patching a live surface, on template children, or on client-side checks, so the pinned 0.10 renderer and upstream 0.16.1 behave alike for everything the spike does.
5. **State selection** by declared guards.
6. **Sidecar 0.2**: per-state purposes; version coexistence decided or explicitly deferred.
7. **The verification levels** in 3.5.

These amend ADR R2 and R4. They are documents and need the owner's sign-off, not code.

### 6.2 Work to R1a

Pure modules, scripts and one standalone host. On a branch, never merged. No change to the app, storage, the Worker, shared renderer packages or the default build.

| # | Deliverable |
|---|---|
| 1 | ADR amendments from 6.1 |
| 2 | Sidecar 0.2 loader that upcasts 0.1 in memory, with a test that the Phase 1B goldens and request hashes still reproduce byte for byte |
| 3 | Expander extended with data and states |
| 4 | `instantiate()`: expand, S1 to S3, emit with the instance's `surfaceId`, attach the two bindings, A1 to A3 on the result, with cached validators |
| 5 | Two compositions: hotel search (inputs) and hotel results (a collection with per-item payloads) |
| 6 | Data sets: three results, two, one (refused, with the rule's reason), none (the empty state), the three reordered, one removed, twenty (timing) |
| 7 | The negative tests in 3.4 |
| 8 | Verification at levels 1a, 1b and 2 |
| 9 | Timing figures against the budget in A12 |
| 10 | The R1a report: what was shown, what was not, what the spike changed in the design |

### 6.3 Not before R1a

Interaction-contract store and UI; Library; Compose preview; promote to composition; any persistence or migration; hash routes and the new shell; the task plan, plan checks and wiring proposal; the Playground; any model call; any change to a sibling repository; anything that reaches the default build.

After R1a the remainder of M1 should be re-scoped from the spike's results, starting with the storage decision in A7.

---

## 7. Additional acceptance criteria

**To close R0 (M0 fixes):**

- Refining a replay with any provider keeps its replay origin: a test that fails before the fix.
- A saved replay never adds a duplicate prompt and surface pair to generation context.
- The production smoke spec passes whether `/api/models` returns hosted models or not.
- Every reachable view has exactly one `h1`, or the claim is narrowed to the views tested.
- The combined tree is green in GitHub CI before merge.
- The document corrections in 2.4 are made.

**For R1a:**

- At every step of every recorded walk, the messages of the live surface equal a fresh governed emission (the guarantee in 3.4).
- No transcript contains `updateComponents` or `updateDataModel` addressed to a surface already shown.
- Each of the five paths in 3.4 has a negative test that is refused, shown, and leaves the last valid instance in place.
- One result where two are required is refused with the rule's own reason; no results selects the empty state by its guard.
- After reorder and removal, each button's payload names its own item, shown by structure, by witness, by property test and by pressing the drawn button (6.1 item 2).
- A replacement of the same composition keeps matching entered values and focus; a change of step keeps neither and moves focus to the heading. Both tested.
- No two instances share a `surfaceId`, within or across sessions.
- Every result is reported under one of two headings: messages correct, or renderer fidelity.
- A consequential action is refused without its confirmation step, and refused a second time on the same surface.
- A change to a rule a composition depends on forces a re-check before anything runs.
- Timing within the A12 budget, measured and reported.
- Levels 1a, 1b and 2 each reported as shown or not shown, with the bridge described.
- Phase 1B goldens, request goldens and the default catalog export unchanged; the default artifact contains none of the new code.

**For the workspace, at R1 and at the release candidate:**

- Canvas at least 60% of the width at 1280 px with one side panel open; canvas first at 390 px.
- A first-time visitor with no model available reaches a working, playable sample without being offered something the site cannot do.
- Every task possible with a pointer is possible from the keyboard, including selecting an element.
- A failed check has a designed state everywhere it can occur.
- Publish shows the verification level actually reached.

**For the protocol track:** conformance is defined as passing all five checks in section 5 at a named upstream commit, re-run at release; 0.9.1 bytes unchanged.

---

## 8. Decisions for the product owner

| # | Decision | Recommended | Owner, 2026-11-25 |
|---|---|---|---|
| 1 | Accept R0 with the revisions in section 2 | Yes | Accepted |
| 2 | Make the M0 revisions on the existing draft branches | Yes | Accepted; Opus carries them out |
| 3 | #117, then one combined fix PR, in place of five merges | Combined | Accepted |
| 4 | Trust fixes may ship ahead of any repositioning work | Yes | Follows from 3; the merge itself stays the owner's act |
| 5 | Fix the live form-field defect | Own small PR with a regression test | Accepted as a separately scoped regression fix, after the intended behaviour is confirmed, with no unrelated shared-renderer change |
| 6 | Immutable instances; drop tracing, I0, rule coverage and in-place updates from M1 (amends D4) | Yes | Accepted as the initial strategy, with the conditions in the status table |
| 7 | The verification levels in 3.5 | Yes | Accepted |
| 8 | Persist nothing before R1a (refines D14) | Yes | Accepted |
| 9 | M1 only up to R1a, as scoped in 6.2 | Yes | Scope accepted. **Implementation not authorized.** |
| 10 | Protocol stage P0 now; hold P1 and P2 | Yes | P0 accepted in principle as a separately scoped task. P1 and P2 not authorized. |
| 11 | Unified, canvas-first workspace (refines D10) | Yes | Approved as the UX/UI direction; refined prototype in `prototypes/composer-workspace.html` |
| 13 | Commit this review to the documents branch | Owner's call | Accepted: committed here, without private links or session details |

**Decided at final approval (2026-11-25):**

| # | Decision | Owner |
|---|---|---|
| 12 | Uploading a Worker version on every branch push | Keep the current branch-build configuration for this milestone; minimise pushes; document how non-production branch builds could be turned off without affecting required CI or production (done in `docs/deployment.md`); no Cloudflare change |
| 14 | Storage before the experimental build writes new shapes | Separate storage keys for the experimental application; implementation deferred to the appropriate post-R1a milestone |
| 15 | Approved version and newer draft of one composition | May coexist; approved versions are immutable and editing one creates a new draft; implementation deferred |
| 16 | An unbound form field | Keeps its local value for the lifetime of the surface and dispatches nothing; verify against the pinned and current upstream renderers first (done: no conflict) |
| 17 | When M1 to R1a and P0 may start | Not until the M0 remediation has been reviewed and verified |
| 18 | Panel behaviour below 1440 px | Keep the prototype's one-panel threshold and the inspector breadcrumb; revisit through usability evaluation |

All earlier architectural conditions remain in effect. The decision register ([DECISIONS.md](DECISIONS.md)) records all of them.

**M0 remediation, as pull requests (all drafts, none merged):**

| Pull request | What it holds |
|---|---|
| #117 | These documents: this review, the refined prototype, the decision register, and the corrections in §2.4 |
| #118 | The four trust fixes, revised per §2.3 and combined; it replaces #113 to #116, which stay open as review records |
| #119 | The unbound-input fix (§9 Part D, decision 16) |

Recommended order: #117, then #118, then #119. Every merge to `main` deploys production.

---|---|---|
| 12 | Whether uploading a Worker version on every branch push is acceptable, or builds for non-production branches should be turned off in Cloudflare (the owner's action) | Owner's call. No harm found, but it is production infrastructure reacting to draft work. |
| 14 | Storage approach before the experimental build writes any new shape: its own storage keys, or a tolerant reader in the public build first (A7) | Its own keys. Needed after R1a, not before. |
| 15 | Whether an approved version and a newer draft of one composition may coexist in a project (A10) | Decide in the 6.1 paper step |
| 16 | What an unbound form field should do when typed into (Part D) | Hold the typed value locally for the life of that surface and send nothing, matching upstream's renderer. To be confirmed against upstream before the fix. |
| 17 | When to authorize the work to R1a, and when to schedule P0 | After the M0 corrections are merged and verified |
| 18 | Whether two side panels should be allowed from 1280 px, since structure and inspector are wanted together (4.5) | Test with users before changing the 1440 px threshold |

---

## 9. Handoff for Opus 5.5

**Where things stand.**

| Part | Work | Status |
|---|---|---|
| A | M0 corrections, combined PR, verification | Accepted. This is the next task. |
| D | Form-field regression fix | Accepted as its own scoped task; confirm decision 16 first |
| C | Protocol P0 | Accepted in principle; wait for the owner to schedule it |
| E | Commit this review | When the owner asks |
| B | Work to R1a | Scope accepted. **Not authorized. Do not start.** |

**Standing rules.** The owner merges; Opus does not. A merge to `main` deploys production. No deploy, no Cloudflare change, no hosted generation, no paid inference, no sibling-repository change. Corpus and goldens untouched. No test weakened, skipped or deleted to get a pass; a test that asserted old behaviour is changed deliberately and the PR says so. Every push to a branch uploads an undeployed version to the production Worker; push when there is something to verify, not for every commit.

**Part A. M0 corrections.**

1. `claude/m0-replay-integrity`. Implement the table in 2.3 ("Replay and replay ancestry are two facts").
   - `apps/composer/app/state.tsx` near line 1329: keep `replayOf` for a turn whose surface is a replay (scripted provider). Add a second field for ancestry, set when a real model refines a turn that has `replayOf` or the ancestry field, carrying the root source id. A scripted "refinement" is a replay in its own right and says the instruction was not applied; it shows no fallback notice claiming a refinement happened.
   - `packages/composer-core/src/build.ts`, `acceptedExampleEntry`: three cases. Replay: as now, resolved to the root source, suffix never stacked, suffix length reserved before the 80-character cut. Refined from a replay: prompt is the source example's prompt plus the accumulated instructions, name is the source label with "(refined)", description names the starting sample, no "demo replay" label. Generated: unchanged.
   - `apps/composer/app/views/build-view.tsx`: for an unrefined replay of an example the project already has, replace the save button with "Already in your project as …". Notice wording differs for a replay and for a refinement of one.
   - `findProbableReplays`: anchor the pattern, handle the refined marker in ids, do not flag a prompt-only edit.
   - The bridge's twin in `apps/agent/src/project.ts` follows the same three cases.
   - Tests, each failing before the change: a model refinement of a replay is not saved under the typed request and is not labelled a replay; a replay of a replay does not stack; an unrefined replay already in the project cannot be saved twice; an end-to-end case with a stubbed provider showing a generated build is saved under its own request.
2. `claude/m0-checks-not-fulfilment`
   - `e2e/composer-prod-smoke.spec.ts`: stub `/api/models` in "with only the scripted twin…".
   - `state.tsx:1746`: add `generationAvailability` to the dependencies. Render no availability message while it is unknown.
   - One notice per turn, shared with the replay notice.
3. `claude/m0-structure-a11y`: give the Component, Mapper and Repository views, the Surfaces editor, Build's not-ready state and the no-contract states their `h1` through `Eyebrow as="h1"`; extend the test to visit them.
4. `claude/m0-checks-reflow`: distinct region labels; add Checks to an axe spec.
5. `claude/vibrant-shannon-v2fuf0`: the corrections in 2.4, including `docs/deployment.md:90`; `.gitattributes` for the two pinned corpus files; remove session text, the private link and version ids from committed documents.
6. Build one combined branch from the four revised fix branches. In `e2e/composer-prod-smoke.spec.ts` resolve by hand: Git factors a shared closing line out of the conflict, so a "keep both" resolution drops a test's `});`. Confirm the test count in that file afterwards.
7. Verify on the combined branch, locally and then in GitHub CI: unit, typecheck, exhibit, composer smoke, agent and experimental suites; the default catalog export and request goldens unchanged; the corpus hash test passing. Report counts against the R0 baseline.
8. Open the combined branch as a draft PR that names the four it replaces. Recommend the order: #117, then the combined PR. Stop. The owner merges and watches the post-deploy smoke run.

**Part D. Form-field regression fix.** Separate PR, not part of the combined one.

- Defect: in Preview, typing into a text field that has no bound value leaves it empty, in both sample design systems. Cause: the binder in `packages/a2ui-ingest/src` always hands the renderer a setter, and that setter does nothing unless the property is a path, so the renderers' own local-state branch never runs.
- First: confirm decision 16. Read what the upstream renderer does for an unbound field at the pinned version and at head, and report it to the owner before changing anything.
- Then: a regression test that types into a field in Preview on the default build, for Astryx and for shadcn, and fails on `main`.
- Then the smallest change that makes it pass, in one place. Do not alter bound-field behaviour. Do not tidy, rename or upgrade anything else in the shared packages. Replay fixtures 005, 006 and 009 (bound inputs), the parity tests and the exhibit suite must stay green and unmodified.
- It reaches production on merge; say so in the PR.

**Part E. Committing this review.** As `docs/repositioning/R0-REVIEW.md` on the documents branch, with the refined prototype's HTML beside the first one under `docs/repositioning/prototypes/`. Keep both free of private links, session identifiers, account identifiers and deployment identifiers.

**Part B. To R1a. Not authorized.** When it is: follow 6.1 then 6.2 in order. Existing code to build on:

- `packages/composer-core/src/blocks/{schema,call,expand,load,provenance,manifest,actions}.ts`
- `packages/composer-core/src/blocks/phase.ts:70-85` for injecting lint and emit
- `packages/composer-core/src/emit.ts` for the emit path (add caching, do not fork it)
- `docs/blocks/HOST-ACTIONS.md` for the host rules to extend
- `docs/repositioning/protocol-check/` for the Python validator harness
- `packages/astryx-renderers` unchanged in the standalone host

Put new modules under `packages/composer-core/src/compositions/` and the standalone host under `docs/repositioning/spikes/`. Do not import either from `apps/composer`. Stop at the R1a report.

**Part C. Protocol P0. Accepted in principle; wait to be scheduled.** No sibling-repository change. Extend `docs/repositioning/protocol-check/` with the pinned commit, file hashes and the five checks; make it a non-blocking CI job; record the failing baseline; correct `PROTOCOL.md`.

---

## How to check the main claims

- **Form fields:** on the live site open the Astryx sample, go to Preview, choose `ex.signup-basic` and type into any field.
- **Worker versions:** the Cloudflare dashboard's version list for the Composer Worker shows one upload per branch push on 2026-11-25, with the earlier deployment still active.
- **#113 hole:** `apps/composer/app/state.tsx:1329`.
- **#114 trap:** the test named "with only the scripted twin…" in `e2e/composer-prod-smoke.spec.ts`, and `.github/workflows/deploy-composer.yml:75-76`.
- **Positional ids and empty context:** dspack-emit `src/emit/surface.ts:497` and `:1795-1826`.
- **No caching on the emit path:** `packages/composer-core/src/emit.ts:101-209`.
