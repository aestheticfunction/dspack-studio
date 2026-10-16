# shadcn/ui v3 Stage 3 on corpus v2: run evidence

This branch keeps the evidence of the shadcn/ui v3 Stage-3 run on corpus v2, and the zero-cost production baseline that run is held to (below). It is never merged: a commit to main redeploys the composer and changes the build id a run is held to.

**Status: the run is complete and verified.** All 480 cells are done, in eight windows. Windows 1 to 6 each stopped at its request cap. Window 7 stopped on a hold, for which the owner made an explicit exception, and window 8 completed the run. The final `--complete` verification finds nothing. The ADR-B3 decision is **pass, uncertain** (below).

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

**Verification** of window 3's copy, as origin holds it at `791798b`:
- **`verify_run.py`** (at `e3f57da`), with the packet's command (`--snapshot` set to windows 1 and 2's copies at `1cc106b` and `4c3db56`, and all three monitor events logs):
  - no findings;
  - one note: 269 planned cells have no record yet.

  It maps all 313 requests to their cells, with no orphan and nothing held. It also checks:
  - the 145 earlier records are kept, and none was moved aside;
  - each monitor's count equals the ledger's.
- **`reconcile_window.py`** agrees on every figure across the three windows:
  - 313 requests, 310 settled and 3 released at $0;
  - $13.1805408 committed;
  - every settlement and call on `claude-haiku-4-5-20251001`;
  - 11,311,651 input and 248,249 output tokens, whose price equals the settled total to the nanodollar.

## Window 4 (2026-10-15)

**Under the owner's back-to-back authorization,** launched with `shadcn-window.sh launch 4 791798b` once window 3's evidence had verified.

**Before the first paid call:** every no-cost check was repeated from 23:29:00Z to 23:29:06Z, and all passed (`.window-4.preresume-checks.txt`):
- main at `7e260c3` and clean, and no harness or monitor running;
- 441 evidence checksum entries;
- the run directory byte-identical to window 3's copy at `791798b`:
  - 313 requests, all finalized, nothing held;
  - three windows, each stopped at its cap;
- the frozen tooling and the monitor's configuration;
- the probe equal to the baseline apart from `at`;
- the resume command through the harness's parser and planner;
- three preflights, so `--preflights 4`;
- the operator record holding invocations 1 to 3.

**The invocation:** 23:29:06Z to 23:52:07Z, exit 0.
- **Its stop:** the pacing cap of 123 requests for the invocation.
- **104 requests sent.**

