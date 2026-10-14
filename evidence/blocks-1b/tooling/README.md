# Run verification tooling for Phase 1B (never merged)

This directory sits on the evidence branch, beside the Astryx Stage-3 evidence it was validated on. Nothing here
changes that evidence:
- the run directory, its checksums (`../1b-stage3-astryx-2026-10-12.SHA256SUMS`, `../SHA256SUMS`) and every earlier
  commit stay as they are;
- `../verify_stage3.py`, the Astryx run's own verifier, stays as committed;
- nothing here reads `../analyze.mjs`, whose figures are known to be wrong.

No provider was called to build or test anything here.

| Path | What it is |
|---|---|
| `verify_run.py` | The verifier for a hosted run of any number of invocations. It generalizes `verify_stage3.py`, which handles two. |
| `tests/test_verify_run.py` | Its tests: the real Astryx run, two synthetic runs, and 25 copies each broken one way. |
| `synth/` | The generator of the synthetic runs, and their scenarios. |
| `fixtures/synthetic-5/`, `fixtures/synthetic-12/` | The synthetic runs: 5 and 12 invocations. |
| `SHA256SUMS` | Checksums of every file here. |

## Verifying a run

```sh
python3 -I verify_run.py --run <run dir> --corpus <the frozen corpus json> --out <result json> \
  --snapshot <the run dir as invocation 1 left it> ... --snapshot <as invocation N-1 left it> \
  --invocations <invocations.txt> --expect-build <the baseline's build id> --expect-code <the code identity> --complete
```

- **`--snapshot`** is the copy of the run directory that each window's evidence commit kept, oldest first. Every
  invocation but the last needs one; `--partial-history` reports a missing copy instead of failing on it.
- **`--invocations`** is the operator's record of each invocation's start, end and exit code, in the format of
  `../1b-stage3-astryx-2026-10-12.invocations.txt`.
- **`--quick`** skips the 200-seed and 20,000-resample robustness checks of the decision's intervals.

It exits 0 only when it finds nothing. It writes every figure it recomputed, and each finding, to the result JSON.

## What it checks

Everything is recomputed from the run's own files and the frozen corpus. Nothing of the harness is imported or run.

- **Identity:**
  - The corpus given is the one the manifest pins, and the expected one.
  - Every invocation's preflight names the manifest's base URL, build id, Worker shape, models and sidecars.
  - One model is measured, and no resume set one aside.
  - The code identity is the expected one.
- **History:**
  - Each window's copy is a prefix of what followed it, file by file.
  - The manifest's identity fields and the preflights never change.
  - A limit changes only with its change on the record.
  - A re-run moves records to `runs.superseded.jsonl` and deletes nothing.
- **The ledger,** request by request:
  - Request ids are consecutive within each invocation, and only one request is in flight at a time.
  - Every settlement's arithmetic holds in whole nanodollars: a release is at nothing, and a hold is at no less than its reservation.
  - A request a killed invocation left open is raised by the next invocation, first, to the most a request can cost.
  - Each invocation's count matches its pacing entry and stays under its cap.
  - The run's totals stay under the run's caps.
- **The cells:**
  - At the end, the planned grid is complete, each cell once.
  - Each invocation runs exactly the cells left to do, in planned order. So a resume skips nothing and repeats nothing.
  - A cell that a stopped invocation abandoned is the next one's first, repeated from its beginning.
  - A re-run replaces exactly the records it moved aside: re-run eligible failures and the refinements skipped for them.
- **Cells against requests,** one invocation at a time:
  - Each request is held to the call it carried: a settled request at what its calls reported, a released request at nothing.
  - Requests that no logged cell made appear only at the end of an invocation that stopped inside a cell: on a call the run cannot trust, an error, or a kill.
- **Backoffs against refusals:**
  - Each refused request that is retried waits the next step of the schedule.
  - A request refused through the whole schedule (five refusals) fails its cell as a provider or policy failure. Its last refusal waits nothing, and is reported as an exhausted schedule.
- **The measurement,** as `verify_stage3.py` does it, per reference:
  - surface digests, the add and remove check, and binding scoring;
  - every arm's statistics, pooled and per condition;
  - the ADR-B3 decision, and its paired cluster bootstrap, both as specified and with independent generators;
  - selection, parity and the encoding comparison;
  - all of it against `summary.json`, field by field.

## Validation

