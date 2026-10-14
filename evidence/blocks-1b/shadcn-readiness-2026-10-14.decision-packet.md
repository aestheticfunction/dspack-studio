# shadcn/ui v3 readiness: the decision packet (2026-10-14)

**Nothing paid has run.**
- Nothing in this sequence called a provider or a model. Its only requests to production were zero-cost: the baseline's four (a refused empty probe, the page, the build manifest and the model list) and three reads of the page's build id.
- shadcn/ui v3 Stage 3, Phase 2, a pilot, the full corpus and Ollama inference have not started.

## 1. The measurement-readiness pull request

**aestheticfunction/dspack-studio#102:** https://github.com/aestheticfunction/dspack-studio/pull/102
- **Head:** `51cf86e7bb401dcde2635c98a0f512f165adb10c`.
- **Merge:** squashed to main as `7e260c38029ab0a1df1fc499733ed037c06d60db`, 2026-10-14 03:08:28Z.
- **Tree:** the squash's tree equals the reviewed head's (`61757ef…`).

| Commit | What |
| --- | --- |
| `81203aa` | Docs: ADR-B3 amendment 2 recorded as adopted; the review's three precision points in `docs/deployment.md` (only a paced run retries a busy refusal; the browser's generic headline with the busy message as the reason; `model` among the result fields). No behavior change. |
| `a758c26` | Parity tests, fail-first: 3 of 5 fail on main's parity. |
| `299911d` | Parity reads strings in arrays, under one rule for every arm and condition. |
| `1897740` | Docs, from the review: `BLOCKS.md` says adopted in all three places; "(at adoption)" markers; the busy paragraph's order. No behavior change. |
| `51cf86e` | Test, from the review: a component's name is structure, so a label inside it stays missing. |

**Independent review:**
- **Round 1, at `299911d`:** no blocking findings.
  - Its two should-fix findings were both fixed in the commits above.
  - Copilot raised one Low finding, the same as the first should-fix. It was fixed, answered and resolved.
- **Round 2, at the final head `51cf86e`:** no blocking or should-fix findings.
  - Every doc statement matches the code.
  - The new test kills the mutant that let component names through: 11 of 16 mutants are killed, and the 5 survivors are unreachable or change no result.
  - Two optional nits are left as they are.

**CI:**
- **PR head `51cf86e`:** `test` green (03:05:40Z); Workers Builds green.
- **Main `7e260c3`:** CI run 38504702977 green (03:16:53Z).

**Deployment:** production moved from build `w6ajVrX5g8V0WhqowIBGN` (served at 03:08:21Z, before the merge) to `Dyml8RSqfWynKU1KbVuZI` (first seen at 03:14:13Z). No other commit reached main.

**Baseline,** one, zero-cost: `claude/blocks-baseline-7e260c3-evidence` at `460cc81`, taken at 03:17:05Z after main's CI passed.
- **Build:** `Dyml8RSqfWynKU1KbVuZI`.
- **Worker:** `per-call-model`, which refused the empty probe with 400 and `calls: []`.
- **Models:** `scripted` and `hosted-ai`.
- **Sidecars:** both approved.

Against the `eaf6ae3` baseline, only `at` and `buildId` differ. No deployment has followed it: at 06:49:54Z, main was still `7e260c3` and production still served `Dyml8RSqfWynKU1KbVuZI`.

## 2. What did not change

- **Corpus v2.** No corpus file changed. Its digest `0e4e4706e19ec92565fea2019258cd5d83f6bef0eca424a0634ccf4749b61ae9` matches its pin, and an independent recomputation in Python agrees.
- **Request bytes.** No change to:
  - the Worker or the app;
  - composer-core or the bench's `src`;
  - the sidecars or goldens.

  The pinned request hashes pass at the merged tree: block-bench's 268 tests and composer's 280, the Worker's pinned sha256 of `env.AI.run`'s arguments among them.
- **The binding decision metrics:**
  - the ADR-B3 rule: at least 30% fewer tokens per success, a pass rate within 5 points of both primitive arms, and a minimum of 20;
  - the pass rate, tokens per success and operation scoring;
  - the prompts and the thresholds.

  Parity stays reported beside the decision, never in it.
- **The Astryx decision is byte-identical apart from parity.** Recomputed over the committed run with the corrected reading:
  - the harness's `summarize()` reproduces `summary.json`;
  - 48 fields differ, all of them parity;
  - the decision stays pass (clear): 52.8% fewer tokens per success than production, and pass rates 0.942, 0.950 and 0.900.