**Window 4's ledger:** 104 requests, each with one reservation and one final.
- **103 settled** at the reported usage, every one on `claude-haiku-4-5-20251001`.
- **1 zero-cost busy refusal** (#44, a 503 busy reply). It was released at $0 and retried once, after 30 s.
- **No hold,** and nothing left open.
- **Committed:** $4.82601105, which is $4.596201 at list price.
- **Window 3's records are unchanged.** Its ledger, records and pacing entries are byte-for-byte prefixes of the files as window 4 left them.

**The run so far:**
- **Requests:** 417 of its 1,275.
- **Committed:** $18.00655185 ($17.149097 at list price) of its $77 ceiling.
- **Cells:** 279 of 480.
- **Daily spend:** all four windows ran on 2026-10-15 UTC, within the owner's $40 daily limit.

**Window 4's cells:** 68, covering the rest of af-05, then af-06 and gs-01, and the first cells of gs-02. All 68 completed, and 61 passed. Every failure is an ordinary arm result that is not re-run:
- **unusable output, twice** (classified output): 5 cells:
  - capped: af-05's structural refinement;
  - production: af-05's and af-06's structural refinements, and gs-02's remove;
  - block-positional: af-06's structural refinement;
- **block:**
  - gs-01's structural refinement, a failed gate on the fallback path;
  - gs-02's structural refinement, whose lint repairs ran out.

There was no provider or policy failure.

**Window 4's tokens:** 106 provider calls, 11 of which returned unusable output. They used 4,046,721 input and 109,896 output tokens, and priced at Claude Haiku 4.5's rates they equal the window's settled total exactly.

**The monitor:** exit 0, with no STOP or HOLD line.
- It saw all 104 requests.
- It read the live build 45 times, always `Dyml8RSqfWynKU1KbVuZI`.
- It allowed the one refusal within its schedule.

**Verification** of window 4's copy, as origin holds it at `85fbe36`:
- **`verify_run.py`** (at `e3f57da`), with windows 1 to 3's copies as snapshots and all four monitor events logs:
  - no findings;
  - one note: 201 planned cells have no record yet.

  It maps all 417 requests to their cells, with nothing held. It also checks:
  - the 211 earlier records are kept, and none was moved aside;
  - each monitor's count equals the ledger's.
- **`reconcile_window.py`** agrees on every figure across the four windows:
  - 417 requests, 413 settled and 4 released at $0;
  - $18.00655185 committed;
  - every settlement and call on `claude-haiku-4-5-20251001`;
  - 15,358,372 input and 358,145 output tokens, whose price equals the settled total to the nanodollar.

## Window 5 (2026-10-15 to 2026-10-16)

**Under the owner's back-to-back authorization,** launched with `shadcn-window.sh launch 5 85fbe36` once window 4's evidence had verified.

**Before the first paid call:** every no-cost check was repeated from 23:53:45Z to 23:53:51Z, and all passed (`.window-5.preresume-checks.txt`):
- main at `7e260c3` and clean, and no harness or monitor running;
- 451 evidence checksum entries;
- the run directory byte-identical to window 4's copy at `85fbe36`:
  - 417 requests, all finalized, nothing held;
  - four windows, each stopped at its cap;
- the frozen tooling and the monitor's configuration;
- the probe equal to the baseline apart from `at`;
- the resume command through the harness's parser and planner;
- four preflights, so `--preflights 5`;
- the operator record holding invocations 1 to 4.

**The invocation:** 23:53:51Z on 2026-10-15 to 00:17:32Z on 2026-10-16, exit 0.
- **Its stop:** the pacing cap of 123 requests for the invocation.
- **105 requests sent.**

**Window 5's ledger:** 105 requests, all settled at the reported usage, every one on `claude-haiku-4-5-20251001`.
- **No refusal,** no hold, and nothing left open.
- **Committed:** $4.99570785, which is $4.757817 at list price. With the fee, $1.17347685 of it fell on 2026-10-15 and $3.822231 on 2026-10-16, UTC.
- **Window 4's records are unchanged.** Its ledger, records and pacing entries are byte-for-byte prefixes of the files as window 5 left them.

**The run so far:**
- **Requests:** 522 of its 1,275.
- **Committed:** $23.0022597 ($21.906914 at list price) of its $77 ceiling.
- **Cells:** 346 of 480.

**Window 5's cells:** 67, covering the rest of gs-02, then gs-03 to gs-05, and the first cells of gs-06. 63 completed, of which 54 passed, and 4 were skipped. Every failure is an ordinary arm result that is not re-run:
- **unusable output, twice** (classified output): 6 cells:
  - capped: gs-03's content, add and remove refinements;
  - production: gs-03's remove and gs-05's structural refinement;
  - block-positional: gs-05's content refinement;
- **production gs-04 fresh:** a failed gate, so its four refinements were skipped;
- **block gs-05 structural refinement:** a failed gate on the fallback path;
- **block-positional gs-05 structural refinement:** its budget of 3 model calls ran out.

There was no provider or policy failure.

**Window 5's tokens:** 109 provider calls, 17 of which returned unusable output. They used 4,141,757 input and 123,212 output tokens, and priced at Claude Haiku 4.5's rates they equal the window's settled total exactly.

**The monitor:** exit 0, with no STOP or HOLD line.
- It saw all 105 requests.
- It read the live build 46 times, always `Dyml8RSqfWynKU1KbVuZI`.

**Verification** of window 5's copy, as origin holds it at `7a4f9a6`:
- **`verify_run.py`** (at `e3f57da`), with windows 1 to 4's copies as snapshots and all five monitor events logs:
  - no findings;
  - one note: 134 planned cells have no record yet.

  It maps all 522 requests to their cells, with nothing held, and keeps the 279 earlier records.
- **`reconcile_window.py`** agrees on every figure:
  - 522 requests, 518 settled and 4 released at $0;
  - $23.0022597 committed;
  - every settlement and call on `claude-haiku-4-5-20251001`;
  - 19,500,129 input and 481,357 output tokens, whose price equals the settled total to the nanodollar.

**Next:** window 6 follows at once with `shadcn-window.sh launch 6 <this window's copy>` (`--preflights 6`), only if window 5's evidence verifies.

## Window 6 (2026-10-16)

**Under the owner's back-to-back authorization,** launched with `shadcn-window.sh launch 6 7a4f9a6` once window 5's evidence had verified.

**Before the first paid call:** every no-cost check was repeated from 00:19:09Z to 00:19:15Z, and all passed (`.window-6.preresume-checks.txt`):
- main at `7e260c3` and clean, and no harness or monitor running;
- 461 evidence checksum entries;
- the run directory byte-identical to window 5's copy at `7a4f9a6`:
  - 522 requests, all finalized, nothing held;
  - five windows, each stopped at its cap;
- the frozen tooling and the monitor's configuration;
- the probe equal to the baseline apart from `at`;
- the resume command through the harness's parser and planner;
- five preflights, so `--preflights 6`;
- the operator record holding invocations 1 to 5.

**The invocation:** 00:19:15Z to 00:42:27Z, exit 0.
- **Its stop:** the pacing cap of 123 requests for the invocation.
- **104 requests sent.**

**Window 6's ledger:** 104 requests, each with one reservation and one final.
- **100 settled** at the reported usage, every one on `claude-haiku-4-5-20251001`.
- **4 zero-cost busy refusals** (#47, #61, #80 and #93, each a 503 busy reply). Each was released at $0 and retried once, after 30 s, and each retry settled.
- **No hold,** and nothing left open.
- **Committed:** $6.5502612, which is $6.238344 at list price, all of it on 2026-10-16 UTC.
- **Window 5's records are unchanged.** Its ledger, records and pacing entries are byte-for-byte prefixes of the files as window 6 left them.

**The run so far:**
- **Requests:** 626 of its 1,275.
- **Committed:** $29.5525209 ($28.145258 at list price) of its $77 ceiling.
- **Cells:** 413 of 480.
- **Daily spend:** with the fee, $10.3724922 on 2026-10-16 UTC so far, within the owner's $40 daily limit.

**Window 6's cells:** 67, covering the rest of gs-06, then nb-01 and nb-02, and the first cells of nb-03. 59 completed, of which 47 passed, and 8 were skipped. Every failure is an ordinary arm result that is not re-run:
- **capped and production gs-06 fresh:** each a failed gate, so each arm's four refinements were skipped;
- **unusable output, twice** (classified output): 5 cells:
  - capped: nb-01's and nb-02's add;
  - production: nb-02's add;
  - block: nb-03's structural refinement;
  - block-positional: nb-02's add;
- **a failed gate:** 4 structural refinements:
  - capped: nb-01's;
  - block: nb-02's;
  - block-positional: nb-02's and nb-03's;
- **production nb-02 structural refinement:** its lint repairs ran out.

There was no provider or policy failure. The nb prompts are the corpus's non-block prompts: in all 30 of their block-arm cells the plan selected no block, and the cell took the primitive path.

**Window 6's tokens:** 105 provider calls, 13 of which returned unusable output. They used 5,863,284 input and 75,012 output tokens, and priced at Claude Haiku 4.5's rates they equal the window's settled total exactly.

**The monitor:** exit 0, with no STOP or HOLD line.
- It saw all 104 requests.
- It read the live build 45 times, always `Dyml8RSqfWynKU1KbVuZI`.
- It allowed the four refusals within its schedule. Each was the only one in a row, and together they took 120 s of backoff, against its limits of 8 releases and 600 s of backoff in a window.

**Verification** of window 6's copy, as origin holds it at `94cc6f9`:
- **`verify_run.py`** (at `e3f57da`), with windows 1 to 5's copies as snapshots and all six monitor events logs:
  - no findings;
  - one note: 67 planned cells have no record yet.

  It maps all 626 requests to their cells, with nothing held, and keeps the 346 earlier records.
- **`reconcile_window.py`** agrees on every figure:
  - 626 requests, 618 settled and 8 released at $0;
  - $29.5525209 committed;
  - every settlement and call on `claude-haiku-4-5-20251001`;
  - 25,363,413 input and 556,369 output tokens, whose price equals the settled total to the nanodollar.

**Next:** window 7 follows at once with `shadcn-window.sh launch 7 <this window's copy>` (`--preflights 7`), only if window 6's evidence verifies. 67 cells remain.

## Window 7 (2026-10-16): stopped on a hold

**Under the owner's back-to-back authorization,** launched with `shadcn-window.sh launch 7 94cc6f9` once window 6's evidence had verified.

**Before the first paid call:** every no-cost check was repeated from 00:49:23Z to 00:49:30Z, and all passed (`.window-7.preresume-checks.txt`):
- main at `7e260c3` and clean, and no harness or monitor running;
- 471 evidence checksum entries;
- the run directory byte-identical to window 6's copy at `94cc6f9`:
  - 626 requests, all finalized, nothing held;
  - six windows, each stopped at its cap;
- the frozen tooling and the monitor's configuration;
- the probe equal to the baseline apart from `at`;
- the resume command through the harness's parser and planner;
- six preflights, so `--preflights 7`;
- the operator record holding invocations 1 to 6.

**The invocation:** 00:49:30Z to 01:02:59Z, exit 3.
- **Its stop:** an integrity stop the harness made itself, at a reply it could not meter (below), after 61 requests.
- **Not a cap stop:** window 7 is the first window not to end at its request cap.

**The hold:** request #61, at 01:02:53.697Z, the first request of production nb-05's add refinement.
- **The reply:** the Worker reported one call, a `provider-error` that had reached the provider, with no token counts.
  - It was not the zero-cost busy refusal, which the harness releases and retries.
  - So the harness could not show whether the provider charged for the call.
- **What the harness did:**
  - it settled the request conservatively, as "usage not verified", at $1.118208, the most a request can cost;
  - it logged no record for the cell in flight;
  - it stopped the run with `usage-missing: a refine call (provider-error) reached the provider without reporting its input tokens as a whole count, so the run cannot meter it`.
- **What the Worker sends in that shape** (its code on main at `7e260c3`, which production serves): its 502 `provider-unavailable`, with cause `provider`. It sends that when the gateway or provider rejected the request's only call, and the Worker could not class the rejection as a busy 429:
  - a status other than 429;
  - a rejection carrying a model result, such as a usage figure;
  - or a rejection whose status it could not read for this call, with a message that names no rate limit.

  A timeout is ruled out: the whole request took 5.6 s, against the Worker's 45 s limit.
- **What would show the cause:** the AI gateway's log for that request, at about 01:02:54Z on 2026-10-16. It records the status and anything charged.

**Window 7's ledger:** 61 requests, each with one reservation and one final.
- **56 settled** at the reported usage, every one on `claude-haiku-4-5-20251001`: $4.03608345, which is $3.843889 at list price.
- **4 zero-cost busy refusals** (#8, #16, #30 and #42, each a 503 busy reply). Each was released at $0 and retried once, after 30 s, and each retry settled.
- **1 hold:** #61, at $1.118208.
- **Committed:** $5.15429145, the hold included, all of it on 2026-10-16 UTC.
- **Nothing left open.**
- **Window 6's records are unchanged.** Its ledger, records and pacing entries are byte-for-byte prefixes of the files as window 7 left them.

**The run so far:**
- **Requests:** 687 of its 1,275: 674 settled, 12 released at $0 and 1 held.
- **Committed:** $34.70681235 of its $77 ceiling, the hold's $1.118208 included. The settled requests alone come to $33.58860435 ($31.989147 at list price).
- **Cells:** 457 of 480. The 23 left are production nb-05's add, remove and structural refinements, and nb-06's 20 cells.
- **Daily spend:** with the fee, $15.52678365 on 2026-10-16 UTC, the hold included, within the owner's $40 daily limit.

**Window 7's cells:** 44, covering the rest of nb-03, then nb-04 and the first cells of nb-05. 36 completed, of which 28 passed, and 8 were skipped. Every failure is an ordinary arm result that is not re-run:
- **unusable output, twice** (classified output): 6 cells:
  - capped: nb-03's structural refinement;
  - production: nb-03's and nb-04's structural refinements, and nb-04's remove;
  - block: nb-05 fresh, so its four refinements were skipped;
  - block-positional: nb-04's structural refinement;
- **lint repairs ran out:** 2 cells:
  - block-positional nb-05 fresh, so its four refinements were skipped;
  - capped nb-05's structural refinement.

No cell ended in a provider or policy failure. In all 12 block-arm cells of the nb prompts that ran, the plan selected no block, and the cell took the primitive path.

**Window 7's tokens:** 62 provider calls in the window's records, 13 of which returned unusable output. They used 3,626,384 input and 43,501 output tokens. Priced at Claude Haiku 4.5's rates, they equal the window's settled total exactly. The held request's call reported no tokens, and is in no record.

**The monitor:** exit 0, after a HOLD line.
- It saw all 61 requests.
- It read the live build 27 times, always `Dyml8RSqfWynKU1KbVuZI`.
- It allowed the four refusals within its schedule. Each was the only one in a row, and together they took 120 s of backoff.
- At the hold it logged `HOLD (settlement)` and waited, as its rules say, for the harness to stop by itself. The harness wrote its stop record and exited within the 15 s grace.

**Verification** of window 7's copy, as origin holds it at `d9fb3c9`:
- **`verify_run.py`** (at `e3f57da`), with windows 1 to 6's copies as snapshots and all seven monitor events logs:
  - no findings;
  - one note: 23 planned cells have no record yet.

  It maps 686 of the 687 requests to their cells. The one left is the held request #61: it belongs to the cell in flight at the stop, which logged no record. The verifier keeps the 413 earlier records, and counts the hold's $1.118208 in the committed total.
- **`reconcile_window.py`** agrees on every figure:
  - 687 requests: 674 settled, 12 released at $0 and 1 held;
  - $34.70681235 committed, $33.58860435 of it settled;
  - every settlement and call on `claude-haiku-4-5-20251001`;
  - 28,989,797 input and 599,870 output tokens, whose price equals the settled total to the nanodollar.

**Next:** the run waits for the owner, and nothing more is sent until the owner decides. The operator's launch script refuses a run that holds a request, so a resume first needs the owner's decision on this hold.

## The owner's decision on window 7's hold (2026-10-16)

**The owner's check:** the AI Gateway entry for request #61 shows HTTP 502, with no recorded usage and no charge.

**Authorized: window 8 only,** as an explicit exception for window 7's held request #61.
- **The hold stays.** #61's $1.118208 stays in the ledger permanently, and the hold stays in the evidence. Nothing deletes, rewrites or reinterprets it, so the run's committed total keeps it.
- **After a short cooldown,** every no-cost check is repeated, and the run resumes with `--preflights 8` under the unchanged frozen caps.
- **The interrupted cell,** production nb-05's add refinement, re-runs from its beginning, as the harness's resume does for a cell that logged no record.
- **Window 8 stops** on any new provider failure, hold, integrity issue, identity change or unexpected condition.
- **If all 480 cells finish:** the final `--complete` verification, the complete evidence preserved and pushed, and the final decision results reported. Nothing merges, and Phase 2 does not begin.

**The operator's scripts for window 8:**
- **`.window-8.preresume-and-launch.sh`** is the window-k launch script with exactly the exception, and runs for window 8 only.
  - Every check is the same, with two allowances. The run's state may hold window 7's #61, its two ledger lines exactly as window 7 left them. Window 7's pacing entry may end in its integrity stop, exactly as window 7 left it.
  - Any other hold, or any other stop but a cap, fails the checks.
  - It was tested offline against altered copies of the run: a second hold, #61 altered, window 7's stop made a cap, window 6's stop made an integrity stop, and another window number each fail.
- **`.window-8.provider-failure-stop.sh`** carries out the owner's stop at a new provider failure.
  - The frozen monitor allows one provider failure a window, and stops at the second. This script follows the monitor's events log and, at the first, sends SIGTERM to the harness's process group, as the monitor's own stops do.
  - It signals only the group the monitor shows the harness inside, and never a harness already ending its window by itself.
  - It was tested offline against a stand-in process group.

**Nothing in the experiment changes:** the harness, corpus, sidecars, model, build, monitor and its configuration, verifier, caps and spacing are as they were.

## Window 8 (2026-10-16): the run's last window, under the owner's exception

**Under the owner's exception for window 7's hold,** launched with `.window-8.preresume-and-launch.sh launch 8 d9fb3c9`, window 7's copy. It started 32 minutes after window 7's last request, the owner's short cooldown.

**Before the first paid call:** every no-cost check was repeated from 01:35:09Z to 01:35:17Z, and all passed (`.window-8.preresume-checks.txt`):
- main at `7e260c3` and clean, and no harness or monitor running;
- 483 evidence checksum entries;
- the run directory byte-identical to window 7's copy at `d9fb3c9`:
  - 687 requests, all finalized;
  - the one hold the owner's exception names, #61, exactly as window 7 left it, and nothing else held;
  - six windows stopped at their caps, and window 7 at its integrity stop, exactly as it left it;
- the frozen tooling and the monitor's configuration;
- the probe equal to the baseline apart from `at`;
- the resume command through the harness's parser and planner;
- seven preflights, so `--preflights 8`;
- the operator record holding invocations 1 to 7.

A check-mode run of the same script, at 01:23:42Z, had passed every check too (`.window-8.check-mode-checks.txt`).

**The invocation:** 01:35:17Z to 01:41:31Z, exit 0.
- **Its end:** the run complete, with all 480 cells done. Its pacing entry records no stop.
- **31 requests sent.**

**Window 8's ledger:** 31 requests, each with one reservation and one final, all settled at the reported usage on `claude-haiku-4-5-20251001`.
- **No refusal,** no hold, and nothing left open.
- **Committed:** $2.1528549, which is $2.050338 at list price, all of it on 2026-10-16 UTC.
- **Window 7's records are unchanged,** the hold included. Its ledger, records and pacing entries are byte-for-byte prefixes of the files as window 8 left them.

**Window 8's cells:** 23, all completed and all passed:
- production nb-05's add refinement, the cell window 7 stopped inside, re-run from its beginning;
- production nb-05's remove and structural refinements;
- nb-06's 20 cells.

In nb-06's 10 block-arm cells, the plan selected no block, and each took the primitive path.

**Window 8's tokens:** 32 provider calls, 2 of which returned unusable output. They used 1,923,043 input and 25,459 output tokens. Priced at Claude Haiku 4.5's rates, they equal the window's settled total exactly.

**The monitor:** exit 0, with no STOP or HOLD line.
- It saw all 31 requests.
- It read the live build 12 times, always `Dyml8RSqfWynKU1KbVuZI`.

**The owner's provider-failure stop:** exit 0 (`.window-8.provider-failure-stop.txt`). It saw the monitor show the harness inside its process group, saw no provider failure, and signalled nothing.

**The run, complete:**
- **Requests:** 718 of its 1,275: 705 settled, 12 released at $0, and window 7's hold.
- **Committed:** $36.85966725 of its $77 ceiling, the hold's $1.118208 included. The settled requests come to $35.74145925 ($34.039485 at list price).
- **Daily spend:** with the fee, $19.1800287 on 2026-10-15 and $17.67963855 on 2026-10-16 UTC, the hold included, each within the owner's $40 daily limit.
- **Cells:** 480 of 480: 448 completed, of which 393 passed, and 32 skipped.

**Verification:** the final verification, `--complete`, below.

## The final verification and the decision (2026-10-16)

**The final verification** of the complete run, as origin holds it at `619e36f`:
- **`verify_run.py`** (at `e3f57da`) with `--complete`, run with:
  - windows 1 to 7's copies as snapshots;
  - all eight monitor events logs and the monitor's configuration;
  - the operator record;
  - the build, code and request-cap expectations.

  It finds **nothing: no findings, and no notes.**
  - It maps 717 of the 718 requests to their cells. The one left is window 7's hold, #61, in the cell window 7 stopped inside, which window 8 re-ran from its beginning.
  - It keeps every earlier window's records, and no window moved any aside.
  - It recomputes the decision and its intervals, and checks the bootstrap with an independent generator.
- **`reconcile_window.py`** agrees on every figure:
  - 718 requests: 705 settled, 12 released at $0 and 1 held;
  - $36.85966725 committed, $35.74145925 of it settled;
  - every settlement and call on `claude-haiku-4-5-20251001`;
  - 30,912,840 input and 625,329 output tokens, whose price equals the settled total to the nanodollar.

**The decision (ADR-B3, corpus v2, binding scoring): pass, uncertain.**

| Arm | Prompt threads | Evaluated cells | Pass rate | Tokens per success |
| --- | ---: | ---: | ---: | ---: |
| block | 24 | 116 | 87.1% (101/116) | 45,446 |
| capped | 24 | 116 | 86.2% (100/116) | 112,229 |
| production | 24 | 112 | 82.1% (92/112) | 119,696 |

- **Tokens per success:**
  - 62.0% fewer than production (95% interval 50.6% to 71.8%), against the 30% the rule needs: clearly met;
  - 59.5% fewer than capped (46.7% to 70.1%).
- **Pass rate against production:** +4.9 points (95% interval −4.9 to +14.8), against the 5-point margin: clearly met.
- **Pass rate against capped:** +0.9 points (95% interval −8.0 to +10.3): uncertain, because the interval crosses the margin.
- **So the verdict, which reads the point estimates, is pass.** The decision is uncertain, because one criterion's interval crosses its threshold.
- **The bootstrap, independently:** 20,000 resamples, and 200 seeds of 2,000, keep the decision uncertain every time. Of the 200 seeds:
  - the token criterion is clear in all 200;
  - the pass-rate criterion against production is clear in 196 and uncertain in 4;
  - the pass-rate criterion against capped is uncertain in all 200.
- **Every reading of the add and remove check** (none, binding, missed and mixed, unchanged misses excused) keeps the verdict pass and the decision uncertain.

**Beside the decision** (these decide nothing):
- **Selection:** the plan chose correctly on all 24 fresh prompts: a block on the 18 block prompts, and none on the 6 nb prompts.
- **Structural refinements are the block arm's weakest condition:** 52.2% passed (12/23), against 78.3% for capped and 59.1% for production.
  - Every one with a block left block mode, as an unsupported refinement (retention 0 of 18).
  - Its primitive fallback had the 2 calls the block phase left, and 9 of those 18 passed.
- **Remove refinements are its strongest:** 91.3% passed, against 73.9% for capped and 68.2% for production.
- **Named against positional (ADR-B2):** the positional encoding passed less often (79.8% against 87.1%) and cost more per success. Its token reduction against named has a 95% interval of −49.3% to −6.0%.

**Against the readiness packet's plan:**
- $36.86 committed, the hold included, against a central estimate of $40.34 (low $18.11, high $72.09);
- 718 requests, against a central 900;
- eight windows.

**Both design-system decisions are now known:** Astryx pass, clear; shadcn/ui v3 pass, uncertain.
- The ADR-B3 addendum allows a fourth stage, the full corpus of 3,600 cells, only when stage 3 was valid and its decision uncertain, as here, and only if narrower intervals are worth their cost.
- That, and Phase 2, are the owner's to decide. Nothing has begun.

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
- `1b-stage3-shadcn-2026-10-15.window-8.preresume-and-launch.sh` and `.window-8.provider-failure-stop.sh`: window 8's launch script and its stop at a new provider failure, under the owner's exception for window 7's hold (above). `.window-8.provider-failure-stop.txt` is that stop's log, and `.window-8.check-mode-checks.txt` the script's check-mode run before the launch. Window 8's `.verify` and `.reconcile` files are the final `--complete` verification.
- `1b-stage3-shadcn-2026-10-15.window-k.preresume-and-launch.sh` and `.window-k.preserve.sh`: the operator scripts for window 3 onward, under the owner's standing authorization.
  - **The launch script** generalizes window 2's. It takes the window number and the commit that preserved the previous window's copy, and reads the expected state from that copy:
    - the run directory byte-identical to it;
    - every request finalized, nothing held;
    - every earlier window stopped at its cap;
    - the identity and caps unchanged.

    It then repeats every no-cost check and launches the packet's frozen command with `--resume`, with the monitor at `--preflights` equal to the window number, only if all pass.
  - **The preserve script** adds the window's copy to this branch.
- `1b-stage3-shadcn-2026-10-15.window-<k>.verify.json` and `.txt`, and `.window-<k>.reconcile.json` and `.txt`, for window 3 onward: as for window 2, against each window's copy as origin holds it.
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
