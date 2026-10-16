# Phase 2 decision record: branch C

**Decided by the owner on 2026-10-16.** This record holds the owner's acceptance of the Phase 1B result, the Phase 2 branch the owner chose, and the owner's answers to the release plan's open decisions ([PHASE-2-RELEASE-PLAN.md](PHASE-2-RELEASE-PLAN.md), §3 and §13).

It authorizes nothing beyond what it states. The owner directed G1 first: this documentation-and-records change, with no runtime behavior change. Phase 2 code has not begun, and each Phase 2 change still needs the owner's authorization.

## The Phase 1B result, accepted

| Reference | Decision (ADR-B3, corpus v2, binding scoring) | Accepted |
| --- | --- | --- |
| Astryx | **pass, clear** | 2026-10-13 |
| shadcn/ui v3 | **pass, uncertain** | 2026-10-16, as valid |

The evidence and what the results mean are in [PHASE-1B-MILESTONE-REPORT.md](PHASE-1B-MILESTONE-REPORT.md). The two runs' reports, manifests and preflights are in [stage3/](stage3/README.md).

## The branch: C

The plan's §3 defines the branches by the shadcn/ui v3 result. An uncertain result is branch C: an Astryx-only beta now, with shadcn/ui v3 joining only if a Stage 4 that the owner authorizes passes clearly. **The owner selected branch C.**

## The owner's decisions

1. **Proceed with an Astryx-only experimental beta.**
2. **Do not authorize shadcn/ui v3 Stage 4 now.** In the owner's words: its results are promising, but the personal cost of the larger experiment is not worthwhile at this stage.
3. **This is a deferral,** not a shadcn/ui v3 failure and not a permanent exclusion. shadcn/ui v3 passed on the rule's point estimates; the evaluation is inconclusive only because one criterion's interval crosses its threshold.
4. **Withhold shadcn/ui v3 blocks from the beta,** and explain to beta users that its evaluation remains inconclusive.
5. **Delivery:** a separate beta origin and Worker (plan §13, decision 1).
6. **Audience:** invite-only first. Public opt-in is considered after the first clean beta window (decision 2).
7. **Kill switch:** a block-specific runtime kill switch with reference and block allowlists, in addition to `HOSTED_AI` and rollback (decision 3).
8. **auth-form:** included under the documented accessibility exception and its host mitigation. GA remains blocked on the vocabulary gap (decision 4; the release plan §10).
9. **Encoding:** named encoding only (decision 13).
10. **Gateway:** keep the shared gateway initially, with the documented monitoring and stop conditions (decision 6).

Decision 5 (branch B) does not arise. Decision 14 (Stage 4 for shadcn/ui v3) is answered by decision 2 above.

**Still open,** for the owner during the beta: telemetry (decision 7), selection (8), the change policy after the decision (9), and provenance across re-binds (10). Under branch C the plan holds ratification (decision 11, and so the upstream form, 12) until a second reference passes clearly.

## Reconsidering shadcn/ui v3

Under branch C, shadcn/ui v3 joins the beta only if an owner-authorized Stage 4 passes clearly under the unchanged frozen rule. The milestone report sets out the criteria for reconsidering it ([PHASE-1B-MILESTONE-REPORT.md](PHASE-1B-MILESTONE-REPORT.md), section 11).

## The gate (plan §3)

- **G1, records on main:** this change. It commits the two Stage 3 reports with their manifests and preflights, their run ids, and links to their evidence branches and commits. It also commits `docs/blocks/baseline.json` ([BASELINE.md](BASELINE.md)). It merges only after the shadcn/ui v3 run closed, which it did on 2026-10-16.
- **G2, the shadcn/ui v3 decision is known:** met. The result is pass, uncertain, accepted as valid.
- **G3, the branch and the decisions marked "before the gate":** met. The owner chose branch C and answered decisions 1 to 4; decision 5 does not arise.

## Operational record

- **The daily spend limit.** For the shadcn/ui v3 run the owner raised the Cloudflare daily spend limit from $10 to $40, from 2026-10-15 22:47Z. Auto top-up stayed off. The change is recorded on the run's evidence branch. On 2026-10-16, after the run closed, the owner restored the limit to $10, with auto top-up still off.
- **The hold in window 7.** Request #61 is held in the run's ledger at $1.118208 permanently, as the owner directed. The owner's AI Gateway log shows it as HTTP 502, with no recorded usage and no charge. The owner authorized window 8 as an explicit exception for that hold only (the milestone report, section 6).
