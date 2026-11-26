# R4. Every instance is a governed expansion, shown as an immutable surface

**Status:** accepted for M1 through R1a. Rewritten in the R1a paper step from the R0 draft, applying the owner's decisions on the independent review ([R0-REVIEW.md](../R0-REVIEW.md) §3.2 and §6.1, decisions 6 and 7, 2026-11-25) and the M1 authorization of 2026-11-26. Implemented by the R1a spike (`packages/composer-core/src/compositions/`); evidence in [R1A-REPORT.md](../R1A-REPORT.md).

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

Every step fails closed, names its stage and, for a rule, the rule and its rationale.

The surface id is `<composition>-<session>-<counter>`, unique across sessions and instances. The session id is random in use and injected in tests.

When data, state or parameters change, the host creates a new instance, sends `deleteSurface` for the old one, then the new creation batch. Nothing is ever sent to a surface that is already shown. That is a structural property with one static test: no transcript holds `updateComponents` or `updateDataModel` addressed to a live surface.

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

A **consequential** action is declared on exactly one confirmation state. It is refused from any other surface (`needs-confirmation`) and accepted once per surface (`duplicate` thereafter). What the confirmation shows and what is sent come from the same instantiation.

### 5. Replacement keeps what the person did

The host, not the agent, carries entered values, focus and an announcement across a replacement:

- **Values, within one composition, across states.** For example, the search's `ready` to `invalid`, so the person's typing survives the error. A carried value must still match the input's declared type (text within its length); one that does not is dropped and reported.
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
- `interactionSha256`: the composition's declared data, inputs and actions;
- `compositionSha256`, with its id and version.

An approval exists only when every declared scenario behaves as declared (`recheck`). On any mismatch, the host refuses to show or accept anything for that composition (`needs-recheck`) until a re-check passes under the new pins.

### 8. Verification levels (R0-REVIEW §3.5)

| Level | Shows | Claim |
|---|---|---|
| 1a | Upstream Python `a2ui-core` loads the catalog and accepts every instance's messages under strict validation | The messages are correct |
| 1b | The same implementation resolves each input's bound value after a write, resolves and dispatches every action with its own payload, and governed properties ignore garbage in `/input` | The messages are correct |
| 2 | A standalone host outside `apps/composer`, on upstream `@a2ui/react` 0.16.1 with Composer's Astryx renderers and a bridge written for the spike, draws every governed literal, accepts typing, and sends the right payloads. The same checks also run on Composer's own canvas | Renderer fidelity, for the renderers tested only |

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
