# Live evaluation (Phase 1B)

The owner's harness for docs/BLOCKS.md, ADR-B3. Everything it measures runs through the real code paths: composer-core's block phase and budget, dspack-gen's `runPipeline`, the same request bytes the app posts, folded with the same `foldBuildEvents`.

```
pnpm --filter @dspack-studio/block-bench baseline                    # record the deployed baseline (no provider call)
pnpm --filter @dspack-studio/block-bench eval:live -- --provider scripted --limit 2   # dry run, no model
pnpm --filter @dspack-studio/block-bench eval:live -- --provider hosted --max-total-requests 600 --max-requests 200 --spacing-ms 3000
pnpm --filter @dspack-studio/block-bench eval:live -- --provider ollama:gpt-oss:latest
pnpm --filter @dspack-studio/block-bench eval:live -- --provider hosted --resume live/runs/<dir> --rerun-failed
```

Output goes to `live/runs/<time>-<provider>/`: `runs.jsonl` (one record per cell, appended as it completes), `manifest.json` (what a resume must match), `preflight.json`, `summary.json`, `REPORT.md`, and when they occur `requests.jsonl` (every hosted request, recorded before it is sent: the count the run's cumulative cap holds across resumes), `run.lock` (while an invocation runs; one at a time, and a killed invocation's lock is taken over), `pacing.jsonl` (every invocation's pacing and waits), `runs.superseded.jsonl` (records a re-run replaced, still counted in the totals) and `runs.torn.jsonl` (a cut-off last line set aside on resume). The directory is git-ignored; copy a report into `docs/blocks/` on purpose. See `run.ts` for every option and docs/BLOCKS.md for what the numbers mean.
