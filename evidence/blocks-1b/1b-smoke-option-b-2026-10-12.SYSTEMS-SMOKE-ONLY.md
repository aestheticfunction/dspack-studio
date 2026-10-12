# 1b-smoke-option-b-2026-10-12: systems-smoke evidence only

Status: COMPLETE (32 of 32 cells, one invocation, no stop). Not Phase 1B decision evidence.

- Deployment: main 03c9465aef21dc57cdee7d5c3fd03017f0888c52 (Option B, PR #98), build id xyE6-W1k_Lck1rWQf4dEu,
  Worker per-call-model. Baseline for 03c9465: `1b-smoke-option-b-2026-10-12.baseline-03c9465.json` (beside this file).
- Model: claude-haiku-4-5-20251001 on every call. Code identity 2d874a15eb36e5f269da7d2e100054afb15b64168531fadc56999394789762b0.
- Selection: fresh only; prompts rt-01, af-01, gs-01, nb-01; both references; all four arms. Limits: $7, 160 requests,
  12000 ms spacing.
- These records are ADR-B3 addendum stage 1 (systems smoke) evidence: they show the hosted path works and meters.
  They are not decision evidence (4 prompt threads per arm and reference, below the 20 the rule needs), and must not
  be pooled into a later stage's decision.
- The run directory is preserved byte-identical; `1b-smoke-option-b-2026-10-12.SHA256SUMS` pins every file.
- Analysis and reconciliation: `1b-smoke-option-b-2026-10-12.ANALYSIS.md`.
