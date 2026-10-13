# Phase 1B stage 3, Astryx only, on corpus v2: run evidence

This branch keeps the evidence of the Astryx-only stage-3 run on corpus v2. It is never merged: a commit to main redeploys the composer and changes the build id a run is held to.

**It first held only the zero-cost production baseline** of main `3aae0eac8495044e7a4de57b1c1bf3a3d59836fe` (aestheticfunction/dspack-studio#100, ADR-B3 amendment 2, adopted by the owner on 2026-10-12). It was captured after that commit's deployment went live. The stage-3 run has not been authorized or started. When it runs, its directory, invocation logs and checksums join this directory.

- `1b-stage3-astryx.baseline-3aae0ea.json`: the record `pnpm --filter @dspack-studio/block-bench baseline` wrote, unedited.
  - **Build id** `txDlHURTKv_S6yicLso97`, first served at 22:26:03Z, about two minutes after the merge. The build served before it was `pPKuI9dQZM9F3iAU_hdnn`.
  - **Worker:** `per-call-model`, refusing the empty probe with 400 and `calls: []`.
  - **Models:** `scripted` and `hosted-ai`.
  - **Sidecars:** both approved, and all three blocks usable on both references.
  - **No model call.** Its four requests are the Worker's refusal of an empty body, the page, that build's manifest and the model list.
- `1b-stage3-astryx.baseline-3aae0ea.capture.txt`: the command's console output, with its start, end and exit code.
- `SHA256SUMS`: run `sha256sum -c SHA256SUMS` from this directory.

Against the 03c9465 baseline (`claude/blocks-smoke-option-b-evidence`), only `at` and `buildId` differ.

**The run this baseline is for.** It is the owner's to authorize, and it has not been run.
- **Corpus:** `blocks-1b` v2, sha256 `0e4e4706e19ec92565fea2019258cd5d83f6bef0eca424a0634ccf4749b61ae9`, scoring binding.
- **Code identity:** `fe2b8e841d49778793efb9b640e2e2ae3a54048a5c4e540339aaa976ad2cc86d`.
- **Scope:** Astryx only, the 24 stage-3 prompts, 480 cells.
- **Caps:** `--max-total-usd 17 --max-total-requests 1150 --max-requests 825 --spacing-ms 12000`.

Corpus v1 (`180f4480…4231`) and both earlier smokes stay systems evidence only. They are preserved on `claude/blocks-smoke-c154548-evidence` and `claude/blocks-smoke-option-b-evidence`.

## Window 1 (2026-10-12 23:36:46Z to 2026-10-13 01:25:50Z): stopped by the harness's integrity stop

**Status:** stopped after 387 of 480 cells. A resume is required, once the cause is understood. The run is open, so nothing may merge to main.

- **The stop.** On `astryx | block-positional | nb-02 | refine-add` the harness stopped itself (exit 3): `usage-missing: a refine call (provider-error) reached the provider without reporting its input tokens as a whole count, so the run cannot meter it`.
  - The request (#539) failed after 2.2 s with a `provider-error` call and no token counts. That is the Worker's 502 path for a non-busy provider failure: not its 45 s timeout, and not a rate limit, which the Worker reports as 503 busy.
  - No record was logged for the cell in flight. It runs again from its start on resume.
  - The request is held in the ledger at its worst case, $1.118208, because its usage is unknown.
  - The operator monitor logged the same line one second after the harness had exited.
- **Requests:** 539 reserved and 539 finalized:
  - 534 settled at the reported usage, every one on `claude-haiku-4-5-20251001`;
  - 4 refusals released before any provider call (503 busy), each passed on its first 30 s backoff;
  - 1 not verified (#539).
- **Cost:** $5.86356015 committed of the $17 ceiling.
  - The logged cells' reported usage: 3,606,843 input and 182,508 output tokens, $4.519383 at list, $4.745352 with the 5% credit fee.
  - Plus #539's worst-case hold.
- **Cells:** 387 logged. 383 completed: 372 passed and 11 failed, both ordinary arm results. 4 were skipped after their fresh cell failed.
- **The reconciliation** (`analyze.mjs`, unchanged from `claude/blocks-smoke-option-b-evidence`, output in `.analysis.json`) has no ledger, mapping or integrity findings.
  - Every final equals its reservation plus adjustments.
  - Every logged cell's ledger total equals its reported usage times 1.05.
  - Every reached call carries usage and the run's model.

**Files:**
- `1b-stage3-astryx-2026-10-12/`: the run directory exactly as the harness left it.
- `.invocation-1.log`: the console output, with Node's experimental-proxy warnings removed.
- `.invocations.txt`: start, end and exit code.
- `.prerun-checks.txt`: the no-cost checks run immediately before the first paid call.
- `.monitor-events.txt`: the operator monitor's log.
- `.analysis.json`: the reconciliation.
- `.SHA256SUMS`: run `sha256sum -c 1b-stage3-astryx-2026-10-12.SHA256SUMS` from this directory.

Window 2 is not started. It is the owner's to authorize, with the same flags and `--resume live/runs/1b-stage3-astryx-2026-10-12` in place of `--out`.
