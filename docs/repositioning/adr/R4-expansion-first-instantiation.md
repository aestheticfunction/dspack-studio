# R4. Every instance is a governed expansion, shown as an immutable surface

**Status:** accepted for M1 through R1a. Rewritten in the R1a paper step from the R0 draft, applying the owner's decisions on the independent review ([R0-REVIEW.md](../R0-REVIEW.md) §3.2 and §6.1, decisions 6 and 7, 2026-11-25) and the M1 authorization of 2026-11-26. Implemented by the R1a spike (`packages/composer-core/src/compositions/`); evidence in [R1A-REPORT.md](../R1A-REPORT.md). **Amended** by the host hardening of R1A-REVIEW Part B (2026-11-26): session ids, immutable instances, the consequential lifecycle, sensitive inputs, the toolchain pin and approval integrity (items 1, 4, 5 and 7).

## Context

The R0 draft bound data into a fixed tree by tracing markers through the emitter, guarded by an equivalence gate, rule coverage and in-place updates. The review showed that on this stack:

- in-place updates are unsafe: `updateComponents` merges and never removes, ids are positional, and a reorder silently retargets a button (A1);
- repeated elements have no identity of their own (A2);
- neither an input's value nor an action's payload survives emission, so tracing cannot place them (A3);
- a renderer write is untyped and can replace a subtree (A4).

## Decision

### 1. An instance is an expansion, and one instance is one surface

`instantiate(composition, parameters, data, state?)`:

1. validates parameters and data against their declared types and bounds;
2. selects the state by guard (6.1 item 5);
3. expands the state's template with the block expander, unchanged;
4. runs S1 to S3 under the state's purpose;
5. emits with dspack-emit under the instance's own `surfaceId`;
6. attaches the two bindings (items 2 and 3 below);
7. checks the binding layout;
8. runs A1 to A3;
9. records the pins (item 7).

Every step fails closed, names its stage and, for a rule, the rule and its rationale. Two literal ids that emit the same id are refused at load, and a declared node the emitter renames is refused at instantiation, so a binding can never find the wrong component (R1A-REVIEW M2).

The surface id is `<composition>-<session>-<counter>`, unique across sessions and instances. The host generates the session id itself, 128 bits from the platform's cryptographic generator as 26 base32 characters (`createSessionId`), unless the caller supplies one, which must be 16 to 64 lowercase letters and digits. With no hyphen in a session id, a surface id reads back one way. Uniqueness across sessions rests on the generator; a caller that supplies its own ids takes that on (R1A-REVIEW L5).

An instance is deeply frozen when it is made, and an accepted action does not change it: what was governed is what stays on screen (L6). The host governs its own frozen snapshot of each composition, so a caller's later edit to a definition changes nothing it decides.

When data, state or parameters change, the host creates a new instance, sends `deleteSurface` for the old one, then the new creation batch. Replacements run one at a time, so every batch deletes the surface actually shown (R1A-REVIEW M1). Nothing is ever sent to a surface that is already shown. That is a structural property with one static test: no transcript holds `updateComponents` or `updateDataModel` addressed to a live surface.

This is the initial strategy, not a permanent ban on A2UI incremental updates. A narrow class of in-place update can return when a scenario demonstrates the need, as a separately reviewed change with its own negative tests.

### 2. Repeated-element identity is proven, never read from an emitted id

The template keeps one literal id for a repeated button, so every item dispatches the same action name. The button that belongs to item k is established and checked four ways. A mismatch at any of them is a refusal.

- **Structure.** The list must hold exactly one `$each` that yields exactly one node per item (load-time check). Its emitted `children` array names the items in order. Item k is the k-th entry, and its button is the single dispatcher of that action inside that entry's subtree. A count mismatch is refused, and so is a dispatcher outside the items.
- **Witness.** Each repeated action declares witness paths that the template renders, here the hotel's name. Item k's subtree must render item k's witness values and none that belong only to another item. If two items render the same witness values, a person could not tell them apart either: that is a completeness refusal (I3).
- **Property test.** Randomised lists are run through four item shapes (a wrapper, a conditional badge, extra text, the plain card), with duplicates injected. Each run is either associated correctly or refused for duplicates, never misassociated.
- **Behaviour.** In two renderers (level 2), pressing the k-th drawn button sends item k's payload.

