# Phase 1B systems smoke on c154548: diagnostic evidence only

This branch preserves the stopped 32-cell systems smoke run against main
`c154548465261070eb4a0d0d643a06c6a29c83ae`. It is never merged and never resumed.

- `1b-smoke-2026-10-11/`: the run directory exactly as the harness left it
  (`packages/block-bench/live/runs/1b-smoke-2026-10-11`), byte-identical.
- `1b-smoke-2026-10-11.baseline-c154548.json`: the zero-cost production baseline
  captured for c154548 (build id `_mim-plk4T2Qgrjy6J_uQ`, Worker phase-0.5).
- `1b-smoke-2026-10-11.SHA256SUMS`: sha256 of every file above
  (`sha256sum -c` from this directory).

**Status: diagnostic systems-smoke evidence only.** The five logged cells
(shadcn-v3, fresh: block rt-01, block-positional rt-01, capped rt-01,
production rt-01, block af-01) and the two stopped draws of shadcn-v3
block-positional af-01 must not enter ADR-B3 metrics, the decision rule, or any
later evaluation result. The run stopped twice on the same integrity condition
(`model-missing`: the c154548 Worker named no model on an unusable-output
reply). Option B (per-call model attribution) replaces the design it ran under,
and a fresh run directory is required after it.

Spend recorded in `requests.jsonl`: $1.4677782 committed over 16 requests.
14 were settled at provider-reported usage ($0.3495702 including the 5% credit
fee). 2 unverified block calls were charged the one-call worst-case bound
($0.559104 each).
