# ADR-B3 amendment 2: corpus v2 and the binding add and remove check

**Status: proposed, not adopted.** Drafted on 2026-10-12 for the owner's review.
- **When it is decided:** before any refinement cell runs live, that is, before the Stage-2 pilot or Stage 3, whichever runs first. The owner adopts or rejects it whole: the templates, whether D1 to D3 join them, and the scoring, including whether it binds tokens per success.
- **Merging this change adopts it,** because it makes v2 the corpus a run measures by default.
- **Once a refinement cell has run, no part of it changes.** The pilot and Stage 3 run on the version adopted. A later change is a new amendment, and cells already run stay on the version they measured.
- Corpus v1, and everything measured on it, stays as it is.

**Pre-data.** No refinement cell has ever run live. Both smokes ran fresh cells only: `1b-smoke-2026-10-11` ran 5, and `1b-smoke-option-b-2026-10-12` ran 32. Neither ran a content, add, remove or structural refinement, so no arm's result on any template exists.
- Every template change follows from a static audit of the corpus text and the design systems' vocabularies (`live/applicability.ts`), the same for every arm.
- The choice of lenient over strict binding (below) used the structure of the Option B smoke's fresh surfaces, with simulated edits. No pass rate, token count or outcome entered any change.

## What stays fixed

- **The thresholds:** at least 30% fewer tokens per success against production, a pass rate within 5 points of both the capped and the production arm, both boundaries inclusive, and a minimum of 20 (`DEFAULT_DECISION`, pinned by a test).
- **The corpus content:** every prompt, intent, label and parity checklist; the content templates; and every template not listed below.
- **The design:** the arms, conditions, call budgets and re-run policy; the addendum's unit, paired intervals and stages.
- **The system under test:** the block contracts and sidecars, the model prompts and how requests are built, and production behavior. The corpus is a test input only; no request golden reads it.
- **Corpus v1:** `blocks-1b` v1, frozen 2026-10-10, sha256 `180f4480…5e4231`, under its own pin (`live/corpora/frozen.json`).
  - Both smokes measured v1, and both remain systems evidence only, never decision evidence.
  - A run on v1 is held to v1: resuming it on v2 is refused.
- **Superseded, for runs on v2 only:** the addendum's fixed scoring, as far as what the pass rate and tokens per success count (M below). The parity checklist and the re-run policy stay fixed, and runs on v1 are scored as before.

## What changes

### Corpus v2

- **Version:** `blocks-1b` v2, frozen 2026-10-12 (`live/corpora/blocks.v2.json`).
- **Pin:** its own, `live/corpora/frozen.v2.json`, with sha256 `0e4e4706e19ec92565fea2019258cd5d83f6bef0eca424a0634ccf4749b61ae9`.
  - With D1 to D3 (below), it would be `8212e223c8fa9a2ac4223286b55eecba60f0df3c2560fbedbae9f1ac022138e0`.
  - Adopted on another date, the freeze date and the digest change together.
- **Runs:** a run measures v2 unless it passes `--corpus 1`. The run manifest pins the version and digest it measured, as before.

Each corrected template must:
- apply to every prompt it is used on;
- name only elements every design system it is used on can render;
- keep what the condition tests. A structural change stays one the blocks cannot express, so the block arm still falls back. An add or a remove stays a change every arm, the block included, can make.

| | Template | v1 | v2 | Why (static audit) |
|---|---|---|---|---|
| C1 | records-table, add | Add one more row at the end for item #9001, subject "Password reset loop", status Open, priority P2. | Add one more row at the end, with a plausible value in every column. | It names a ticket's values. Only rt-01 is a table of tickets; rt-02 to rt-22 have no columns for them. |
| C2 | auth-form, remove | Remove the provider buttons. | Remove the sign-in provider buttons; if there are none, remove the first field. | 15 of the 22 auth-form prompts name no provider, so v1 had nothing to remove. |
| C3 | guide-steps, structural | Turn the steps into an accordion with a timer and a photo for each step, and a comments section below. | Show each step as its own card with a numbered badge, and add a comments section with a text field and a Post button below the steps. | The accordion is a shadcn-v3 casualty and absent from Astryx, and no component in either is judged to render a timer or a photo. The block draws its steps as a table, so a card per step and a comments field stay changes it cannot express. |
| C4 | auth-form, add | Add Microsoft as a sign-in provider. | Add Microsoft as a sign-in provider; if it is there already, add Apple. | af-12 already offers Microsoft. Under binding, the block cannot add it twice (its providers are unique), so its correct no-op would fail, while a regenerating arm could add a second button and pass. C4 is part of M: without it, M traps the block arm alone. af-12 is outside Stage 3. |

