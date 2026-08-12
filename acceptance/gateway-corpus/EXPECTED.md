# Expected classification

The state of each prompt against the current product. **Solved** means the requested interface is achievable as a governed artifact. **Partial** means a real version builds but a named part of the request is not representable. **Gap** means the vocabulary to express it honestly does not exist, and Composer says so rather than faking it.

Runtime caveats are called out because they are the product's stated boundary: Composer composes and governs *representations*; it does not bind live data or execute workflows.

| # | Prompt | Status | Owner of what remains |
|---|---|---|---|
| 1 | Service Catalog Explorer | **Partial** | Design-system vocabulary — a dependent selector needs option lists that react to another control; `Select.options` is a static literal and the change handlers are dropped props. What builds is a static configuration form |
| 2 | Filing Directory Browser | **Partial** | Design-system vocabulary — no combobox / type-ahead / query vocabulary. The shadcn contract's own `select.whenNotToUse` names the missing component |
| 3 | Estimate Workspace | **Solved** | — |
| 4 | Create Estimate | **Solved** as a flow | Runtime — the post-create read-back is live data |
| 5 | Convert Estimate to Project | **Solved** as a flow | Runtime — same |
| 6 | Direct Project Creation | **Solved** as a flow | Runtime — same |
| 7 | Project Workspace | **Solved** | — (line-item tables render natively; the renderer defect that once emptied shadcn tables is fixed and regression-guarded) |
| 8 | Mutation Confirmation | **Solved** for one state | Product model — a reusable *multi-variant* composition (calm vs destructive from one definition) is parameterized reuse, deliberately deferred |
| 9 | Operation Progress | **Gap** | Design-system vocabulary + one governance rule — indeterminate progress is the request's core demand and the shadcn rule requires a determinate value; Astryx has no progress vocabulary and refuses honestly |
| 10 | File / Artifact Card | **Partial** | Runtime — metadata, states, and a download *action* are representable; downloading is not |
| 11 | Gateway Error / Recovery | **Gap** | Design-system vocabulary — field-level error binding does not exist, and the alert action slot is still dropped by the profile pending upstream work |
| 12 | Full demo composition | **Solved** as a flow | Runtime — read-backs and context carriage between steps |

**Tally: 6 solved, 4 partial, 2 gaps.** At the start of the investigation that produced this corpus, none of the twelve was achievable as intended.

## How to read a failure

- **A gate failure (S1/S2/S3)** is the model producing something the design system does not allow. Expected occasionally; the repair loop gets a bounded number of tries.
- **An emit refusal** is the surface being contract-legal but unrepresentable — a declared casualty, a dissolution rule, a missing join key. Since the pipeline-trust milestone these ride the repair loop with the refusal text as the instruction, so a terminal refusal means repair genuinely could not fix it.
- **A planning vocab-gap** is the honest one: the planner said the request needs a capability the design system does not have, and no generation was attempted.
- **An adapter error** is infrastructure, not product. Re-measure.

## Keeping this current

Update this table when a milestone changes a verdict, and say what changed it. Do not soften a classification to make a release look better — the corpus's only value is that it has never been graded generously.
