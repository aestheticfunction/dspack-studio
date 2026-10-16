# Governed interface blocks: the Phase 1B milestone report

**2026-10-16. The record of Phase 1B, the live evaluation of governed interface blocks on both packaged references.** Every measured figure here comes from the preserved runs. The few that do not, offline estimates and static audits, say where they come from. Section 13 says where the evidence is kept, and how this report was checked.

## 1. Executive summary

Composer can generate a surface two ways. In the **primitive** way, the model writes the whole surface against the design system's full generation schema. In the **block** way, the model fills a small, owner-authored signature, and deterministic code expands it into an ordinary surface before the same governance gates run. Phase 1B measured, on the hosted model, whether blocks cut the tokens a successful result costs without lowering how often results pass.

**Both references passed the frozen decision rule. They differ in how clearly.**

| | Astryx | shadcn/ui v3 |
| --- | --- | --- |
| **Decision** (ADR-B3, frozen before any run) | **pass, clear** | **pass, uncertain** |
| Tokens per success: block, capped, production | 7,573, 14,908, 16,048 | 45,446, 112,229, 119,696 |
| Token cut against production (95% interval) | 52.8% (39.0% to 65.1%) | 62.0% (50.6% to 71.8%) |
| Pass rate: block, capped, production | 94.2%, 95.0%, 90.0% | 87.1%, 86.2%, 82.1% |
| Block minus capped, in points (95% interval) | -0.8 (-3.3 to +1.7) | +0.9 (-8.0 to +10.3) |

- **Pass, clear** (Astryx): every criterion's 95% interval lies on the passing side of its threshold.
- **Pass, uncertain** (shadcn/ui v3): the point estimates meet every criterion, but one interval crosses its threshold. Against the budget-matched primitive arm, the 95% interval for the difference in pass rate reaches -8.0 points, past the margin of -5. That is not a failure: the rule's verdict reads the point estimates, and the token criterion and the comparison with production are clear.
- **The saving is real on both references.** It comes mostly from input: blocks avoid sending the full generation schema with every request.
- **The named encoding is the contract.** The compact positional encoding passed less often and cost more per success on both references.
- **Every run was verified independently.** Its ledger, cell records and decision were recomputed with no findings.
- **The owner's decision (branch C):** an Astryx-only experimental beta. shadcn/ui v3 Stage 4 is deferred: in the owner's words, its results are promising, but the personal cost of the larger experiment is not worthwhile at this stage. It is recorded as a deferral, not a shadcn/ui v3 failure or a permanent exclusion ([PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md)).
- **Cost:** the two decision runs committed $7.6298649 (Astryx) and $36.85966725 (shadcn/ui v3) on the harness's ledger. Each figure includes one conservative hold of $1.118208, which the AI Gateway's log shows was never charged.

## 2. The research question

**Do governed interface blocks reduce hosted tokens per successful result by at least 30%, without lowering the end-to-end pass rate by more than 5 points against either primitive configuration?**

The question is narrow on purpose:
- **The unit of cost** is tokens as the provider reports them, input plus output, across every call a result needs: planning, generation, repairs, fallback and refinements.
- **The unit of quality** is the governed pipeline's own verdict (S1 to S3, emit, A1 to A3), with the add and remove refinements held to the operation they asked for.
- **The comparison** is against two primitive arms: today's production configuration, and a primitive arm held to the block arm's call budget.

Why it matters: the offline Phase 0 bench showed that hosted input is dominated by schema text. On shadcn/ui v3, 83% to 90% of a fresh request's input tokens, by an offline estimate, are the generation schema ([../BLOCKS.md](../BLOCKS.md)). Those offline figures were estimates. Phase 1B measured the real thing.

## 3. The frozen methodology

The method is set out in [../BLOCKS.md](../BLOCKS.md) (ADR-B3, ADR-B4), [ADR-B3-ADDENDUM.md](ADR-B3-ADDENDUM.md) and [ADR-B3-AMENDMENT-2.md](ADR-B3-AMENDMENT-2.md). All of it was fixed before the Stage 3 run it governs began, and none of it changed during the runs. In order:
- **ADR-B3 and ADR-B4** (Phases 0 to 1A) and **the addendum** (2026-10-11) came before any hosted result.
- **Amendment 2 and corpus version 2** (2026-10-12) came after the two systems smokes had run fresh cells on corpus version 1, and before any refinement cell ran live (section 3.1).
- **The shadcn/ui v3 monitor's rules** (section 3.7) were frozen on 2026-10-14, after the Astryx result and before the shadcn/ui v3 run.

### 3.1 The decision rule (ADR-B3)

Blocks pass for a reference only if both hold, with both boundaries inclusive:
1. **Tokens per success** fall by at least 30% against production.
2. **The pass rate** is non-inferior within 5 points against **both** primitive arms, capped and production.

**The addendum, fixed before any hosted result:**
- **It is a descriptive product decision rule, not a statistical test.** Meeting it is not publication-grade evidence.
- **The independent unit is the prompt thread:** one prompt on one reference in one arm, with its fresh build and its four refinements. Refinements are repeated observations of their prompt, never independent samples.
- **There must be at least 20 evaluated and 20 metered prompt threads per arm.** Both runs had 24.
- **Arms are compared paired by prompt,** with 95% paired cluster-bootstrap intervals: 2,000 resamples over the prompts every decision arm evaluated.
- **Clarity:**
  - a criterion is *clearly met* when its whole interval lies on the passing side of its threshold, and *uncertain* when the interval crosses it;
  - the decision is *clear* when no outcome inside the intervals could flip it, that outcome is the verdict's, and the intervals rest on at least 20 prompts that every decision arm evaluated;
  - the verdict itself reads the point estimates.
