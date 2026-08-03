# The catalog composer (vertical slice)

The composer turns the studio's pipeline into an authoring experience for
**user projects**: connect a React component library, discover its components
(dspack-export), enrich the contract (props + prose + governance, tracked by
the x-bootstrap ownership ledger), map it through a **JSON profile**
(dspack-emit profile-as-data), emit a project-specific A2UI catalog, preview
it through the wireframe or native shadcn registries, validate every gate,
and run governed generation against the project-scoped vocabulary.

Status: Phase 1 vertical slice. The full architecture proposal and phased
roadmap live in the planning document that produced this slice; deltas from
that plan are recorded below.

Hosted at **https://composer.aesthetic-function.com** (its own zero-binding
Worker; see [deployment.md](./deployment.md#the-composer-second-worker-same-posture)).

## Run it

```
pnpm --filter agent dev        # the local agent (BYO machine, port 8787)
pnpm --filter composer dev     # the composer app (port 3001)
```

The hosted/offline posture mirrors the exhibit: without the agent the app
serves the pre-emitted **demo project** (`apps/composer/demo-project` — a
real non-canonical 5-component React library, "Acme UI") and states plainly
which actions need the agent. Nothing is simulated.

Connect the demo project through the agent to exercise the full loop:
paste the absolute path to `apps/composer/demo-project` in Project → Connect.

## What lives where (the three seams, unchanged)

| Seam | Owner | Composer's use |
|---|---|---|
| Discovery | `dspack-export` `FrameworkAdapter` | agent shells the CLI; refusals verbatim |
| Mapping | `dspack-emit` `Profile` (now loadable as JSON — `loadProfile`, `profile.v1.schema.json`, dspack-emit PR #24) | the Mapper edits `*.profile.json`; `transformFromJson` is the live judge |
| Rendering | `a2ui-ingest` `Registry` | wireframe (universal, catalog-derived) or native `shadcnRegistry` |

New studio pieces, all thin:

- `packages/composer-core` — project manifest (zod), x-bootstrap ledger
  reading on WebCrypto (hash-pinned to dspack-export output), normalized
  findings, adapter manifests (data only; registries bound by id in the app).
- `packages/wireframe-renderers` — `wireframeRegistryFor(catalog)`: every
  catalog name renders as an honest labeled wireframe; zero user code
  executes. The permanent fallback for targets with no native renderer
  (the Vue door).
- `apps/agent` `/project/*` routes — connect / discover / emit / validate /
  save (ledger-preserving) / run (AG-UI SSE generation under the project
  contract + profile). dspack-export is imported/spawned **only** here
  (import-isolation rule).
- `apps/composer` — six views (Project, Inventory, Component, Mapper,
  Preview, Validate) over the project files. The exhibit (apps/web) is
  untouched.

## Evidence (spike + slice verification, 2026-08-03)

- Grammar-budget thesis: full-shadcn depth-6 generation schema 70,940 B
  (the config that failed 72/72 hosted structured-output runs) vs the
  project-scoped acme schema **16,679 B (23.5%)**; depth 4: 11,037 B.
- Live constrained generation: `ollama:gemma4:e4b` (0/72 end-to-end passes
  on the full shadcn vocabulary in the recorded evals) **passes first-attempt**
  under the acme contract — S1/S2/S3 green, JSON profile emission, A1–A3
  green on both A2UI versions — both via `runPipeline` directly and through
  `POST /project/run`.
- The real `shadcnRegistry` natively covers all six acme catalog names
  (registry-conventional profile naming); catalog-derived zod schemas accept
  the verbatim emitted instances and reject unknown props/enums.
- Anthropic grammar-ceiling reproduction remains open (no API key in the
  build environment); byte-size delta + live local pass stand as evidence.

## Known temporary state

- **pnpm override**: `@aestheticfunction/dspack-emit` points at the local
  `feat/profile-as-data` build (dspack-emit PR #24). Replace with `^0.4.0`
  from npm at release; CI on this branch is red until then by construction
  (the established paired-PR protocol).
- The bridge's hand-mirrored `PipelineEvent` union stays until dspack-gen
  PR #48 releases (`pipeline-types.ts` retirement is mechanical after).
- Demo-mode in-browser emit (fidelity rail without the agent) waits on
  dspack-emit's browser-safe `/core` (meta-schemas as imports, not
  `node:fs`) — planned Phase 0 item ⑤, not required for the slice.

## Plan deltas (what implementation taught us)

1. **Prop enrichment is required, not polish**: dspack-export extraction is
   variant-centric (the canonical fixture's `input` has zero props; acme's
   `label`/`steps` were not extracted). The Component view therefore authors
   props, and contract-`required` props flow into the generation grammar.
2. **Registry-conventional catalog naming** (Button/Card/Badge/TextField +
   variant/size/label) is the recommended profile default — it bought native
   shadcn preview for the whole foreign catalog with zero registry changes.
3. **Casualty refusals cite their authored reason** end to end (dspack-emit
   change, surfaced in the agent findings and the Preview's refused chip).
4. The composer app's `test` uses `--passWithNoTests` (contracts precedent);
   its logic lives in tested packages and the agent.
