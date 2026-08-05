# The shadcn contract pin

`packages/contracts/shadcn-ui.dspack.json` is **pinned to one upstream commit** instead of tracking `dspack@main`. This file is the record of that decision.

A pin is not staleness. Staleness is silent and is discovered when something breaks; a pin names the exact bytes this repo was built against, verifies them by hash on every CI run, reports how far behind `main` it sits, and states what has to be true before it is removed.

## The pin

| | |
|---|---|
| **Pinned ref** | [`805732c154f0f214721c9934a450b0edb2656c99`](https://github.com/aestheticfunction/dspack/commit/805732c154f0f214721c9934a450b0edb2656c99) — *feat(shadcn): record-collection intent (v2.3.0)*, 2026‑07‑22 |
| **Pinned contract** | shadcn/ui **v2.3.0** — 8 components, 39 sub-components, 2 intents, 8 rules, 2 worked examples, 70 040 bytes |
| **sha256** | `ca19f8410a97f2004cf1d6f6dd2d7542abccfbb5430b756e0ccdc1ee954c7bb7` |
| **Current upstream** | shadcn/ui **v3.0.0** at [`48643ff`](https://github.com/aestheticfunction/dspack/commit/48643ff) (merged as [`b573637`](https://github.com/aestheticfunction/dspack/commit/b573637), dspack#35) — 32 components, 106 sub-components, 11 intents, 48 rules, 14 worked examples, 460 066 bytes |
| **Tracking issue** | aestheticfunction/dspack-studio#48 |

The pinned copy is byte-identical to that upstream commit — the same artifact `dspack-emit` pins, verified by the same sha256. Nothing is forked: no contract content was copied, edited, or re-authored to make the check pass.

> **The pinned contract is not current shadcn/ui coverage.** It describes 8 of the 32 components the design system's contract now governs. Do not cite this repo's catalogs, scenario surfaces, or renderer coverage as a statement about shadcn/ui support.

## Why the pin exists

dspack#35 merged the production contract (a 4× vocabulary expansion) on 2026‑08‑05. The shadcn renderers, the emit profile, and the scenario surfaces here were all built against v2.3.0.

The sync check runs in CI **before** the unit tests, so once upstream moved, every downstream step — unit tests, type checks, Playwright — was skipped rather than run. That is the concrete harm: not a warning, but a repo whose test evidence silently stopped being produced.

Following `main` would not have widened coverage; it would have broken catalog builds and scenario surfaces, and coupled unrelated work to a migration that cannot land yet.

## Removal condition

Replace the pin with the production contract only after **the dspack-emit representation foundation lands and the profile migration completes** — the emitter must be able to represent the production catalog before this repo consumes it. Tracked in aestheticfunction/dspack-emit#28, whose checklist is the gating work:

- [ ] profile v2 schema + explicit `profileVersion` dispatch
- [ ] v1 directive desugaring into the internal Identity/Route/Collect model
- [ ] load-time validation of selectors and destinations
- [ ] surface fidelity reporting + `--strict-surface`
- [ ] sub-component coverage derived and enforced
- [ ] `functions` support on the profile/catalog path
- [ ] the restated parity invariant

Then: remove the `pin` block, `node scripts/check-sync.mjs --write`, rebuild catalogs (`build:catalogs`), re-record scenario surfaces, and commit them together.

## How the pin is enforced

`packages/contracts/scripts/check-sync.mjs` runs in CI on every push and PR. For a pinned entry it:

1. fetches the artifact at the pinned commit and **fails if its sha256 differs from the recorded hash** — a pinned ref must be immutable, so a change means a force-push, history rewrite or CDN mismatch, never a routine update;
2. fails if the local copy drifts from those exact bytes, as before;
3. fetches the tracked branch and **always prints how far behind the pin sits**, so it can never quietly read as current.

Verified: clean pin exits 0; a mutated expected hash exits 1 with `TAMPERED`; a one-byte local edit exits 1.