**The Astryx Stage-3 run, two invocations:**
- **Command:** the run directory, its window-1 copy from evidence commit `17328e3`, the v2 corpus,
  `--expect-build txDlHURTKv_S6yicLso97`, the run's code identity, and `--complete`.
- **No findings, in 15 seconds.**
- **Identical to `verify_stage3.py`'s committed `1b-stage3-astryx-2026-10-12.verify.json`.** That covers:
  - the decision, with its intervals and the 200-seed and 20,000-resample robustness;
  - every arm's statistics, pooled and per condition;
  - selection, the encoding comparison and the five readings;
  - the totals, the request-by-request mapping, the ledger, the cost, the surface checks and the orphan;
  - each window's figures, and each window's backoffs.

**The synthetic runs** went through the real harness and the real Worker (`propose.mjs`), with a scripted model
binding. Every invocation is its own process, as the CLI makes it. Both verify with no findings.
- **`synthetic-5`,** 5 invocations over rt-01 and rt-02, 40 cells:
  1. A busy 429, released at no cost and retried after 30 s, then a cap stop.
  2. A reply without usage, held at its worst case. The run halts (exit 3) inside a fresh cell whose plan had settled.
  3. The abandoned cell, repeated from its beginning. Two busy refusals in a row (30 s, 60 s), then the Worker's own limiter (429 rate-limited), then a cap stop.
  4. Five busy refusals exhaust the schedule on a fresh plan. The cell fails as a provider failure, and the invocation is killed at its next spacing wait, as the monitor would stop it.
  5. `--rerun-failed` moves the failed cell and its four skipped refinements aside and runs them again. The run completes.
- **`synthetic-12`,** 12 invocations over rt-01 to rt-03, 60 cells, with eight cap stops and:
  - a busy refusal and a limiter refusal;
  - a held request, followed by its cell repeated;
  - three refusals in a row (30 s, 60 s, 120 s);
  - a kill while a request was open. The next invocation raises that request to the most a request can cost, then repeats its cell.
  - a garbled output the Worker re-asked inside one request;
  - an exhausted schedule, then a kill, then a re-run;
  - four refusals in a row that use the whole schedule (30 s, 60 s, 120 s, 240 s) before the fifth try settles.

**Broken copies.** The verifier fails, and names the fault, on 25 copies of `synthetic-12`, each broken one way:
- duplicate cells, at the end and inside the history;
- missing requests, in the last window and inside the history;
- a resume against another build, or an unexpected build;
- a settlement or a call on another model;
- another corpus, or a relabelled record;
- a settlement whose arithmetic is off, one unlike what its cell reported, a release that kept money, a request settled twice, and a refusal settled as spent;
- an earlier record altered, an earlier pacing entry removed, the re-run evidence removed, cells out of order, and a cell missing;
- requests no cell made in a window that stopped cleanly;
- backoffs unlike the refusals;
- an integrity stop dressed as a kill;
- an altered summary;
- a window copy missing.

```sh
python3 -I evidence/blocks-1b/tooling/tests/test_verify_run.py -v   # 28 tests, about 10 seconds
```

The tests read the corpus from a dspack-studio checkout (`DSPACK_STUDIO`, default `/home/user/dspack-studio`). They
take the Astryx window-1 copy from this branch's history.

## The synthetic runs

```sh
# from a dspack-studio checkout's block-bench tsx; the out directory must not exist
packages/block-bench/node_modules/.bin/tsx <this dir>/synth/generate.mts <this dir>/synth/scenarios/synthetic-12.json <out dir>
```

Both fixtures were generated with the checkout at `299911d` (PR 102), code identity `51c80cec…a229`. Each
fixture's `generated.json` records this, and its `configs/` and `logs/` hold each invocation's configuration and
output. The scripted binding answers each plan with the prompt's own intent and no block, so every arm routes to
primitive generation. The block phase's request shapes are covered by the Astryx run instead.

## Limits

- **A window copy whose last line was cut off** is reported as a finding, to be checked by hand. The harness sets such a line aside on its next resume, and the verifier does not reconstruct that.
- **Without window copies,** what each invocation logged is read from the record times, and the history before them is not checked. Each case is listed among the notes.
- **A window stopped from outside.** Its `summary.json` is the previous window's. The verifier checks that summary's request count against the windows it covers, and compares nothing else in it.
- **Prices.** The verifier prices Claude Haiku 4.5 alone, as the harness does.

## The operator monitor for shadcn/ui v3 (not launched)

