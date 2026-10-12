# ADR-B3 amendment 2: corpus v2 and the binding add and remove check

**Status: proposed, not adopted.** Drafted on 2026-10-12 for the owner's review. It takes effect only when the owner adopts it, and only before Stage 3's first paid call. Corpus v1, and everything measured on it, stays as it is.

**Pre-data.** No refinement cell has ever run live. Both smokes ran fresh cells only: `1b-smoke-2026-10-11` ran 5, and `1b-smoke-option-b-2026-10-12` ran 32. Neither ran a content, add, remove or structural refinement, so no arm's result on any template exists. Every change below follows from a static audit of the corpus text and the design systems' vocabularies (`live/applicability.ts`). None follows from an arm's output.

## What stays fixed

- **The thresholds:** at least 30% fewer tokens per success against production, a pass rate within 5 points of both the capped and the production arm, both boundaries inclusive, and a minimum of 20 (`DEFAULT_DECISION`, pinned by a test).
- **The corpus content:** every prompt, intent, label and parity checklist; the content templates; and every other template that applies everywhere.
- **The design:** the arms, conditions, call budgets and re-run policy; the addendum's unit, paired intervals and stages.
- **The system under test:** the block contracts and sidecars, the model prompts and how requests are built, and production behavior. The corpus is a test input only; no request golden reads it.
- **Corpus v1:** `blocks-1b` v1, frozen 2026-10-10, sha256 `180f4480…5e4231`, under its own pin (`live/corpora/frozen.json`).
  - Both smokes measured v1, and both remain systems evidence only, never decision evidence.
  - A run on v1 is held to v1: resuming it on v2 is refused.

## What changes

### Corpus v2

- **Version:** `blocks-1b` v2, frozen 2026-10-12 (`live/corpora/blocks.v2.json`).
- **Pin:** its own, `live/corpora/frozen.v2.json`, with sha256 `590ecb75bb53d98ae7b8a7f2d810ae4f5c9dc41d046f41554db8d991c20a9935`.
- **Runs:** a run measures v2 unless it passes `--corpus 1`. The run manifest pins the version and digest it measured, as before.

Each corrected template must:
- apply to every prompt it is used on;
- name only elements every design system it is used on can render;
- keep what the condition tests. A structural change stays one the blocks cannot express, so the block arm still falls back. An add or a remove stays a change every arm, the block included, can make.

| | Template | v1 | v2 | Why (static audit) |
|---|---|---|---|---|
| C1 | records-table, add | Add one more row at the end for item #9001, subject "Password reset loop", status Open, priority P2. | Add one more row at the end, with a plausible value in every column. | It names a ticket's values. Only rt-01 is a table of tickets; rt-02 to rt-22 have no columns for them. |
| C2 | auth-form, remove | Remove the provider buttons. | Remove the sign-in provider buttons; if there are none, remove the first field. | 15 of the 22 auth-form prompts name no provider, so v1 had nothing to remove. The fallback target is the first field, never the last: the block keeps the password in sign-in and sign-up, so removing the last field would ask the block for what it cannot do. |
| C3 | guide-steps, structural | Turn the steps into an accordion with a timer and a photo for each step, and a comments section below. | Show each step as its own card with a numbered badge, and add a comments section with a text field and a Post button below the steps. | The accordion is a shadcn-v3 casualty and absent from Astryx. No component in either renders a timer or a photo. The block draws its steps as a table, so cards per step and a comments field remain changes it cannot express. |

### M: the add and remove check is binding

**The rule.** Under corpus v2 (`scoring.operation: "binding"`), a passing `refine-add` or `refine-remove` refinement whose operation was missed counts as a failure. Missed means no list changed, or lists changed only the other way (`live/operation.ts`).
- A mixed change still passes.
- A passing add or remove the check never read fails, so the rule cannot be skipped.
- It applies to every arm alike, the comparative positional arm included.
- Every call's tokens still count.

**Why both inputs of the rule.** ADR-B3's two inputs, the pass rate and tokens per success, read one success. Binding only the pass rate would let an unperformed operation still lower tokens per success, which is the inflation the audit found. So a missed operation is a failure in both.

**Why it is sound.** It never fails an operation that was done.
- **By construction:** the per-list changes sum to the elements the refined surface gained or lost. So a refinement that added anything shows a list that grew, and one that removed anything shows one that shrank, however nodes are matched.
- **In simulation:** across the Option B smoke's 32 fresh surfaces, every single-node removal and insertion in every arm read as performed or mixed, never missed (0 of 5,924). Those are fresh surfaces with simulated edits, not refinement outputs.

**Why strict scoring is not used.** Failing mixed changes too would be unsound: place matching reads clean shadcn-v3 operations as mixed, at rates that differ by arm.

| shadcn-v3, read as mixed | Removals | Insertions |
|---|---|---|
| block | 11.0% | 14.8% |
| block-positional | 18.0% | 22.2% |
| capped | 12.8% | 20.5% |
| production | 9.6% | 14.3% |

- On Astryx, where nodes carry ids, the rate is 0% in every arm.
- The spread between arms, up to 8 points, exceeds the 5-point margin.
- The strict reading stays a sensitivity row under every decision.

**Which way any bias runs.** The check reads direction, not content. A refinement that ignored its instruction but changed something else in the requested direction passes.
- The block arm's compact refinement re-sends its call, which expands to exactly the same surface, so its ignored instructions always read as missed.
- Arms that regenerate the whole surface can pass by such incidental changes.
- So the binding check is conservative: it can only make the block arm's case harder, for the 30% threshold and the guardrail alike.

### What the report shows under v2

- **Under each decision:**
  - the scoring in force;
  - the add and remove counts, of the refinements the pipeline passed;
  - a readings table with the decision without the check (the pipeline's pass alone) and with the mixed ones failing too.
- **Elsewhere:**
  - the pass rate columns count the binding failures;
  - Changed and Operation performed describe the refinements the pipeline passed.

## What adopting it invalidates

- **Decision evidence:** none exists yet.
- **The smokes:** both are v1 systems evidence and stay so.
- **The Stage-3 offline plan and cost:** recomputed for v2. The cells are unchanged; only refinement instruction bytes change.
- **Deployment:** no new production deployment or baseline is needed for the corpus decision itself. A run still records the deployment it measured.