- **Stages:** the evaluation stops as soon as the decision is clear.
  - Stage 1 is a systems smoke, and Stage 2 a pilot.
  - Stage 3 is the minimum paired evaluation: 24 prompts per reference.
  - Stage 1 ran as a systems smoke, after an earlier attempt stopped on an integrity condition. Stage 2 did not run.
  - Stage 4, the full corpus, runs only if Stage 3 was valid and uncertain, and only if narrower intervals are worth their cost.

**Amendment 2, adopted by the owner on 2026-10-12, before any refinement cell ran live:**
- It corrects the add and remove templates, and one structural template, that a static audit found could not apply to every prompt or design system.
- It makes the add and remove check **binding** in every arm alike: a passing add or remove refinement that did not change its lists the way it asked counts as a failure.

### 3.2 The corpus

**`blocks-1b` version 2,** frozen 2026-10-12, sha256 `0e4e4706e19ec92565fea2019258cd5d83f6bef0eca424a0634ccf4749b61ae9`.
- **The whole corpus:** 97 prompts, 22 for each block and 31 null prompts. Of them, 92 apply to shadcn/ui v3 and 88 to Astryx.
- **Each prompt carries:** its expected block (or none), its expected intent per reference, and a parity checklist of labels and components the surface should contain.
- **The owner approved** the block definitions and the frozen corpus on 2026-10-11, and adopted version 2 on 2026-10-12 (amendment 2).

**Stage 3 used the subset fixed in the addendum,** the same 24 prompts on each reference:
- `rt-01` to `rt-06`: records-table;
- `af-01` to `af-06`: auth-form;
- `gs-01` to `gs-06`: guide-steps;
- `nb-01` to `nb-06`: null prompts, which no block fits.

### 3.3 The arms

| Arm | What it is |
| --- | --- |
| `block` | The experimental path. A planning call that also asks which block fits (or none), then the block phase: a block call, the B1 and B2 gates, deterministic expansion, and the governed pipeline. When no block is selected it runs today's path, as the app does. **The decision reads this arm.** |
| `block-positional` | The same path with the model answering in the compact positional encoding (ADR-B2). It is decoded to the named call before B1. It is compared with `block` and decides nothing. |
| `capped` | The budget-matched primitive arm: production's planning call, which does not ask about blocks, then primitive generation within the block arm's budget of 3 provider calls. |
| `production` | Today's configuration, unchanged: one planning call, then primitive generation with up to 2 repairs and the Worker's own parse retry. |

### 3.4 The conditions

Each prompt runs five conditions in each arm:
- **fresh:** a build from the prompt;
- **refine-content:** a content change to the arm's own fresh result;
- **refine-add:** add a repeated item;
- **refine-remove:** remove one;
- **refine-structural:** a structural change the blocks do not support, which must fall back.

A refinement runs only on its arm's own passing fresh result. A failed fresh build skips its four refinements, which then count in no rate.

**Cells per reference:** 24 prompts, 4 arms and 5 conditions make 480. The cells run prompt-major, so a run stopped at any point holds balanced comparisons.

### 3.5 Budget and fairness (ADR-B4)

- **The budget:** at most 3 provider generation calls per cell in the block and capped arms. The planning call is outside it.
- **The block phase leaves the rest of the budget** to the governed pipeline: repairs after an expansion, or a primitive fallback.
- **Both budgeted arms share one adapter,** so an unusable output is re-issued under the same rule in each.
- **Ordinary arm results are never re-run:** budget exhaustion, fallback, unusable output twice and failed gates.
- **Only a cell that ended in a provider or policy failure** is re-run, and no cell in either run ended in one. The two replies the runs could not meter stopped their runs instead (section 6).

### 3.6 Model, deployment and accounting

- **Model:** Claude Haiku 4.5, served as `claude-haiku-4-5-20251001` on every call of both runs. The hosted path goes through the composer's Worker and the account's AI Gateway.
- **One deployment per run.**
  - Each run was held to a zero-cost baseline of its deployment: the build id, the Worker's reply shape and the sidecars.
  - Every invocation's preflight matched it, and the harness refuses to resume across a deployment change. For shadcn/ui v3 the monitor also read the live build every 30 seconds, and it never changed.
  - No merge to main fell inside either run.
- **Tokens** are what the provider reported for each call. Nothing is estimated.
- **Dollars** are the harness's ledger: each request is reserved at its worst case before it is sent, then settled at its reported usage. The price is Claude Haiku 4.5's ($1 per million input tokens, $5 per million output tokens) plus Cloudflare's 5% credit fee.
- **A reply the run cannot meter** is held at the worst case one request can cost, $1.118208, and the run stops (section 6). The harness never reads the account's bill.

### 3.7 Run controls

Each run was capped in requests and dollars, paced at 12 seconds between requests, and watched by an operator monitor. The no-cost checks were repeated before every invocation, and each window's evidence was preserved and verified before the next began.

- **On Astryx,** the monitor logged progress, refusals and the hold. Its log is preserved; the monitor's own script is not, and the log holds no build readings.
- **On shadcn/ui v3,** the monitor's rules were frozen before the run (`monitor-shadcn.json`, section 13). It read the live build every 30 seconds. Among its rules, it stopped a window at:
  - a hold, any other unexpected settlement, a policy failure or an invariant failure;
  - the 8th zero-cost refusal, or 600 s of refusal backoff, in the window;
  - a second provider failure;
  - another build, model, corpus, reference or code identity, or a build it could not read for 5 minutes.

## 4. Results

### 4.1 The decisions

