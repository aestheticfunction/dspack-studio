# shadcn/ui v3 Stage 3 on corpus v2: run evidence

This branch keeps the evidence of the shadcn/ui v3 Stage-3 run on corpus v2, and the zero-cost production baseline that run is held to (below). It is never merged: a commit to main redeploys the composer and changes the build id a run is held to.

**Status: the run is open.** Windows 1 to 3 are complete. Each stopped cleanly at its request cap, and together they cover 211 of 480 cells. The remaining windows run back to back under the owner's authorization (below).

## Operational change: the daily spend limit (2026-10-15)

At 22:47Z on 2026-10-15, after window 2 and before window 3, the owner temporarily raised the Cloudflare daily spend limit from $10 to $40. With it, the remaining windows run back to back instead of one per UTC day.
- **Made by the owner,** and explicitly authorized.
- **Nothing else changed in Cloudflare:** auto top-up stays off.
- **Temporary:** the owner restores the $10 limit after the run.

**Nothing in the experiment changes:**
- each window keeps its 123-request cap and 12 s spacing;
- the run keeps its $77 and 1,275-request ceilings;
- the model, build, corpus, sidecars and every identity check stay as they were;
- each window starts only after the one before it has stopped cleanly at its cap, and its evidence is preserved, verified and pushed.

Only the readiness packet's pace of one window a day, which the $10 limit set, is lifted. A Cloudflare limit response still stops the run, as does any STOP or HOLD, provider failure, integrity or verification finding, or identity change.

## Window 1 (2026-10-15)

**Authorized by the owner, window 1 only:**
- **Corpus:** `blocks-1b` v2, `0e4e4706e19ec92565fea2019258cd5d83f6bef0eca424a0634ccf4749b61ae9`, scoring binding.
- **Reference and model:** `shadcn-v3`, all three blocks approved; `claude-haiku-4-5-20251001`.
- **Build and code:** `Dyml8RSqfWynKU1KbVuZI`; code identity `51c80cec7a652216c3b9b28b1467e8c45eb0ecebe170969854bb1d49d3c8a229`.
- **Caps:** `--max-total-usd 77 --max-total-requests 1275 --max-requests 123 --spacing-ms 12000`.
- **Scope:** the 24 Stage-3 prompts, 4 arms and 5 conditions, 480 cells.
- **Tooling:** `monitor_run.py`, `monitor-shadcn.json` and `verify_run.py` from `claude/blocks-stage3-astryx-evidence` at `e3f57da`, the readiness packet's frozen versions. Their sha256 are in the pre-run checks.

**Before the first paid call:**
- Every no-cost check was repeated from 00:22:11Z to 00:22:21Z, and all passed (`.prerun-checks.txt`):
  - main and the checkout at `7e260c3`, clean, and no harness or monitor running;
  - a fresh run directory;
  - 394 evidence checksum entries and the tooling's 312;
  - the monitor's configuration against the authorization;
  - the zero-cost probe equal to this branch's baseline apart from `at`;
  - the command through the harness's own parser, selection check, frozen pin and planner (480 cells), with the corpus digest and the code identity.
- **The owner confirmed** that the Cloudflare credit balance covers the run's $77 ceiling, and that the controls are unchanged:
  - auto top-up off;
  - the $10/day limit active;
  - Retry Requests off, and cache off;
  - no dynamic route, fallback, DLP rule, guardrail or spend rule reroutes or synthetically answers Claude Haiku 4.5.

  The balance itself is not recorded here.

**The invocation:** 00:22:21Z to 00:44:57Z, exit 0, launched with the readiness packet's frozen command and monitor (`.prerun-and-launch.sh`).
- **Its stop:** "the pacing cap of 123 requests for this invocation is reached; resume later".
- **104 requests sent.** The harness starts no cell whose worst case could carry it past the cap.