- **The code identity changed** from the Astryx run's `fe2b8e84…cc86d` to `51c80cec7a652216c3b9b28b1467e8c45eb0ecebe170969854bb1d49d3c8a229`. `live/parity.ts` is the only file in its roots that changed, and a shadcn run records the new identity.
- **One correction to the Astryx packet,** added as a new file (`8bf756d`): the parity defect did not lower every arm alike.
  - Block-positional gains 18.3 points, against 13.5 to 14.1 for the others.
  - The block arm still scores at least as well as both primitive arms.

## 3. Verification tooling for runs of many windows (never merged)

It is on `claude/blocks-stage3-astryx-evidence`, under `evidence/blocks-1b/tooling/`:
- **First version:** `84785d2`, `bc10f67`, `2545d42` and `3329354`. The last restores the fixtures' invocation logs, which the repository's `*.log` ignore rule had kept out.
- **Fixes after an independent review:** `61a57a2`, `e33b070`, `ceb4f6b` and `3db4c76`.
- **Fixes after its second pass:** `5221130`, `8c7f6f4`, `67d8fe9` and `6c21b20`.
- **Fixes after its third pass:** `c176a65`, `1710e54` and `f8db99c`.
- **The fix after its fourth pass:** `4b88ccd`, with its README and checksums in `998e0ce`.
- **Head `998e0ce`:**
  - all 340 checksum entries on the branch verify from a clean export of origin;
  - both suites pass on a clean checkout of it, with no skips or warnings.

**`verify_run.py`** verifies a hosted run of any number of invocations from its files, its window copies and its monitor's events logs. It never uses `analyze.mjs`.
- **The Astryx run, two invocations:** no findings and no notes, with the full robustness checks, re-run at `998e0ce`.
  - Every figure is identical to `verify_stage3.py`'s committed result: the decision and its intervals, the 200-seed and 20,000-resample robustness, every arm's statistics, selection, encoding, readings, totals, the request-by-request mapping, the ledger, cost and backoffs.
  - Parity is now recomputed from each surface. All of the run's stored results reproduce under its own pre-fix reading (`--parity-reading no-arrays`). The corrected reading gives the erratum's means: block 0.963, capped 0.959, production 0.948, block-positional 0.9635.
- **Synthetic runs of 5, 12, 3 and 3 invocations,** through the real harness and the real Worker with a scripted model, verify with no findings. Between them they hold:
  - clean resumes and request-cap stops;
  - zero-cost busy refusals retried at 30, 60, 120 and 240 s;
  - the Worker's own 429;
  - a conservative held request, with its cell repeated from its beginning;
  - a kill with a request in flight, raised by the next window;
  - a first window killed before it wrote any summary, and a launch the harness refused after raising that window's open request;
  - a lost lock that leaves a request recorded but never sent;
  - an invocation killed as soon as its preflight was written, before it raised the request left in flight;
  - an exhausted backoff schedule followed by a kill, and a `--rerun-failed` that supersedes the failed cell and its skipped refinements;
  - a Worker parse retry.
- **Every window copy verifies as the run so far,** and so does a run with a copy missing across a re-run, or with a refused launch's own monitor log beside its window's.
- **42 broken copies fail, each by name:**
  - duplicate completed cells;
  - missing requests;
  - mixed builds, models and corpora;
  - inconsistent settlements, and a hold below the harness's least hold;
  - altered history: an earlier record, a pacing entry, the re-run evidence, cell order, a raise moved to a later window;
  - a request left open that a later invocation, which ended by itself, never raised;
  - the summary: a figure, a reading's flags, the scoring, the telemetry, an entry the records do not make, a stale summary, and the report's verdict;
  - a stored parity unlike its surface's;
  - a killed window's trailing request removed from every copy with the totals adjusted. Only the monitor's events log shows it;
  - a monitor that went too long without reading the build, or read another build;
  - a log whose limits are not the monitor configuration's, its first monitor's or a restarted one's;
  - a window with no log, or with only a log whose monitor never opened the window.
- **Tests:** 54 pass, `python3 -I evidence/blocks-1b/tooling/tests/test_verify_run.py`.
- **The Astryx evidence is unchanged.** Every existing checksum verifies, and no commit was rewritten.