| | Astryx | shadcn/ui v3 |
| --- | --- | --- |
| **Verdict and clarity** | **pass, clear** | **pass, uncertain** |
| Prompt threads per decision arm (evaluated and metered) | 24 and 24 | 24 and 24 |
| Evaluated cells: block, capped, production | 120, 120, 120 | 116, 116, 112 |
| **Tokens per success** (metered tokens / successes) | | |
| block | 7,573 (855,784 / 113) | 45,446 (4,590,027 / 101) |
| capped | 14,908 (1,699,513 / 114) | 112,229 (11,222,949 / 100) |
| production | 16,048 (1,733,209 / 108) | 119,696 (11,012,017 / 92) |
| **Criterion 1:** token cut against production (needs 30%) | 52.8% (39.0% to 65.1%): clearly met | 62.0% (50.6% to 71.8%): clearly met |
| Token cut against capped (reported, not a criterion) | 49.2% (36.1% to 61.1%) | 59.5% (46.7% to 70.1%) |
| **Pass rate** (passed / evaluated) | | |
| block | 94.2% (113 / 120) | 87.1% (101 / 116) |
| capped | 95.0% (114 / 120) | 86.2% (100 / 116) |
| production | 90.0% (108 / 120) | 82.1% (92 / 112) |
| **Criterion 2a:** block minus production, in points (no lower than -5) | +4.2 (+0.0 to +8.3): clearly met | +4.9 (-4.9 to +14.8): clearly met |
| **Criterion 2b:** block minus capped, in points (no lower than -5) | -0.8 (-3.3 to +1.7): clearly met | +0.9 (-8.0 to +10.3): **uncertain** |

The intervals are 95% paired cluster-bootstrap intervals, from 2,000 resamples over the 24 prompts.

**Why shadcn/ui v3 is uncertain.** Its pass-rate interval against the capped arm runs from -8.0 to +10.3 points, across the -5 point margin. The point estimate is +0.9 in the block arm's favour, but the 24 prompts cannot rule out a deficit larger than the margin. Section 4.4 shows the conditions where the arms differ. Against production the interval's lower end is -4.9, just inside the margin, so that criterion is clearly met but only narrowly (section 4.7).

**Prompt by prompt** (paired counts):

| | Astryx against production | Astryx against capped | shadcn/ui v3 against production | shadcn/ui v3 against capped |
| --- | --- | --- | --- | --- |
| Block's thread pass rate higher, same, lower | 7, 15, 2 | 1, 21, 2 | 10, 6, 8 | 6, 8, 10 |
| Block's tokens per success lower, higher (of comparable) | 21, 3 (of 24) | 21, 3 (of 24) | 20, 1 (of 21) | 20, 2 (of 22) |

### 4.2 Token efficiency

**Where the saving comes from.** It comes mostly from input, per success, in the decision arms:

| | Astryx: block, capped, production | shadcn/ui v3: block, capped, production |
| --- | --- | --- |
| Input tokens per success | 7,121, 14,382, 15,452 | 44,400, 110,175, 117,372 |
| Output tokens per success | 452, 526, 596 | 1,046, 2,054, 2,324 |
| Cut against production: input, output | 53.9%, 24.2% | 62.2%, 55.0% |

- **The input cut is the schema not sent.** A fresh cell's requests post, on average:

  | | block | capped | production |
  | --- | ---: | ---: | ---: |
  | Astryx | 19,075 bytes | 54,015 | 50,406 |
  | shadcn/ui v3 | 70,458 bytes | 331,168 | 362,136 |

- **Output falls less on Astryx.** Its output-only cut, 24.2%, is short of 30% on its own, and the Astryx decision packet's interval for it, 16.1% to 31.2%, crosses 30%. The rule counts input and output together, so this does not affect the decision. No interval was computed for shadcn/ui v3's output-only cut. Its point figure, 55.0%, is a descriptive reading beside the rule, not a criterion.
- **Fewer repairs.** The block arm needed far fewer repairs on shadcn/ui v3, where fresh primitive generation often failed its first attempt:

  | | First-attempt pass: block, capped, production | Repairs per success |
  | --- | --- | --- |
  | Astryx | 92.5% (111 / 120), 88.3% (106 / 120), 87.5% (105 / 120) | 0.018, 0.070, 0.028 |
  | shadcn/ui v3 | 81.0% (94 / 116), 65.5% (76 / 116), 63.4% (71 / 112) | 0.069, 0.280, 0.228 |

- **Latency.** Median execution time of a fresh cell, with the harness's own pacing removed:
  - Astryx: 5,920 ms (block), 5,886 ms (capped) and 5,867 ms (production).
  - shadcn/ui v3: 7,577 ms, 11,560 ms and 11,722 ms.
  - Time to a first valid preview equals completion today, so these are also its figures.

### 4.3 Selection accuracy

The planner chose correctly on every fresh prompt of both references:
- **Astryx: 24 of 24.** That is a block on all 18 block prompts and an explicit null on all 6 null prompts.
  - Intent accuracy was 23 of 24. nb-04 was labelled `record-collection` and planned as `transactional-review`, and its null block choice was still right.
- **shadcn/ui v3: 24 of 24,** with the same split, and intent accuracy 24 of 24.
- **On both references:** no omitted answer, no rejected answer and no failed planning call.
- **The limit:** this is accuracy on a purposive corpus written to cover each block and its near misses. It is not accuracy on real users' goals.

### 4.4 Results by condition

Pass rate (passed / evaluated) per condition. Skipped refinements of failed fresh builds are not evaluated.

**Astryx**