**The ledger:** 104 requests, each with one reservation and one final.
- **103 settled** at the reported usage, every one on `claude-haiku-4-5-20251001`.
- **1 zero-cost busy refusal** (#57, a 503 busy reply). It was released at $0 and retried once, after the 30 s backoff.
- **No hold,** and no request left open.
- **Committed:** $4.4553222, which is $4.243164 at list price plus the 5% credit fee. That is against the run's $77 ceiling, and 104 of its 1,275 requests.

**The cells:** 72 of 480. 64 completed, of which 58 passed, and 8 were skipped. The skipped cells are the refinements of two block-positional fresh builds that did not pass. Every failure is an ordinary arm result:
- **block:** 2 failed gates and 1 failed adapter, all three structural refinements on the fallback path (an unsupported refinement);
- **block-positional:**
  - 2 fresh builds (rt-02, rt-03) whose block call returned unusable output twice, classified as output and not re-run;
  - 1 structural refinement whose lint repairs ran out;
- **capped and production:** none.

**Tokens:** 104 provider calls, with 3,723,359 input and 103,961 output tokens. Priced at Claude Haiku 4.5's rates, the calls equal the settled total exactly.

**The monitor:** exit 0, with no STOP or HOLD line.
- It saw all 104 requests.
- It read the live build 44 times, always `Dyml8RSqfWynKU1KbVuZI`, at most 32 s apart.
- It allowed the one refusal within its schedule.

**Verification** of window 1's copy, as origin holds it at `1cc106b`:
- **`verify_run.py`** (at `e3f57da`), with the packet's command (`--monitor-config`, `--monitor-events`, `--invocations`, `--expect-build`, `--expect-code`, `--expect-max-requests 123`):
  - no findings;
  - one note: 408 planned cells have no record yet.

  It maps every one of the 104 requests to its cell, with no orphan and no request held. It also recomputes:
  - every surface's digest and the 24 add and remove operations, with no mismatch;
  - the monitor's count, 104, against the ledger.

  The run's decision reads "insufficient", as it must with 3 to 4 prompt threads per arm.
- **`reconcile_window.py`** reconciles the window independently from the raw files, and shares no code with the harness or the verifier. It agrees on every figure:
  - every request, settlement, refusal, model, token and dollar;
  - the cell records' calls, priced at Claude Haiku 4.5's rates, equal the settled total to the nanodollar.

## Window 2 (2026-10-15)

**Authorized by the owner, window 2 only,** on the existing run under the frozen protocol, with the same caps.
- **Cloudflare:** the owner confirmed that the credit balance covers the run's remaining ceiling, and that the Cloudflare controls are unchanged. The balance itself is not recorded here.
- **Timing:** the owner chose to run it on window 1's UTC day. They accepted that the day's combined spend might reach Cloudflare's $10 daily limit, and that a limit response would count as a clean cap stop.
- **The scheduled next-day launch** was cancelled first.

**Before the first paid call:** every no-cost check was repeated from 20:20:10Z to 20:20:38Z, and all passed (`.window-2.preresume-checks.txt`):
- main and the checkout at `7e260c3`, clean, and no harness or monitor running;
- every evidence branch at its expected head, and 417 checksum entries;
- the run directory byte-identical to window 1's copy at `1cc106b`:
  - 104 requests, all finalized;
  - $4.4553222 committed;
  - no lock;
- the frozen tooling and the monitor's configuration;
- the zero-cost probe equal to the baseline apart from `at`;
- the resume command through the harness's own parser, selection check, frozen pin and planner (480 cells, the same caps), with the corpus digest and the code identity;
- one preflight, so the monitor's window count was `--preflights 2`.

**The invocation:** 20:20:38Z to 20:43:31Z, exit 0. It ran the packet's frozen command with `--resume live/runs/1b-stage3-shadcn-2026-10-15` (`.window-2.preresume-and-launch.sh`).
- **Its stop:** "the pacing cap of 123 requests for this invocation is reached; resume later".
- **105 requests sent.**

**Window 2's ledger:** 105 requests, each with one reservation and one final.
- **104 settled** at the reported usage, every one on `claude-haiku-4-5-20251001`.
- **1 zero-cost busy refusal** (#99, a 503 busy reply). It was released at $0 and retried once, after the 30 s backoff. It was not a Cloudflare limit response: the window carried on to its cap.
- **No hold,** and nothing left open.
- **Committed:** $4.66405695, which is $4.441959 at list price plus the 5% credit fee.
- **Window 1's records are unchanged.** Its ledger, cell records and pacing entry are byte-for-byte prefixes of the files as window 2 left them.

**The run so far:**
- **Requests:** 209 of its 1,275, of which 207 settled and 2 released.
- **Committed:** $9.11937915 ($8.685123 at list price) of its $77 ceiling.
- **Cells:** 145 of 480.
- **Daily limit:** both windows ran on 2026-10-15 UTC, together $8.685123 at list price, under the $10 daily limit.

**Window 2's cells:** 73, covering the rest of rt-04, then rt-05, rt-06 and af-01, and the first cells of af-02. 69 completed, of which 64 passed, and 4 were skipped. Every failure is an ordinary arm result:
- **block:** 1 failed gate, rt-05's structural refinement on the fallback path;
- **block-positional:**
  - 2 failed gates, rt-05's and rt-06's structural refinements on the fallback path;
  - 1 fresh build (af-01) whose block call returned unusable output twice. Its 4 refinements were skipped;
- **production:** 1 structural refinement (af-01) whose output was unusable, classified as output;
- **capped:** none.

**Window 2's tokens:** 105 provider calls, with 3,994,184 input and 89,555 output tokens. Priced at Claude Haiku 4.5's rates, the calls equal the window's settled total exactly.

**The monitor:** exit 0, with no STOP or HOLD line.
- It saw all 105 requests.
- It read the live build 44 times, always `Dyml8RSqfWynKU1KbVuZI`.
- It allowed the one refusal within its schedule.

**Verification** of window 2's copy, as origin holds it at `4c3db56`:
- **`verify_run.py`** (at `e3f57da`), with the packet's command (`--snapshot` set to window 1's copy at `1cc106b`, and both monitor events logs):
  - no findings;
  - one note: 335 planned cells have no record yet.

  It maps all 209 requests to their cells, with no orphan and nothing held. It also checks:
  - window 1's 72 records are kept, and none was moved aside;
  - the 52 add and remove operations recompute with no mismatch;
  - each monitor's count (104, then 105) equals the ledger's.

  The decision reads "insufficient", as it must with 7 to 8 prompt threads per arm.
- **`reconcile_window.py`**, independent of the harness and the verifier, agrees on every figure across both windows:
  - 209 requests, 207 settled and 2 released at $0;
  - $9.11937915 committed;
  - every settlement and call on `claude-haiku-4-5-20251001`;
  - 7,717,543 input and 193,516 output tokens, whose price equals the settled total to the nanodollar.

## Window 3 (2026-10-15)

**Authorized by the owner,** together with the remaining windows back to back, under the operational change above.
- The owner started it at once, on the same UTC day as windows 1 and 2. The owner's $40 daily limit covers that day's earlier spend.
- The scheduled launch was cancelled first.
- It ran with `shadcn-window.sh launch 3 4c3db56`.

**Before the first paid call:** every no-cost check was repeated from 23:05:31Z to 23:05:40Z, and all passed (`.window-3.preresume-checks.txt`):
- main and the checkout at `7e260c3`, clean, and no harness or monitor running;
- every evidence branch at its expected head, and 431 checksum entries;
- the run directory byte-identical to window 2's copy at `4c3db56`, the branch's copy unchanged since:
  - 209 requests, all finalized, nothing held;
  - both earlier windows stopped at their caps;
- the frozen tooling and the monitor's configuration;
- the zero-cost probe equal to the baseline apart from `at`;
- the resume command through the harness's own parser and planner;
- two preflights, so `--preflights 3`;
- the operator record holding invocations 1 and 2.

**The invocation:** 23:05:40Z to 23:26:58Z, exit 0.
- **Its stop:** "the pacing cap of 123 requests for this invocation is reached; resume later".
- **104 requests sent.**

**Window 3's ledger:** 104 requests, each with one reservation and one final.
- **103 settled** at the reported usage, every one on `claude-haiku-4-5-20251001`.
- **1 zero-cost busy refusal** (#56, a 503 busy reply). It was released at $0 and retried once, after the 30 s backoff. It was not a Cloudflare limit response: the window carried on to its cap.
- **No hold,** and nothing left open.
- **Committed:** $4.06116165, which is $3.867773 at list price plus the 5% credit fee.
- **Window 2's records are unchanged.** Its ledger, cell records and pacing entries are byte-for-byte prefixes of the files as window 3 left them.

**The run so far:**
- **Requests:** 313 of its 1,275.
- **Committed:** $13.1805408 ($12.552896 at list price) of its $77 ceiling.
- **Cells:** 211 of 480.
- **Daily spend:** windows 1 to 3 all ran on 2026-10-15 UTC, together $12.552896 at list price, within the owner's $40 daily limit.

**Window 3's cells:** 66, covering the auth-form prompts af-02 to af-05. All 66 completed, and 58 passed. Every failure is a structural refinement, and an ordinary arm result that is not re-run:
- **unusable output, twice** (classified output): 6 cells:
  - capped: af-02;
  - production: af-02 and af-04;
  - block: af-05;
  - block-positional: af-03 and af-05;
- **block af-03:** its budget of 3 model calls ran out on the fallback path;
- **block-positional af-04:** a failed gate on the fallback path.

There was no provider or policy failure.

**Window 3's tokens:** 106 provider calls, 15 of which returned unusable output. They used 3,594,108 input and 54,733 output tokens, and priced at Claude Haiku 4.5's rates they equal the window's settled total exactly.

**The monitor:** exit 0, with no STOP or HOLD line.
- It saw all 104 requests.
- It read the live build 42 times, always `Dyml8RSqfWynKU1KbVuZI`.
- It allowed the one refusal within its schedule.

**Next:** window 4 follows at once with `shadcn-window.sh launch 4 <this window's copy>`, which runs the monitor with `--preflights 4`. It starts only if window 3's evidence verifies.

## Files of the run

- `1b-stage3-shadcn-2026-10-15/`: the run directory exactly as the harness left it (`packages/block-bench/live/runs/1b-stage3-shadcn-2026-10-15`), byte-identical. Each window's copy is the commit that preserved it:
  - window 1's is `1cc106b`;
  - window 2's is `4c3db56`;
  - later windows' commits are named in their sections and reports.
- `1b-stage3-shadcn-2026-10-15.prerun-checks.txt`: the no-cost checks, repeated immediately before the first paid call.
- `1b-stage3-shadcn-2026-10-15.prerun-probe.json`: the zero-cost probe those checks made.
- `1b-stage3-shadcn-2026-10-15.prerun-and-launch.sh` and `.plan-check.mts`:
  - the script that ran the checks and then launched the packet's frozen command and monitor;
  - its offline plan check.
- `1b-stage3-shadcn-2026-10-15.invocations.txt`: the operator's record of each invocation's start, end and exit code.
- `1b-stage3-shadcn-2026-10-15.window-2.preresume-checks.txt`, `.window-2.preresume-probe.json`, `.window-2.preresume-and-launch.sh`, `.window-2.plan-check.mts` and `.window-2.launch-console.txt`: window 2's checks, probe, launch script, plan check and console, as for window 1. Later windows have the same files under `.window-<k>.`, except that they share the `.window-k.` scripts.
- `1b-stage3-shadcn-2026-10-15.invocation-<k>.log`: each invocation's console output, unedited. Their only warnings are Node's "EnvHttpProxyAgent is experimental".
- `1b-stage3-shadcn-2026-10-15.monitor-events-<k>.log`: the operator monitor's events log for each window.
- `1b-stage3-shadcn-2026-10-15.launch-console.txt`: the launch script's console, holding the checks, the monitor's output and its exit code.
- `1b-stage3-shadcn-2026-10-15.window-1.verify.json` and `.txt`: the verifier's result and console for window 1's copy, as origin holds it at `1cc106b`.
- `1b-stage3-shadcn-2026-10-15.window-1.reconcile.json` and `.txt`: the independent reconciliation of the same copy.
- `1b-stage3-shadcn-2026-10-15.window-2.verify.json` and `.txt`, and `.window-2.reconcile.json` and `.txt`: the verifier's result and the reconciliation for window 2's copy, as origin holds it at `4c3db56`.
- `1b-stage3-shadcn-2026-10-15.window-k.preresume-and-launch.sh` and `.window-k.preserve.sh`: the operator scripts for window 3 onward, under the owner's standing authorization.
  - **The launch script** generalizes window 2's. It takes the window number and the commit that preserved the previous window's copy, and reads the expected state from that copy:
    - the run directory byte-identical to it;
    - every request finalized, nothing held;
    - every earlier window stopped at its cap;
    - the identity and caps unchanged.

    It then repeats every no-cost check and launches the packet's frozen command with `--resume`, with the monitor at `--preflights` equal to the window number, only if all pass.
  - **The preserve script** adds the window's copy to this branch.
- `reconcile_window.py`: that reconciliation's script. Run it as `python3 -I reconcile_window.py <run dir> <invocations.txt> <monitor events log> <out.json>`.
- `1b-stage3-shadcn-2026-10-15.SHA256SUMS`: the sha256 of the run directory's files and of every file above. Run `sha256sum -c 1b-stage3-shadcn-2026-10-15.SHA256SUMS` from this directory.

## The baseline the run is held to

This branch holds the zero-cost production baseline of main `7e260c38029ab0a1df1fc499733ed037c06d60db`. It was captured after the deployment of aestheticfunction/dspack-studio#102, the measurement-readiness change:
- parity reads strings in arrays;
- amendment 2 is recorded as adopted;
- the busy-refusal documentation is precise.

The baseline's status:
- **It is never merged.** A commit to main redeploys the composer and changes the build id a run is held to.
- **No documentation-only deployment follows it.**
- **No run is authorized by it.** A shadcn/ui v3 run, or any other paid or local run, needs the owner's authorization.

### Files

- `1b.baseline-7e260c3.json`: the record `pnpm --filter @dspack-studio/block-bench baseline` wrote, unedited.
  - **Build id** `Dyml8RSqfWynKU1KbVuZI`, first seen at 2026-10-14 03:14:13Z, about 6 minutes after the merge at 03:08:28Z. The build served at 03:08:21Z, just before the merge, was `w6ajVrX5g8V0WhqowIBGN`. No other commit reached main in between.
  - **Main's CI on `7e260c3` passed:** run 38504702977, finished at 03:16:53Z. The baseline was taken after it, at 03:17:05Z.
  - **Worker:** `per-call-model`, refusing the empty probe with 400 and `calls: []`.
  - **Models:** `scripted` and `hosted-ai`.
  - **Sidecars:** both approved, and all three blocks usable on both references.
  - **No model call.** Its four requests are the Worker's refusal of an empty body, the page, that build's manifest and the model list.
- `1b.baseline-7e260c3.capture.txt`: the command's console output, with its start, end and exit code.
- `SHA256SUMS`: run `sha256sum -c SHA256SUMS` from this directory.

Against the `eaf6ae3` baseline (`claude/blocks-baseline-eaf6ae3-evidence`), only `at` and `buildId` differ.

### What a shadcn/ui v3 run would record

- **Code identity:** `51c80cec7a652216c3b9b28b1467e8c45eb0ecebe170969854bb1d49d3c8a229`, with dspack-gen 0.5.0 and dspack-emit 0.7.0.
  - `live/parity.ts` changed in this pull request, so the identity is not the Astryx run's `fe2b8e84…cc86d`.
  - It is the only file in the identity's roots that changed.
- **Corpus:** `blocks-1b` v2, `0e4e4706e19ec92565fea2019258cd5d83f6bef0eca424a0634ccf4749b61ae9`, unchanged.
- **Request bytes:** unchanged. The squash's tree equals the reviewed head `51cf86e`, where:
  - block-bench's 268 tests pass, its pinned request hashes among them;
  - composer's 280 pass, the Worker's pinned sha256 of `env.AI.run`'s arguments among them.

**Unchanged since the previous baseline:** the Worker, the app, the sidecars, composer-core and the bench's `src`.