**Independent review of the tooling, at `8bf756d`:** 1 blocking issue, 12 should-fix, 13 nits.
- **The blocking issue:** the monitor's stop on a held settlement raced the harness's own integrity halt. It could cut the halt's stop record off (exit 143) and leave the verifier a false finding, or a lost record.
- **Should-fix:**
  - the build was checked only every 10 minutes;
  - parity was not recomputed;
  - the summary was not compared field by field, nor the report;
  - a low hold was accepted;
  - legitimate states gave false findings or a crash: a lost lock, a run between windows, a refused resume, a missing copy across a re-run;
  - a wrong window count failed open;
  - the 900 s backoff limit could never fire;
  - a rare read order could miss an exhausted schedule;
  - a killed window's trailing request was not anchored, and a raise by a later window than the next was accepted.
- **Each was fixed with a test that failed first.** Three nits are left as designed:
  - an invariant failure still stops a window;
  - the monitor leaves settled amounts to the verifier;
  - a restarted monitor logs releases again.

**Second pass, at `3db4c76`:** nothing blocking. Every earlier finding was fixed or partly fixed, and each of the reviewer's reproductions re-run to show it. The pass found four should-fix issues and seven nits in the new code. Each was fixed with a test that failed first:
- a hold the harness carries on from was stopped on its next reservation, leaving that request in flight. It is now stopped on the cell's record, before the next request can go out, or once that request settles;
- a build change the monitor logged was only a note. It is now a finding;
- a running `--pgid` that is not the harness could be signalled. Now only a group the run's lock shows the harness inside is signalled;
- the verifier took each events log's limits on trust. They are now pinned to the monitor configuration, with a log required for every window;
- the nits: the same-millisecond tie order, a failure inside a hold, redirects, the unreadable build timed by the clock, a request past the window limit, a raise after an invocation that died before writing anything, and a restarted monitor's events log.

**Third pass, at `6c21b20`:** nothing blocking. Every second-pass finding was fixed, three of them with gaps. Three should-fix issues were left, all in the changed code. Each was fixed with a test that failed first:
- **The wait on a carried-on hold could cut a real halt, and had no limit of its own.**
  - A second hold met during the wait was stopped at once, and a halt's 15 s ran from the first hold. A halt on the next request then lost its stop record (exit 143).
  - Now a hold met while waiting starts its own wait, and the 15 s runs from the halt's pacing entry.
  - The harness rides one request at most.
  - The window's other limits apply throughout: a request in flight 10 minutes, the build, and the hand-back.
- **`--monitor-config` had two holes:**
  - a restarted monitor's limits were not pinned;
  - a log whose monitor never opened its window counted as that window's.

  Both are now findings.
- **The verifier's in-flight allowance was looser than before.** It accepted an open last request after a later invocation that ended by itself. That invocation read the ledger and would have raised the request, so this is now a finding.
- **The nits, fixed:**
  - a test whose stand-in wrote out of the harness's order now writes in it;
  - lines of one millisecond are taken as the harness writes them, a request's reservation before its settlement;
  - the monitor could signal the wrong process through a reused pid, or another window's harness before this window's preflight is known. The lock now counts only when it was taken on this host, no earlier than the window's preflight, by a process already running then. Before this window's preflight is known, nothing outside `--pgid` is signalled.
- **Left as they are:** two narrow races, each leaving at most one reservation open. The next window raises it, and the verifier allows it:
  - a stop with 0 to 3 ms before the next request;
  - the 2 s a halt has to show, when the held request took about 10 s.

**Fourth pass, at `f8db99c`:** clear. All three should-fix issues and the four nits are fixed, each checked against the reviewer's own reproductions. Among them, a halt after a carried-on hold now exits 3 with its pacing entry, `summary.json` and `REPORT.md`, where at `6c21b20` it lost all three. Two minor nits:
- **Fixed, with a test that failed first:** a refused launch's own monitor log, passed beside its window's log or after the last window, gave a false finding ("the window ran unwatched"). It now counts as no window's log, and each window still needs a log whose monitor opened it.
- **Left as it is:** a cell's record sorts after the next request's settlement if both of that request's lines share the record's millisecond. That needs a full round trip within one millisecond, and the fastest seen was 3 ms.

**Fifth pass, at `998e0ce`:** clear. The fix holds and cannot hide an unwatched window under `--monitor-config`: a window whose only logs are refused launches', or a monitor stopped by a wrong `--preflights`, is still a finding. Nothing else regressed.