| Condition | block | capped | production | block arm: retained in block mode |
| --- | --- | --- | --- | --- |
| fresh | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) | n/a |
| refine-content | 100.0% (24/24) | 100.0% (24/24) | 100.0% (24/24) | 17 of 18 |
| refine-add | 91.7% (22/24) | 95.8% (23/24) | 87.5% (21/24) | 18 of 18 |
| refine-remove | 87.5% (21/24) | 87.5% (21/24) | 87.5% (21/24) | 17 of 18 |
| refine-structural | 91.7% (22/24) | 91.7% (22/24) | 75.0% (18/24) | 0 of 18 |

**shadcn/ui v3**

| Condition | block | capped | production | block arm: retained in block mode |
| --- | --- | --- | --- | --- |
| fresh | 95.8% (23/24) | 95.8% (23/24) | 91.7% (22/24) | n/a |
| refine-content | 100.0% (23/23) | 95.7% (22/23) | 100.0% (22/22) | 18 of 18 |
| refine-add | 95.7% (22/23) | 87.0% (20/23) | 90.9% (20/22) | 18 of 18 |
| refine-remove | 91.3% (21/23) | 73.9% (17/23) | 68.2% (15/22) | 18 of 18 |
| refine-structural | 52.2% (12/23) | 78.3% (18/23) | 59.1% (13/22) | 0 of 18 |

**Retention** counts the block arm's refinements of a block surface (18 per condition) that stayed in block mode.

**Findings by condition:**
- **Content, add and remove refinements mostly stay in block mode:** 52 of 54 on Astryx, and 54 of 54 on shadcn/ui v3.
- **The block arm's largest lead on shadcn/ui v3 was on removes:** 91.3% against 73.9% (capped) and 68.2% (production).
- **Structural refinements are where the block arm is weakest on shadcn/ui v3:** 52.2%, against 78.3% for capped.
  - Every structural refinement of a block surface leaves block mode, by design: the model answers that the block cannot express the change. That held on 18 of 18 on each reference.
  - The primitive fallback then works with the budget the block phase left: 2 calls for all 18 on shadcn/ui v3. 9 of those 18 passed on shadcn/ui v3, against 16 of 18 on Astryx.
  - The capped arm spends its whole budget of 3 on the structural change itself.
  - It is the only condition in which the capped arm passed more cells than the block arm on shadcn/ui v3: 18 against 12.
- **On Astryx the structural condition favoured blocks over production:** 91.7% against 75.0%. The Astryx decision packet traces most of block's lead over production to it.
- **Some structural templates ask for something the design system cannot render, or the prompt does not have,** because the corrections D1 to D3 were not adopted. Amendment 2's static audit counts 18 of the 24 structural prompts on Astryx, and 11 on shadcn/ui v3. Every arm receives the same templates, but amendment 2 records that the sign of their effect on the block arm is unknown (section 8).

### 4.5 Fallback, failures and invariants

- **Invariant failures** (a template that expanded to something the gates or the emitter reject): **none,** on either reference, in any arm.
- **Provider or policy failures in a cell record:** none. Nothing was eligible for a re-run.
- **Budget exhaustion:** none on Astryx. On shadcn/ui v3, 2 cells in the block arm and 1 in the positional arm, all structural refinements.
- **The pipeline's failures are all ordinary arm results,** across all four arms.
  - Astryx: 10 cells ran out of lint repairs, and 7 ended on unusable output twice.
  - shadcn/ui v3: 15 failed gates, 5 ran out of lint repairs, and 35 ended as adapter failures. Of the 35, 32 were unusable output twice and 3 ran out of the call budget.
- **Binding scoring** also fails a passing add or remove refinement that missed its operation. In the three decision arms it failed 13 such cells on each reference.

### 4.6 Named against positional encoding (ADR-B2)

The positional arm decides nothing. It tests whether the compact positional call is worth committing to.

| | Astryx: named, positional | shadcn/ui v3: named, positional |
| --- | --- | --- |
| Pass rate, every condition | 94.2% (113/120), 90.5% (105/116) | 87.1% (101/116), 79.8% (83/104) |
| Tokens per success | 7,573, 9,628 | 45,446, 56,785 |
| Positional minus named pass rate, 95% interval | -8.2 to +0.0 points | -15.2 to +0.3 points |
| Positional's token reduction against named, 95% interval (negative: positional cost more) | -54.4% to -6.1% | -49.3% to -6.0% |

- **On both references positional cost more per success,** and passed no more often.
- **Where positional lost:**
  - On Astryx, as the Astryx decision packet lists: three records-table fresh calls whose positional values did not fit the declared fields, which fell back; one fresh build with two unusable outputs; and two compact removes re-sent unchanged.
  - On shadcn/ui v3, positional's thread pass rate was lower on 10 prompts. Among them, three fresh calls (rt-02, rt-03 and af-01) returned no usable answer, which skipped their twelve refinements. With nb-05's fresh failure, which the named arm shared, positional skipped 16 refinements in all.
- **This supports ADR-B2:** the named call is the contract. The owner chose named encoding only for the beta.

### 4.7 Robustness and sensitivity

- **An independent bootstrap** used another generator, with 20,000 resamples and 200 seeds of 2,000 resamples each.
  - **Astryx:** the decision is clear in all 200 seeds. The lowest lower bounds were 37.7% for the token cut, -0.8 points against production and -4.2 points against capped.
  - **shadcn/ui v3:** the decision is uncertain in all 200 seeds.
    - The token criterion is clear in all 200.
    - The criterion against production is clear in 196 and uncertain in 4, with lower bounds as low as -5.4 points.
    - The criterion against capped is uncertain in all 200, with lower bounds as low as -8.6 points.
