# Composer — architecture

The product story and setup live in the [README](../README.md); this document
is the internals companion: what runs where, which surfaces exist, and where
each guarantee is enforced. Verified against the implementation on `main`.

Composer turns a plain goal into a governed interface built from a design
system's approved components only. The AI proposes; the deterministic pipeline
decides.

## The one pipeline, three proposal seams

```
goal → governed context inference → PROPOSAL → S1/S2/S3 → bounded repair
     → dspack-emit → A2UI messages (A1/A2/A3) → registry render → accept → export
```

Only the PROPOSAL step varies:

| Provider | Where the model call happens | Where the gates run |
|---|---|---|
| **Hosted AI** | the composer Worker → AI Gateway → managed Claude Haiku | the browser |
| **Local AI** (Ollama / OpenAI-compatible) | the local agent → your endpoint | the browser (browser projects) or the agent (repository projects) |
| **Scripted** | nothing — replays the intent's latest worked example behind one deliberately wrong attempt | the browser |

`apps/composer/app/hosted-build.ts` runs `runPipeline` from
`@aestheticfunction/dspack-gen/browser` in the page and calls the Worker only
for the model turn. Goal inference uses the same gateway request path
(`planning.ts` → `buildPlanRequest` → the gateway), falling back to
`planDeterministic` when no hosted model is available — inference degrades,
it never blocks a build.

## Where a project's vocabulary comes from

A project is identity + a **source**, and the working contract is always
`base + the project's authored delta`:

| Source | Base vocabulary | Persistence |
|---|---|---|
| `reference` | a packaged design system (`app/demo-data.ts`: shadcn/ui v3, Astryx) | delta in `localStorage` |
| `imported` | the contract/profile that travelled in a `.composerproject.json` | vocabulary + delta in `localStorage` |
| `agent` | the connected repository's files on disk | the repository itself |

**The canonical references are never mutated.** Accepted builds and authored
scenarios land in a per-project delta (`composer.project.examples.<id>`),
merged over the base on open (`mergeExamples` — replace-by-id else append, so
the owner's latest work is what scripted replay and the few-shot corpus
reach). Provenance is by base membership (`referenceExampleIds`), never by id
prefix, which is what lets Preview and Scenarios separate *yours* from the
reference corpus honestly.

Browser storage keys: `composer.projects.v1` (index), `composer.lastProject.v1`,
`composer.project.vocab.<id>`, `composer.project.examples.<id>`,
`composer.providers.v1` (endpoints + chosen model — **never a credential**),
`composer.appearance.v1`.

**Portability.** Export writes `<name>.composerproject.json`: name,
description, `previewRegistry`, contract, profile — including accepted
surfaces, and excluding ids, machine paths, and credentials by construction
(`app/project-portability.ts`). Import validates fail-closed (version gate,
contract has components, the profile must load through the real emitter
loader) before a project is created.

## Accepting work

Accept runs the same fail-closed gate in both homes, so a browser project
owns its surfaces without an agent:

- **browser** — `state.tsx` re-lints with `lintOneSurface` (S1–S3 over the
  project contract), requires an authored intent, mints a collision-free
  `ex.chat-N` against the merged set, never overwrites, then saves through
  `saveContract` (which persists the delta).
- **repository** — the agent's `/project/save-example` re-lints server-side
  and writes into the contract on disk, ledger preserved.

## The local agent

`apps/agent` is the bridge to your machine. It holds endpoints and
credentials; the browser never does.

| Route | Purpose |
|---|---|
| `GET /` | health + `canPickFolder` |
| `GET /models` | model refs this machine can run (`scripted` + discovered Ollama) |
| `POST /provider/test` | connection test + model discovery for a configured provider |
| `POST /pick-folder` | native OS folder picker (macOS `osascript`, Linux `zenity`) |
| `POST /generate` | governed run over an **inline** contract + profile — how a browser project uses a local model |
| `POST /project/connect\|discover\|rediscover\|emit\|validate\|save\|save-example\|run` | repository-project operations over files on disk |
| `POST /fork`, `POST /action` | Studio interactive scenarios (not Composer) |

Provider configuration arrives per request (`{kind, baseUrl, apiKey?, model}`)
and is never persisted by the agent; `OLLAMA_URL` remains a default, and
`AGENT_ALLOWED_ORIGINS` (default `*`) bounds who may call it.

## The hosted Worker

Repo-root `wrangler.jsonc` → `dspack-studio-composer`, static assets from
`apps/composer/out` with `run_worker_first` scoped to `/api/*`. Exactly two
routes: `GET /api/models` (capability probe — reports `hosted-ai` only when
the AI Gateway binding and kill switch allow it) and `POST /api/propose` (the
model turn). No key ever reaches the client bundle. See
[deployment.md](deployment.md).

## Rendering

Native renderer where one exists, **universal wireframe fallback where none
does** — composed per component in `app/registries.ts`, which merges the
wireframe registry under the native one (native wins name-by-name) behind a
per-catalog identity cache, because `A2uiCanvas` memoizes catalog ingestion on
registry identity. `nativeRegistryFor` + `wireframeFallbackNames` keep the
honest pre-merge gap reportable, so Preview can say how many components are
standing in without the raw `[unimplemented: …]` placeholder ever reaching a
user. Layer boundaries: [renderer-abstraction.md](renderer-abstraction.md).

## Where the guarantees live

| Guarantee | Enforced in |
|---|---|
| Generation uses approved components only | S2, `dspack-gen` (browser or agent) |
| Design-system rules hold | S3, the contract's typed rules |
| Emission is representable or refused | `dspack-emit` gates A1/A2/A3 + declared casualties |
| Accepted work is gate-green | `lintOneSurface` (browser) / `/project/save-example` (agent) |
| The reference is never mutated | base+delta merge (`app/projects.ts`) |
| No credential in the browser | `app/providers.ts` writes endpoints and model only |

## Verified by test

`apps/composer/app/registries.test.ts` (fallback composition + identity),
`packages/composer-core` unit tests (manifest, ledger, planning, build fold),
`e2e/composer-prod-smoke.spec.ts` (first run, ownership round-trip, Examples,
portability, lifecycle, hygiene), `e2e/composer-agent.spec.ts` +
`e2e/composer-build.spec.ts` (repository projects against real files).

Historical record — how this was built, phase by phase, with the measurements
that drove each decision — is in
[IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md).
