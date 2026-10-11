# ADR-B3 addendum: the unit, the uncertainty and the stages

**Pre-data.** This addendum was fixed on 2026-10-11, before any hosted result existed: no hosted call had been made under Phase 1B when it landed. It changes how results are counted, compared and reported, not what is measured or what passes.

## What stays fixed

- **The corpus and its labels:** `blocks-1b` v1, frozen 2026-10-10, sha256 `180f4480…5e4231`, owner-approved 2026-10-11.
- **The thresholds:** at least 30% fewer tokens per success against production; a pass rate within 5 points of both the capped and the production arm; both boundaries inclusive; a minimum of 20 (`DEFAULT_DECISION`, frozen and pinned by a test).
- **The scoring:** what tokens per success and the pass rate count (ADR-B3), the parity checklist, the re-run policy.
- **The arms:** `production`, `capped`, `block`, and the comparative `block-positional`.
- **The block contracts and sidecars.**

## What the rule is, and is not

The ADR-B3 rule is a **descriptive product decision rule**. It is an engineering threshold, chosen before any run, for whether interface blocks earn Phase 2.

It is not a statistical test. The 5-point margin is an engineering tolerance, not the output of a power calculation. A non-inferiority claim in the statistical sense would need a pre-registered analysis with controlled error rates, and this rule does not provide one. Meeting the rule on point estimates says the product case holds on this corpus. It is not publication-grade evidence.

## The unit

A **prompt thread** is one prompt on one reference in one arm: its fresh build and its four refinements. The refinements build on the fresh result and share its prompt, so they are repeated observations of that prompt, never independent samples.

**How many independent prompts there are.** The 3,600 cells of a full run come from:
- 92 prompts on shadcn/ui v3 (66 block prompts and 26 null);
- 88 on Astryx (66 and 22);
- each through 4 arms × 5 conditions.

A decision is per reference and provider, so it rests on at most 92 or 88 independent prompts, not on 1,840 or 1,760 cells.

**The minimum of 20 counts prompt threads:**
- per decision arm, threads with an evaluated cell;
- for the token figure, threads with a metered evaluated cell.

Twenty-five cells from five prompts are five threads, and the rule calls them insufficient.

The point estimates the rule reads are unchanged: pooled over every evaluated cell, refinements included, because ADR-B3 counts every call.

## Paired comparisons

Every arm runs the same prompts on the same reference, so arms are compared **paired by prompt**:

- **Counts, prompt by prompt.** For each prompt both arms evaluated: whether the block thread's pass rate was higher, the same, or lower. And, where both threads have a metered success, whether its tokens per success were lower, the same, or higher.
- **Intervals from the same resample in every arm** (below), drawn only from the prompts every compared arm evaluated. Each interval therefore carries the pairing, not two independent noises.

Named against positional encoding (ADR-B2) is compared the same way. It informs ADR-B2 and decides nothing.

## Uncertainty

**Method: a paired cluster bootstrap over prompts.**
- 2,000 resamples, with replacement, of the **paired cohort**: the prompts every compared arm evaluated. A prompt one arm lacks, as in a partial run, joins no interval, and each interval states the cohort it rests on.
- Each resample recomputes every arm's pooled pass rate and tokens per success from all the cells of the prompts drawn.
- A thread's cells are never resampled on their own. Repeating them cannot narrow an interval; a test pins this.
- The generator is seeded per reference and provider, so the same records always give the same report.

**Intervals reported** (95%, percentile):
- the token reduction against production and against capped;
- the pass-rate difference, block minus production and block minus capped, in points.

**Clarity.** A criterion is **clearly met** or **clearly missed** only when its whole interval lies on one side of its unchanged threshold. Otherwise it is **uncertain**. The decision as a whole is **clear** when the outcome cannot flip inside the intervals (every criterion clearly met, or one clearly missed), that outcome is the verdict's, and the intervals rest on at least the minimum's 20 prompts that every decision arm evaluated. The verdict still reads the point estimates, which pool every evaluated cell; when a partial run leaves prompts that only some arms reached, the verdict and the intervals can disagree, and the decision is then uncertain.

**Limitations.** These hold however many cells are run:

