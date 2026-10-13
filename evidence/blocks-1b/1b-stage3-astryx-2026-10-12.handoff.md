# Morning handoff: Astryx Stage 3, 2026-10-13

## Where things stand

- **The run is complete and capable of a decision.** All 480 of 480 cells ran. The formal ADR-B3 decision is **pass, clear**.
- **No paid activity since 02:28:19Z.** Window 2 was the single authorized resume. There has been no third invocation, and no harness process is running.
- **Nothing else changed:**
  - no change to code, corpus, Cloudflare, git history or deployments;
  - main is unchanged;
  - production still serves the same build.

## Identities

| | |
| --- | --- |
| main | `3aae0eac8495044e7a4de57b1c1bf3a3d59836fe` (local checkout clean) |
| Production | build `txDlHURTKv_S6yicLso97`, Worker `per-call-model` (last read 03:01Z) |
| Code identity | `fe2b8e841d49778793efb9b640e2e2ae3a54048a5c4e540339aaa976ad2cc86d` |
| Corpus | `blocks-1b` v2, `0e4e4706e19ec92565fea2019258cd5d83f6bef0eca424a0634ccf4749b61ae9`, binding |
| Served model | `claude-haiku-4-5-20251001`, on every settled request |
| Run | `2026-10-12T23-36-49-450Z-hosted-ai-claude-haiku-4-5-https-composer-aesthetic-function-com`; manifest sha256 `b4fd45cec960f28b0c66e96be3a1e8c8e59798cbbb98940ef5fb4e4d58fd03e9`, unchanged since the start |
| Evidence | `claude/blocks-stage3-astryx-evidence`, never merged. `0b41881` has the baseline, `17328e3` window 1, `a4da532` window 2 and the verification, and the branch head these documents. |

## The paid run and what it cost

| Invocation | Time (UTC) | Exit | Cells | Requests | Committed |
| --- | --- | --- | ---: | ---: | ---: |
| 1 | 2026-10-12 23:36:46 to 10-13 01:25:50 | 3, an integrity stop at #539 | 387 | 539 | $5.86356015 |
| 2, the resume | 2026-10-13 01:59:08 to 02:28:19 | 0, complete | 93 | 140 | $1.76630475 |
| **The run** | | | **480** | **679 of 1,150** | **$7.6298649 of $17** |

**The total, broken down:**
- **The logged cells:** $6.5116569 with the 5% credit fee ($6.201578 at list). That is 5,073,868 input and 225,542 output tokens over 679 provider calls.
- **Plus #539's worst-case hold, $1.118208.** It stays as the owner directed. The owner's AI Gateway log shows that request as a 429 with no usage and no cost.

**By UTC day** (ledger): 2026-10-12 $0.9216984; 2026-10-13 $6.7081665, including the hold.

**Requests:** 670 settled at the reported usage, 8 busy refusals released at no cost, and 1 not verified (#539).

## The decision

- **Tokens per success:** 7,573 for blocks against 16,048 for production and 14,908 for capped. That is a 52.8% cut against production (95% interval 39.0% to 65.1%), against a 30% threshold.
- **Pass rate:** block 94.2%, capped 95.0%, production 90.0%.
  - Block minus production is +4.2 points (+0.0 to +8.3).
  - Block minus capped is -0.8 points (-3.3 to +1.7), against a -5-point margin.
- **What it rests on:** 24 prompt threads per arm, all metered.
- **Without the binding check** it also passes, clear.
- **The independent recomputation** (`verify_stage3.py`) agrees on every figure, with no findings.
- **Details** are in `1b-stage3-astryx-2026-10-12.decision-packet.md`.
- **Nothing is promoted to Phase 2.**

## Unresolved issues

**Integrity:** none open.
- #539's hold is conservative, kept on purpose.
- Its cause is in `1b-stage3-astryx-2026-10-12.follow-up-429.md`: the Worker reads a 429 only from the error message's text. It interrupts runs and cannot bias them.

**Validity** (decision packet, section 5):
1. **The null add and remove templates do not apply on Astryx's leaf dialogs.** All 13 binding failures in the decision arms are add and remove cells on nb-01 to nb-03. In every arm those surfaces are a single `alert-dialog` with no list, and the static audit marks both templates as always applicable. The decision does not depend on these cells: leaving them out still gives pass, clear.
2. **Clarity rests on scoring untouched add and remove surfaces as misses,** as the frozen rule does. Excusing them keeps pass, but makes the capped comparison uncertain: its interval reaches -5.8 points.
3. **The parity checker never reads strings inside arrays,** which is where Astryx tables keep their columns and cells. Parity is a reported metric, outside the decision.
4. **The scope is narrow:** one reference, one model, one deployment and a purposive set of 24 prompts. shadcn/ui v3 has not run.
5. **`analyze.mjs` is unfit for runs with more than one invocation.** For this run `verify_stage3.py` replaces it.
6. **One doc on main is stale.** `docs/blocks/ADR-B3-AMENDMENT-2.md` still opens "Status: proposed, not adopted", although the owner adopted it and aestheticfunction/dspack-studio#100 merged it (the adoption is recorded in #100's description). Correcting it is a commit to main, which redeploys, so it waits for the next change made between runs.

## Ollama: read-only inventory

**It could not be reached** (checked at 02:50:29Z). This session runs in a cloud container, not on the owner's machine:
- nothing listens on port 11434 at `localhost`, `127.0.0.1` or `::1`;
- `host.docker.internal` does not resolve;
- there is no `ollama` binary, and `OLLAMA_HOST` is unset.

**Nothing was recorded or touched.** `qwen3.8:27b-mlx`'s tag, digest, quantization, context and template metadata, and the Ollama version, are not recorded. Nothing was pulled, loaded or invoked.

**The owner can record them on their own machine** with commands that read metadata and load no model:

```
ollama --version
ollama list
ollama show qwen3.8:27b-mlx
ollama show qwen3.8:27b-mlx --modelfile
```

## The next action that needs the owner's authorization

**Recommended:** option C in `1b-stage3-astryx-2026-10-12.next-stage.md`.
- **What it is:** authorize one narrow pull request that classifies the gateway's 429 by its status. It needs fail-first tests, review and a merge, which redeploys, then a zero-cost baseline.
- **What follows:** a separate decision between B (shadcn/ui v3 Stage 3: up to $77 and 1,275 requests, 123 per daily window, 5 to 12 windows) and A (stop after Astryx).

Nothing paid is pending, scheduled or authorized.

## Where everything is

**On the evidence branch,** `evidence/blocks-1b/` holds:
- the run directory, both invocation logs, both windows' checks and monitor logs;
- `verify_stage3.py` and `.verify.json`, `analysis_stage3.py` and `.sensitivity.json`;
- the decision packet, the 429 follow-up, the next-stage comparison and this handoff;
- `.SHA256SUMS` and `SHA256SUMS`;
- the README, with the run's status.

**Not committed anywhere:** the owner's gateway screenshot and account balances, which are private operator evidence.

**Locally:** the run directory is in place at `packages/block-bench/live/runs/1b-stage3-astryx-2026-10-12`, which is gitignored. The scratchpad holds the monitor, the launch scripts and the raw logs for this session only.
