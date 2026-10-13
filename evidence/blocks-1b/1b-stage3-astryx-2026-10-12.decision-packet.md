# Astryx Stage 3 on corpus v2: decision packet

**Run:** `2026-10-12T23-36-49-450Z-hosted-ai-claude-haiku-4-5-https-composer-aesthetic-function-com`.

**What it measured:**
- **Reference:** Astryx.
- **Model:** `claude-haiku-4-5-20251001` through `hosted-ai:claude-haiku-4.5`.
- **Deployment:** build `txDlHURTKv_S6yicLso97`, main `3aae0ea`.
- **Corpus:** `blocks-1b` v2 (`0e4e4706…61ae9`), binding scoring.
- **Scope:** the 24 Stage-3 prompts, 480 cells.

**How the figures were checked.**
- Every figure here is recomputed from the preserved files by `verify_stage3.py` and `analysis_stage3.py` in this directory, without the harness's code.
- The decision figures match the harness's `summary.json` and `REPORT.md` exactly, the bootstrap intervals included. The verification has no findings.
- Readings other than the frozen rule are labelled. None replaces the verdict, and nothing here promotes anything to Phase 2.

## 1. Status: a formal decision

| The owner's three cases | This run |
| --- | --- |
| A formal decision | **Yes.** The frozen rule was applied to a complete run above its minimum, and every criterion is clearly met. |
| An ambiguous result | **No**, under the frozen scoring: no criterion's interval reaches its threshold. Two readings outside the rule differ: excusing untouched add and remove surfaces makes the capped comparison uncertain (section 5.1), and output tokens alone fall short of 30% (section 4.9). |
| An incomplete run | **No.** All 480 cells ran, and the decision arms have 24 evaluated and 24 metered prompt threads each, against a minimum of 20. |

**Verdict:** Astryx on `hosted-ai:claude-haiku-4.5`, **pass, clear**.