- **Readings of the add and remove check.** The binding check is the frozen rule, and each verifier also recomputed the decision under four other ways of counting those refinements.
  - **shadcn/ui v3:** every reading gives pass, uncertain.
  - **Astryx:** three readings give pass, clear. Two that excuse unchanged surfaces as correct no-ops give pass, uncertain (block minus capped -5.8 to +3.3). The Astryx decision packet shows that the cells this turns on do not test the operation: on nb-01 to nb-03, Astryx surfaces have no list to add to or remove from.
- **Leaving out any single prompt** keeps the Astryx decision pass, clear in all 24 cases. The same check was not run for shadcn/ui v3.

## 5. What the runs cost: requests, tokens and dollars

The requests and dollars are the harness ledgers' figures (`requests.jsonl`). The provider calls and tokens come from the cell records (`runs.jsonl`). A **held** request is a conservative reservation at the worst case one request can cost, not a measured charge.

| Run | Corpus | Cells | Requests: settled, released at $0, held | Provider calls | Input tokens | Output tokens | Settled at reported usage | Held | Committed |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Astryx Stage 3 | v2 | 480 | 679: 670, 8, 1 | 679 | 5,073,868 | 225,542 | $6.5116569 | $1.118208 | $7.6298649 |
| shadcn/ui v3 Stage 3 | v2 | 480 | 718: 705, 12, 1 | 729 | 30,912,840 | 625,329 | $35.74145925 | $1.118208 | $36.85966725 |

- **The settled amounts equal the logged cells' reported usage** at the prices in section 3.6, to the nanodollar. At list price, before the fee, they are $6.201578 and $34.039485.
- **The released requests** were zero-cost refusals from the shared gateway (a `503 busy` reply), each retried once after 30 seconds and then settled.
- **The two holds** (section 6) were checked by the owner in the AI Gateway's log. Neither was charged. They stay in the ledgers, as the owner directed.
- **Provider calls outnumber settled requests,** by 9 on Astryx and 24 on shadcn/ui v3. A request in the production configuration may make a second call, the Worker's parse retry.
- **Time:** Astryx ran in two invocations, from 2026-10-12 23:36Z to 2026-10-13 02:28Z. shadcn/ui v3 ran in eight, from 2026-10-15 00:22Z to 2026-10-16 01:41Z.
- **Against the readiness estimate:** the shadcn/ui v3 plan estimated $40.34 and 900 requests at its central figure (low $18.11 and 516, high $72.09 and 1,212). Those were estimates. The run committed $36.86 over 718 requests.

**All hosted spend in Phase 1B.** Two systems smokes on corpus v1 preceded the Stage 3 runs. They are systems evidence only and enter no decision.

| Run | Requests | Committed |
| --- | ---: | ---: |
| c154548 systems smoke (stopped, diagnostic only) | 16 | $1.4677782 |
| Option B systems smoke | 74 | $1.52478375 |
| Astryx Stage 3 | 679 | $7.6298649 |
| shadcn/ui v3 Stage 3 | 718 | $36.85966725 |
| **Total** | **1,487** | **$47.4820941** |

Of that total, $44.1274701 settled at reported usage. The other $3.354624 is four conservative holds: two of $0.559104 in the c154548 smoke, at that harness's worst case for one provider call, and one of $1.118208 in each Stage 3 run.

## 6. Run integrity: the holds, and the controlled completion

**The integrity rule, frozen in the harness.** A call that reached the provider must report its usage and the model that served it.
- A reply that cannot show this is held at the worst case one request can cost, $1.118208, and the run stops itself (exit 3).
- The cell in flight logs no record, and a resume runs it again from its beginning.
- A refusal that reached no model is released at no cost, and is not a stop.

**Astryx, window 1, request #539** (2026-10-13 01:25:50Z, after 387 cells):
- **The reply:** the Worker's 502 provider error, with a call that reported no usage.
- **The cause:** the owner's AI Gateway log shows HTTP 429, with no usage and no cost: a zero-cost refusal. The Worker then recognized a busy reply only by its message's text.
- **The fix:** aestheticfunction/dspack-studio#101 (`eaf6ae3`) made the Worker read the 429 from the status the AI binding records, before the shadcn/ui v3 run began.
- **The completion:** the owner authorized one resume. It re-ran the stopped cell from its start and completed the run.

**shadcn/ui v3, window 7, request #61** (2026-10-16 01:02:59Z, after 457 of 480 cells):
- **Where:** the first request of production nb-05's add refinement.
- **The reply:** one `provider-error` call with no token counts. It was not the zero-cost busy shape, so the harness held it and stopped, and the monitor logged the hold.
- **What the gateway shows:** HTTP 502 in the owner's AI Gateway log, with no recorded usage and no charge.
- **The owner's exception:** the owner authorized window 8 only, as an explicit exception for this hold.
  - The hold's $1.118208 stays in the ledger permanently, unchanged.
  - The operator's launch script accepted exactly this hold and window 7's stop, and still refused any other hold or stop. It was tested offline against altered copies of the run.
  - A further operator script was set to stop the run at the first new provider failure, which the frozen monitor allows once per window. It saw none.
- **Window 8:** it started after a 32-minute cooldown, with every no-cost check repeated.
  - It re-ran the interrupted cell from its beginning and completed the remaining 23 cells.
  - All 31 of its requests settled, with no refusal, hold or provider failure.
  - The final verification (`--complete`) found nothing.

**The shadcn/ui v3 windows:**

