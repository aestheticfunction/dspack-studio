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
| `tests/test_verify_run.py` | Its tests: the real Astryx run, four synthetic runs, every window copy read as the run so far, and 42 copies each broken one way. |
| `synth/` | The generator of the synthetic runs, and their scenarios. |
| `fixtures/synthetic-5/`, `fixtures/synthetic-12/`, `fixtures/synthetic-edge/`, `fixtures/synthetic-dead/` | The synthetic runs: 5, 12, 3 and 3 invocations. |
| `monitor_run.py`, `monitor-shadcn.json` | The operator monitor for one window, and its configuration for shadcn/ui v3 (below). |
| `tests/test_monitor.py`, `tests/fake_harness.py` | The monitor's tests, and a stand-in harness that writes a run directory on a fixed timeline. |
| `SHA256SUMS` | Checksums of every file here. |

## Verifying a run

```sh
python3 -I verify_run.py --run <run dir> --corpus <the frozen corpus json> --out <result json> \
  --snapshot <the run dir as invocation 1 left it> ... --snapshot <as invocation N-1 left it> \
  --invocations <invocations.txt> --monitor-config monitor-shadcn.json --monitor-events <window 1 events log> ... \
  --expect-build <the baseline's build id> --expect-code <the code identity> --expect-max-requests 123 --complete
```

- **`--snapshot`** is the copy of the run directory that each window's evidence commit kept, oldest first. Every
  invocation but the last needs one; `--partial-history` reports a missing copy instead of failing on it.
- **`--invocations`** is the operator's record of each invocation's start, end and exit code, in the format of
  `../1b-stage3-astryx-2026-10-12.invocations.txt`. A launch the harness refuses writes no preflight and is no
  invocation: record it as `refused launch after invocation <k>: <start> to <end> exit 1`, not as an invocation.
