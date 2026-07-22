# Phase Next: the platform roadmap

Rewritten 2026-07-21 at the close of the example-expansion milestone. The
previous edition of this document planned WS0 through WS3 (ds-mcp re-pin,
FM-11 take-it-home, FM-10 design-system swap groundwork, FM-7 governed
question); all four shipped and merged, followed by the example-expansion
milestone itself (PRs #16 through #20 plus dspack-gen 0.1.2). Delivered
state, verified on main at `7db93d8`:

- **6 of 6 scenarios ready, none planned**: recipe-creator,
  appointment-booking, project-deletion, support-triage, onboarding,
  hotel-reservations. Full history in `docs/IMPLEMENTATION_LOG.md`;
  audit posture in `docs/AUDIT.md`.
- **Astryx contract**: 12 components, 6 intents, 14 rules, 6 worked
  examples. New this milestone: intents record-collection,
  data-collection, transactional-review; components list,
  selectable-card, metadata-list; the tour auto-starts for first-time
  visitors.
- **dspack-gen 0.1.2** published: contract-declared `required: true`
  props reach the constrained-decoding grammar (born from measured
  data-less tables across ~20 live runs on two models).

Everything remaining is **platform work, not scenario work**. Items are
ordered by leverage; each is deliberate deferral, not drift, and none
blocks the shipped experience.

## Standing constraints (restated, non-negotiable)

- Honest magic only. Nothing simulated or synthesized; replays are recorded
  real runs; capabilities that need the local agent say so plainly.
- No credentials ever transit the browser.
- Import isolation: `@a2ui/*` only in `a2ui-ingest` and the renderer
  packages' shared helper, `@ag-ui/*` only in `agui-bridge`, design-system
  imports only in their own renderer package.
- Published packages are consumed from npm, never vendored, with the single
  documented exception of ds-mcp's build-time core bundle.
- `packages/contracts/astryx.dspack.json` byte-syncs with dspack main.
  **This constraint is currently unmet** — see P0. The example-expansion
  milestone authored governance (3 intents, 9 rules, 3 examples, 3
  components) directly in the studio copy through reviewed PRs; upstream
  `dspack/examples/astryx.dspack.json` still carries the 3-intent,
  9-component edition. Restoring the sync is the roadmap's first item.
- All governance content (intents, rules, rationales, examples) is
  owner-authored. This document specifies required shapes only.
- Public-facing copy follows AF brand voice: declarative, unhyped,
  technically precise, no em-dashes.

## Delivery discipline

Unchanged: each work item ships as its own review-gated PR; every new
assertion lands fail-first (written against the old code, run, failing
output pasted into the PR); fixtures ship only from real model runs;
copy is written from recorded events, never the reverse; new intents land
atomically with the scenario or surface that validates them.

## P0 — Contract re-sync upstream (restores a standing constraint)

The studio's Astryx contract is the current source of truth in fact but
not in declared direction: the byte-sync discipline names dspack main as
canonical, and the take-home view tells visitors the downloaded contract
"is the byte-synced copy of dspack main". Until upstream catches up, that
user-facing sentence over-claims.

Work: propagate the studio's `astryx.dspack.json` (and the unchanged
`shadcn-ui.dspack.json`) to `dspack/examples/` via a dspack-repo PR, then
re-assert byte-equality here. Owner decision folded in: whether the sync
direction stays studio-led during active milestones or reverts to
upstream-led between them. Small, mechanical, high honesty value.

## P1 — shadcn contract parity (owner-authored, upstream)

The largest declared gap, and older than this milestone: the shadcn
catalog carries 8 components, 1 intent (destructive-action), and 5 rules
against Astryx's 12/6/14. Renderer-level parity is current (11 of 12
catalog names; Dialog is the deliberate placeholder), so the design-swap
experience is whole; what is missing is governance vocabulary. Parity
means: the 5 newer intents with rules and worked examples appropriate to
shadcn's idioms (its `data-table-with-row-actions` pattern is the natural
seed for record-collection; its category registry likely needs to grow
beyond interactive/overlay), plus selection-class components mirroring
list / selectable-card / metadata-list. Generation always lints under the
Astryx catalog, so this work changes what shadcn *governs*, not what the
studio runs.

## P2 — Transactional-review interactivity (select → confirm)

Designed during the vocabulary milestone; needs no platform extension.
Shape: `transactionalCapabilities` with `select_option` grounded by
enhancer-attached `context.optionId` (matchers see only the source
component, so ancestry rides the enhancement, exactly as booking grounds
its overlay), `confirm_reservation` through the FM-7 governed question,
an agent responder holding `/reservation/*` state, an authored
`.dsurface.json` start, and `isSelected` re-delivery for visual
selection. A matcher-ancestry extension becomes relevant only if
raw-generated live interactivity without enhancement is ever wanted.

## P3 — Generator expressiveness (dspack-gen 0.2 candidates)

Take up only when a scenario demonstrably needs enforcement beyond
floors; nothing shipped requires these, and each ceiling is stated inside
the affected rules' rationales today:

- `requireOneOf` choice sets (component-choice `require` is conjunctive;
  the record-collection table rule documents the inexpressible
  table-or-list widening).
- Cardinality ceilings and exact counts ("exactly one primary action per
  option" is prose guidance today).
- Per-parent child grammars (the generation schema's documented
  spike-inherited simplification: children accept the full vocabulary at
  every level; per-parent constraints are S3 territory).

## P4 — dropdown-menu item vocabulary

The one casualty in both catalogs: its `items` array has no declared item
shape, so both profiles refuse it, and two shipped fixtures document the
refusal honestly (project-deletion's fixture-003, onboarding's
fixture-014). Specifying the item vocabulary (labels, actions,
separators) in the contract unlocks the shadcn `contextual-actions-menu`
and `data-table-with-row-actions` patterns and retires the standing
casualty entry in `astryx-profile.ts`.

## P5 — Search-class vocabulary (optional)

Deliberately out of the minimal selection slice: upstream Astryx already
ships Typeahead, PowerSearch, DateRangeInput, and Calendar. Admit them
only when a scenario needs live querying or date selection rather than a
prompt-stated ask; the vocabulary-addition path (contract entry, profile
mapping, drift-check name, renderers in both design systems, `x-drift`
for any documented divergence) is established and mechanical.

## The first task

As always, the highest-leverage first task is the one that restores a
stated invariant: **P0's byte-equality check**. Sync the contract
upstream, then add the studio-side assertion that
`packages/contracts/astryx.dspack.json` byte-matches the dspack-main
copy, failing output first. Everything else on this roadmap can proceed
in any order after it.