**C2's fallback.**
- It removes the first field on the 15 prompts without providers, 5 of the 6 in Stage 3: a sign-in form's email, for example.
- The block can make that change: its fields need one at least, and sign-in and sign-up keep the password. None of the 22 auth-form prompts asks for a reset form, the one mode that requires the email.
- That the first field is not the password is a premise, not a guarantee. Both sidecar examples and all four af-01 block calls in the smokes put the email first, but the contract allows any order.
- **Detection is uneven.** If a model balks at deleting a field, the block arm's compact re-send always reads as missed, while a regenerating arm's balk can read as mixed and pass. At worst that is 5 of the block arm's 120 Stage-3 cells per reference, about 4.2 points, against the block arm. The readings row without the check would show it.

### D1 to D3: the owner's decision, not proposed

The same two rules find three more templates that cannot apply everywhere: structural ones the owner did not name. They are not part of this proposal. The owner may adopt them in the same decision, before any refinement cell runs.

| | Template | v1, kept in v2 | If adopted | Why (static audit) |
|---|---|---|---|---|
| D1 | records-table, structural | Split the table into two tabs, Open and Closed, with a search field and a filter bar above them. | Split the rows into two tables, each in its own card with a heading, and add a search field and a filter button above them. | Astryx has no tabs. A split into Open and Closed fits only tables of items that open and close: tickets, bugs and incidents (rt-01, rt-07, rt-21). |
| D2 | auth-form, structural | Turn it into a two-step wizard with a progress indicator and a terms-of-service checkbox on the second step. | Turn it into a two-step wizard of two cards, each with a step badge ("Step 1 of 2", "Step 2 of 2"), and a terms-of-service notice with an "I agree" button on the second card. | Astryx has neither a progress indicator nor a checkbox. |
| D3 | null, structural | Turn it into a two-column layout with a sidebar of related links. | Move the main content into a card, and add a second card below it with three related links as buttons. | Neither design system is judged to lay content out in columns, and Astryx has no sidebar. |

- **For:** they apply the element rule as C3 does. Without them, 18 of the 24 Stage-3 structural prompts on Astryx, and 11 on shadcn-v3, ask for something the design system cannot render or the prompt does not have.
- **Against:**
  - M does not read structural cells, so it does not need them.
  - They are outside the three the owner named.
  - They rewrite the structural instruction for 18 of the 24 Stage-3 prompts on each reference, including shadcn-v3's auth-form prompts, whose v1 elements it renders.
- **The sign of their effect on the block arm is unknown.** A possible request yields a richer surface: more tokens in every arm, which lowers the block arm's relative reduction, and possibly more gate failures, which weigh most on the block arm's fallback, one attempt shorter. An impossible request may provoke failures of its own. Neither choice is a safe default for the block arm.
- **Without them,** the structural condition still does what it was frozen to do: the blocks cannot express the change, so the block arm falls back, and every arm must build a surface that passes the gates, approximating what its design system cannot render.

### M: the add and remove check is binding

**The rule.** Under corpus v2 (`scoring.operation: "binding"`), a `refine-add` or `refine-remove` refinement that the pipeline passed, but whose operation was missed, counts as a failure. Missed means no list changed, or lists changed only the other way (`live/operation.ts`).
- A mixed change still passes.
- A passing add or remove the check never read fails, so the rule cannot be skipped.
- It applies to every arm alike, the comparative positional arm included.
- Every call's tokens still count.

**It binds both of ADR-B3's inputs, which the owner must confirm.**
- The owner asked for binding "for the decision guardrail", the pass-rate criterion. M also binds the successes that tokens per success divides by, the input to the 30% criterion.
- **Why:** the two inputs read one success. Bound in the pass rate alone, a refinement that passed the gates without doing what it was asked would still count as a success in tokens per success. The block arm's compact re-send of its prior call is exactly such a refinement, and the cheapest one, so the token criterion would favor it.
- **The alternative** is to bind the pass rate only, and keep tokens per success on the pipeline's pass. It is less cautious for the block arm, and it needs a change in how the decision reads its two inputs, made before adoption.