## 4. The operator monitor for shadcn/ui v3 (not launched)

`monitor_run.py` and `monitor-shadcn.json`, on the same branch. A window must match the baseline's build `Dyml8RSqfWynKU1KbVuZI`, code `51c80cec…a229`, corpus v2, `claude-haiku-4-5-20251001` and `shadcn-v3`.

| Event | What the monitor does |
| --- | --- |
| A refusal released at no cost, answered within its backoff schedule | Allows it and logs it with its wait. That includes the whole 30/60/120/240 s schedule. |
| A request refused through its whole schedule (5 times in a row) | Stops the window. Nothing is in flight. |
| The window's 8th released refusal, or 600 s of backoff, whichever comes first | Stops the window, so refusals cannot quietly eat a daily window. Nothing is in flight. |
| A hold: a reply held at its worst case | Usually the harness halts itself (exit 3) and writes its stop record: it then has 15 s from its pacing entry to exit. If it carries on, it is stopped where nothing is in flight: on the cell's record, before its next request can go out, or once a request already sent settles. It rides one request at most. A hold met while waiting starts its own wait, and the window's other limits apply throughout. |
| A settlement other than at reported usage, a release or a hold; arithmetic off; two requests in flight | Stops at once (settlement). |
| Another model, corpus, reference, code identity or manifest identity; an invariant failure; a request in flight 10 minutes; more than 123 requests | Stops at once. |
| Another build: the live deployment, read every 30 s (following redirects) and logged | Stops at once. A build unreadable for 5 minutes, by the clock, also stops the window. |
| A window count (`--preflights`) that is not this window's, or no preflight in 180 s | Stops at once: it fails closed. So does a failure of the monitor itself, including one while it waits out a hold or stops. |
| A `--pgid` that the run's lock does not show the harness inside | Never signalled. The lock counts only when it was taken on this host, no earlier than the window's preflight, by a process already running then. Once this window's preflight is known, the process the lock names is stopped instead. Before then nothing is signalled, and the monitor exits 2. |
| A provider failure | Allows the first in a window (to re-run); the second stops. A policy failure stops at once. |
| A lint exhaustion, gate failure, unusable output or skipped refinement | Never stops. |

Its events log ends with the count of requests it saw. The verifier checks that count against the ledger, and the build readings' cadence.

**Tests:** 69 pass, `python3 -I evidence/blocks-1b/tooling/tests/test_monitor.py`.
- **45 rules,** one at a time, among them lines of one millisecond judged in the harness's order.
- **Both synthetic runs replayed:** it stops exactly where each scenario should, and allows the raise of a request left open at the next window's start.
- **Eighteen runs of its loop against a stand-in harness that holds the run's lock:**
  - a hold left to the harness, which stops itself, and a hold the harness carries on from, onto a record or into one more request at most;
  - a halt on a later request's hold, a halt's grace timed from its pacing entry, and a request in flight too long during a hold;
  - a wrong window count, either way, and a preflight that never comes;
  - its own process group, one not running, and one that does not hold the run's lock;
  - another window's harness before this window's preflight is known, and a lock whose pid started after it was taken;
  - a record and the next request in the same millisecond;
  - a failure inside a hold;
  - a deployment that redirects;
  - a closing count that holds every request the window wrote.
- **Four live windows of the synthetic harness,** in its own process group, with real, scaled sleeps:
  - an exhausted schedule and repeated refusals stop with nothing in flight;
  - one retried refusal lets the window finish;
  - a build change stops the window, and a resume completes the run.
- **Every one of these runs then verifies with its window's events log.** The only finding is the build change's own: the requests settled after the last good reading.

## 5. Where Phase 1B stands

**Astryx passed: the formal ADR-B3 decision is pass, clear.**
- The block path cut hosted tokens per success by 52.8% against production (95% interval 39.0% to 65.1%).
- It kept the pass rate within the margin of both primitive arms.

**Plan-wide Phase 1B remains incomplete.**
- The plan decides per reference: shadcn/ui v3 and Astryx.
- shadcn/ui v3 has only two systems smokes of fresh cells, on corpus v1. They are not decision evidence.
- So nothing is known about the pass-rate guardrail on the reference with the larger schema, casualty components, and nodes matched by place. Its generation calls carried about 65,000 input tokens each in the smoke, as the provider counted them, mostly schema; Astryx's carried about 11,000.