| Window | Started (UTC) | Requests | Zero-cost refusals | How it ended |
| ---: | --- | ---: | ---: | --- |
| 1 | 2026-10-15 00:22 | 104 | 1 | at its request cap |
| 2 | 2026-10-15 20:20 | 105 | 1 | at its request cap |
| 3 | 2026-10-15 23:05 | 104 | 1 | at its request cap |
| 4 | 2026-10-15 23:29 | 104 | 1 | at its request cap |
| 5 | 2026-10-15 23:53 | 105 | 0 | at its request cap |
| 6 | 2026-10-16 00:19 | 104 | 4 | at its request cap |
| 7 | 2026-10-16 00:49 | 61 | 4 | integrity stop on #61 |
| 8 | 2026-10-16 01:35 | 31 | 0 | complete |

- **The cap per window** was 123 requests.
- **The run's caps** were 1,275 requests and $77.
- **The daily spend limit:** the owner temporarily raised Cloudflare's daily limit from $10 to $40 so the windows could run back to back, with auto top-up off; the evidence branch records the raise. After the run, the owner reported restoring the limit to $10, with auto top-up still off.

## 7. Accessibility and product limitations

**auth-form cannot meet WCAG 2.2 SC 1.3.5 (input purpose) from the governed surface today.**
- Neither contract has an `autocomplete` vocabulary.
- Both emit profiles map an `email` field to A2UI `shortText`, so even `type="email"` is lost on emission.
- The shadcn/ui 3.2.0 `input` has no required prop, so required fields are not marked.
- Error text, `aria-invalid` and announcements are host-owned.
- **For the beta,** the owner decided that auth-form ships only under a documented accessibility exception with a host mitigation. GA stays blocked until the vocabulary lands upstream and the host semantics are defined ([PHASE-2-RELEASE-PLAN.md](PHASE-2-RELEASE-PLAN.md), §10).

**Preview renderers** (Composer's own previews, not a host's):
- the shadcn/ui table renderer does not render a caption;
- Astryx heading variants render as `<p>`, so block titles are not headings in the Astryx preview;
- shadcn/ui `Separator` has no native renderer and draws through the wireframe fallback.

**Accessibility testing so far:**
- **What runs:** an automated axe pass over the experimental Settings section, the Block row, the note and the receipt, on shadcn/ui v3 projects.
- **What it leaves out:** it excludes the rendered canvas, and it does not cover Astryx builds.
- **Nothing has measured block surfaces against WCAG 2.2 AA.**

**Product limits:**
- **Composer never executes actions.** Block actions are semantic names a host binds, and the host authorizes each effect.
- **Per-row actions are blocked by vocabulary.** dropdown-menu is a casualty on Astryx, and its items carry no action on shadcn/ui v3.
- **Blocks are offered only on packaged reference projects and Example sessions** on their unedited design system. Imported projects, repository projects and local models get none.
- **Structural changes are outside the blocks.** They always fall back to primitive generation (section 4.4).
- **Parity scores labels and components only.** The corpus names no action names.

## 8. Threats to validity

1. **The corpus is a purposive sample.** The 24 prompts per reference were written to cover each block and its near misses: 18 block prompts and 6 null prompts.
   - They are the Stage 3 subset of the prompts that apply to each reference: 24 of 88 on Astryx, and 24 of 92 on shadcn/ui v3. The results describe that subset.
   - The intervals describe variation across these prompts, not across real users' goals.
   - The pooled token cut blends the two kinds of prompt. On Astryx, after the run, the block prompts alone gave a 69.8% cut, and the null prompts 10.1%, with an interval spanning zero. On null prompts the block arm runs production's path, so that is an A/A comparison.
   - A product whose real goals rarely fit a block would see less. The same split was not computed for shadcn/ui v3.