| Path | What it is |
|---|---|
| `monitor_run.py` | The monitor for one window (one invocation). It reads the run directory and never writes to it. It only ever signals the harness's process group. |
| `monitor-shadcn.json` | Its configuration for shadcn/ui v3 Stage 3: what each window must match, and its limits. |
| `tests/test_monitor.py` | Its tests: 33 rules one at a time, both synthetic runs replayed, and 4 windows of a live synthetic harness. |

**What stops a window at once:**
- **Settlement:** any of these:
  - a request that ends neither settled at its reported usage nor released as a refusal at no cost (a hold, such as "usage not verified");
  - arithmetic that does not hold in whole nanodollars;
  - a release not at zero;
  - two requests in flight;
  - a settlement for a request not in flight;
  - a line it cannot read.
- **Model:** a settlement or a provider call on another model, or a manifest that records another, or one set aside.
- **Build:** the live deployment, checked every 10 minutes, or the window's preflight or the manifest, naming any other build than the baseline's.
- **Corpus:** another pinned corpus, a record for another reference or provider, or labels other than the frozen corpus's.
- **Integrity:** any of these:
  - another code identity;
  - the manifest's identity changing during the window;
  - an invariant failure;
  - a request in flight for 10 minutes. No reply can take that long: at most two calls of at most 45 s each.

**Refusals** (zero-cost busy and limiter refusals, which the harness releases and retries after a backoff):
- **Allowed:** a refusal answered within its backoff schedule, including one that uses the whole schedule (30, 60, 120 and 240 s). Each release is logged with the wait it costs, never silently.
- **Stopped:**
  - a request refused through its whole schedule, which is 5 times in a row;
  - the window's 8th released refusal;
  - refusals whose backoffs reach 900 s in the window.

  So refusals cannot quietly eat the rest of a daily window.

**Failures:**
- **Policy or unknown:** a policy failure, or an unknown one, stops the window.
- **Provider:** one provider failure per window is allowed and logged; re-run it with `--rerun-failed`. The second stops the window.
- **Ordinary arm results** never stop a run: a lint exhaustion, a gate failure, an unusable output, a skipped refinement.

**When a stop holds nothing.** A stop on a refusal lands when nothing is in flight: the harness has just released the request and is waiting out its backoff, or the spacing after a spent schedule. The live tests show that no request is left open.
- **A stop on a record or the build can land while a request is in flight.** The next resume then raises that request to the most a request can cost, $1.118208 against the ceiling, and repeats its cell from the beginning. The monitor allows that raise at the start of the next window, before its first request, and logs it.

**The limits, for a window of `--max-requests 123`:**
- **Refusals in Astryx:** at most 4 per window, which is 2.9% of window 2's 140 requests.
- **Eight releases:** 6.5% of a window, more than twice that rate.
- **900 s of backoff:** about half a window's 30 to 40 minutes of requests. It allows one full schedule, which costs 450 s, and leaves room for single refusals.
- **Provider failures:** Astryx had none; its 7 adapter failures were unusable outputs.

**Before any window, the build must be set:** `expect.build` must be the post-merge baseline's. Until it is, the monitor stops every window at once. The code identity and the corpus are already set: `51c80cec…a229` and v2 `0e4e4706…1ae9`.

**Launching a window** follows the Astryx procedure (`v2/stage3/preresume-and-launch.sh` in the operator's scratch). Run the no-cost checks first. Start the harness in its own session, then start the monitor at once:

```sh
python3 -I monitor_run.py --run <run dir> --pgid <the harness session's process group> --preflights <N> \
  --config monitor-shadcn.json --corpus <frozen corpus v2> --events <window events log>
```

- **`--preflights`** is the number of preflight files the run will hold once this window has started: 1 for the first window, and one more for each resume.
- **The monitor reads only this window's lines,** so restarting it during a window rebuilds its count from the files.
- **Exit codes:**
  - 0: the harness exited by itself;
  - 10: the monitor stopped it;
  - 20: the monitor handed back while the harness still runs (after 7 hours by default).

```sh
python3 -I evidence/blocks-1b/tooling/tests/test_monitor.py -v   # 39 tests, about 70 seconds
```

The live tests start the synthetic harness in its own process group, with its waits slept for real at a fraction of their length, and the monitor watches it:
- **An exhausted schedule** stops the window with nothing in flight.
- **Eight retried refusals** stop it during a backoff.
- **A single retried refusal** lets the window finish.
- **A build change** stops it, and a resume completes the run.

Each run then verifies with `verify_run.py`, and finds nothing.
