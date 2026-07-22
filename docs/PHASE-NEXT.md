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
- **The synchronization invariant** (restored and formalized by P0): at
  every green commit on main, the canonical Astryx contract in
  `dspack/examples/` and the copy consumed in `packages/contracts/` are
  **byte-identical** — enforced by `check:sync` in this repo's CI and by
  dspack-gen's check-sync on its fixture copy. Repository
  synchronization is absolute byte equality; design-system fidelity
  (documented `x-drift` divergences from the Astryx component API,
  checked by `drift-check.ts`) lives *inside* the synchronized artifact.
  The two are never conflated: `x-drift` annotates the contract's
  relationship to Astryx, not any repo-to-repo difference.
- **Contract-change merge protocol (the definition of done)**: the
  canonical change lands in `dspack` first; the consuming dspack-studio
  PR carries the byte-copied file (which keeps intent-plus-scenario PRs
  atomic — the studio PR merges after its paired upstream PR);
  synchronization checks are green in both repositories.
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

## P0 — Contract re-sync upstream — **DELIVERED 2026-07-21**

The one-time studio → dspack catch-up landed as dspack #22 (the
milestone's governance consumed into the canonical copy; verified
superset, nothing upstream-only lost). Steady state is upstream-first:
canonical changes land in dspack, the studio consumes byte-identical
copies. Enforcement: `packages/contracts/scripts/check-sync.mjs`
(`pnpm --filter @dspack-studio/contracts check:sync`, `--write` to
re-sync locally), run by CI on every push and PR; dspack-gen's existing
check-sync guards its fixture copy the same way. The invariant and the
contract-change merge protocol are stated in the standing constraints
above. The take-home view's "byte-synced copy of dspack main" sentence
is accurate again.

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

P0 delivered the invariant-restoring first task (sync landed, check
wired, failing output captured first). The next milestone's
highest-leverage opening move belongs to **P1**: the owner-authored
shadcn intent extension upstream in `dspack/examples/shadcn-ui.dspack.json`
— which now flows through the P0 protocol by construction: canonical
change first, byte-copied consumption second, both sync checks green.