**Why it is sound: it never fails an operation done on net.**
- **By construction:** the per-list changes sum to the net change in the surface's list elements. So a refinement whose surface gained elements on net shows a list that grew, and one that lost elements on net shows one that shrank, however nodes are matched. An add that grew the surface is never missed, nor a remove that shrank it.
- **Only on net:** a refinement that adds a row to one table and drops another table loses elements on net. It reads as a remove, so an add that does this is missed. Failing it is defensible: the surface did not grow.
- **In simulation,** on the Option B smoke's 30 fresh surfaces (its two failed cells kept none):
  - Every element of every list was removed in turn, and a copy of every element, with fresh ids, was inserted at every position of its list: 942 removals and 4,982 insertions.
  - In every arm, none of these 5,924 edits read as missed.
  - These are fresh surfaces with simulated edits, not refinement outputs.
- **In review:** 25,390 random multi-edits on the same surfaces (insertions, removals, moves, renamed and deleted ids) never read a net gain as missed for an add, or a net loss as missed for a remove.

**Why strict scoring is not used.** Failing mixed changes too would be unsound: place matching reads clean shadcn-v3 operations as mixed, at rates that differ by arm.

| shadcn-v3, read as mixed | Removals | Insertions |
|---|---|---|
| block | 11.0% | 14.8% |
| block-positional | 18.0% | 22.2% |
| capped | 12.8% | 20.5% |
| production | 9.6% | 14.3% |

- On Astryx, where nodes carry ids, the rate is 0% in every arm.
- Among the three decision arms, the spread is 3.2 points for removals and 6.2 for insertions. The insertion spread exceeds the 5-point margin.
- The strict reading stays a sensitivity row under every decision.

**Which way the remaining error runs.**
- The check reads direction, not content, so it has one false-pass channel: a refinement that ignored its instruction but changed something else in the requested direction passes.
- Only a surface regenerated in full can pass that way. The block arm's compact re-send expands its prior call again, so an ignored instruction leaves the surface unchanged and always reads as missed. The block arm's fallback, switch and null-prompt paths regenerate in full, like the other arms, and share the channel.
- So against a perfect check, the remaining error can only favor regenerated surfaces. That makes the block arm's case harder, for the 30% threshold and the guardrail alike.
- Against v1's scoring, binding moves the decision whichever way the detected misses fall: it helps the block arm where the other arms miss more, and hurts it where it misses more.

### What the report shows under v2

- **Under each decision:**
  - the scoring in force;
  - the add and remove counts of the refinements the pipeline passed: performed, mixed, missed, and unchecked, which failed closed;
  - a readings table with the decision without the check (the pipeline's pass alone) and with the mixed ones failing too.
- **Elsewhere:**
  - the pass rate columns count the binding failures;
  - Changed and Operation performed are of the refinements the pipeline passed.
- **A run is reported only under its corpus's scoring.** The summary records its scoring, and the report refuses one scored otherwise than its corpus declares.

### How far the static audit reaches

- **It applies two rules mechanically to recorded judgments:** what each template needs from a prompt, and which components render each element. Both are written down in `live/applicability.ts`, and a template it has not read is a finding until it is added.
- **Judgment calls:**
  - A timer and a photo are judged to have no component. A duration badge could stand in for a timer, and shadcn-v3 has avatar-image and aspect-ratio. Both appear only in C3's v1 template, beside the accordion, which no arm may emit either way.
  - A split into Open and Closed is judged to fit tickets, bugs and incidents.
  - C2's premise that the first field is not the password (above).
- **Targets are read from each prompt's text.** Each arm acts on its own fresh surface, which may differ from what the text implies.
- **It audits the refinement templates only.** The same element rule would flag two owner-approved fresh prompts: nb-06's team photos and nb-16's breadcrumb trail, a shadcn-v3 casualty. Fresh prompts are outside this amendment and unchanged.

## What adopting it invalidates

- **Decision evidence:** none exists yet.
- **The smokes:** both are v1 systems evidence and stay so.
- **The addendum's fixed scoring:** superseded for runs on v2, as above.
- **The Stage-3 offline plan and cost:** recomputed for v2. The cells are unchanged; only refinement instruction bytes change.
- **Deployment:** none is needed to decide. After a merge, the next run needs a new zero-cost baseline, because the harness's code identity changes, as after any harness change. A run still records the deployment it measured.