- **`--monitor-events`** is a window's `monitor_run.py` events log, one per monitored window. A monitor restarted during a window appends to its window's log, so each window has one.
- **`--monitor-config`** is the configuration every window's monitor ran with. Every monitor in a log (a restarted one appends its own "monitor up" line) must have run with its limits, and every window must have a log whose monitor opened it.
- **`--parity-reading`** says how the run's code read a surface's text for parity: `arrays` (the default; code from
  aestheticfunction/dspack-studio#102 on, which reads the strings arrays hold) or `no-arrays` (before it, as the Astryx
  run's code did). The other reading's arm means are reported too.
- **`--quick`** skips the 200-seed and 20,000-resample robustness checks of the decision's intervals.

It exits 0 only when it finds nothing. It writes every figure it recomputed, each finding and each note, to the
result JSON.

Without `--complete` it verifies the run so far, as it stands between windows. That allows what a window stopped
from outside leaves:
- no pacing entry, and perhaps no `summary.json` yet;
- a request in flight, which the next process to write to the ledger raises to the most a request can cost. It stays allowed only while no later process has written to the ledger and no later invocation has ended by itself, since such an invocation read the ledger and would have raised it;
- arms and conditions with no record yet, and a re-run's cells not yet run again.

## What it checks

Everything is recomputed from the run's own files and the frozen corpus. Nothing of the harness is imported or run.

- **Identity:**
  - The corpus given is the one the manifest pins, and the expected one.
  - Every invocation's preflight names the manifest's base URL, build id, Worker shape, models and sidecars.
  - One model is measured. A resume may set aside a served model no record shows measured only if it is the expected model.
  - The code identity is the expected one, and so is each invocation's `--max-requests`.
- **History:**
  - Each window's copy is a prefix of what followed it, file by file.
  - The manifest's identity fields and the preflights never change.
  - A limit changes only with its change on the record.
  - A re-run moves records to `runs.superseded.jsonl` and deletes nothing.
  - Without a copy between them, a record logged inside the gap may be moved aside within it. The invocation that moved it is the one whose cells show it.
- **The ledger,** request by request:
  - Request ids are consecutive within each invocation, and only one request is in flight at a time.
  - Every settlement's arithmetic holds in whole nanodollars:
    - a release is at nothing;
    - a hold is at no less than its reservation, nor the most one call can cost ($0.559104, the least the harness holds a reply it cannot trust at).
  - A request an invocation left open is raised to the most a request can cost ($1.118208) by the first process after it to write to the ledger. That is the next invocation, a launch the harness refused that raised it before refusing, or a later invocation when those between died before writing anything.
  - Each invocation's count matches its pacing entry and stays under its cap. A lost lock or an unsyncable reservation stops an invocation with one request recorded but never sent, and that is allowed for.
  - A cap stop was due: the next cell's worst case no longer fit.
  - The run's totals stay under the run's caps.
- **The cells:**
  - At the end, the planned grid is complete, each cell once.
  - Each invocation runs exactly the cells left to do, in planned order. So a resume skips nothing and repeats nothing.
  - A cell that a stopped invocation abandoned is the next one's first, repeated from its beginning.
  - A re-run replaces exactly the records it moved aside: re-run eligible failures and the refinements skipped for them.
- **Cells against requests,** one invocation at a time:
  - Each request is held to the call it carried: a settled request at what its calls reported, a released request at nothing.
  - The busy gateway's turned-away call, which names no model, may only be the last provider call of a cell that failed on it.
  - Requests that no logged cell made appear only at the end of an invocation that stopped inside a cell: on a call the run cannot trust, an error, or a kill.
- **Backoffs against refusals:**
  - Each refused request that is retried waits the next step of the schedule.
  - A request refused through the whole schedule (five refusals) fails its cell as a provider or policy failure. Its last refusal waits nothing, and is reported as an exhausted schedule.
- **The measurement,** per reference:
  - surface digests, the add and remove check, and binding scoring;
  - parity, recomputed from each surface and its checklist (the prompt's labels, a refinement's expected text, its components);
  - every arm's statistics, pooled and per condition, with their re-run counts by kind;
  - the ADR-B3 decision, its reasons word for word, its options, and its paired cluster bootstrap, both as specified and with independent generators;
  - every operation-sensitivity reading the summary lists, which readings it lists, and its verdict and clarity flags;
  - selection and the encoding comparison;
  - all of it against `summary.json` field by field, with no entry the records do not make and every one they do; the scoring, the totals and the telemetry; and the verdict `REPORT.md` states.
- **Whose summary it is.** `summary.json` is an invocation's last write. A signal in the harness's shutdown (exit 143 under tsx, after its pacing entry) can leave an earlier invocation's in place. The verifier reports that, and it is a finding for a run that must be complete.
- **Each monitored window** (`--monitor-events`):
  - the window it watched is the invocation it names;
  - the count of requests it saw is the ledger's for that invocation;
  - it read the live build at least every `2 × buildCheckSeconds + 25` seconds;
  - any build other than the baseline's is a finding, with the requests settled after the last good reading: their cells may have been measured on another deployment, and the owner decides;
  - with `--monitor-config`, every monitor in it ran with the configuration's limits, and no window lacks a log whose monitor opened it.

## Validation

**The Astryx Stage-3 run, two invocations:**
- **Command:** the run directory, its window-1 copy from evidence commit `17328e3`, the v2 corpus,
  `--expect-build txDlHURTKv_S6yicLso97`, the run's code identity `fe2b8e84…cc86d`, `--parity-reading no-arrays` and
  `--complete`.
- **No findings and no notes, in 15 seconds with the full robustness checks.** The decision is pass, clear, and the
  ledger commits $7.6298649.
- **Parity:** all of the run's stored parity results are reproduced under its own reading. The other reading gives
  the corrected means of `../1b-stage3-astryx-2026-10-12.erratum-parity.md`: block 0.963, capped 0.959, production
  0.948, block-positional 0.9635.
- **The rest is identical to `verify_stage3.py`'s committed `1b-stage3-astryx-2026-10-12.verify.json`.** That covers:
  - the decision, with its intervals and the 200-seed and 20,000-resample robustness;
  - every arm's statistics, pooled and per condition;
  - selection, the encoding comparison and the five readings;
  - the totals, the request-by-request mapping, the ledger, the cost, the surface checks and the orphan;
  - each window's figures, and each window's backoffs.

**The synthetic runs** went through the real harness and the real Worker (`propose.mjs`), with a scripted model
binding. Every invocation is its own process, as the CLI makes it. All four verify with no findings.
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
- **`synthetic-edge`,** 3 invocations and a refused launch over rt-01, 20 cells:
  1. Killed from outside with its third request in flight. It leaves no pacing entry and no `summary.json`.
  2. A resume the harness refuses, its request cap below what the run has sent. It raises the open request first, and writes no preflight.
  3. A resume whose lock is lost before its fourth request. That request is written but never sent, and the invocation stops on an error (exit 1).
  4. A resume that raises the unsent request and completes the run.
- **`synthetic-dead`,** 3 invocations over rt-01, 20 cells:
  1. Killed from outside with its third request in flight.
  2. A resume killed as soon as its preflight is on the disk, before it raises that request. It writes nothing to the ledger.
  3. A resume that raises it, as the first process after the first window to write to the ledger, and completes the run.

**Every window copy** of the four runs also verifies on its own, as the run so far, with no findings. So does each
run with a window copy missing across a re-run (`--partial-history`).

**Broken copies.** The verifier fails, and names the fault, on 42 copies, each broken one way:
- duplicate cells, at the end and inside the history;
- missing requests, in the last window and inside the history;
- a resume against another build, or an unexpected build;
- a settlement or a call on another model;
- another corpus, or a relabelled record;
- a settlement whose arithmetic is off, one unlike what its cell reported, a release that kept money, a request settled twice, and a refusal settled as spent;
- a held settlement below the harness's least hold;
- a raise made by the invocation after the next one;
- an earlier record altered, an earlier pacing entry removed, the re-run evidence removed, cells out of order, and a cell missing;
- requests no cell made in a window that stopped cleanly;
- backoffs unlike the refusals;
- an integrity stop dressed as a kill;
- a summary altered, a summary left by an earlier window, a decision for a reference the run never measured, another scoring, sensitivity flags flipped, altered telemetry, and a report stating another verdict;
- a stored parity unlike its surface's;
- a window copy missing;
- a killed window's trailing request removed from every copy, with the totals adjusted to match. Nothing in the run's own files shows it, and the monitor's events log does;
- a monitor that went too long without reading the build, a window whose monitor read another build, a log whose limits are not the configuration's (its first monitor's, or a restarted one's), a window with no log, and a log whose monitor never opened its window;
- a request left open that a later invocation, which ended by itself, never raised.

```sh
python3 -I evidence/blocks-1b/tooling/tests/test_verify_run.py -v   # 53 tests, about 25 seconds
```

The tests read the corpus from a dspack-studio checkout (`DSPACK_STUDIO`, default `/home/user/dspack-studio`). They
take the Astryx window-1 copy from this branch's history.

## The synthetic runs

```sh
# from a dspack-studio checkout's block-bench tsx; the out directory must not exist
packages/block-bench/node_modules/.bin/tsx <this dir>/synth/generate.mts <this dir>/synth/scenarios/synthetic-12.json <out dir>
```

`synthetic-5` and `synthetic-12` were generated with the checkout at `299911d` (PR 102), `synthetic-edge` and
`synthetic-dead` at its merge `7e260c3`; all four have code identity `51c80cec…a229`. Each fixture's `generated.json` records this, and its
`configs/` and `logs/` hold each invocation's configuration and output. The scripted binding answers each plan with
the prompt's own intent and no block, so every arm routes to primitive generation. The block phase's request shapes
are covered by the Astryx run instead.

## Limits

- **A window copy whose last line was cut off** is reported as a finding, to be checked by hand. The harness sets such a line aside on its next resume, and the verifier does not reconstruct that. A cut-off last line in the run directory itself is a note while the run is unfinished.
- **Without window copies,** what each invocation logged is read from the record times, and the history before them is not checked. Each case is listed among the notes.
- **An earlier invocation's `summary.json`.** The verifier checks its request count against the invocations it covers, and compares nothing else in it.
- **A stop at the run's dollar ceiling** is not checked for being due.
- **Without a monitor's events log,** a killed window's trailing request removed from every copy, with the totals adjusted, goes unseen.
- **The monitor's own rules** (its refusal limits, its stops) are not replayed against its events log; their limits are checked, and its count of requests.
- **Prices.** The verifier prices Claude Haiku 4.5 alone, as the harness does.

## The operator monitor for shadcn/ui v3 (not launched)

`monitor_run.py` watches one window (one invocation). It reads the run directory and never writes to it, and only
ever signals the harness's process group. `monitor-shadcn.json` holds what each window must match and its limits.

**What stops a window at once:**
- **Settlement:** any of these:
  - a request that ends neither settled at its reported usage nor released as a refusal at no cost;
  - arithmetic that does not hold in whole nanodollars;
  - a release not at zero;
  - two requests in flight, or a request out of sequence;
  - a settlement for a request not in flight;
  - a line it cannot read.
- **Model:** a settlement or a provider call on another model, or a manifest that records another. The busy gateway's turned-away call names no model; it is allowed only as the last provider call of a cell that failed on it. A resume may set aside the expected model; setting aside any other stops the window.
- **Build:** any of these naming another build than the baseline's:
  - the live deployment, read every 30 s on a thread of its own, following redirects as the harness does, with each reading logged;
  - the window's preflight;
  - the manifest.

  A live build that cannot be read for 5 minutes, by the clock, also stops the window.
- **Corpus:** another pinned corpus, a record for another reference or provider, or labels other than the frozen corpus's.
- **Integrity:** any of these:
  - another code identity;
  - the manifest's identity changing during the window;
  - an invariant failure (an arm result the run keeps, but a block template that produced an invalid surface is the owner's to see before more is spent);
  - a request in flight for 10 minutes. No reply can take that long: at most two calls of at most 45 s each;
  - more than 123 requests in the window, its `--max-requests`. The harness never sends more, so this is a second guard;
  - a sign that this is not the window being run: a ledger line from a later invocation, a newer preflight, a pacing entry for the preflight given, or a request sent before the preflight exists.

**A hold** ("usage not verified": a reply held at its worst case) is usually a stop the harness makes itself. It
halts (exit 3) and writes its stop record (pacing entry, then `summary.json` and `REPORT.md`) in a short synchronous
shutdown, and a signal there would cut that record off. But a reply that passes its integrity checks and exceeds its
priced reservation is held too, and the harness goes on with it. So the monitor logs a HOLD and waits:
- **if the harness halts** (its pacing entry is written), it has 15 s from that entry to exit, and is signalled only after that;
- **if it carries on,** it is stopped where nothing is in flight:
  - on its cell's record;
  - before its next request can go out (the held request's reservation plus the 12 s spacing, less a second), allowing the halt at least 2 s to show;
  - or, if it has already sent another request, once that request settles. If the next request goes out at once, the monitor stops it with that one in flight rather than ride on.
- **A hold met while waiting** starts its own wait, so a halt on a later request is left to finish too.
- **The window's other limits hold throughout:** a request in flight 10 minutes, the build and the hand-back.

**Refusals** (zero-cost busy and limiter refusals, which the harness releases and retries after a backoff):
- **Allowed:** a refusal answered within its backoff schedule, including one that uses the whole schedule (30, 60, 120 and 240 s). Each release is logged with the wait it costs, never silently.
- **Stopped:**
  - a request refused through its whole schedule, which is 5 times in a row;
  - the window's 8th released refusal;
  - refusals whose backoffs reach 600 s in the window, each release counted as if retried.

  Either limit can fire first. A whole schedule (450 s) and then three more refusals in a row reach 660 s at the 7th release. Eight refusals each answered on its first retry reach the 8th release at 240 s. So refusals cannot quietly eat the rest of a daily window.

**Failures:**
- **Policy or unknown:** a policy failure, or an unknown one, stops the window.
- **Provider:** one provider failure per window is allowed and logged; re-run it with `--rerun-failed`. The second stops the window.
- **Ordinary arm results** never stop a run: a lint exhaustion, a gate failure, an unusable output, a skipped refinement.

**When a stop holds nothing.** A stop on a refusal lands when nothing is in flight. The harness has just released the
request and is waiting out a backoff of 30 s or more, or, after a spent schedule, its spacing of 12 s against the
monitor's 2 s poll. The live tests show that no request is left open.
- **A stop on a record or the build can land while a request is in flight.** The next resume then raises that request to the most a request can cost, $1.118208 against the ceiling, and repeats its cell from the beginning. The monitor allows that raise at the start of the next window, before its first request, and logs it.
- **On a build change,** up to about four requests (30 s between readings, plus at most 20 s of fetching, at 12 s spacing) can be served before the stop. The verifier reports how many were settled after the last good reading.

**It fails closed.**
- It waits at most 180 s for this window's preflight.
- It stops the harness if a request is sent before that preflight exists.
- It stops the harness if the monitor itself fails, rather than leave the window unwatched, and that includes a failure while it waits out a hold or stops.
- It refuses to start on its own process group, or on one that is not running.
- It signals `--pgid` only once the run's lock has shown the harness inside it. The lock must have been taken on this host, no earlier than this window's preflight, by a process already running then: a pid that started later is another process that reused it. A group that does not hold the lock, such as another process or the operator's shell, is never signalled. Once this window's preflight is known, the process the lock names is stopped instead; before then, nothing is, since that process may be another window's harness.
- A group whose processes have exited but not been reaped still counts as exited.

**Reading order.** It reads `runs.jsonl` before `requests.jsonl`, then takes lines by time. Within one millisecond it
takes them as the harness writes them when nothing waits between: raises first, then each request's reservation and
settlement in request order, and the records after the last settlement, before any later request. A record ends a
chain of refusals only at the next request, so a release read late still counts in its chain.

**What it does not check:** a settlement's amount against its cell's calls. The verifier does that. A restarted
monitor logs again the releases its predecessor logged; give it the same `--events` file, which it appends to.

**The limits, for a window of `--max-requests 123` and `--spacing-ms 12000` (`spacingSeconds` 12 in the configuration):**
- **Refusals in Astryx:** at most 4 per window, which is 2.9% of window 2's 140 requests.
- **Eight releases:** 6.5% of a window, more than twice that rate.
- **600 s of backoff:** about a third of a window's 25 to 30 minutes of requests. It allows one full schedule, which costs 450 s, and a few single refusals besides.
- **Provider failures:** Astryx had none; its 7 adapter failures were unusable outputs.

**What every window must match:**
- **Build:** `Dyml8RSqfWynKU1KbVuZI`, the zero-cost baseline's after PR 102 merged as `7e260c3`, on `claude/blocks-baseline-7e260c3-evidence`.
- **Code identity:** `51c80cec…a229`.
- **Corpus:** v2, `0e4e4706…1ae9`.
- **Model:** `claude-haiku-4-5-20251001`.

Any other build stops a window at once. So would a redeployment of main, which would also stop the run for good,
since the harness refuses to resume across a deployment.

**Launching a window** follows the Astryx procedure (`v2/stage3/preresume-and-launch.sh` in the operator's scratch). Run the no-cost checks first. Start the harness in its own session, from a script without job control so that `$!` is that session's process group, then start the monitor at once:

```sh
python3 -I monitor_run.py --run <run dir> --pgid <the harness session's process group> --preflights <N> \
  --config monitor-shadcn.json --corpus <frozen corpus v2> --events <window events log>
```

- **`--preflights`** is the number of preflight files the run will hold once this window has started: 1 for the first window, and one more for each resume. Count it from the run directory before launching (the files present, plus one); a wrong count stops the window.
- **The monitor reads only this window's lines,** so restarting it during a window rebuilds its count from the files.
- **Exit codes:**
  - 0: the harness exited by itself. That includes a hold it halted on, and a stop condition seen only after it had exited, which is still logged as a STOP line;
  - 10: the monitor stopped it;
  - 20: the monitor handed back while the harness still runs (after 7 hours by default);
  - 2: a usage error, or a `--pgid` that never held the run: nothing was signalled, and a harness still running must be stopped by hand;
  - 1: the stop itself failed, and nothing could be signalled.

```sh
python3 -I evidence/blocks-1b/tooling/tests/test_monitor.py -v   # 69 tests, about 90 seconds
```

The rules are tested one at a time, and both synthetic runs are replayed through the monitor. `main()` is tested
against `tests/fake_harness.py`, which holds the run's lock as the harness does, for:
- a hold left to the harness, and a hold the harness carries on from, onto its cell's record or into another request, at most one;
- a halt on a later request's hold, a halt's grace timed from its pacing entry, and a request in flight too long during a hold;
- a wrong preflight count, either way;
- its own process group, a process group that is not running, one that does not hold the run's lock, another window's harness before this window's preflight is known, and a lock whose pid started after it was taken;
- a record and the next request in the same millisecond;
- a failure inside a hold;
- a deployment that redirects;
- a closing count that holds every request the window wrote.

The live tests start the synthetic harness in its own process group, with its waits slept for real at a fraction of
their length, and the monitor watches it:
- **An exhausted schedule** stops the window with nothing in flight.
- **Eight retried refusals** stop it during a backoff.
- **A single retried refusal** lets the window finish.
- **A build change** stops it, and a resume completes the run.

Each run then verifies with `verify_run.py` and its window's events log, and finds nothing.
