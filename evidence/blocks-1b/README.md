# shadcn/ui v3 Stage 3 on corpus v2: run evidence

This branch keeps the evidence of the shadcn/ui v3 Stage-3 run on corpus v2, and the zero-cost production baseline that run is held to (below). It is never merged: a commit to main redeploys the composer and changes the build id a run is held to.

**Status: the run is open.** Window 1 is complete: it stopped cleanly at its request cap after 72 of 480 cells. No later window is authorized yet.

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

**Next:** the next window resumes the run with `--resume live/runs/1b-stage3-shadcn-2026-10-15` and the monitor's `--preflights 2`, and only on the owner's authorization.

## Files of the run

- `1b-stage3-shadcn-2026-10-15/`: the run directory exactly as the harness left it (`packages/block-bench/live/runs/1b-stage3-shadcn-2026-10-15`), byte-identical. This commit is window 1's copy.
- `1b-stage3-shadcn-2026-10-15.prerun-checks.txt`: the no-cost checks, repeated immediately before the first paid call.
- `1b-stage3-shadcn-2026-10-15.prerun-probe.json`: the zero-cost probe those checks made.
- `1b-stage3-shadcn-2026-10-15.prerun-and-launch.sh` and `.plan-check.mts`:
  - the script that ran the checks and then launched the packet's frozen command and monitor;
  - its offline plan check.
- `1b-stage3-shadcn-2026-10-15.invocations.txt`: the operator's record of the invocation's start, end and exit code.
- `1b-stage3-shadcn-2026-10-15.invocation-1.log`: the harness's console output, unedited. Its only warnings are Node's "EnvHttpProxyAgent is experimental".
- `1b-stage3-shadcn-2026-10-15.monitor-events-1.log`: the operator monitor's events log for window 1.
- `1b-stage3-shadcn-2026-10-15.launch-console.txt`: the launch script's console, holding the checks, the monitor's output and its exit code.
- `1b-stage3-shadcn-2026-10-15.SHA256SUMS`: the sha256 of the run directory's files and of the files above. Run `sha256sum -c 1b-stage3-shadcn-2026-10-15.SHA256SUMS` from this directory.

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