**Its scope** (the addendum's limits apply):
- one reference, one model, one deployment and a purposive set of 24 prompts;
- a descriptive product decision rule, not a statistical test;
- nothing about shadcn/ui v3, which has not run.

## 2. The decision (ADR-B3, thresholds frozen before any run)

| Arm | Prompt threads | Evaluated / metered cells | Pass rate | Tokens per success (metered tokens / successes) |
| --- | ---: | ---: | ---: | ---: |
| block | 24 | 120 / 120 | 94.2% (113 / 120) | 7,573 (855,784 / 113) |
| capped | 24 | 120 / 120 | 95.0% (114 / 120) | 14,908 (1,699,513 / 114) |
| production | 24 | 120 / 120 | 90.0% (108 / 120) | 16,048 (1,733,209 / 108) |

| Criterion | Threshold | Point | 95% interval (2,000 paired cluster resamples, 24 prompts) | Clarity |
| --- | --- | ---: | --- | --- |
| Token cut against production | at least 30% | 52.8% | 39.0% to 65.1% | clearly met |
| Pass rate, block minus production | no lower than -5 points | +4.2 | +0.0 to +8.3 | clearly met |
| Pass rate, block minus capped | no lower than -5 points | -0.8 | -3.3 to +1.7 | clearly met |
| Token cut against capped (reported, not a criterion) | none | 49.2% | 36.1% to 61.1% | none |

**Prompt by prompt:**
- **Against production:** block's thread pass rate is higher on 7 prompts, the same on 15 and lower on 2. Its tokens per success are lower on 21 of 24 and higher on 3, all null prompts (nb-01, nb-02, nb-05).
- **Against capped:** higher on 1, the same on 21, lower on 2. Tokens per success are lower on 21 and higher on 3 (nb-01, nb-02, nb-04).

**The bootstrap is not an artifact of its generator.**
- The seeded resample reproduces the report's intervals exactly.
- An independent generator over 20,000 resamples gives 39.0% to 65.0%, -0.8 to +8.3 points and -3.3 to +1.7 points.
- Over 200 further seeds of 2,000 resamples each, the decision is clear every time. The lowest lower bounds are 37.7% for the token cut, -0.8 points against production and -4.2 points against capped.

## 3. Ordinary and binding readings, side by side

Corpus v2's binding rule fails a passing add or remove refinement whose lists did not change in the requested direction. The ordinary reading takes the pipeline's pass alone, as corpus v1 did.

| Reading | Verdict | Clarity | Passed: block · capped · production | Token cut (interval) | Block − production, points (interval) | Block − capped, points (interval) |
| --- | --- | --- | --- | --- | --- | --- |
| **binding (the frozen v2 rule)** | **pass** | **clear** | 113 · 114 · 108 of 120 | 52.8% (39.0 to 65.1) | +4.2 (+0.0 to +8.3) | -0.8 (-3.3 to +1.7) |
| ordinary (the pipeline's pass alone) | pass | clear | 118 · 117 · 113 of 120 | 52.7% (39.1 to 65.0) | +4.2 (-0.8 to +9.2) | +0.8 (-1.7 to +3.3) |
| mixed changes failing too | identical to binding: no arm has a mixed change | | | | | |

**What the add and remove check read** (passing add and remove refinements):

| Arm | Checked | Performed | Mixed | Missed | Of them unchanged | Unchecked | Where the misses are |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| block | 48 | 43 | 0 | 5 | 1 | 0 | nb-01 add, nb-01 remove, nb-02 add (unchanged), nb-02 remove, nb-03 remove |
| capped | 47 | 44 | 0 | 3 | 1 | 0 | nb-01 remove (unchanged), nb-02 remove, nb-03 remove |
| production | 47 | 42 | 0 | 5 | 3 | 0 | nb-01 add (unchanged), nb-01 remove (unchanged), nb-02 remove (unchanged), nb-03 add, nb-03 remove |
| block-positional | 45 | 39 | 0 | 6 | 4 | 0 | af-02 remove, af-04 remove (both unchanged), nb-01 add and remove (unchanged), nb-02 remove, nb-03 remove |

Every miss in the decision arms is on the three destructive-confirmation null prompts, nb-01 to nb-03. Section 5.2 explains why those cells do not test an add or a remove on Astryx.

## 4. Results in detail

### 4.1 Per condition, binding (ordinary in brackets where it differs)

| Condition | Arm | Pass rate | Tokens per success | Passed at the first attempt | Repairs |
| --- | --- | ---: | ---: | ---: | ---: |
| fresh | block | 100.0% (24/24) | 5,560 | 23 | 1 |
| fresh | capped | 100.0% (24/24) | 15,582 | 20 | 4 |
| fresh | production | 100.0% (24/24) | 14,571 | 21 | 3 |
| fresh | block-positional | 95.8% (23/24) | 7,569 | 22 | 1 |
| refine-content | block | 100.0% (24/24) | 4,235 | 24 | 0 |
| refine-content | capped | 100.0% (24/24) | 12,030 | 24 | 0 |
| refine-content | production | 100.0% (24/24) | 12,021 | 24 | 0 |
| refine-content | block-positional | 100.0% (23/23) | 5,357 | 23 | 0 |
| refine-add | block | 91.7% (22/24) [100.0%, 5,181] | 5,652 | 22 | 0 |
| refine-add | capped | 95.8% (23/24) | 14,591 | 21 | 2 |
| refine-add | production | 87.5% (21/24) [95.8%, 14,574] | 15,962 | 21 | 0 |
| refine-add | block-positional | 91.3% (21/23) [95.7%, 8,221] | 8,613 | 20 | 1 |
| refine-remove | block | 87.5% (21/24) [100.0%, 5,677] | 6,488 | 21 | 0 |
| refine-remove | capped | 87.5% (21/24) [100.0%, 12,978] | 14,832 | 21 | 0 |
| refine-remove | production | 87.5% (21/24) [100.0%, 12,479] | 14,262 | 21 | 0 |
| refine-remove | block-positional | 78.3% (18/23) [100.0%, 6,377] | 8,149 | 18 | 0 |
| refine-structural | block | 91.7% (22/24) | 16,369 | 21 | 1 |
| refine-structural | capped | 91.7% (22/24) | 17,717 | 20 | 2 |
| refine-structural | production | 75.0% (18/24) | 25,573 | 18 | 0 |
| refine-structural | block-positional | 87.0% (20/23) | 19,304 | 19 | 1 |

The block arm is cheapest in every condition. Its structural refinements, which always fall back to a full surface, cost the most of its conditions, and still less than either primitive arm's.

### 4.2 Per block family, binding (ordinary in brackets where it differs)

| Family | Block | Capped | Production | Block-positional |
| --- | --- | --- | --- | --- |
| records-table (6 prompts) | 30/30 · 3,886 | 30/30 · 12,434 | 29/30 · 13,738 | 30/30 · 8,508 |
| auth-form (6) | 30/30 · 3,677 | 30/30 · 12,335 | 29/30 · 13,181 | 23/26 · 3,857 [25/26 · 3,549] |
| guide-steps (6) | 28/30 · 5,964 | 28/30 · 16,462 | 27/30 · 17,765 | 29/30 · 5,383 |
| null (6) | 25/30 · 18,475 [30/30 · 15,396] | 26/30 · 19,058 [29/30 · 17,087] | 23/30 · 20,561 [28/30 · 16,889] | 23/30 · 22,210 [27/30 · 18,920] |

Each cell reads as passed / evaluated · tokens per success.

**The per-prompt table:**

| Prompt | Block | Capped | Production | Positional | Block's cut against production |
| --- | ---: | ---: | ---: | ---: | ---: |
| rt-01 | 5/5 · 3,912 | 5/5 · 12,881 | 5/5 · 12,526 | 5/5 · 4,054 | 68.8% |
| rt-02 | 5/5 · 3,918 | 5/5 · 12,308 | 4/5 · 21,986 | 5/5 · 12,719 | 82.2% |
| rt-03 | 5/5 · 3,816 | 5/5 · 12,433 | 5/5 · 12,369 | 5/5 · 4,225 | 69.1% |
| rt-04 | 5/5 · 3,920 | 5/5 · 12,192 | 5/5 · 12,373 | 5/5 · 4,111 | 68.3% |
| rt-05 | 5/5 · 3,969 | 5/5 · 12,555 | 5/5 · 12,571 | 5/5 · 13,253 | 68.4% |
| rt-06 | 5/5 · 3,782 | 5/5 · 12,233 | 5/5 · 12,253 | 5/5 · 12,683 | 69.1% |
| af-01 | 5/5 · 3,286 | 5/5 · 14,217 | 5/5 · 14,292 | 0/1 · n/a | 77.0% |
| af-02 | 5/5 · 3,273 | 5/5 · 11,944 | 5/5 · 11,956 | 4/5 · 4,243 | 72.6% |
| af-03 | 5/5 · 3,424 | 5/5 · 12,040 | 4/5 · 18,074 | 5/5 · 3,458 | 81.1% |
| af-04 | 5/5 · 5,569 | 5/5 · 11,932 | 5/5 · 11,966 | 4/5 · 4,234 | 53.5% |
| af-05 | 5/5 · 3,253 | 5/5 · 11,984 | 5/5 · 11,923 | 5/5 · 3,428 | 72.7% |
| af-06 | 5/5 · 3,259 | 5/5 · 11,895 | 5/5 · 11,855 | 5/5 · 3,545 | 72.5% |
| gs-01 | 5/5 · 4,314 | 5/5 · 12,759 | 5/5 · 12,919 | 5/5 · 4,333 | 66.6% |
| gs-02 | 5/5 · 6,736 | 4/5 · 22,321 | 4/5 · 22,366 | 5/5 · 4,248 | 69.9% |
| gs-03 | 4/5 · 8,980 | 5/5 · 13,451 | 5/5 · 13,346 | 4/5 · 8,654 | 32.7% |
| gs-04 | 4/5 · 7,939 | 4/5 · 25,239 | 5/5 · 12,595 | 5/5 · 3,875 | 37.0% |
| gs-05 | 5/5 · 4,678 | 5/5 · 15,665 | 4/5 · 27,186 | 5/5 · 4,561 | 82.8% |
| gs-06 | 5/5 · 4,137 | 5/5 · 12,261 | 4/5 · 21,784 | 5/5 · 7,283 | 81.0% |
| nb-01 | 3/5 · 27,262 | 4/5 · 20,305 | 3/5 · 23,144 | 3/5 · 27,177 | -17.8% |
| nb-02 | 3/5 · 31,028 | 3/5 · 27,017 | 3/5 · 23,086 | 3/5 · 27,150 | -34.4% |
| nb-03 | 4/5 · 17,633 | 4/5 · 23,272 | 3/5 · 31,080 | 4/5 · 23,378 | 43.3% |
| nb-04 | 5/5 · 15,588 | 5/5 · 15,560 | 4/5 · 22,822 | 4/5 · 23,011 | 31.7% |
| nb-05 | 5/5 · 15,459 | 5/5 · 17,803 | 5/5 · 15,261 | 4/5 · 25,266 | -1.3% |
| nb-06 | 5/5 · 12,248 | 5/5 · 14,669 | 5/5 · 14,676 | 5/5 · 12,246 | 16.5% |

**The block prompts and the null prompts behave differently.**
- **On all 18 block prompts** the block arm cuts tokens per success by 33% to 83%.
- **On the 6 null prompts** the block arm runs the production configuration (section 5.5). The differences there, -34% to +43%, are sampling variation between two copies of one configuration.

### 4.3 Selection

- **Block accuracy:** 24 of 24, 100%. That is 18 blocks chosen as labelled and 6 explicit nulls.
- **No other outcomes:** no omitted field, no answer withdrawn by reconciliation and no failed planning call.
- **Intent accuracy:** 23 of 24, 95.8%. The miss is nb-04 ("a board of selectable project cards to pick one to open"), labelled `record-collection` and planned as `transactional-review`. Its block choice, null, was still correct.

### 4.4 Refinement retention

**The block arm** (refinements on a block prior, compact mode):

| Condition | Retained in block mode |
| --- | ---: |
| content | 17 / 18 |
| add | 18 / 18 |
| remove | 17 / 18 |
| structural | 0 / 18 |

- **Overall:** 52 of 72 (72.2%), or 52 of 54 (96.3%) without the structural condition.
- **Structural refinements fall back by design:** the blocks cannot express those changes.
- **The two other fallbacks** are gs-02 content and af-04 remove. In each the model answered that the block could not express the change. Both passed after falling back.

**The positional arm** retained 42 of 68 (61.8%).
- Three records-table prompts (rt-02, rt-05 and rt-06) had a fresh positional call that failed B1. They fell back, so their refinements had no valid seed and switched to primitive (12 cells).

### 4.5 Fallback behavior, repairs and failures

**Fallback in the block arm:**
- 20 fallbacks, every one "unsupported-refinement": the model answering that the block cannot express the change. 18 were structural, plus gs-02 content and af-04 remove.
- The budget left at fallback was 2 calls in 19 cases and 1 in one.
- 18 of the 20 passed after falling back. gs-03 and gs-04 structural failed lint after their two remaining attempts.
- No other kind of fallback in the block arm: no invalid call and no provider failure.
- The positional arm had 3 invalid-call fallbacks (rt-02, rt-05 and rt-06 fresh) and one provider-failure path (af-01 fresh).
- No arm had an invariant failure or an exhausted budget.

**First-attempt passes and repairs** (binding):

| Arm | Passed at the first attempt | Repairs per success |
| --- | ---: | ---: |
| block | 111 / 120 (92.5%) | 0.018 (2 / 113) |
| capped | 106 / 120 (88.3%) | 0.070 (8 / 114) |
| production | 105 / 120 (87.5%) | 0.028 (3 / 108) |

**Re-issues and parse retries.** An unusable output is retried once, in one of two ways:
- **Re-issued by the shared ADR-B4 rule:** block 1, capped 4, block-positional 6.
- **Retried inside the Worker,** in requests made in the production configuration: 9 in all. That is 4 in the production arm, 1 in the block arm and 4 in the positional arm, the last two on their primitive refinements of null prompts.

**The pipeline's 17 failures** (none eligible for a re-run):

| Arm | Cell | Outcome |
| --- | --- | --- |
| block | gs-03 structural, gs-04 structural | failed-lint-exhausted, via fallback (2 attempts) |
| capped | gs-02 structural, gs-04 structural | failed-lint-exhausted (3 attempts) |
| capped | nb-02 add | failed-adapter, unusable output |
| production | rt-02, gs-02, gs-05, gs-06, nb-04 structural | failed-lint-exhausted (3 attempts) |
| production | af-03 structural; nb-02 add | failed-adapter, unusable output |
| block-positional | af-01 fresh (its 4 refinements skipped), gs-03 structural, nb-02 add, nb-04 structural | failed-adapter, unusable output |
| block-positional | nb-05 structural | failed-lint-exhausted |

### 4.6 Latency

Execution time, with the harness's own pacing waits removed. Figures are medians per cell, in seconds:

| Arm | All cells | Fresh | Refinements | Plan call (fresh) | Block phase | First gated attempt | Emit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| block | 3.2 | 5.9 | 2.8 | 2.6 | 2.1 (fresh 3.1) | 3.0 | 0.11 |
| capped | 3.9 | 5.9 | 3.3 | 2.0 | n/a | 3.5 | 0.11 |
| production | 3.7 | 5.9 | 3.2 | 2.2 | n/a | 3.5 | 0.11 |
| block-positional | 3.4 | 6.2 | 2.7 | 2.5 | 2.2 | 3.0 | 0.11 |

- **Fresh builds take the same time in the three decision arms,** 5.9 s (positional 6.2 s). The block arm's plan call is 0.4 to 0.6 s slower, because it carries the block choice, and its block call is short.
- **Refinements** are about 0.4 s faster in the block arm.
- **Wall-clock medians are about 12.2 to 12.6 s per cell in every arm**, dominated by the 12 s spacing.

### 4.7 Semantic parity (the committed checklist, over passing cells)

| Arm | Mean score, all | Full scores, all | Mean score, fresh | Full scores, fresh |
| --- | ---: | ---: | ---: | ---: |
| block | 0.828 | 75 / 113 | 0.875 | 18 / 24 |
| capped | 0.818 | 75 / 114 | 0.847 | 17 / 24 |
| production | 0.808 | 70 / 108 | 0.847 | 17 / 24 |
| block-positional | 0.780 | 65 / 105 | 0.826 | 16 / 23 |

The block arm scores at least as well as both primitive arms.

**The checker has a limitation that lowers every arm's absolute scores** (section 5.8): it never reads strings inside arrays, which is where Astryx tables keep their column headers and cells.

### 4.8 Named against positional encoding (ADR-B2: comparative, decides nothing)

| | Named (block arm) | Positional |
| --- | ---: | ---: |
| Pass rate | 94.2% (113 / 120) | 90.5% (105 / 116) |
| Tokens per success | 7,573 | 9,628 |

**Prompt by prompt:** positional's pass rate is higher on 1 prompt, the same on 18 and lower on 5. Its tokens per success are lower on 8 and higher on 15, of 23 comparable.

**The intervals:**
- positional minus named pass rate: -8.2 to 0.0 points;
- positional's token change against named: -54.4% to -6.1%, so it costs more.

**Where positional loses:**
- three records-table fresh calls whose positional values did not fit the declared fields (rt-02, rt-05 and rt-06), each falling back with its refinements switched to primitive;
- af-01 fresh, which gave two unusable outputs and so skipped its four refinements;
- two compact removes re-sent unchanged (af-02 and af-04).

This supports ADR-B2's choice of the named encoding as the contract.

### 4.9 Cost measures beside tokens (binding)

| Measure | Block | Capped | Production | Cut against production (interval) | Cut against capped (interval) |
| --- | ---: | ---: | ---: | --- | --- |
| tokens (the rule's) | 7,573 | 14,908 | 16,048 | 52.8% (39.0 to 65.1) | 49.2% (36.1 to 61.1) |
| list dollars | $0.00938 | $0.01701 | $0.01843 | 49.1% (36.3 to 60.2) | 44.8% (32.9 to 55.5) |
| input tokens only | 7,121 | 14,382 | 15,452 | 53.9% (39.6 to 66.7) | 50.5% (37.1 to 62.9) |
| output tokens only | 452 | 526 | 596 | 24.2% (16.1 to 31.2) | 14.0% (5.2 to 23.4) |
| tokens without the planning call | 7,269 | 14,673 | 15,801 | 54.0% (40.0 to 66.4) | 50.5% (37.2 to 62.6) |

The saving is in input: blocks avoid sending the full generation schema. Output falls less: on output tokens alone the cut is 24.2% (16.1% to 31.2%), short of 30%, though the rule counts input and output together. Because output costs five times as much per token, the dollar cut (49%) is a little smaller than the token cut (53%).

## 5. Validity and sensitivity

The readings in this section were not defined by the frozen rule unless marked otherwise. They test whether the conclusion depends on particular cells, prompts or choices of measure.

### 5.1 Unchanged and mixed operations

- **Mixed changes: none in any arm.**
  - Most list nodes in these Astryx surfaces carry ids, which the check matches by id.
  - 50 of the 459 saved surfaces also hold id-less nodes in lists, mostly text, which it matches by place.
  - No add or remove read as mixed, as the amendment's simulation predicted for Astryx (0%). Failing mixed changes too would change nothing.
- **Missed operations:** 13 in the decision arms (block 5, capped 3, production 5), every one on nb-01 to nb-03. Binding scoring moves the pass rates from 98.3%, 97.5% and 94.2% (ordinary) to 94.2%, 95.0% and 90.0%. The verdict and its clarity are the same under both.
- **Unchanged misses** are surfaces the refinement left exactly as they were: block 1 (nb-02 add), capped 1 (nb-01 remove), production 3.
  - The frozen v2 rule fails them. Under v2 every add and remove template is meant to apply to every prompt, so an untouched surface counts as an ignored instruction.
  - **Excusing them** (counting them as correct no-ops, the v1-era "changed-missed" reading) keeps the verdict, pass. The block-minus-capped interval then reaches -5.8 points (-5.8 to +3.3), so that criterion and the decision become **uncertain**. The token cut stays clear (51.9%, 36.1% to 65.0%).
  - **The mechanism is two cells on one prompt.** On nb-01 the block arm failed both its add and its remove, while capped's only miss there was unchanged. Excusing it widens the per-prompt difference and stretches the interval's lower end past the margin.
  - Of the readings of the add and remove check, this is the only one under which any criterion is not clear. It is not part of the frozen rule, and section 5.2 shows that the cells it turns on do not test the operation at all.

### 5.2 The null add and remove templates do not apply to nb-01 to nb-03 on Astryx

- **The fresh surfaces have nothing to act on.** In all four arms, each of these three destructive confirmations is a single Astryx `alert-dialog` node with no list: 12 of 12 surfaces. "Add one more item." and "Remove the last item." have no item to act on. The static audit (`live/applicability.ts`) marks both templates `always` applicable; this run shows that is not so for these prompts on Astryx.
- **The outcomes there are arbitrary:**
  - **a remove that returns the Astryx contract's own example surface, "Delete project confirmation", verbatim.** It appears in 8 identical cells across all four arms, nb-02 and nb-03 included, where it replaces the prompt's dialog with an unrelated delete-project card. It reads as an add. The pipeline passed it, and parity's labels ("delete", "remove") appear in its text, so the ordinary reading counts these off-topic surfaces as successes;
  - an untouched surface;
  - on nb-02's add, three arms failing on an unusable output.
- **The add instruction also provoked unusable outputs:** 6 of the run's 9 Worker parse retries, and 2 of its 11 re-issues, are on nb-01 to nb-03 add cells.
- **These cells say nothing about blocks.** On null prompts the block arm runs the production configuration.
- **All 13 binding failures in the decision arms are in these 18 cells.**
- **Leaving them out** (post hoc), the decision is pass, clear:
  - token cut 57.0% (44.7% to 66.8%);
  - block minus production +3.5 points (-0.9 to +8.0);
  - block minus capped 0.0 (-2.6 to +2.6).
- **Without nb-01 to nb-03 entirely** (21 prompts): pass, clear, with a 60.9% cut (49.5% to 70.8%).
- **What follows:** the binding rule's whole effect on the decision comes from cells where its instruction does not apply. Outside the decision arms, its only other failures are the positional arm's two unchanged compact removes (section 5.4).
  - It penalized every arm, and the decision does not depend on it.
  - Where it failed the removes above, those surfaces were wrong anyway, though the check read them for an incidental reason.
  - Section 6 lists this for the next corpus revision, not for this run.

### 5.3 The structural condition (D1 to D3 not adopted)

- **18 of the 24 structural prompts ask for something Astryx cannot render,** because D1 to D3 were left out:
  - tabs, for records-table;
  - a progress indicator and a checkbox, for auth-form;
  - two columns with a sidebar, for null prompts.
- **C3's guide-steps template is renderable,** and yet it failed most:
  - **guide-steps:** 7 of 18 decision-arm cells failed (block gs-03 and gs-04; capped gs-02 and gs-04; production gs-02, gs-05 and gs-06);
  - **the three impossible templates:** 3 of 54 failed (production rt-02, af-03 and nb-04).

  The models approximated the impossible elements and passed the gates. The records do not keep the lint findings, so which element of the guide-steps request tripped lint is not known.
- **Production failed 6 of its 24 structural cells,** against 2 each for block and capped. That accounts for most of block's pass-rate lead over production: +4.2 points overall, +1.0 without the structural condition.
- **Without the structural condition** (post hoc), the decision is pass, clear:
  - token cut 61.5% (44.5% to 77.7%);
  - block minus production +1.0 points (+0.0 to +3.1);
  - block minus capped -1.0 (-3.1 to +0.0).

### 5.4 C2's premise (removing the first field)

**It held:** no arm removed a password field. The auth-form removes took out:
- the email or name field (af-01, af-02, af-04, af-05, af-06), with the "Forgot password?" button as well in the block arm's af-01 and af-06;
- or, on af-03, the provider buttons, which every arm removed along with the email field.

**The predicted case appeared twice, both in the comparative arm.** The amendment expected that a model balking at deleting a field would show up as a compact re-send that reads as missed. That happened in the positional arm (af-02 and af-04, both unchanged). The named block arm's six auth-form removes were all performed.

### 5.5 Block prompts and null prompts (an A/A check)

On null prompts the block arm plans with a null block and then runs exactly the production configuration, so its null-prompt cells are a second sample of production.

| Prompts | Prompts in the subset | Token cut | Block − production | Block − capped |
| --- | ---: | --- | --- | --- |
| block prompts only | 18 | 69.8% (63.4 to 74.9) | +3.3 (-2.2 to +8.9) | 0.0 (-3.3 to +3.3) |
| null prompts only | 6 | 10.1% (-14.0 to +29.3) | +6.7 (+0.0 to +13.3) | -3.3 (-10.0 to 0.0) |

- **Both subsets fall below the minimum,** so the rule would call them insufficient. The intervals still show something.
- **Where blocks apply,** they cut tokens per success by about 70%.
- **Between two copies of one configuration,** the difference is about 10%, with an interval spanning zero.

**The pooled 52.8% is a blend of the two.** It depends on the corpus's mix of block and null prompts: 18 to 6 here, the same 3 to 1 as the full Astryx corpus (66 to 22). A product whose real goals rarely fit a block would see less.

### 5.6 Prompt clustering and near-duplicates

| Check | Result |
| --- | --- |
| Leave one prompt out (24 recomputations) | pass, clear in all 24. Cut 50.7% to 56.2%; block − production +3.5 to +5.2 points; block − capped -1.7 to 0.0 |
| Leave one family out (18 prompts each, below the minimum) | point cuts 47.3% (without records-table), 47.5% (auth-form), 47.6% (guide-steps), 69.8% (null). Every token interval's lower end is above 30% |
| Near-duplicates by shared words (Jaccard ≥ 0.3) | af-01 with af-02 and af-05, merged: 22 clusters. Resampling clusters: clear, cut 37.8% to 65.6%, block − production +0.0 to +8.5, block − capped -3.6 to +1.8 |
| Near-duplicates by reading: {af-01, af-05, af-06} sign-in, {af-02, af-04} sign-up, {nb-01, nb-02, nb-03} destructive confirmations | 19 clusters (below the minimum, so read for width only): cut 35.0% to 68.3%, block − production -0.8 to +8.7, block − capped -3.5 to +1.9. Every interval stays on the passing side of its threshold |
| Token concentration | The block arm's three most expensive prompts (nb-02, nb-01, nb-04, all null) carry 29.5% of its metered tokens; capped's and production's top three carry about 17% |

**No single prompt, family or near-duplicate cluster carries the decision.** The intervals widen when near-duplicates are merged, and stay clear of every threshold.

### 5.7 Templates and corpus limits

- **The prompts are a purposive sample,** written to cover each block and its near misses (the addendum). The intervals describe variation across this corpus, not across real user goals.
- **The add and remove check reads direction, not content.** A refinement that changed something other than what was asked, in the requested direction, passes; that is open to every arm.
- **The amendment's element rule flags three fresh prompts:** nb-06's team photos, nb-16's breadcrumb trail (a shadcn/ui v3 casualty, on a shadcn-only prompt) and af-07, which only matches the photo pattern. Fresh prompts are outside amendment 2 and unchanged. Only nb-06 is in this subset, and it passed in every arm.

### 5.8 Measurement defects found (reporting only; neither enters the decision)

- **Parity never reads strings inside arrays.** `live/parity.ts` collects text from `text` fields and string-valued props, but skips strings held in arrays. Astryx tables keep their column headers and cells in arrays, so labels such as "SKU" or "Quantity" in a table read as missing in every arm. Parity is reported beside the decision, never in it, and the defect lowers every arm's score alike. It is a follow-up candidate, with a fail-first test on an Astryx table's `columns`.
- **`analyze.mjs` is not fit for runs with more than one invocation.** It walks the ledger as one sequence and reads the pipeline's pass, not binding scoring (README). `verify_stage3.py` replaces it for this run.

## 6. Conclusion

- **Formal:** Astryx, `hosted-ai:claude-haiku-4.5`, corpus v2 binding. **Pass, clear.** Blocks cut tokens per success by 52.8% against production, and keep the pass rate within the margin of both primitive arms.
- **It holds under:**
  - the ordinary and the binding scoring;
  - leaving out any prompt;
  - resampling near-duplicate clusters;
  - list dollars, input tokens alone, and tokens without the planning call;
  - leaving out the non-applicable nb-01 to nb-03 add and remove cells, or the structural condition;
  - other bootstrap generators and seeds.
- **On output tokens alone it falls short:** a 24.2% cut (16.1% to 31.2%). The saving is in input, which the rule counts together with output.
- **Its clarity rests on one choice:** failing untouched add and remove surfaces, as the frozen rule does. Excusing them makes the capped comparison uncertain, though the verdict stays pass. The cells it turns on do not test the operation (section 5.2).
- **It does not show:**
  - anything about shadcn/ui v3, the reference with the larger schema, casualty components and place-matched nodes;
  - anything about another model or deployment;
  - whether real user goals fit blocks as often as this corpus does.
- **Follow-up candidates for a later corpus or harness revision.** None changes this run.
  - The null add and remove templates' applicability on leaf surfaces such as Astryx's `alert-dialog`.
  - Parity's arrays.
  - `analyze.mjs` across invocations.
  - The Worker's 429 classification (`1b-stage3-astryx-2026-10-12.follow-up-429.md`).
- **Nothing is promoted to Phase 2.** That decision is the owner's.
