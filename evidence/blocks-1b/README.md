# Phase 1B stage 3, Astryx only, on corpus v2: run evidence

This branch keeps the evidence of the Astryx-only stage-3 run on corpus v2. It is never merged: a commit to main redeploys the composer and changes the build id a run is held to.

**Status: complete.** All 480 cells ran, over two invocations. Window 1 stopped on the harness's integrity stop after 387 cells. The single resume the owner authorized, window 2, ran the remaining 93 to the end.
- **The decision** (ADR-B3, corpus v2's binding scoring) is **pass, clear**.
- **An independent recomputation** from these files (`verify_stage3.py`) agrees with every figure.
- **The run is closed.** No further paid call is authorized, and nothing in its directory may change.

**It first held only the zero-cost production baseline** of main `3aae0eac8495044e7a4de57b1c1bf3a3d59836fe` (aestheticfunction/dspack-studio#100, ADR-B3 amendment 2, adopted by the owner on 2026-10-12). It was captured after that commit's deployment went live. The stage-3 run was authorized and started after it. Its directory, invocation logs and checksums are below.

- `1b-stage3-astryx.baseline-3aae0ea.json`: the record `pnpm --filter @dspack-studio/block-bench baseline` wrote, unedited.
  - **Build id** `txDlHURTKv_S6yicLso97`, first served at 22:26:03Z, about two minutes after the merge. The build served before it was `pPKuI9dQZM9F3iAU_hdnn`.
  - **Worker:** `per-call-model`, refusing the empty probe with 400 and `calls: []`.
  - **Models:** `scripted` and `hosted-ai`.
  - **Sidecars:** both approved, and all three blocks usable on both references.
  - **No model call.** Its four requests are the Worker's refusal of an empty body, the page, that build's manifest and the model list.
- `1b-stage3-astryx.baseline-3aae0ea.capture.txt`: the command's console output, with its start, end and exit code.
- `SHA256SUMS`: run `sha256sum -c SHA256SUMS` from this directory.

Against the 03c9465 baseline (`claude/blocks-smoke-option-b-evidence`), only `at` and `buildId` differ.

**The run this baseline is for,** as the owner authorized it:
- **Corpus:** `blocks-1b` v2, sha256 `0e4e4706e19ec92565fea2019258cd5d83f6bef0eca424a0634ccf4749b61ae9`, scoring binding.
- **Code identity:** `fe2b8e841d49778793efb9b640e2e2ae3a54048a5c4e540339aaa976ad2cc86d`.
- **Scope:** Astryx only, the 24 stage-3 prompts, 480 cells.
- **Caps:** `--max-total-usd 17 --max-total-requests 1150 --max-requests 825 --spacing-ms 12000`.

Corpus v1 (`180f4480…4231`) and both earlier smokes stay systems evidence only. They are preserved on `claude/blocks-smoke-c154548-evidence` and `claude/blocks-smoke-option-b-evidence`.

## Window 1 (2026-10-12 23:36:46Z to 2026-10-13 01:25:50Z): stopped by the harness's integrity stop

**Status at the time:** stopped after 387 of 480 cells. A resume was required, and nothing could merge to main while the run was open.

- **The stop.** On `astryx | block-positional | nb-02 | refine-add` the harness stopped itself (exit 3): `usage-missing: a refine call (provider-error) reached the provider without reporting its input tokens as a whole count, so the run cannot meter it`.
  - The request (#539) failed after 2.2 s with a `provider-error` call and no token counts. That is the Worker's 502 path for a provider failure it does not read as busy, not its 45 s timeout.
  - **Corrected after window 1:** this was not a provider failure.
    - The owner's AI Gateway log shows the request as HTTP 429, with no usage and no cost: a refusal.
    - The Worker recognizes a busy reply only by its error message's text, so this 429 took the 502 path (see the completed run, below).
    - This replaces the reading above, made from the run's own files, that it was "not a rate limit".
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

The owner authorized one resume, window 2, with the same flags and `--resume live/runs/1b-stage3-astryx-2026-10-12` in place of `--out`.

## Window 2 (2026-10-13 01:59:08Z to 02:28:19Z): the single authorized resume, completed

**Before it, the no-cost checks ran again** (`.preresume-checks.txt`):
- main and the checkout were at `3aae0ea`, clean, with no harness running;
- the local run directory was identical to window 1's evidence (`17328e3`), and the manifest's sha256 (`b4fd45ce…03e9`) was unchanged;
- all 56 evidence checksums were OK;
- the run's ledger stood at 539 requests and $5.86356015 committed;
- the zero-cost probe equalled the baseline apart from its time: build `txDlHURTKv_S6yicLso97`, Worker `per-call-model`, no model call;
- the plan and the code identity were unchanged.

**The resume:**
- **Command:** the window-1 flags, with `--resume live/runs/1b-stage3-astryx-2026-10-12`.
- **Time and exit:** it started at 01:59:08Z and exited 0 at 02:28:19Z, the run complete.
- **What it ran:** the stopped cell first (`astryx | block-positional | nb-02 | refine-add`, from its start), then the rest: 93 cells.
- **Requests:** 140 reserved and 140 finalized; none unverified.
  - 136 settled at the reported usage, every one on `claude-haiku-4-5-20251001`.
  - 4 busy refusals (503) were released before any provider call, each passed on its first 30 s backoff.
- **Cost:** $1.76630475 committed. That equals its cells' reported usage with the 5% credit fee ($1.682195 at list).
- **Cells:** 93 logged and completed: 87 passed, 2 failed-lint-exhausted and 4 failed-adapter. These are on the pipeline's pass, and all are arm results.
- **The operator monitor** logged the 4 released refusals and the harness's exit. None of its stop conditions fired.

## The completed run

**Requests:** 679 reserved and 679 finalized, within the caps of 1,150 requests and $17:
- 670 settled at the reported usage, all on `claude-haiku-4-5-20251001`;
- 8 busy refusals released, 4 in each window;
- 1 not verified: window 1's #539.

**Cost:** $7.6298649 committed of $17.
- **The logged cells' reported usage:** 5,073,868 input and 225,542 output tokens over 679 provider calls (670 requests, 9 with a Worker parse retry). That is $6.201578 at list and $6.5116569 with the fee.
- **Plus #539's worst-case hold, $1.118208.** It stays as the owner directed. The owner's AI Gateway log shows that request cost nothing, so the committed figure overstates the run by the hold.
- **By UTC day** (the ledger's finals): 2026-10-12 $0.9216984; 2026-10-13 $6.7081665, including the hold.

**Cells:** 480 logged.
- 476 completed, on the pipeline's pass:
  - 459 passed;
  - 17 failed: 10 failed-lint-exhausted and 7 failed-adapter for an unusable output, all arm results and none eligible for a re-run.
- 4 skipped: block-positional af-01's refinements, after its fresh build failed.

**The decision** (ADR-B3, corpus v2, binding scoring): **pass, clear**.

| Arm | Tokens per success (metered tokens / successes) | Pass rate (passed / evaluated) |
| --- | ---: | ---: |
| block | 7,573 (855,784 / 113) | 94.2% (113 / 120) |
| capped | 14,908 (1,699,513 / 114) | 95.0% (114 / 120) |
| production | 16,048 (1,733,209 / 108) | 90.0% (108 / 120) |

- **Tokens per success:** 52.8% fewer than production (95% interval 39.0% to 65.1%) and 49.2% fewer than capped (36.1% to 61.1%).
- **Pass rate:** block minus production is +4.2 points (+0.0 to +8.3); block minus capped is -0.8 points (-3.3 to +1.7).
- **What it rests on:** 24 prompt threads per arm, all metered. The intervals come from 2,000 paired cluster resamples over the 24 prompts.
- **Without the binding check** (the pipeline's pass alone), it also passes, clear: 118, 117 and 113 of 120, and a 52.7% cut.

**Independent verification** (`verify_stage3.py`, result in `.verify.json`): **no findings.** Without the harness's code, it recomputes from these files and the frozen corpus:
- **The ledger:** reservation by reservation, in whole nanodollars.
- **The cell-to-request mapping:** each invocation separately. Every settled request equals its cell's reported usage at $1 and $5 per million tokens plus 5%, and every refusal is released.
- **Window 1 still holds:**
  - its content is an exact prefix of each log;
  - the manifest and preflight are unchanged;
  - the only orphan request is #539.
- **The saved surfaces:** every surface digest, `changed` flag and add or remove check, re-derived from the surfaces themselves.
- **The decision, exactly:**
  - binding scoring, every pooled and per-condition arm statistic, the selection figures, the paired counts and the named-against-positional comparison;
  - the seeded bootstrap intervals.
- **The bootstrap, independently:** a different generator (20,000 resamples, and 200 seeds of 2,000) calls the decision clear every time.

**Sensitivity** (`analysis_stage3.py`, result in `.sensitivity.json`). These are readings beside the verdict, and none replaces it.
- **Every binding failure sits on three prompts.** All 13 of the decision arms' binding failures are add or remove cells on nb-01 to nb-03, the destructive confirmations.
  - In every arm, those surfaces are a single Astryx `alert-dialog` with no list, so "Add one more item." and "Remove the last item." have nothing to act on.
  - On null prompts the block arm runs the production configuration, so these failures say nothing about blocks.
- **Excusing unchanged misses** (counting an untouched surface as a correct no-op) keeps the pass verdict. Block minus capped's interval then reaches -5.8 points, so that reading is uncertain.
- **Leaving out any single prompt** keeps the decision pass and clear in all 24 cases.

**`analyze.mjs` is not used for this run.** It was written for single-invocation smokes.
- It walks the ledger as one sequence. After window 1's orphan request it pairs every later cell with the request before its own, and reports 88 spurious mapping differences.
- It reads the pipeline's pass, not binding scoring.
- `verify_stage3.py` maps each invocation on its own and finds none.

**Files (window 2 and the completed run):**
- `1b-stage3-astryx-2026-10-12/`: the run directory exactly as the harness left it at exit, including `preflight.resume-1.json`, the resume's preflight.
- `.invocation-2.log`: the resume's console output, with Node's experimental-proxy warnings removed.
- `.invocations.txt`: both invocations' start, end and exit code.
- `.preresume-checks.txt`: the no-cost checks run immediately before the resume's first paid call.
- `.monitor-events-2.txt`: the operator monitor's log for window 2.
- `verify_stage3.py` and `.verify.json`: the independent verification and its result.
- `analysis_stage3.py` and `.sensitivity.json`: the decision-packet tables and the sensitivity readings.
- `.SHA256SUMS`: covers every file of the run, both windows. `SHA256SUMS` covers the baseline and this README.

**To re-run the verification from a checkout of this branch:**

```
mkdir -p /tmp/w1
git archive 17328e3 evidence/blocks-1b/1b-stage3-astryx-2026-10-12 | tar -x -C /tmp/w1
git show 3aae0ea:packages/block-bench/live/corpora/blocks.v2.json > /tmp/blocks.v2.json
cd evidence/blocks-1b
python3 -I verify_stage3.py 1b-stage3-astryx-2026-10-12 /tmp/w1/evidence/blocks-1b/1b-stage3-astryx-2026-10-12 /tmp/blocks.v2.json /tmp/verify.json
```