## 6. Two options

### Option 1: stop with the Astryx evidence, and narrow the claim

- **Cost:** none. Main is not frozen.
- **The claim narrows to:**
  - on Astryx, with Claude Haiku 4.5 through the hosted gateway, governed interface blocks cut hosted generation tokens per success by about half (52.8%; 39% to 65%);
  - at a pass rate within 5 points of the production and budget-matched paths;
  - for these 24 corpus prompts.
- **It claims nothing about:**
  - shadcn/ui v3 or design systems in general;
  - other models;
  - real users' goals.
- **What follows:**
  - Phase 2 is the owner's call. It either waits, or proceeds scoped to Astryx: blocks stay an Astryx-only experimental capability, and dspack `blocks` is not proposed upstream as cross-design-system.
  - Any public statement of the result names Astryx, not design systems in general.
- **Risk:** a shared mechanism promoted on the small-schema reference alone. That is the reference where most list nodes carry ids and no operation read as mixed.

### Option 2: run shadcn/ui v3 Stage 3, as the plan intended

**Scope:** 24 prompts × 4 arms × 5 conditions = 480 cells, on corpus v2 with binding scoring, against the deployed build `Dyml8RSqfWynKU1KbVuZI`. Checked offline at `7e260c3` with the harness's own parser, selection check, frozen pin and planner: 480 cells, `shadcn-v3` approved with all three blocks.

**Cost and time,** from the v2 offline plan. The parity correction changes no request byte.

| shadcn/ui v3 | Low | Central | High |
| --- | ---: | ---: | ---: |
| Ledger dollars (credit fee included) | $18.11 | $40.34 | $72.09 |
| Requests | 516 | 900 | 1,212 |
| Daily windows | 5 | 9 | 12 |
| Request time | 1.7 h | 3.0 h | 4.0 h |

- **The same plan's Astryx central figures were 684 requests and 2.3 hours.** The run took 679 requests and about 2.3 hours.
- **Astryx's logged cells cost 10% above their central estimate** ($6.51 against $5.90), or 29% above with request 539's hold. Carried over, shadcn's central figure is about $44.50.
- **That may not transfer.** shadcn's cost is driven by repairs on far larger requests.

**Maximum:** `--max-total-usd 77` (the high scenario needs $76.56 to complete) and `--max-total-requests 1275` (its 1,212 requests plus 5%). The ledger never commits past either, worst cases included.

**Daily windows:**
- **Size:** `--max-requests 123` per window, so that no window can exceed $8.50 at list prices in the high scenario, under the $10 daily limit.
- **Pace:** one window a day, as in the table, plus one for each interruption. That is 5 to 12 days, about one to two weeks.
- **Main stays frozen throughout.** A deployment changes the build id; the monitor stops the window, and the harness refuses to resume across it.

**Runtime:**
- **Per request:** the 12 s spacing sets the pace. shadcn's generation calls in the smoke took a median of 4.3 s, p90 10.7 s, at most 12.9 s. Astryx Stage 3 averaged 12.1 to 12.5 s per request.
- **Per window:** about 25 to 30 minutes of requests, plus at most 10 minutes of refusal backoff, plus about 15 minutes of checks and closeout.

**Before every window** (no cost):
1. Main and the checkout are at `7e260c3` and clean, and no harness process is running.
2. The probe matches the baseline apart from `at`: `NODE_USE_ENV_PROXY=1 pnpm --filter @dspack-studio/block-bench baseline --out <tmp>`, compared with `1b.baseline-7e260c3.json`.
3. The run directory equals the previous window's committed copy, and every evidence checksum verifies.
4. The ledger so far is under both caps.
5. The monitor's window count is the run's preflight files plus one: `--preflights 1` for the first window. A wrong count stops the window.

**First window,** from `/home/user/dspack-studio/packages/block-bench`, in its own session, with the monitor started at once. Run it from a script, without job control, so that `$!` is the new session's process group. The monitor checks that group against the run's lock, and signals nothing else.

