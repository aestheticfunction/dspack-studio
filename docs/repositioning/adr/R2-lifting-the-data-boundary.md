# R2. Compositions carry data and action payloads; Composer simulates and never executes

**Status:** draft for review. Accepted in principle by the owner as D2 (2026-11-24).

## Context

Two intentional boundaries stand in the way of agent-ready compositions:

1. Blocks may not carry data in flight: "There is deliberately no type that can carry an entered value, a default, a credential or runtime state" (RFC §2), and the host-action guide requires every action context to be empty (rule 7).
2. Composer's stated non-goals (`docs/ARCHITECTURE.md` §9 and invariant 9): no binding to live data, no carrying state between flow steps, flows never a new runtime path.

## Decision

Lift both, deliberately and narrowly:

- A composition declares data inputs and action payloads. Model-filled parameters still never carry runtime values; a model never names an action (H1 stays); fields marked sensitive never enter a payload; the data model is never relayed whole (`sendDataModel` stays off).
- Composer simulates: a deterministic, in-browser Playground with synthetic data and declared simulated tool responses. It never calls a real tool, never authorizes anything and is never a workflow execution platform (owner's condition on D2).
- Flows marked stateful have their transitions executed in the Playground only. Unmarked flows behave exactly as today.

## Consequences

- `HOST-ACTIONS.md` gains a payload section; the manifest's "empty context" rule becomes "context matches the declared payload", with tests changed deliberately (`blocks-ratchet.test.mjs` and the manifest tests).
- `ARCHITECTURE.md` §9 and invariant 9 are rewritten in the same change, so the documents never claim a boundary the code no longer keeps.
- Risk: entered values now travel in action payloads by design. Controls: sensitive typing, gate I1, the host guide. Medium reversibility once packages carry payload schemas hosts rely on.
