# Phase 1B Stage 3 records

The two completed Stage 3 runs of the interface-blocks evaluation (ADR-B3), copied byte for byte from the commits that preserved them on their evidence branches. These are records. Nothing in the repository reads them, and they are never edited. What the results mean is set out in [../PHASE-1B-MILESTONE-REPORT.md](../PHASE-1B-MILESTONE-REPORT.md).

The full evidence stays on the evidence branches, which are never merged: every run's ledger (`requests.jsonl`), cell records (`runs.jsonl`), pacing, summary, invocation logs, operator monitor logs, pre-run checks and independent verifications. A merge to main redeploys the composer and changes the build id a run is held to, which is why the evidence was kept off main while the runs were open.

## The two runs

| | Astryx | shadcn/ui v3 |
| --- | --- | --- |
| Run directory | `1b-stage3-astryx-2026-10-12` | `1b-stage3-shadcn-2026-10-15` |
| Run id | `2026-10-12T23-36-49-450Z-hosted-ai-claude-haiku-4-5-https-composer-aesthetic-function-com` | `2026-10-15T00-22-25-520Z-hosted-ai-claude-haiku-4-5-https-composer-aesthetic-function-com` |
| Decision (ADR-B3, corpus v2, binding scoring) | **pass, clear** | **pass, uncertain** |
| Main measured, and its deployed build | `3aae0ea`, build `txDlHURTKv_S6yicLso97` | `7e260c3`, build `Dyml8RSqfWynKU1KbVuZI` |
| Harness code identity | `fe2b8e841d49778793efb9b640e2e2ae3a54048a5c4e540339aaa976ad2cc86d` | `51c80cec7a652216c3b9b28b1467e8c45eb0ecebe170969854bb1d49d3c8a229` |
| Served model | `claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001` |
| Invocations (windows) | 2 | 8 |
| Evidence branch | `claude/blocks-stage3-astryx-evidence` | `claude/blocks-stage3-shadcn-evidence` |
| Commit that preserved the final run directory | [`a4da53293b0e196430fae8d024d8eb233dd78717`](https://github.com/aestheticfunction/dspack-studio/tree/a4da53293b0e196430fae8d024d8eb233dd78717/evidence/blocks-1b) | [`619e36f31afa72edcbd39f7b3841276b9819d090`](https://github.com/aestheticfunction/dspack-studio/tree/619e36f31afa72edcbd39f7b3841276b9819d090/evidence/blocks-1b) |
| Independent verification | `verify_stage3.py`, committed with the run in `a4da532`: no findings. `verify_run.py --complete`, at [`e3f57da`](https://github.com/aestheticfunction/dspack-studio/blob/e3f57da4280e8f67c5f8cdecde3fc0872e03708b/evidence/blocks-1b/tooling/README.md): no findings and no notes | `verify_run.py --complete`, at [`27a91085a2b784a682e6a7fdfc31a649751b2449`](https://github.com/aestheticfunction/dspack-studio/tree/27a91085a2b784a682e6a7fdfc31a649751b2449/evidence/blocks-1b): no findings and no notes |
| The evidence branch's own account | [README at `e3f57da`](https://github.com/aestheticfunction/dspack-studio/blob/e3f57da4280e8f67c5f8cdecde3fc0872e03708b/evidence/blocks-1b/README.md) | [README at `27a9108`](https://github.com/aestheticfunction/dspack-studio/blob/27a91085a2b784a682e6a7fdfc31a649751b2449/evidence/blocks-1b/README.md) |

## The files

- `<run directory>/REPORT.md`: the harness's report, generated from the run's records when the run ended (`pnpm --filter @dspack-studio/block-bench eval:live`). Two things to know when reading it:
  - Its "Integrity stops" list dates each stop by the invocation it ended, not by the moment of the stop. The Astryx stop came at 2026-10-13T01:25:50Z and the shadcn/ui v3 stop at 2026-10-16T01:02:59Z.
  - The Astryx report's parity figures were read with a defect that aestheticfunction/dspack-studio#102 corrected: the checker skipped strings held in arrays. The [erratum](https://github.com/aestheticfunction/dspack-studio/blob/e3f57da4280e8f67c5f8cdecde3fc0872e03708b/evidence/blocks-1b/1b-stage3-astryx-2026-10-12.erratum-parity.md) gives the corrected figures. Parity is reported beside the decision, never in it, and nothing else in the report changes. The shadcn/ui v3 run measured with the corrected reading.
- `<run directory>/manifest.json`: what every resume had to match. It records the provider, the corpus digest, each contract, emit profile and sidecar by digest, the harness's code identity, the deployment, the selection, the caps and the served model.
- `<run directory>/preflight.json` and `preflight.resume-<k>.json`: the zero-cost probe each invocation made before its first paid call. It records the deployed build, the Worker's reply shape and the sidecars.
- `1b-stage3-astryx.baseline-3aae0ea.json`: the zero-cost production baseline the Astryx run was held to. The baseline the shadcn/ui v3 run was held to is [`../baseline.json`](../baseline.json) ([BASELINE.md](../BASELINE.md)).
- `SHA256SUMS`: the sha256 of every file above and of `../baseline.json`. Run `sha256sum -c SHA256SUMS` from this directory.

## Checking a copy against its evidence commit

Each file's bytes equal the evidence commit's. From a checkout that has fetched the evidence branches:

```sh
git show a4da53293b0e196430fae8d024d8eb233dd78717:evidence/blocks-1b/1b-stage3-astryx-2026-10-12/REPORT.md | cmp - docs/blocks/stage3/1b-stage3-astryx-2026-10-12/REPORT.md
git show a4da53293b0e196430fae8d024d8eb233dd78717:evidence/blocks-1b/1b-stage3-astryx.baseline-3aae0ea.json | cmp - docs/blocks/stage3/1b-stage3-astryx.baseline-3aae0ea.json
git show 619e36f31afa72edcbd39f7b3841276b9819d090:evidence/blocks-1b/1b-stage3-shadcn-2026-10-15/REPORT.md | cmp - docs/blocks/stage3/1b-stage3-shadcn-2026-10-15/REPORT.md
git show 460cc81d7af794eadabb7da919dc4bd147c09c74:evidence/blocks-1b/1b.baseline-7e260c3.json | cmp - docs/blocks/baseline.json
```

The same holds for each `manifest.json` and preflight. The Astryx run directory has not changed since `a4da532`, so the branch's head gives the same bytes.