2. **One model, one hosted path.** Claude Haiku 4.5 through the composer's Worker and the account's gateway. Nothing here transfers automatically to another model, provider or local model.
3. **The two references ran on different builds.**
   - Astryx measured `3aae0ea`, and shadcn/ui v3 measured `7e260c3`.
   - Between them the Worker's 429 reading changed (#101) and the harness's parity reading changed (#102).
   - The production arm's request bytes are identical at both commits.
   - The two results are each internally controlled, but a comparison across the references is descriptive.
4. **Time and load.** The runs were on different days, and the shared gateway's load varied: shadcn/ui v3's zero-cost refusals rose in windows 6 and 7.
   - Within a prompt the arms ran in a fixed order, not interleaved at random.
   - Each logged cell is a single run, with no repeat to average over. The two cells in flight at the integrity stops ran again from their start on resume, and only the re-run is logged.
5. **Template applicability.** Some refinements could not apply to the surface in front of them.
   - The null add and remove templates meet Astryx's single-node confirmation dialogs.
   - Some structural templates ask for elements a reference cannot render (D1 to D3 were not adopted).
   - Every arm receives the same templates, but their effect need not be the same in each. Of the structural ones, amendment 2 records that "the sign of their effect on the block arm is unknown", and that neither version "is a safe default for the block arm".
   - They can move pass rates. On Astryx, two cells on nb-01, an add and a remove on a surface with no list to change, decide the clarity of the two sensitivity readings that excuse unchanged surfaces (section 4.7).
6. **The add and remove check reads the direction of a change, not its content.**
7. **A descriptive rule.** ADR-B3 is a product decision rule over 24 prompts, not a statistical test. The addendum lists the limits of its intervals, and "clear" rests on them:
   - percentile bootstrap intervals run narrow when there are few clusters. The addendum treats fewer than about 20 prompts as indicative only, and Stage 3 had 24;
   - a pass rate near 100% gives degenerate intervals: an interval of 0 to 0 points means no prompt disagreed, not that rare failures cannot happen;
   - there is no correction for multiple comparisons across the references, the criteria and the positional comparison. The criteria are joint requirements, which limits this but does not remove it.
8. **Accounting.** Tokens are provider-reported. Dollars are the harness's pricing of them, plus conservative holds. The account's bill was not read, except where the owner checked the two holds in the gateway log.
9. **A measurement defect, reporting only.** Astryx's report read parity with a defect corrected after the run (an erratum on its evidence branch). Parity is not in the decision, and shadcn/ui v3 measured with the corrected reading.
10. **Where the evidence lives.** The raw evidence sits on unmerged branches. The commit-pinned links here stay valid while those commits remain in the repository.

## 9. What the experiment does not establish

- **That blocks pass clearly on shadcn/ui v3.** The decision is uncertain against the budget-matched arm.
- **Results on the rest of the corpus.** Stage 3 ran 24 of the 88 prompts that apply to Astryx and 24 of the 92 that apply to shadcn/ui v3. The full corpus is Stage 4.
- **Anything about other design systems,** other block families, other models or local models.
- **How often real users' goals fit a block,** or how accurately real goals are routed. Field data has no labels.
- **Accessibility conformance** of block surfaces.
- **The behaviour of real hosts:** binding actions, handling entered values, or the data model when an action fires.
- **Production economics.** Beta traffic, and its share of the shared gateway's limit, are unmeasured. Decision-grade beta figures will come only from an owner-run canary on the beta deployment.
- **That positional encoding is worth committing to.** It did worse on both references.
- **Cross-session refinement from stored provenance.** It was not in scope.

## 10. The decision: branch C, and why Stage 4 is deferred

**The owner accepted the shadcn/ui v3 result as valid, pass, uncertain, on 2026-10-16, and selected branch C** of the release plan. The decisions:
- **An Astryx-only experimental beta.** shadcn/ui v3 blocks are withheld from it, and the beta explains that their evaluation remains inconclusive.
- **Stage 4 is deferred.**
  - Under the addendum, Stage 4 (the full corpus) is open only because Stage 3 was valid and uncertain, and only if narrower intervals are worth their cost.
  - In the owner's words, the results are promising, but the personal cost of the larger experiment is not worthwhile at this stage.
- **A deferral, recorded as such.** It is not a shadcn/ui v3 failure and not a permanent exclusion. shadcn/ui v3 met every criterion on its point estimates.

The beta's other decisions (a separate origin, invite-only, a block-specific kill switch, named encoding only, the shared gateway) are in [PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md).

## 11. Criteria for reconsidering shadcn/ui v3

**Under branch C as the release plan defines it, shadcn/ui v3 joins only if an owner-authorized Stage 4 passes clearly** under the unchanged frozen rule: the same thresholds, the same scoring, and every criterion's interval on its passing side.

The rest of this section is this report's proposal, for the owner to weigh. None of it is an owner decision.

**What could make Stage 4 worth its cost:**
- **Cost.** A lower price per token, or a cheaper way to run the full corpus.
- **Value.** Evidence from the Astryx beta that blocks are worth offering on the default reference.
- **Change.** A change to the composer's shadcn/ui reference or its blocks. What such a change would need before it counts is the plan's change policy (§13, decision 9), which is still open.

**What would not count:**
- re-reading Stage 3, or a subset of its prompts chosen after the fact;
- the Astryx beta's results on their own;
- a relaxed threshold.

**What a revision might target first:** structural refinements, where the block arm's fallback runs on a reduced budget and passed 9 of 18 on shadcn/ui v3.
- A change to that budget would change ADR-B4, the frozen fairness rule, for every reference.
- A change to a block falls under the change policy. Under the plan's recommendation, a change to a block's signature, actions, intents, summary or prompt is a new block version and needs a new evaluation stage.

## 12. Implications and recommended next steps

**Implications:**
- **Blocks reduce hosted tokens per success substantially on both references.** Both token cuts clear 30% with room: their intervals' lower ends are 39.0% and 50.6%.
- **On Astryx, quality held clearly.** On shadcn/ui v3 it held against production, but against the budget-matched arm the evidence cannot exclude a deficit beyond the margin. On shadcn/ui v3, structural refinements are the one condition in which the budget-matched arm passed more cells.
- **The named call is the contract.** Positional encoding is not worth a compatibility commitment.
- **The integrity controls worked.** Two replies the runs could not meter were held and stopped, and both turned out uncharged. No figure in either decision depends on an unverified reply.

**Recommended next steps,** each a separately reviewable change that needs the owner's authorization (the release plan, §4 to §12, Astryx only):
1. **Merge this record set (G1).** Merging redeploys the composer with a new build id. That is expected, and `docs/blocks/baseline.json` stays the historical record of `7e260c3`.
2. **The beta deploy path:** a separate beta origin and Worker, invite-only, with the block-specific runtime kill switch and its reference and block allowlists.
3. **Host action authorization:**
   - load-time proof of each block's action allowlist;
   - an action manifest in the beta's export;
   - a host guide stating that a surface id and an action name alone grant nothing without verified provenance or expansion identity.
4. **The beta's documentation:** the auth-form accessibility exception and host mitigation, the known gaps, and the note explaining why shadcn/ui v3 blocks are withheld.
5. **Observability and accessibility:**
   - shape-only logs and receipts;
   - an owner-run canary on the beta deployment;
   - axe and manual passes on rendered block surfaces.
6. **The release acceptance criteria** of the plan's §12, before the first beta deploy.

**Housekeeping:** protect the evidence branches, or tag the cited commits, so that every link in section 13 stays reachable.

## 13. Evidence: branches, commits, run ids and verification

All evidence is in aestheticfunction/dspack-studio, on branches that are never merged. Every link names a commit, so it shows the evidence as preserved.

| Evidence | Branch | Commit | Contents | Verification |
| --- | --- | --- | --- | --- |
| Astryx Stage 3 run | `claude/blocks-stage3-astryx-evidence` | [`a4da53293b0e196430fae8d024d8eb233dd78717`](https://github.com/aestheticfunction/dspack-studio/tree/a4da53293b0e196430fae8d024d8eb233dd78717/evidence/blocks-1b) | The complete run directory: ledger, records, pacing, summary, report. Also the logs, checks and `verify_stage3.py` with its result | No findings. Re-verified by `verify_run.py --complete` at `e3f57da`: no findings, no notes |
| Astryx decision packet, erratum and README | the same | [`e3f57da4280e8f67c5f8cdecde3fc0872e03708b`](https://github.com/aestheticfunction/dspack-studio/blob/e3f57da4280e8f67c5f8cdecde3fc0872e03708b/evidence/blocks-1b/1b-stage3-astryx-2026-10-12.decision-packet.md) | The formal decision with its validity and sensitivity analysis; the [parity erratum](https://github.com/aestheticfunction/dspack-studio/blob/e3f57da4280e8f67c5f8cdecde3fc0872e03708b/evidence/blocks-1b/1b-stage3-astryx-2026-10-12.erratum-parity.md); the [README](https://github.com/aestheticfunction/dspack-studio/blob/e3f57da4280e8f67c5f8cdecde3fc0872e03708b/evidence/blocks-1b/README.md) | The packet's tables come from `analysis_stage3.py`, committed beside them |
| Verification tooling: `verify_run.py`, `monitor_run.py` and the shadcn/ui v3 monitor configuration | the same | [`e3f57da4280e8f67c5f8cdecde3fc0872e03708b`](https://github.com/aestheticfunction/dspack-studio/blob/e3f57da4280e8f67c5f8cdecde3fc0872e03708b/evidence/blocks-1b/tooling/README.md) | The verifier and monitor frozen for the shadcn/ui v3 run | Tested offline on the Astryx run and on synthetic runs |
| shadcn/ui v3 Stage 3 run, final copy | `claude/blocks-stage3-shadcn-evidence` | [`619e36f31afa72edcbd39f7b3841276b9819d090`](https://github.com/aestheticfunction/dspack-studio/tree/619e36f31afa72edcbd39f7b3841276b9819d090/evidence/blocks-1b) | The complete run directory, all eight windows' logs, monitor logs and checks, and the window-8 exception scripts | Each window verified before the next began |
| shadcn/ui v3 final verification and README | the same | [`27a91085a2b784a682e6a7fdfc31a649751b2449`](https://github.com/aestheticfunction/dspack-studio/blob/27a91085a2b784a682e6a7fdfc31a649751b2449/evidence/blocks-1b/README.md) | `verify_run.py --complete` and the independent reconciliation | No findings and no notes |
| Production baseline, `7e260c3` | `claude/blocks-baseline-7e260c3-evidence` | [`460cc81d7af794eadabb7da919dc4bd147c09c74`](https://github.com/aestheticfunction/dspack-studio/tree/460cc81d7af794eadabb7da919dc4bd147c09c74/evidence/blocks-1b) | The record shadcn/ui v3 was held to; copied as `docs/blocks/baseline.json` | Every window's probe equaled it apart from its time |
| Production baseline, `eaf6ae3` | `claude/blocks-baseline-eaf6ae3-evidence` | [`d85a0e872ad8d888f2b367d0db3c4eba99c31efe`](https://github.com/aestheticfunction/dspack-studio/tree/d85a0e872ad8d888f2b367d0db3c4eba99c31efe/evidence/blocks-1b) | The baseline after the 429 fix | n/a |
| Option B systems smoke | `claude/blocks-smoke-option-b-evidence` | [`a71b47cdfbc1ee33b7015a68f4f3c16a3059509f`](https://github.com/aestheticfunction/dspack-studio/tree/a71b47cdfbc1ee33b7015a68f4f3c16a3059509f/evidence/blocks-1b) | Stage 1, 32 cells; systems evidence only | Its own reconciliation |
| c154548 systems smoke | `claude/blocks-smoke-c154548-evidence` | [`11aa8b4e2419984410c318a5da9a57a3b743f826`](https://github.com/aestheticfunction/dspack-studio/tree/11aa8b4e2419984410c318a5da9a57a3b743f826/evidence/blocks-1b) | Stopped twice; diagnostic only | n/a |

**Run ids:**
- Astryx: `2026-10-12T23-36-49-450Z-hosted-ai-claude-haiku-4-5-https-composer-aesthetic-function-com`
- shadcn/ui v3: `2026-10-15T00-22-25-520Z-hosted-ai-claude-haiku-4-5-https-composer-aesthetic-function-com`

**On main:**
- [stage3/](stage3/README.md): each run's `REPORT.md`, `manifest.json` and preflights, byte-identical to the commits above, with checksums.
- [baseline.json](baseline.json) and [BASELINE.md](BASELINE.md).
- [PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md) and [PHASE-2-RELEASE-PLAN.md](PHASE-2-RELEASE-PLAN.md).

**How this report was checked.**
- **The figures.** Every figure was taken from the runs' summaries, ledgers and records at the commits above, by script.
- **The numbers in the text.** Each was matched back to them.
- **The links.** Every link was resolved against the repository.
- **Independent review.** Two independent reviews fact-checked this report against the evidence before it merged. The description of the pull request that added it lists what they found and what was corrected.
