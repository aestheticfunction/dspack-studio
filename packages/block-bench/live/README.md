# Live evaluation (Phase 1B)

The owner's harness for docs/BLOCKS.md, ADR-B3. Everything it measures runs through the real code paths: composer-core's block phase and budget, dspack-gen's `runPipeline`, the same request bytes the app posts, folded with the same `foldBuildEvents`.

```
pnpm --filter @dspack-studio/block-bench baseline                    # record the deployed baseline (no provider call)
pnpm --filter @dspack-studio/block-bench eval:live -- --provider scripted --allow-drafts --limit 2   # dry run, no model
pnpm --filter @dspack-studio/block-bench eval:live -- --provider hosted --allow-drafts --max-requests 200 --spacing-ms 3000
pnpm --filter @dspack-studio/block-bench eval:live -- --provider ollama:gpt-oss:latest --allow-drafts
pnpm --filter @dspack-studio/block-bench eval:live -- --provider hosted --resume live/runs/<dir> --rerun-failed
```

Output goes to `live/runs/<time>-<provider>/`: `runs.jsonl` (one record per cell, appended as it completes), `preflight.json`, `summary.json`, `REPORT.md`. The directory is git-ignored; copy a report into `docs/blocks/` on purpose. See `run.ts` for every option and docs/BLOCKS.md for what the numbers mean.
