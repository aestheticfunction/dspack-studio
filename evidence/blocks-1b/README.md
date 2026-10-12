# Phase 1B systems smoke on 03c9465 (Option B): systems-smoke evidence only

This branch preserves the 32-cell systems smoke run against main
`03c9465aef21dc57cdee7d5c3fd03017f0888c52` (PR #98, Option B: per-call model attribution). It is never merged.

- `1b-smoke-option-b-2026-10-12/`: the run directory exactly as the harness left it
  (`packages/block-bench/live/runs/1b-smoke-option-b-2026-10-12`), byte-identical.
- `1b-smoke-option-b-2026-10-12.baseline-03c9465.json`: the zero-cost production baseline captured for 03c9465
  after its deploy (build id `xyE6-W1k_Lck1rWQf4dEu`, Worker `per-call-model`).
- `1b-smoke-option-b-2026-10-12.prerun-checks.txt`: the no-cost checks repeated just before the first paid call.
- `1b-smoke-option-b-2026-10-12.invocation-1.log` and `.invocations.txt`: the one invocation's console output
  (proxy warnings removed), with its start, end and exit code.
- `1b-smoke-option-b-2026-10-12.SHA256SUMS`: sha256 of the run directory's files and the four files above
  (`sha256sum -c` from this directory).
- `1b-smoke-option-b-2026-10-12.ANALYSIS.md`: the reconciliation and analysis. It is recomputed from the raw records
  by `analyze.mjs` (`node analyze.mjs 1b-smoke-option-b-2026-10-12 32`), whose output is
  `1b-smoke-option-b-2026-10-12.analysis.json`.

**Status: systems-smoke evidence only (ADR-B3 addendum, stage 1).**
- It shows whether the hosted path works and meters. It is not Phase 1B decision evidence: there are 4 prompt threads per arm and reference, below the minimum of 20.
- It must not be pooled into a later stage's decision.

Outcome:
- **Cells:** 32 of 32 in one invocation, with no stop: 30 passed and 2 failed, both ordinary arm results.
- **Requests:** 74, every one settled at the provider-reported usage of the run's single model.
- **Spend:** $1.52478375 committed under the $7.00 ceiling, which is $1.452175 at list price plus the 5% credit fee.

The earlier c154548 smoke, which stopped twice, is preserved separately on
`claude/blocks-smoke-c154548-evidence`. It is diagnostic only and is not part of this evidence.
