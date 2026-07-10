# dspack-studio

dspack-studio is the flagship experience for the open AI-native frontend ecosystem: an AI agent builds interfaces under a design-system contract, streamed over AG-UI as A2UI surfaces, rendered with Astryx. Rewind it, fork it, break it, X-ray it. Every gate, repair, and audit is inspectable.

Status: pre-alpha. Phase 1 (foundation) complete: the contract's worked example renders through Astryx with the theme dial; both A2UI catalogs emit behind gates; the vocabulary drift check runs against Astryx's own machine-readable docs.

## Try it

```sh
pnpm install
pnpm build:contracts   # compile the contract -> A2UI catalogs + example surface (gated)
pnpm dev               # http://localhost:3000
```

No keys, no network calls beyond npm. `pnpm --filter @dspack-studio/contracts drift-check` compares the contract's vocabulary against `npx astryx component --json`.

## The pipeline

dspack constrains and validates. dspack-emit compiles. AG-UI transports. A2UI describes. Astryx renders.

```
CONTRACT TIME (build/CI, deterministic)
  astryx.dspack.json --dspack-emit--> A2UI catalogs v0.9.1 + v1.0   (gates A1/A2)
                     --dspack-gen---> generation context (prompt + schema + few-shot)
                     --a2ui-ingest--> renderer-registry contract

GENERATION TIME (agent service per prompt, or replayed from fixtures)
  prompt -> dspack-gen runPipeline: adapter -> surface -> S1/S2/S3 -> repair loop
         -> dspack-emit -> A2UI messages (gate A3) -> audit report

RUNTIME (browser)
  AG-UI events (SSE) -> A2UI MessageProcessor -> Astryx registry -> pixels
```

| Layer | Responsibility |
|---|---|
| Agent (`apps/agent`) | Intent routing, governed generation, HITL pauses, data-model patching |
| dspack contract (`packages/contracts`) | Constrain generation, validate S1/S2/S3, carry rationale |
| dspack-emit | Compile contract to catalog, surface to A2UI; gates A1/A2/A3 |
| AG-UI | Transport: lifecycle, tool calls, gate telemetry, state deltas |
| A2UI | Declarative surface, data model, actions |
| Astryx (`packages/astryx-renderers`) | Real components and theming behind catalog names |

## Workspace

| Package | Purpose |
|---|---|
| `apps/web` | The studio: canvas, timeline, X-ray, wire view |
| `apps/agent` | AG-UI agent server wrapping the dspack-gen pipeline |
| `packages/a2ui-ingest` | Generic A2UI catalog to renderer adapter (extracted from dspack-emit's demo) |
| `packages/astryx-renderers` | Catalog names mapped to Astryx components |
| `packages/agui-bridge` | Pipeline events mapped to AG-UI events |
| `packages/contracts` | The astryx dspack contract, catalog emission, drift check |
| `packages/replay` | Recorded-run fixtures, recorder, timeline player |
| `packages/provenance` | Event-log indexing for X-ray |
| `packages/scenarios` | Scenario configs: prompts, break-it prompts, fixtures |

## What this is not

This project demonstrates the open ecosystem only: [dspack](https://github.com/aestheticfunction/dspack), [ds-mcp](https://github.com/aestheticfunction/ds-mcp), [dspack-export](https://github.com/aestheticfunction/dspack-export), [dspack-gen](https://github.com/aestheticfunction/dspack-gen), [dspack-emit](https://github.com/aestheticfunction/dspack-emit), with [AG-UI](https://github.com/ag-ui-protocol/ag-ui), [A2UI](https://github.com/google/A2UI), and [Astryx](https://github.com/facebook/astryx). It does not include the Aesthetic Function reconciliation engine.

## License

Apache-2.0