### 3. Input binding: leaf paths under `/input/`, attached after emission

Each declared input names a `text-input` with a literal id outside any repeat. After emission, its `TextField.value` becomes `{path: "/input/<name>"}`. The creation batch ends with one `updateDataModel` that writes `/input` with the carried values, or empty strings.

The binding layout is checked on every instance: the only data paths in the messages are `/input/<leaf>`, and only as a text field's value or inside an action context. Nothing governed reads them (A4).

Inputs reach the agent only as an action's declared `carries`. The host validates each carried value against its declared kind (text, date, integer) and bounds. The binding is spelled in one function (`inputPath`), so the A2UI 1.0 spelling is a one-line change.

### 4. Payloads: literal, fixed at instantiation

A repeated action's payload reads only the item (`{"$prop": "hotel.id"}`). It is evaluated once per item and attached as a literal `context`. A single action's payload reads parameters and data. Nothing in a payload is a path except declared carried inputs.

The host accepts an action only when all of these hold:

- its surface is the current instance;
- the approval's pins are current;
- the action name and component are a declared action of this instance;
- the context is exactly the literal payload plus the declared carried inputs;
- each carried value is valid.

A **consequential** action is declared on exactly one confirmation state and carries literals only, never typed input (R1A-REVIEW M6). It is refused from any other surface (`needs-confirmation`). What the confirmation shows and what is sent come from the same instantiation.

**The consequential lifecycle (R1A-REVIEW M3, decision D3).** Accepting a consequential action opens a commitment: an idempotency key, `<surfaceId>/<action>/<component>`, and an outcome that starts `pending`. The key follows [HOST-ACTIONS.md](../../blocks/HOST-ACTIONS.md) rule 4: it is built from an id the host issued (the surface id), it is the same for any repeat, and the literal payload is fixed for that surface.

- From acceptance until a replacement is shown, the surface accepts nothing: a repeat is refused as `duplicate`, naming the same key; anything else is refused as `locked`.
- While the outcome is `pending` or `unknown`, nothing replaces the surface (`outcome-pending`), so the person cannot be moved on and press it again elsewhere.
- Outcomes move only forward: `pending` to `succeeded`, `failed` or `unknown`; `unknown` to `succeeded` or `failed`. `succeeded` and `failed` are final, and a conflicting report is refused.
- Recovery from `unknown` is by reconciling the same key with the tool. A new attempt is possible only after a known `failed`, and it is a new surface with a new key.

What the host guarantees: at most one acceptance per surface, one key for every repeat, no second attempt while one is pending or unknown. What it cannot: that the tool honours the key, or that the agent reports outcomes and asks the tool by key after an unknown one. Those stay the external side's responsibility. The host executes nothing.

### 5. Replacement keeps what the person did

The host, not the agent, carries entered values, focus and an announcement across a replacement:

- **Values, within one composition, across states.** For example, the search's `ready` to `invalid`, so the person's typing survives the error. Values are kept after an `invalid-input` refusal as well as after an accepted action (R1A-REVIEW M4). A carried value must still fit its field; one that does not is dropped and reported. Only non-empty values are reported as carried.
- **Sensitive inputs, never (decision D5).** An input declared `sensitive` reaches the caller once, in the accepted action that carries it, and nowhere else. The host keeps no sensitive value, never carries one, and refuses to write one into a creation batch, which is what a transcript records. `redactEvent` and `host.redact` give the form of an action event that may be recorded. The distinction is between the runtime value, used once, and anything durable: transcripts, evidence, logs and saved artifacts. The renderer still draws the field as an ordinary text field; masking it is a renderer question, not addressed here.
- **Values, across compositions.** Moving to another composition (a different step) carries nothing.
- **Focus.** It returns to the same emitted id outside a repeat. Inside a repeat, it returns to the item with the same literal payload, or to the surface heading if that item is gone. A different composition focuses its heading.
- **Announcement.** A polite live-region message says what changed.

