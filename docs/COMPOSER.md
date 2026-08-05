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

## Phase 2: authoring depth (2026-08-03)

- **Validation is whole, everywhere**: the dspack harness is importable
  (dspack#34), so document validation, S1–S3, and the full emit loop
  (browser-safe dspack-emit, dspack-emit#25) run IN the browser with the
  CLI's wording — the "requires the local agent" validation caveat is
  retired. Every contract/profile edit re-emits live in both modes.
- **Governance forms**: intents and the four rule types as pure form
  projections; the rationale gates saving ("write the rationale first");
  every save re-lints all worked examples (the governance-impact rail).
- **Scenario editor**: dsurface trees built through forms constrained to
  the contract's vocabulary, live S1–S3 + live wireframe preview per edit,
  save-gated on clean gates; a saved scenario IS a contract worked example.
- **Rediscovery**: /project/rediscover merges fresh extraction at the
  ledger's granularity (dspack-export#12 regenerateSections) — tool-owned
  refreshes, human-owned + governance preserved, new components added,
  refusals verbatim.
- **Project home**: the derived "What remains" checklist (described /
  props / mapped / intents / rules / examples / gates), each row linking to
  the view where the work happens.

Temporary state: pnpm overrides point dspack-spec/emit/export at the three
Phase 2 upstream branches until 0.4.2 / 0.4.1 / 0.4.0 release (the same
paired-PR protocol Phase 1 used).

## Acknowledged casualties (2026-08-04, #30)

A component the profile author declared a **casualty with a written reason**
is an owner decision, not unresolved work. `composer-core`'s
`classifySurfaceRefusal` decides this from structured data only — the
surface's referenced component ids, minus the profile's mapped plans, minus
the contract's declared sub-components; acknowledged only when what remains
is non-empty and *every* id in it is a declared casualty carrying a
non-empty reason. Message text is never parsed.

**Scope boundary.** The classification applies to that one surface-level
emission refusal and nothing else. Schema, mapping, coverage, lint,
generation, and any other finding — including findings targeting the *same*
surface — remain unclassified and keep counting as unresolved. A surface
carrying both an acknowledged casualty and a genuine failure leaves the
project failed and reports both categories
(`2 error findings · 1 acknowledged casualty`). An acknowledged casualty can
never make a failing project look green.

The finding itself is never altered: severity, code, target, and the verbatim
refusal (including the authored reason) all survive, and Validate marks it
`ACKNOWLEDGED` rather than hiding it.

Known emitter limitation: `EmitSurfaceError` exposes only `message` and
`path`, and `path` addresses the emitter's *normalized* emission tree — in
the shipped demo it resolves to the compound child, not to the casualty — so
it cannot identify the component responsible for a refusal. The profile's
authored declaration is therefore the only sound provenance today; see the
upstream follow-up for a structured cause.

## Phase 3: Build — chat-driven creation (2026-08-04)

The product model, in order: **Build** (chat-driven creation from approved
components) · **Catalog** (discovery, mapping, governance, ownership,
validation — the setup layer) · **Component Workshop** (a later, separate
human-reviewed workflow for components that do not exist yet). Building
never generates React component implementations; an ask the vocabulary
cannot express is reported as a **vocabulary gap**, the Workshop hook.

The slice: describe an interface → dspack-gen generates a governed dsurface
under the project-scoped contract (`/project/run`, AG-UI SSE) → S1–S3 +
bounded repair + emit stream visibly per turn → the surface renders through
the trusted registry (wireframe/shadcn) → **Refine** seeds the prior
surface + the new instruction (dspack-gen 0.2.0 `RunOptions.conversation`)
and regenerates a COMPLETE surface through every gate, prior turns kept in
the thread → **Accept** saves the result as a contract worked example via
the server-side fail-closed `/project/save-example` (S1–S3 re-linted on the
agent; unknown intents refused; ledger preserved) — and immediately joins
that intent's few-shot corpus, so accepted results compound generation.

Build-first IA: Build is the first nav item, the default view for a ready
connected project, and visibly disabled with the exact remaining-setup
reason otherwise ("Set up your design system, then build with it"; the
project home gains **Start building** when ready — readiness =
contract + profile + ≥1 intent + every component mapped-or-casualty +
gates green + ≥1 worked example, `composer-core buildReadiness`).

Providers: `scripted` is the always-available zero-model twin — a fresh run
plays a contract-derived S2 violation then the intent's LATEST worked
example (the governed fail→repair→pass loop, deterministically), and a
refinement returns the prior surface with a deterministic textual change
ONLY when the seed is present (the non-vacuous-refinement proof). Local
Ollama is the first real provider (evidence: `gemma4:e4b` first-attempt
pass over the scoped demo contract, and a seeded refinement that applied
the requested changes — the same model that scored 0/72 on the full shadcn
vocabulary). Anthropic keeps working through the agent's environment; no
browser keys, no hosted AI, no new bindings. What leaves the machine, per
provider, is stated in the Build view; project source never does.

