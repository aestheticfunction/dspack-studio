# Production baseline for the interface-blocks evaluation

The Phase 1B evaluation (docs/BLOCKS.md, ADR-B3) compares block mode against today's production configuration. This file fixes what "today" means, so the comparison is against a named deployment, not a moving target.

## The configuration being compared against

- **Source.** `main` at `6c0a71b`, the squash merge of aestheticfunction/dspack-studio#88 (Phases 0, 0.5 and 1A). The default build of that commit is today's artifact byte for byte and carries no block code (`apps/composer/scripts/check-default-artifact.mjs` is clean on it); blocks exist only in the experimental build.
- **The production arm.** Flag off. One hosted planning call (`buildPlanRequest`, outside the budget), then `runPipeline` with the gateway adapter and `maxRepairs: 2`, every request without a `maxCalls` key, so the Worker keeps its one parse retry (up to two provider calls per request). This is the arm the evaluation's `production` label means.
- **The Worker.** `apps/composer/worker/propose.mjs` at that commit: canonical `usage`, `calls[]` on every reply, `cause` on the 502, the optional `maxCalls`. The harness refuses to run against a Worker that does not report `calls: []` on a refusal (the zero-cost probe in `packages/block-bench/live/preflight.ts`).
- **The byte-identity oracle.** The request hashes in `packages/block-bench/results.json` (`requests.generation[*].bodySha256`, `requests.planning[*].bodySha256`) are what the deployed app posts. `pnpm test` fails on any drift.

## The deployment record

Run on a machine that can reach the deployed site:

```
pnpm --filter @dspack-studio/block-bench baseline --out docs/blocks/baseline.json
```

It records, with no provider call: the deployed build id (Next names the static export's manifest by it), the Worker's reply shape on a refused empty body, the hosted model list, and the sidecars this checkout would offer. The harness repeats the same probe at the start of every run and writes it to `preflight.json`; a run whose build id differs from the committed baseline is against a later deployment, and the report says so.

Status: the record is not yet committed. This checkout could not reach composer.aesthetic-function.com (the session's network policy denied the host), so the owner runs the command above once the merge has deployed and commits `baseline.json` beside this file.

## What a live run must state

- The sidecar status. The drafts shipped in Phase 0 are `"status": "draft"`; ADR-B3 counts approved sidecars only. A run on drafts is provisional and its report says so.
- The provider and, for hosted, the pacing used (`--spacing-ms`, `--max-requests`) and every wait the gateway imposed.
- The corpus id and freeze date, which the report carries.
