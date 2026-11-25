# Live evaluation proposal

**Status:** proposal only, 2026-11-25. No paid inference was run in M0 and none is authorized (decision D8). This document asks for a small pilot first and makes anything larger depend on what the pilot shows.

> **After R0.** The owner accepted the pilot and its $5 ceiling in principle and authorized its preparation only. The harness changes this proposal called for now exist (`packages/block-bench/live/pilot/`), and [LIVE-PILOT-RUNBOOK.md](LIVE-PILOT-RUNBOOK.md) sets out the restricted environment, the owner's actions, the commands and the rollback. The pilot was then authorized and run on 2026-11-25: see [LIVE-PILOT-REPORT.md](LIVE-PILOT-REPORT.md). The full baseline remains unauthorized.

## Why a live run is needed at all

The deterministic baseline (BASELINE.md) shows the machinery works. It cannot show how a model behaves on the requests this repositioning is about: whether a multi-stage request is decomposed sensibly, whether the result does what was asked, and what it costs. Every provisional threshold in the proposal's E5 that depends on a model stays provisional until measured.

## Pilot (recommended first)

| | |
|---|---|
| Model and provider | `anthropic/claude-haiku-4.5`, the model production pins, through the existing Worker (`/api/propose`) and AI Gateway (`ds-ai-gateway`, `collectLog: false`), so the pilot measures the product as deployed |
| Design system | Astryx only (about a fifth to a seventh of shadcn/ui v3's tokens per build in Phase 1B) |
| Harness | The existing `acceptance/gateway-corpus/harness.mjs` for corpus prompts and a scripted driver over the same browser pipeline for the hotel request, both writing one evidence file per run; the corpus files are imported, never copied or edited |
| Requests (prompts × samples) | Hotel request as a single build × 3; hotel request as a flow × 3; corpus prompt 3 (Estimate Workspace, classified Solved) × 2; prompt 10 (File / Artifact Card, Partial) × 2; prompt 5 (Convert Estimate to Project, Solved as a flow) × 2 |
| Expected provider calls | About 60, counting plans, generations and repairs |
| Estimated cost | **About $1.** Basis: Phase 1B recorded about 16,000 tokens per successful Astryx build on the production configuration; at $1 per million input tokens, $5 per million output tokens and Cloudflare's 5% credit fee, a build costs about $0.02 and a five-step flow about $0.13 |
| Ceiling | **$5**, enforced per request by the dollar-ceiling ledger built for Phase 1B (`packages/block-bench/live/cost.ts`), which reserves each request's worst case before sending it. The corpus harness has no ceiling or model check today, so the pilot needs one small change before it runs: route its requests through that ledger and its integrity checks. That change is M1 work and would be reviewed on its own |

### What the pilot measures

1. Planning: the intent chosen, and for the flow, the steps proposed, compared with the five stages a person would expect (search, results, room, review, confirmation). Recorded as a checklist per run, not scored by a model.
2. Gates: first-attempt pass, repairs used, final outcome, failure class (provider, gate, emit refusal, vocabulary gap).
3. Task fit: a written checklist per prompt (for the hotel request: destination, both dates, guest count, a comparison of at least two hotels, a room choice, a review, an explicit confirmation), marked by a person. This is the offline rubric D16 allows; it is not a gate.
4. Tokens, cost and latency per call, from the provider's own reports.

### Early termination

Stop the run, and keep what was recorded, on any of:

- the ledger reaching $5;
- a reply whose model is not Claude Haiku 4.5, or that reports no usage (the Phase 1B harness in `packages/block-bench/live` already refuses these; the corpus harness would need the same check added before the run);
- three consecutive provider failures, or any 429 from the gateway;
- any sign the evidence is unusable (for example, every plan identical regardless of the prompt).

### What would justify more runs

| Pilot result | Next step proposed |
|---|---|
| Plans for the hotel flow are mostly sensible and builds mostly pass | The full baseline below, to set E5's thresholds with intervals |
| Plans are mostly not sensible | Skip the full baseline; spend the next authorization on the D9 comparison (a stronger planning model) with the same prompts |
| Builds pass but task fit is poor | Evidence for the M1 task plan and completeness checks; no more runs until those exist |
| Cost per build is far from the estimate | Re-derive every estimate before asking for anything else |

## Full baseline (only after the pilot, separately authorized)

Twelve corpus prompts on both references with two samples, the four paraphrases, and the hotel request on Astryx with three samples. Estimated $15 to $25, mostly shadcn/ui v3; proposed ceiling $40. The same termination rules apply.

## Preconditions the owner controls

1. **Hosted generation must be on for the run.** It is off on production (`HOSTED_AI = "off"`, see HOSTED-AI-AVAILABILITY.md). Two ways to run:
   - turn it on for a short, announced window and accept that the public site can generate during it; or
   - re-apply Access to the hostname first and give the harness a short-lived service token (backlog item O1).
2. **The AI Gateway's daily limit** stays at or below $10 with auto top-up off, as documented.
3. **Who runs it.** Either the owner runs the commands, as in Phase 1B, or the owner provides the window and the token and this session runs them.

Nothing in this proposal changes production configuration by itself.
