# Production baseline for the interface-blocks evaluation

The Phase 1B evaluation (docs/BLOCKS.md, ADR-B3) compares block mode against today's production configuration. This file fixes what "today" means, so the comparison is against a named deployment, not a moving target.

## The configuration being compared against

- **Source.** `main` at `6c0a71b`, the squash merge of aestheticfunction/dspack-studio#88 (Phases 0, 0.5 and 1A). The default build of that commit is today's artifact byte for byte and carries no block code (`apps/composer/scripts/check-default-artifact.mjs` is clean on it); blocks exist only in the experimental build.
- **What the Stage 3 runs measured.** Each ran against the deployment of a later commit: Astryx against `3aae0ea` (aestheticfunction/dspack-studio#100), shadcn/ui v3 against `7e260c3` (#102). The production arm's request bytes are the same at all three commits: the request hashes in `packages/block-bench/results.json` are identical at `6c0a71b` and `7e260c3`. Between the two runs the Worker changed how it reads a gateway 429 (#101), and the harness changed how parity reads text (#102). Neither changes what the production arm sends.
- **The production arm.** Flag off. One hosted planning call (`buildPlanRequest`, outside the budget), then `runPipeline` with the gateway adapter and `maxRepairs: 2`, every request without a `maxCalls` key, so the Worker keeps its one parse retry (up to two provider calls per request). This is the arm the evaluation's `production` label means.
- **The Worker.** `apps/composer/worker/propose.mjs` at that commit: canonical `usage`, `calls[]` on every reply, `cause` on the 502, the optional `maxCalls`. The harness refuses to run against a Worker that does not report `calls: []` on a refusal (the zero-cost probe in `packages/block-bench/live/preflight.ts`). Since Option B the Worker also names, on each `calls[]` entry whose response arrived, the model the provider said served the call, and advertises `per-call-model` among the `capabilities` of that refusal. The harness now requires it, so it refuses the Worker at that commit unless forced; what the production arm sends, and how many provider calls it may make, is unchanged.
- **The byte-identity oracle.** The request hashes in `packages/block-bench/results.json` (`requests.generation[*].bodySha256`, `requests.planning[*].bodySha256`) are what the deployed app posts. `pnpm test` fails on any drift.

## The deployment record

Run on a machine that can reach the deployed site:

```
pnpm --filter @dspack-studio/block-bench baseline --out <file>
```

`docs/blocks/baseline.json` is now a committed historical record (below). Write a new capture beside the run it is for, on that run's evidence branch, and never over the committed record.

It records, with no provider call, the deployed build id, the Worker's reply shape on a refused empty body, the hosted model list, and the sidecars this checkout would offer. It makes four requests, none of which reaches a model:

1. `POST /api/propose` with the body `{}`, which the Worker refuses with 400 before any provider call.
2. `GET /`.
3. `GET /_next/static/<build id>/_buildManifest.js`. Composer is an app-router static export, so its HTML names no build manifest. The id comes from the page's flight payload and counts only when the deployment serves that build's manifest.
4. `GET /api/models`.

A test runs the command as its own process against the real Worker module with a model binding that counts calls, and holds it to exactly these requests and no model call. `--out` is resolved against the directory the command is typed in. The record is written only when it is whole: a Worker that names each call's model (`per-call-model`), a confirmed build id and the model list. Anything less exits 1, writes nothing and says what was missing.

The build id is random per build. It names a deployment but does not say which commit it was built from: that link is in the Workers Builds deployment log. The harness repeats the same probe at the start of every run and writes it to `preflight.json`, and the report prints the build id it ran against. A run whose build id differs from the committed baseline's ran against a later deployment.

## The committed record

**`docs/blocks/baseline.json` is a historical run record, not a self-updating production baseline.** It describes the deployment the shadcn/ui v3 Stage 3 run was held to, as it was captured. It does not follow later deployments. Every merge to main redeploys the composer with a new build id, this record's own merge included, and a later run captures its own baseline.

- **What it is.** The record the command above wrote for `main` at `7e260c3` (#102), captured at 2026-10-14T03:17:05Z: build `Dyml8RSqfWynKU1KbVuZI`, a Worker answering with `per-call-model`, the models `scripted` and `hosted-ai`, and both sidecars approved with all three blocks usable on each reference.
- **Where it comes from.** It is a byte-for-byte copy of `evidence/blocks-1b/1b.baseline-7e260c3.json` on `claude/blocks-baseline-7e260c3-evidence`, at commit [`460cc81d7af794eadabb7da919dc4bd147c09c74`](https://github.com/aestheticfunction/dspack-studio/blob/460cc81d7af794eadabb7da919dc4bd147c09c74/evidence/blocks-1b/1b.baseline-7e260c3.json). That branch also keeps the capture's console and checksums. Its sha256 is `0e46f3c21f0507dd053758f60fc599413055eb95682f62ccaf37629a79d9e7ed`, checked by [stage3/SHA256SUMS](stage3/SHA256SUMS).
- **What it was used for.** The shadcn/ui v3 run repeated the same probe before each of its eight invocations. Every probe equaled this record apart from its time (`at`).
- **The Astryx run's baseline.** That run was held to an earlier record, for `main` at `3aae0ea` (build `txDlHURTKv_S6yicLso97`): [stage3/1b-stage3-astryx.baseline-3aae0ea.json](stage3/1b-stage3-astryx.baseline-3aae0ea.json).

The two Stage 3 runs and their results are in [stage3/README.md](stage3/README.md) and [PHASE-1B-MILESTONE-REPORT.md](PHASE-1B-MILESTONE-REPORT.md).

## What a live run must state

- The sidecar status. ADR-B3 counts approved sidecars only. The owner approved both sidecars and all six blocks on 2026-10-11; a run on a draft is provisional and its report says so.
- The provider and, for hosted, the pacing used (`--spacing-ms`, `--max-requests`, the run's cumulative `--max-total-requests` and its dollar ceiling `--max-total-usd`) and every wait the gateway imposed.
- The corpus id and freeze date, which the report carries.
