# After Astryx Stage 3: the next stage, compared

**What this is.** A comparison of the three options the owner named, with a recommendation.
- It gives commands only. None has been run, and nothing here is authorized by being written down.
- Nothing about Astryx changes: its decision is formal and clear (pass), and the addendum ends a reference's evaluation once its decision is clear.
- The open question is everything beyond Astryx.

## What each option costs and buys

| | A: stop after Astryx | B: shadcn/ui v3 Stage 3 now | C: a narrow infrastructure correction first |
| --- | --- | --- | --- |
| **What it is** | No further run. Phase 2 is decided on the Astryx evidence alone. | The same 24 prompts × 4 arms × 5 conditions (480 cells) on shadcn/ui v3, on today's build. | Fix the Worker's 429 classification (`1b-stage3-astryx-2026-10-12.follow-up-429.md`) with fail-first tests, review and a merge, then take a new zero-cost baseline. B then runs on the corrected build, under its own authorization. |
| **Provider spend** | $0 | Ledger estimate from the offline plan: $18.11 low, $40.34 central, $72.09 high. Astryx's logged cells came in 10% above their central dollar estimate ($6.51 against $5.90; 29% above with #539's hold) and 1% under on requests. Carried over, the central figure is about $44.50, though shadcn's cost is driven by repairs on far larger requests, so it may not transfer. | $0 for the correction itself: its tests use fakes, and the baseline makes no model call. B's spend is unchanged by it. |
| **Largest authorization** | none | `--max-total-usd 77` (the plan's ceiling to complete its high scenario is $76.56) and `--max-total-requests 1275` (high scenario 1,212, plus 5%, as Astryx's caps were set); `--max-requests 123` per window, so that no window can exceed $8.50 at list in the high scenario, under the $10 daily limit. | The merge of one small pull request, which redeploys the composer, and then the same B authorization as in the column before. |
| **Daily windows** | 0 | 5 low, 9 central, 12 high, plus one for each interruption. At one window a day that is 5 to 12 days, about one to two weeks with an interruption or two, with main frozen throughout: a deployment changes the build id, and a run refuses to resume across it. | none for the correction; B's windows follow it, starting a day or so later |
| **Evidence gained** | none beyond Astryx | A formal shadcn/ui v3 decision, on the reference with the larger schema (its full generation request is 52k to 56k tokens, of which schema text is 83% to 90%), casualty components and nodes matched by place. The token criterion is likely to pass there, so the information is mostly in the pass-rate guardrail, which Astryx cannot speak for. Also named against positional, retention and fallback on shadcn. | none about blocks. Operationally, fewer stopped windows in B, and production users who meet such a 429 are told to retry instead of being told the generation failed. |
| **Risks** | Phase 2 (dspack `blocks` upstream, the block phase in dspack-gen's core) would rest on one design system: the one with the small schema, where most list nodes carry ids and no operation read as mixed. Nothing would be known about the guardrail on shadcn. The production misclassification stays. | **Interruptions.** Astryx met one misclassified 429 in 679 requests. One event says little about the rate, but if that rate held, B's 900 requests (central) would meet about 1.3, and at least one with probability about 73% (83% at the high scenario's 1,212). Each one stops the run, needs an owner authorization to resume, holds up to $1.12 at worst case and costs a window. **Drift:** over 2 weeks the served Haiku snapshot or the deployment may change, which stops the run for good (the harness refuses to resume across a model or deployment change). **Templates:** on shadcn, 11 of the 24 structural prompts ask for something it cannot render or the prompt does not have (D1 to D3 were not adopted), and the null add and remove templates may meet leaf surfaces as they did on Astryx. | The fix rests on reading the gateway's log entry. If that entry cannot be read when `collectLog` is false, the fix falls back to today's behavior: no gain, and no harm. A merge changes production, though the request bytes do not change. It delays B by a review cycle. |

## Recommendation: C

**C first, then a separate decision on B.** Prior work is not the reason. The reasons stand on their own:
1. **The correction can only land between runs.** B freezes main for one to two weeks, and a fix merged during B would stop it. If the fix is wanted at all in the coming weeks, it has to go in before B starts.
2. **It removes B's most likely interruption.** With today's classifier, B is more likely than not to stop at least once. Each stop costs the owner an authorization, a window and a conservative hold.
3. **It fixes a production defect** that users meet regardless of any evaluation.
4. **It costs no provider spend,** and its failure mode is today's behavior.

**After C, whether B runs is the owner's decision.** B is worth its cost if Phase 2 is meant to reach beyond Astryx: the shadcn guardrail is the largest unknown for a shared, cross-design-system mechanism. If Phase 2 will not go ahead, or will start scoped to Astryx, A is the honest stopping point, and C still stands on its own as a production fix.

## Commands (none run)

**C: the correction.** Code, review and a merge, each needing the owner's approval. No model call.

```
git -C /home/user/dspack-studio fetch origin main
git -C /home/user/dspack-studio switch -c claude/worker-429-status origin/main
# Write the fail-first tests (follow-up-429 plan, cases 1-7 and the harness pin); confirm case 1 fails:
pnpm --filter composer test
# Implement the fix in apps/composer/worker/propose.mjs, then:
pnpm --filter composer test
pnpm --filter @dspack-studio/block-bench test
pnpm typecheck
# Pull request, review, merge (Workers Builds deploys main). Once the new build is live,
# the zero-cost baseline (four requests, no model call):
NODE_USE_ENV_PROXY=1 pnpm --filter @dspack-studio/block-bench baseline
```

**B: shadcn/ui v3 Stage 3.** It needs the owner's authorization, with each window run as Astryx's were.
- The no-cost checks run immediately before every window's first paid call.
- The operator monitor runs during each window.
- No window is resumed automatically.

The commands below were checked offline with the harness's own parser and selection check: 24 prompts, corpus 2, `shadcn-v3`, $77, 1,275, 123, 12,000 ms.

```
# First window:
NODE_USE_ENV_PROXY=1 pnpm --filter @dspack-studio/block-bench eval:live -- --provider hosted --corpus 2 --reference shadcn-v3 \
  --prompts rt-01,rt-02,rt-03,rt-04,rt-05,rt-06,af-01,af-02,af-03,af-04,af-05,af-06,gs-01,gs-02,gs-03,gs-04,gs-05,gs-06,nb-01,nb-02,nb-03,nb-04,nb-05,nb-06 \
  --max-total-usd 77 --max-total-requests 1275 --max-requests 123 --spacing-ms 12000 \
  --out live/runs/1b-stage3-shadcn-<date>
# Each later window: the same flags, with --resume live/runs/1b-stage3-shadcn-<date> in place of --out.
```

**A: no command.**