- **The prompts are a purposive sample**, written to cover each block and its near misses, not drawn from real user goals. The intervals describe variation across this corpus, not across all goals.
- **Percentile bootstrap intervals run narrow when there are few clusters.**
  - Below about 20 prompts per arm, they are indicative only.
  - At 4 prompts per reference (the smoke and the pilot) they are not interpretable, and the report says insufficient.
- **A pass rate near 100% gives degenerate intervals.** An interval of 0 to 0 points means no prompt disagreed, not that rare failures cannot happen.
- **There is no multiple-comparison correction** across 2 references, 3 criteria and the positional comparison. The rule's criteria are joint requirements, which limits but does not remove this.
- **The scope is one model, one deployment and one tokenizer.** A change of model or deployment mid-run invalidates the comparison for the affected cells, which is why the harness refuses to resume across one.

## Raw counts

Every rate in the report is printed with its numerator and denominator. This covers:
- pass rates;
- first-attempt rates;
- selection and intent accuracy;
- changed and retention rates;
- tokens per success, as metered tokens over metered successes, in every table.

The decision table puts prompt threads beside cells.

## What the offline bench already establishes

**No provider spend is needed for these.** They are measured deterministically by the Phase 0 bench and the harness's dry runs on the real code paths:

- **Request size.** A block request is 382 to 880 input tokens (o200k), named or positional, fresh or refinement. A full generation request is 52k–56k on shadcn/ui and 9k–10k on Astryx, of which schema text is 83%–90% and 79%–83% respectively. Every arm also sends the same planning request, of 0.9k–2.2k. The expected input saving is therefore large if blocks are selected and expand.
- **Expansion correctness.** Each approved block's expansion of its worked examples is byte-exact against its golden, passes S1–S3, and emits on both A2UI versions with only declared actions.
- **Equivalence and budget.**
  - Named and positional calls expand to byte-identical surfaces.
  - The ADR-B4 call budget is exact on every path.
  - The production arm's request bytes equal the app's (the pinned request hashes).
- **Cost bounds.** The offline volume of a full run and of each stage is known before any call (see the authorization packet).

## What only live calls can establish

**Each of these needs the hosted model:**
- whether the planner picks the right block, and picks null for near misses;
- whether model-written calls pass B1/B2, and how often a block needs a repair or falls back;
- tokens per success as the provider counts them, with planning, repairs, retries and the real tokenizer;
- whether the pass rate holds against both primitive arms;
- whether refinements stay in block mode and change what they should;
- whether named and positional answers differ in quality or cost.

Live expense is justified only for these questions, and only as far as an answer can still change the decision.

## The stages, and when to stop

1. **Systems smoke.**
   - **What runs:** fresh condition only. Prompts `rt-01, af-01, gs-01, nb-01`, all four arms, both references: 32 cells, under a hard dollar ceiling.
   - **What it shows:** whether the hosted path works and meters. It is not decision evidence.
   - **When to stop and fix:**
     - a call reports no usage;
     - the model identifier changes or differs from the configured one;
     - the preflight differs from the baseline;
     - request bytes leave the pinned production configuration;
     - the ledger or the lock misbehaves.
2. **Limited pilot (the 160-cell canary).**
   - **What runs:** the same four prompts through all five conditions, adding the refinement paths (compact, switch, fallback).
   - **What it measures:** the real tokenizer ratio, repair and fallback rates, and refinement retention, for cost calibration and validity.
   - **What it cannot do:** four prompts per reference are below the minimum, so it cannot decide.
3. **Minimum paired evaluation.**
   - **What runs:** a subset fixed now, before any data. On each reference: the first six prompts of each block and the first six null prompts that apply to both references, in corpus order (`rt-01`–`rt-06`, `af-01`–`af-06`, `gs-01`–`gs-06`, `nb-01`–`nb-06`). That is 24 prompt threads per arm, all four arms and five conditions: 960 cells.
   - **What it gives:** the smallest run that meets the minimum, and the first descriptive decision with intervals.
4. **The full corpus (3,600 cells).** Only if stage 3 was valid and its decision is uncertain, and only if the narrower intervals are worth their cost.

**Stop as soon as the decision is clear.** At any stage at or above the minimum, a clear decision ends the evaluation; more cells would not change it. A failed validity check stops the stage until it is fixed. More cells are not better evidence when the answer no longer depends on them.
