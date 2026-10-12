# Option B systems smoke (2026-10-12): reconciliation and analysis

**Systems-smoke evidence only (ADR-B3 addendum, stage 1).** It shows whether the hosted path works and meters. It is
not Phase 1B decision evidence: 4 prompt threads per arm and reference, below the 20 the rule needs. The harness's own
verdict for both references is `insufficient`.

Every figure below comes from the run directory's raw records (`requests.jsonl`, `runs.jsonl`, `manifest.json`,
`pacing.jsonl`), recomputed independently by `analyze.mjs`. It agrees with the harness's `REPORT.md` on every shared
figure.

## Run

| | |
|---|---|
| Run id | `2026-10-12T03-39-07-159Z-hosted-ai-claude-haiku-4-5-https-composer-aesthetic-function-com` |
| Directory | `packages/block-bench/live/runs/1b-smoke-option-b-2026-10-12` |
| Invocations | 1 of the 3 allowed: 03:39:01Z to 03:53:47Z, exit 0, no stop |
| Deployment | main `03c9465` (PR #98, Option B), confirmed active by the owner; build `xyE6-W1k_Lck1rWQf4dEu`; Worker `per-call-model` |
| Deployment during the run | preflight equal to the 01:10Z baseline; build id polled every 2 minutes, never changed; unchanged after the run |
| Model | `claude-haiku-4-5-20251001`, recorded from the first metered call (03:39:11.831Z), on every call |
| Code and corpus | code identity `2d874a15…` (dspack-gen 0.5.0, dspack-emit 0.7.0); corpus `blocks-1b` v1, frozen 2026-10-10 |
| Limits | $7.00 ceiling; 160 requests in total and per invocation; 12000 ms spacing |

## Spend and reconciliation

| Measure | Value |
|---|---|
| Requests (ledger) | 74, each with one reservation and one settlement |
| Settlement reasons | 74 "settled at the reported usage"; none raised, none released, none unsettled |
| Served model on settlements | `claude-haiku-4-5-20251001` only |
| Provider-reported usage | 1,297,835 input + 30,868 output tokens, over 74 provider calls |
| List price ($1/M input, $5/M output) | **$1.452175** |
| With the 5% credit fee | $1.524784 |
| Ledger committed | **$1.52478375**. Each cell's ledger amount equals its reported usage × 1.05 to the nanodollar. |
| Headroom | $5.48 of $7.00 unused; 86 of 160 requests unused |
| Cloudflare balance | $8.25 before the run (owner's reading). Not readable from here. Expected ≈ **$6.80** if debited at list price, as the c154548 smoke's $0.33 drop was. The gateway should log 74 requests between 03:39 and 03:54Z. |

## Cells

Planned 32. Started 32. Completed 32. **Passed 30. Failed 2.** Skipped 0. Re-run eligible 0. Superseded 0.

### By arm (both references)

| Arm | Passed | First attempt | Pipeline repairs | Block repairs | Re-issues | Provider calls | Input | Output | Tokens/success | Ledger |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| block | 8/8 | 8 | 0 | 0 | 0 | 16 | 94,206 | 3,450 | 12,207 | $0.1170 |
| block-positional | 7/8 | 7 | 0 | 1 | 2 | 19 | 97,659 | 3,426 | 14,441 | $0.1205 |
| capped | 7/8 | 6 | 3 | 0 | 0 | 19 | 520,262 | 12,232 | 76,071 | $0.6105 |
| production | 8/8 | 5 | 4 | 0 | 0 | 20 | 585,708 | 11,760 | 74,684 | $0.6767 |

### By reference and arm (tokens per success as ADR-B3 defines it: all calls, planning included, failures included, over successes)

| Reference | block | block-positional | capped | production | Block vs production | Block vs capped |
|---|---:|---:|---:|---:|---:|---:|
| shadcn-v3 | 19,567 (4/4) | 19,654 (4/4) | 160,374 (3/4) | 136,573 (4/4) | −85.7% | −87.8% |
| astryx | 4,847 (4/4) | 7,490 (3/4) | 12,843 (4/4) | 12,794 (4/4) | −62.1% | −62.3% |

Both reductions pool nb-01, where every arm correctly takes the primitive path. Over 4 prompts the intervals are not
interpretable (addendum), so these are a systems check that the metering works, not an estimate of the effect.

### By prompt

| Prompt | Passed | Notes |
|---|---:|---|
| rt-01 (records-table) | 7/8 | astryx block-positional failed (output) |
| af-01 (auth-form) | 8/8 | astryx block-positional passed after one unusable output was re-issued |
| gs-01 (guide-steps) | 7/8 | shadcn-v3 capped failed-gate; shadcn-v3 production needed both repairs |
| nb-01 (null) | 8/8 | all four block-arm cells chose null and took today's path |

### Planning and selection

- The planner chose the expected intent in 32 of 32 cells.
- In the block arms it chose the expected block in 16 of 16 cells: 12 hits and 4 correct nulls. There were no omissions, rejections or planning failures.
- The block question adds about 280 tokens to the planning request: 2.37k against 2.09k on shadcn, 1.28k against 1.00k on Astryx.

## Retry and repair behavior

- **Pipeline repairs:** 7, all on shadcn-v3 primitive chains. capped had 3 (gs-01 2, nb-01 1) and production had 4 (rt-01 1, af-01 1, gs-01 2). Astryx had none.
- **Block repairs** (feedback after B1/B2): 1, on astryx block-positional rt-01.
- **Re-issues** under the ADR-B4 unusable-output rule: 2.
  - astryx block-positional af-01's block call was re-issued and passed.
  - astryx block-positional rt-01's block repair was re-issued and was unusable again.
- **None of the following occurred:**
  - Worker parse retries (the production arm's second internal call);
  - gateway refusals or backoffs;
  - fallbacks;
  - invariant failures;
  - typed budget errors.
- **Pacing:** 71 spacing waits, 593 s in total.

## Failures (both ordinary arm results)

1. **`failed-gate`, shadcn-v3 capped gs-01.**
   - It made three generation calls, with 63.9k, 65.9k and 70.1k input tokens.
   - The last attempt passed S1–S3 but failed the emit gate. In dspack-gen, `failed-gate` means a lint-clean surface that the emitter refused, here with no repair budget left.
   - The run record does not persist the gate finding, so the component or rule that was refused is unknown.
   - The same prompt needed both repairs in production and passed at attempt 3. Both block arms passed it with one block call.
2. **`failed-adapter`, kind `output`, astryx block-positional rt-01.**
   - B1 rejected the decoded positional call at `$.p.2` ("expected an array").
   - The one feedback block repair returned unusable output (177 output tokens). It was re-issued once and was unusable again (168).
   - All four calls report usage and the run's model. The cell is not re-run eligible.
   - The raw model output is not persisted, by design. The trace keeps only the issue path, byte counts and digests.

There were no provider, policy, budget, invariant or integrity failures.

## Named against positional (ADR-B2; informs ADR-B2, decides nothing)

- **Pass rate:** named 8/8, positional 7/8.
- **Failures:** all three unusable outputs in the run, and its one B1 rejection, came from the positional arm, both on Astryx.
- **Tokens:**
  - Positional block calls read more input: 586–733 tokens against 435–553 for named, because of the projection's instructions.
  - They write similar or fewer output tokens: auth-form 38–41 against 68; records-table 341 against 353; guide-steps 323 against 448 on shadcn, and 428 against 435 on Astryx.
  - Net tokens per success are higher for positional on all 4 shadcn prompts (+0.4%) and on all 3 comparable Astryx prompts (7,490 against 4,847: the failed cell's tokens count against no success, and one call was re-issued).
- **Raw answer bytes:** positional is smaller for auth-form (78–86 against 156) and about the same otherwise.
- **The shadcn-v3 positional auth-form cell**, which stopped the c154548 smoke twice, passed this time on its first call (586 in, 38 out). The c154548 run is cited here for context only, not counted. The positional prompt was not changed.

## Request sizes and the tokenizer

| Request | shadcn-v3 | astryx |
|---|---:|---:|
| Planning | 2.09k (primitive arms) / 2.37k (block arms) | 1.00k / 1.28k |
| Block call | 436–733 input tokens | 435–732 |
| Primitive generation | 63.8k–67.6k | 11.15k–11.5k |
| Request bytes per cell, block path | 12.0–12.9 KB | 7.1–9.6 KB |
| Request bytes per cell, primitive path | 232–717 KB | 43.7–45.2 KB |

- **Claude tokens against the offline o200k counts of the same requests:** planning 1.09–1.13, block 1.12–1.14, generation 1.19–1.20. The authorization packet assumed 1.25.
- **Median provider latency per call:** planning 2.0 s; block 2.6–3.3 s; generation 5.3 s on shadcn and 1.9 s on Astryx; shadcn repair 6.5 s.
- **Cell timings include the 12 s pacing waits**, so they are not product latency.

## Integrity and accounting invariants (all held)

1. **Calls:** every one of the 74 provider calls reported both usage figures and named its own model, `claude-haiku-4-5-20251001`. No call went unreported and none was model-free.
2. **Ledger:** every ledger request has exactly one reservation and one settlement, settled at the reported usage. The ledger equals the reported usage × 1.05 per cell.
3. **Limits:** $1.52478375 ≤ $7.00, and 74 ≤ 160 requests, both in total and per invocation.
4. **Run records:**
   - The manifest's `servedModel` was recorded once and held, with no `setAside`.
   - There was one invocation, and its lock was taken and released.
   - There are no torn lines and no superseded records.
5. **Deployment:** constant from the preflight through the post-run check.
6. **Request bytes:**
   - Production requests carry no `maxCalls`: wherever capped and production sent the same requests, each capped body is exactly 13 bytes larger (`,"maxCalls":1`).
   - The request-hash oracle passes on this checkout after the run: block-bench 203/203, including `bench.test.ts` 9/9, and Composer `hosted-build.test.ts` 43/43.
7. **Inputs:** the corpus is frozen and the code identity is unchanged.

**Option B removed the run-wide blocker.**
- The event that stopped the c154548 smoke twice, unusable output at a block call, occurred three times here.
- Each time, every call was metered with its own model and became an arm event: one re-issue that passed, and one output failure.
- The run never stopped.