```sh
setsid bash -c '
  echo "invocation 1 start $(date -u +%FT%TZ)" >> "$1/invocations.txt"
  NODE_USE_ENV_PROXY=1 pnpm --filter @dspack-studio/block-bench eval:live -- --provider hosted --corpus 2 --reference shadcn-v3 \
    --prompts rt-01,rt-02,rt-03,rt-04,rt-05,rt-06,af-01,af-02,af-03,af-04,af-05,af-06,gs-01,gs-02,gs-03,gs-04,gs-05,gs-06,nb-01,nb-02,nb-03,nb-04,nb-05,nb-06 \
    --max-total-usd 77 --max-total-requests 1275 --max-requests 123 --spacing-ms 12000 \
    --out live/runs/1b-stage3-shadcn-<date> > "$1/invocation-1.log" 2>&1
  code=$?
  echo "invocation 1 end $(date -u +%FT%TZ) exit $code" >> "$1/invocations.txt"
' _ <operator dir> < /dev/null > /dev/null 2>&1 &
python3 -I <tooling>/monitor_run.py --run live/runs/1b-stage3-shadcn-<date> --pgid $! --preflights 1 \
  --config <tooling>/monitor-shadcn.json --corpus live/corpora/blocks.v2.json --events <operator dir>/monitor-events-1.log
```

**Window k:**
- Use the same flags with `--resume live/runs/1b-stage3-shadcn-<date>` in place of `--out …`, and the monitor's `--preflights` counted as above: k for window k, since a refused launch adds no preflight.
- Record the window as `invocation k` in `invocations.txt`. A launch the harness refuses writes no preflight and is no invocation: record it as `refused launch after invocation <k-1>: …`. Keep its monitor's log and pass it to the verifier with the others: it opens no window, and counts as no window's.
- Add `--rerun-failed` when the window before logged a provider failure.

**After every window:**
1. Commit the run directory, its log, the monitor's events and `invocations.txt` to the run's evidence branch, with checksums. That commit is the window's copy.
2. Run `python3 -I <tooling>/verify_run.py --run <run> --snapshot <each earlier window's copy> --monitor-config <tooling>/monitor-shadcn.json --monitor-events <each window's events log, and each refused launch's> --corpus live/corpora/blocks.v2.json --invocations <invocations.txt> --expect-build Dyml8RSqfWynKU1KbVuZI --expect-code 51c80cec7a652216c3b9b28b1467e8c45eb0ecebe170969854bb1d49d3c8a229 --expect-max-requests 123 --out <window>.verify.json`.
3. After the last window, run the same command with `--complete`. It must find nothing.

**Stopping rules:**
- **Continue the next day** only after a clean cap stop: the harness exits 0 at `--max-requests`, the monitor exits 0 with no STOP or HOLD line in its events log, and the verifier finds nothing.
- **Pause for the owner:**
  - any STOP or HOLD line in the monitor's events log, whatever its exit code;
  - a monitor exit of 2 or 1: it signalled nothing, so stop the harness by hand if it still runs;
  - a harness stop on a call it cannot trust (exit 3) or an error (exit 1);
  - any verifier finding;
  - a second interruption in a row;
  - the dollar ceiling or the request cap reached before 480 cells. Only the owner raises a cap, and the manifest records any change.
- **Stop for good:**
  - a deployment other than `Dyml8RSqfWynKU1KbVuZI`;
  - a served model other than `claude-haiku-4-5-20251001`;
  - a change to the corpus, the code identity or the sidecars;
  - any settlement inconsistency.

  The harness refuses to resume across the first three in any case.
- **Never** resume automatically, merge to main, or change the monitor's limits during the run.
- **Each interruption costs:**
  - a window;
  - the owner's decision;
  - at most $1.12 held at worst case, when a stop leaves a request in flight.

**Risks:**
- **Interruptions:** one misclassified 429 in Astryx's 679 requests is too few to forecast from. The structured 429 fix now releases such refusals at no cost.
- **Drift over one to two weeks:** a new served Haiku snapshot, or any deployment, ends the run.
- **Templates:** 11 of the 24 structural prompts ask shadcn for what it cannot render or the prompt lacks, because D1 to D3 were not adopted. The null add and remove templates may meet leaf surfaces, as they did on Astryx. Both are open to every arm alike.

## 7. The decision

- **Option 2** if Phase 2 is meant to reach beyond Astryx: a cross-design-system `blocks` in dspack and in dspack-gen's core. The shadcn guardrail is then the largest unknown, and the plan called for it.
- **Option 1** if Phase 2 will not go ahead, or will start scoped to Astryx: it is the honest stopping point, at no cost, with the claim narrowed as above.

The choice is the owner's. Nothing runs until it is made.
