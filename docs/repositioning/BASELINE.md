# Deterministic baseline

**Status:** M0, 2026-11-25. Every step `.github/workflows/ci.yml` runs, executed twice in a cloud container at `main` = `8053151`. No step calls a model. Run 2 is on the documents branch, which adds only documents and one test (the corpus hash pin).

## Environment

Node 22.23.5, pnpm 10.25.0, `@playwright/test` 1.61.1 with the container's preinstalled Chromium (Chrome for Testing 158). Playwright 1.61.1 expects browser revision 1228 and the container has 1243; a scratch `PLAYWRIGHT_BROWSERS_PATH` mapped one to the other, without modifying the repository or the container's browser directory. Before that mapping, every Playwright test failed to launch, so this is an environment note, not a product finding.

## Results

| Step | Command | Run 1 | Run 2 |
|---|---|---|---|
| Install | `pnpm install --frozen-lockfile` | pass, 6 s | pass, 2 s |
| Catalog gates | `pnpm --filter @dspack-studio/contracts build:catalogs` | pass, 2 s | pass, 2 s |
| Contract sync | `… check:sync` | pass: Astryx in sync; shadcn/ui 2.3.0 pinned, sha256 verified, upstream has moved (the known #48) | same |
| Drift check (report only) | `… drift-check` | pass: vocabulary matches Astryx docs; 2 unverifiable (type aliases) | same |
| Unit tests, all workspaces | `pnpm test` | **1,366 passed**, 0 failed, 84 files, 69 s | **1,368 passed** (+2: the corpus pin), 63 s |
| Type checks | `pnpm -r typecheck` | pass, 24 s | pass, 20 s |
| Exhibit build and e2e | `pnpm --filter web build && pnpm exec playwright test` | **106 passed, 4 skipped**, 0 failed | same |
| Composer build | `pnpm --filter composer build` (includes `check-default-artifact`) | pass | pass |
| Composer smoke e2e | `--config playwright.composer-smoke.config.ts` | **39 passed** | same |
| Composer agent e2e | `--config playwright.composer-agent.config.ts` | **49 passed** | same |
| Composer experimental build and e2e | `build:experimental`, `--config playwright.composer-experimental.config.ts` | **57 passed** | same |

Unit tests by workspace (run 1): composer-core 445, apps/composer 524, block-bench 268, agent 50, shadcn-renderers 25, replay 21, wireframe-renderers 11, agui-bridge 6, apps/web 6, scenarios 5, a2ui-ingest 3, contracts 2.

The 4 skipped exhibit tests are the environment-gated live and benchmark specs (`RECORD_LIVE`, `RECORD_QUESTION`, `RECORD_RECIPE`, `BENCH`). They make model calls and are skipped in CI by design.

**Reproducibility:** every count matched across the two runs apart from the deliberate +2. No test was flaky in either run, including the known intermittent `e2e/fork.spec.ts:37` (#104). Durations are wall-clock in one container and indicative only.

## Gateway corpus

`acceptance/gateway-corpus/corpus.mjs` and `paraphrases.mjs` are pinned by sha256 in `packages/composer-core/src/corpus-pin.test.ts`. Changing either fails CI. The test was shown to catch a one-line edit, and the file was restored. `EXPECTED.md` is deliberately not pinned: it should change when a verdict changes.

## Not part of this baseline

- Live inference (decision D8): see LIVE-EVALUATION-PROPOSAL.md. The model-dependent thresholds in PROPOSAL.md section E5 stay provisional.
- The deployed site: see HOSTED-AI-AVAILABILITY.md for what production serves.
- Protocol conformance: see PROTOCOL.md.
