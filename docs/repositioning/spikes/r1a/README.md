# R1a spike: files and how to reproduce

The report is [../../R1A-REPORT.md](../../R1A-REPORT.md). Nothing here is imported by `apps/composer`.

| Path | What |
|---|---|
| `packages/composer-core/src/compositions/` | The sidecar 0.2 schema and loader, data-aware expansion, the instantiation pipeline, the cached gates, the two attachments, and the host. Tests: `load.test.ts`, `instantiate.test.ts`, `host.test.ts`, `corrections.test.ts` (review Part A), `hardening.test.ts` (review Part B) |
| `packages/composer-core/src/compositions/spike/` | The two hotel compositions (`astryx.compositions.json`), the data sets, and the evidence script |
| `evidence/` | One file per data set, the recorded walk, the catalogs, the performance figures, and the level 1 and level 2 results |
| `verify_python.py` | Levels 1a and 1b, in upstream's Python `a2ui-core`, with expectations derived from the data, and the replacement walk through one long-lived processor (`evidence/level-1.json`) |
| `../r1a-host/verify-walk.mjs` | The same replacement walk through one long-lived `@a2ui/web_core` 0.16.1 processor (`evidence/level-1-web-core-walk.json`) |
| `evidence/failing-first.txt` | The corrections' regression tests, failing against `3036584` before the fixes |
| `evidence/failing-first-part-b.txt` | The host-hardening tests, 28 of 30 failing against `main` at `939cdb5` before the fixes |
| `evidence/sensitive-exclusion.json` | The sensitive value typed in the recorded walk, searched for in every evidence file, with a positive control |
| `verify_render.cjs` | Level 2, in Chromium, on both renderer stacks (`evidence/level-2.json`) |
| `verify_demo.cjs` | The demonstration driven in Chromium in one renderer session: displayed values, focus, the consequential lock and outcomes, session ids, sensitive-value exclusion, and browser timings (`evidence/level-2-demo.json`) |
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

```bash
node docs/repositioning/spikes/r1a/verify_demo.cjs
```

The long-lived processor walk in `@a2ui/web_core` 0.16.1:

```bash
cd docs/repositioning/spikes/r1a-host && node verify-walk.mjs ../r1a/evidence
```