R0-REVIEW §3.2 said "when the composition or state changes, nothing is carried". The spike carries across a state change within one composition, which the invalid state needs. This is flagged for the owner in the R1a report as a clarification, not a new mechanism.

### 6. Renderer assumptions

Nothing relies on patching a live surface, on template child lists, on client-side checks or on anything in `createSurface.theme`. So the pinned 0.10 renderer and upstream 0.16.1 behave alike for everything the spike does. Level 2 confirms this on both.

### 7. Pins and approvals

Every approval and every instance records:

- `contractSha256`: the contract as governed, rule edits included;
- `profileSha256`;
- `toolchainSha256`: the lint, emitter and runtime versions the governor runs (R1A-REVIEW L2). The caller names the lint and emitter versions it installed; the runtime's own version is a constant raised with any change to what an instance is accepted as;
- `interactionSha256`: the composition's declared data, inputs and actions;
- `compositionSha256`, with its id and version.

An approval exists only when every declared scenario behaves as declared (`recheck`). On any mismatch, the host refuses to show or accept anything for that composition (`needs-recheck`) until a re-check passes under the new pins. A surface on screen must itself carry the current approval's pins: after a re-approval under changed rules, a surface governed under the old ones is refused until it is replaced, because the scenarios a re-check runs need not cover the data that surface shows (R1A-REVIEW H1). A governor takes frozen copies of its contract and profile, so the rules a pin stands for cannot change underneath it (H2).

A refused scenario names the rule or stage that must refuse it (`refusedBy`); any other refusal fails the re-check (L3). An approval is issued only by `recheck`, frozen, and accepted by a host only as issued and only for its own composition. The host hashes each composition once when it is made, so every pin comparison is synchronous: no window in which an approval or a governor change has not yet taken effect (L4). An exception inside a gate is a refusal at that stage, not a rejection (L1).

### 8. Verification levels (R0-REVIEW §3.5)

| Level | Shows | Claim |
|---|---|---|
| 1a | Upstream Python `a2ui-core` loads the catalog and accepts every instance's messages under strict validation | The messages are correct |
| 1b | The same implementation resolves each input's bound value after a write, resolves and dispatches every action with its own payload, and governed properties ignore garbage in `/input` | The messages are correct |
| 2 | A standalone host outside `apps/composer`, on upstream `@a2ui/react` 0.16.1 with Composer's Astryx renderers and a bridge written for the spike, draws every governed literal, accepts typing, and sends the right payloads. The same checks also run on Composer's own canvas | Renderer fidelity, for the renderers tested only |
| 2 (demonstration) | The standalone demonstration, driven in a browser in one long-lived renderer session: retained values displayed, focus applied, the locked surface inert, outcomes and navigation, session ids, and the sensitive value absent from everything recorded (`verify_demo.cjs`) | Host behaviour as a person meets it, for that renderer only |

## Not in M1 through R1a

Out of scope here:

- binding by tracing;
- gate I0 and rule coverage;
- in-place agent updates;
- template child lists;
- client-side A2UI checks;
- nested repeats (refused at load);
- data-model writes by the agent after creation;
- version coexistence of one composition (R0-REVIEW A10; the loader refuses a duplicate id).

## Consequences

- One definition gives many governed instances. Different data, same composition, no content hardcoded in a tree.
- The agent, or the host on its behalf, re-instantiates on every change: a pure function with no model call. Measured warm at 2.6 ms at the 95th percentile for 20 items, with A1 to A3 cached per contract and profile.
- What a person types into a field is not governed content. A third-party host can send anything to its own renderer; the package gives it the same `instantiate` and host checks.
