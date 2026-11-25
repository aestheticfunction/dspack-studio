# Astryx for the hotel vertical: D5a now, D5b investigated

**Status:** M0 investigation, 2026-11-25. Decision D5: Astryx as contracted today (D5a) is the initial reference. D5b (extending the contract) is documented here only; no upstream vocabulary change without separate approval.

## What the vertical needs and what Astryx 0.1.4 has

The contract Composer packages (`apps/composer/astryx-project/astryx.dspack.json`, Astryx 0.1.4, 12 components) against the hotel stages:

| Need | In the contract today | Under D5a |
|---|---|---|
| Destination, guest name | `text-input` (type text, email, password) | As is |
| Check-in, check-out dates | No date component | `text-input` with an A2UI check (format and order), stated as a fidelity note |
| Number of guests | No number component | `text-input` with a range check |
| Compare hotels | `list` › `selectable-card` › `metadata-list`, `badge` | As is; the purpose `transactional-review` already requires at least two options |
| Choose a room | Same pattern | As is |
| Loading results | No skeleton or spinner | Text in a card ("Searching…"); no visual loading treatment |
| No availability, failure | No empty-state, banner or inline alert | Text and a button in a card |
| Confirm the booking | `alert-dialog`, `button` | As is (renders inline in Composer's canvas) |
| Booking result | `card`, `text`, `badge` | As is |

Everything renders natively (12 of 12 catalog names). The gaps are vocabulary, and each is reported in the product rather than hidden.

## The purposes the vertical needs (owner-authored)

Astryx's six purposes cover four of the hotel stages. The other states have no honest purpose, and filing them under a permissive one (for example `scheduling`) would pass the gates while describing them wrongly.

| Stage or state | Purpose to use | Exists? |
|---|---|---|
| Hotel search | `data-collection` | Yes |
| Hotel results, room picker | `transactional-review` | Yes |
| Reservation review and confirmation | `transactional-review`, with the confirmation as `destructive-action`'s alert dialog only if the owner judges booking "high-consequence" | Yes, but a decision: booking is consequential, not destructive |
| Loading results | **`loading-state`**: a surface shown while data is on its way; no actions except cancel | **No** (shadcn/ui v3 has it) |
| No availability, search failure, booking failure | **`status-feedback`**: a surface that reports an outcome and offers a way on | **No** (shadcn/ui v3 has it) |
| Booking result | `status-feedback` | **No** |

Proposed: the owner authors `loading-state` and `status-feedback` for the Astryx project, each with one or two rules (for example, status feedback carries a text explaining the outcome and at most one primary action), and one worked example each. This is project governance, which Composer already supports and which D14's storage work makes durable. It needs no upstream change. A ruling is also needed on whether a booking confirmation belongs under `destructive-action`.

## D5b: what a contract extension would take

| Step | Work | Where |
|---|---|---|
| 1. Pick components | DateInput or DateRangeInput, NumberInput, Selector, Skeleton, EmptyState, Banner (all present in upstream Astryx 0.7.18) | Owner |
| 2. Upgrade the package | `@astryxdesign/*` 0.1.4 to 0.7.x: about 60 releases with breaking API notes; the existing 12 renderers must be re-verified | `packages/astryx-renderers`, `packages/contracts` |
| 3. Contract | Add the components, props, accessibility notes and rules to the Astryx dspack contract | Upstream-first: the Astryx contract is byte-synced with `dspack` main (`check-sync`), so the change lands in the dspack repository first |
| 4. Protocol mapping | Profile entries for each new component; a date input maps to A2UI's `DateTimeInput` only if the catalog carries it | `packages/contracts/src/astryx-profile.ts`, then dspack-emit |
| 5. Renderers | Native renderers for each new component, with the existing parity and accessibility tests | `packages/astryx-renderers` |
| 6. Re-measure | Phase 1B's evidence was measured on the 0.1.4 contract; block sidecars are bound to its hash and would need a deliberate re-bind | `apps/composer/experimental/blocks`, `packages/block-bench` |

Estimated size: a milestone of its own (M), across two repositories. Not on the critical path: the vertical works under D5a, plainer and with stated gaps.

## Recommendation

Proceed with D5a for M1 and M2, with the two owner-authored purposes above. Decide D5b after the M2 walkthrough, when it is clear how much the plainer vertical costs in usability.
