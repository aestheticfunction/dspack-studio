# R1a spike: files and how to reproduce

The report is [../../R1A-REPORT.md](../../R1A-REPORT.md). Nothing here is imported by `apps/composer`.

| Path | What |
|---|---|
| `packages/composer-core/src/compositions/` | The sidecar 0.2 schema and loader, data-aware expansion, the instantiation pipeline, the cached gates, the two attachments, and the host. Tests: `load.test.ts`, `instantiate.test.ts`, `host.test.ts` |
| `packages/composer-core/src/compositions/spike/` | The two hotel compositions (`astryx.compositions.json`), the data sets, and the evidence script |
| `evidence/` | One file per data set, the recorded walk, the catalogs, the performance figures, and the level 1 and level 2 results |
| `verify_python.py` | Levels 1a and 1b, in upstream's Python `a2ui-core` |
| `verify_render.cjs` | Level 2, in Chromium, on both renderer stacks |
| `../r1a-host/` | The standalone host: the bridge to upstream `@a2ui/react` 0.16.1, the fidelity pages, and the source of the interactive demonstration. A separate npm project, outside the pnpm workspace. `node build.mjs --demo` writes `dist/demo.html`, one self-contained page to open from disk. Built pages are not committed: they bundle third-party packages whole |

## Reproduce

Evidence, from the repository root:

```bash
pnpm --filter @dspack-studio/composer-core r1a:evidence
```

Levels 1a and 1b need `a2ui-core` from the A2UI repository at the pinned commit `1dbe86a`, installed into a virtual environment with `pyyaml`. Then:

```bash
python3 docs/repositioning/spikes/r1a/verify_python.py docs/repositioning/spikes/r1a/evidence
```

Level 2 and the demo:

```bash
cd docs/repositioning/spikes/r1a-host && npm install && node build.mjs --demo
```

```bash
node docs/repositioning/spikes/r1a/verify_render.cjs
```
