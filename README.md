# Composer · dspack-studio

**Composer helps a design engineer create governed interfaces and catalogs from a design system.** You describe what you want in plain language; Composer works out the governed context, builds the interface from your design system's *approved components only*, checks every attempt against the system's own rules, repairs what it can, renders the result natively, and lets you accept it into your project — which you can export, reopen, and take with you.

The primary workflow:

```
project → natural-language goal → governed context inference → AI proposal
        → S1/S2/S3 validation → bounded repair → emit → native/wireframe preview
        → accept into project → export
```

The AI proposes; it never decides. Every proposal — hosted, local, or scripted — passes through the same deterministic pipeline, and invalid patterns are refused or repaired with the rule and its written rationale on the record.

![An agent proposes a destructive-action surface without an AlertDialog; the S3 gate fails with rule.destructive-requires-alertdialog, a repair message is sent, and the repaired surface renders.](docs/assets/dspack-studio-catch.gif)

Under the hood, a design system is described as a [dspack](https://github.com/aestheticfunction/dspack) **contract** (components, intents, rules, worked examples) plus a mapping **profile**; generation runs through [dspack-gen](https://github.com/aestheticfunction/dspack-gen), emission through [dspack-emit](https://github.com/aestheticfunction/dspack-emit) onto [A2UI](https://github.com/google/A2UI), streamed over [AG-UI](https://github.com/ag-ui-protocol/ag-ui). This repository is the flagship application of that ecosystem — see the [organization profile](https://github.com/aestheticfunction) for the full map.

> **Kind:** application (pnpm monorepo: two web apps + a local agent server; not an npm package)
> **Hosted Composer:** [composer.aesthetic-function.com](https://composer.aesthetic-function.com) · **Hosted Studio (replay exhibit):** [studio.aesthetic-function.com](https://studio.aesthetic-function.com)

## Try it — no install

Open [composer.aesthetic-function.com](https://composer.aesthetic-function.com), create a project on shadcn/ui or Astryx (or open an **Example** first — read-only reference projects that show how everything works), and build with:

- **Hosted AI** — managed Claude Haiku through the Aesthetic Function AI Gateway. No API key ever enters your browser; the model proposes, and the deterministic checks and rendering run entirely in your browser.
- **Scripted** — a zero-model deterministic mode that replays the intent's worked example behind one deliberately wrong first attempt, so you can watch the governance actually catch and repair.

Your goal and the contract-derived context go to the gateway when you choose Hosted AI; with local models (below) requests go only to your own endpoint, through your own machine.

## Quick start — run Composer locally

Requirements: **Node ≥ 22** and **pnpm 10** (the repo pins `pnpm@10.25.0` via the `packageManager` field — `corepack enable` gets you the right one).

```sh
git clone https://github.com/aestheticfunction/dspack-studio
cd dspack-studio
pnpm install
pnpm --filter composer dev        # Composer at http://localhost:3001
pnpm --filter agent dev           # the local agent at http://localhost:8787 (second terminal)
```

Then open <http://localhost:3001>, create a project (name + governed design system), pick a provider in **Settings**, and describe what you want in **Build**. The agent is optional for browser-only work (scripted mode needs nothing), and required for local models and repository-backed projects.

## Local AI — Ollama

The browser is only a client: it cannot reach a model on `localhost` by itself, and it never stores a provider secret. The **local agent is the bridge** — it owns endpoint communication and any credential:

```
Composer UI  →  local agent (:8787)  →  Ollama  →  your local model
```

Setup, entirely through the UI:

1. Install [Ollama](https://ollama.com) and pull a model (`ollama pull <model>`); make sure its API is reachable (default `http://localhost:11434`).
2. Start the Composer agent: `pnpm --filter agent dev`.
3. Open Composer (local or the hosted site — the hosted page can talk to your local agent too).
4. Go to **Settings → Local AI & your own provider → Ollama**.
5. Confirm or edit the endpoint (normally `http://localhost:11434`).
6. Click **Test connection** — the agent probes the endpoint and lists the discovered models.
7. Pick a model. It becomes the active provider ("Local · \<model\>").
8. Return to **Build** and describe what you want.

`OLLAMA_URL` in the agent's environment remains an advanced fallback default; the normal path is the UI above. Prefer models that emit clean raw JSON — the pipeline refuses (rather than salvages) output it cannot parse, by design.

## Local AI — OpenAI-compatible servers

Anything that speaks the OpenAI Chat Completions API works through one generic integration — for example **LM Studio**, **llama.cpp server**, **vLLM**, or **LocalAI** (no bespoke per-product integrations; one adapter serves the family):

1. **Settings → Local AI → OpenAI-compatible.**
2. Enter the base URL — e.g. LM Studio's default `http://localhost:1234/v1` (an example; use your server's).
3. Optionally enter a credential if your server requires one. It is held in memory for the session, sent only to the agent, and **never written to browser storage**.
4. **Test connection** — models are discovered via `/v1/models` where the server supports it; if it doesn't, enter a model id manually.
5. Choose the model, return to **Build**.

Structured output degrades gracefully (`json_schema` → `json_object` → plain), but the same raw-JSON note applies: a model that wraps its answer in code fences will fail the run honestly rather than being silently repaired.

## Hosted + Local together

Both can be reachable at once. When the local agent is connected, Hosted AI stays selectable alongside your local models — the provider list is the union of what the hosted origin and the agent each offer, and a deliberately chosen provider is never silently switched. Provider choice changes only who *proposes*; the governed pipeline is identical.

## Projects

- **Your projects** holds only what you created or imported. **Examples** (on the same hub) are read-only reference projects — the design systems' own worked examples, scenarios, and governance — for learning: *Open example* to explore (changes are not kept), *Create copy* to start your own.
- A project's source is a packaged **reference** (shadcn/ui or Astryx), an **imported** file, or a **connected repository** (through the agent). The canonical references are immutable; **your project owns its accepted surfaces** — a per-project authored delta layered over the base vocabulary. What you build and accept shows up in Preview and Surfaces as *yours*, seeds future generation, and survives reload.
- Full lifecycle: create, rename, duplicate, remove, switch; the last-opened project reopens on return.
- **Portability:** *Export* (on the project card, and always in the top bar while a project is open) downloads a `<name>.composerproject.json` — the project's name, description, design system, contract, and profile, including your accepted surfaces. No machine paths, ids, or credentials ever travel in it. *Import a project…* on the hub restores it, ready to keep building.

## Connect your own repository

Repository-backed projects run through the local agent, which reads your project folder in place (nothing is uploaded):

- **Browse…** opens your operating system's real folder picker — the agent does it on your machine, because a browser cannot enumerate arbitrary local folders (macOS uses `osascript`; Linux needs `zenity` installed; elsewhere, use the path field).
- **Recent workspaces** reconnect in one click; a manual absolute path remains the fallback.

From a connected repository you can discover the contract with dspack-export, enrich it, author governance, accept builds to disk, and re-emit — see the **Repository** view.

## Design-system references

shadcn/ui and Astryx are not the product — they are the two packaged **governed reference design systems**, proving one pipeline with zero design-system-specific code paths:

```
design system = contract (components, intents, rules, examples)
              + profile (mapping to A2UI)
              + renderer registry (the pixels)
```

- **shadcn/ui v3** — the production catalog: 34 contract components, 27 A2UI components, native React visuals where renderers exist.
- **Astryx** — 12 components, 6 governed intents, full native coverage with runtime themes.

The Composer UX and AI pipeline are shared; adapters for further design systems are future direction, not current capability.

## The working views

| View | What it is |
|---|---|
| **Build** | Goal-first conversational authoring: describe → inferred governed context → generate → gates → render → refine → *Add to project* |
| **Preview** | The project's own surfaces, drawn in its own design system by default, with the reference surfaces clearly separated; catalog export |
| **Catalog** | The governed component vocabulary available to this project — what Composer is allowed to use, and how each maps to A2UI |
| **Governance** | The intents, rules, and constraints governing generation and validation — why certain things are allowed or refused |
| **Surfaces** | Every screen this project has built or authored (yours), plus the clearly labeled reference corpus; hand-authoring with live gates |
| **Flows** | Your surfaces composed into a walkable workflow — Preview, opened on flow mode |
| **Checks** | The validation dashboard: contract + surface gates, findings, evidence |
| **Settings** | Providers (Hosted / Local / Scripted) and appearance |
| **Repository** | Repository-backed tools: discovery, rediscovery, the ownership ledger (agent projects only) |

## Native and wireframe rendering

Rendering is honest about coverage: **native renderer where available → universal wireframe fallback where not**. A component without a native visual draws as a labeled wireframe stand-in *inside* the otherwise-native surface (Preview states the count plainly). Wireframe fallback is intentional — it means "no native visual yet," never that the governed surface failed. Today shadcn/ui renders 11 of its 27 A2UI components natively; Astryx renders all 12.

## Architecture

```
AI proposal (hosted | local | scripted)      ← the only seam that varies
  → dspack-gen runPipeline
  → S1/S2/S3 gates → bounded repair loop
  → dspack-emit → A2UI messages (gates A1/A2/A3) → audit report
  → registry renderer (native + wireframe fallback)
```

The proposal provider differs; **the deterministic authority does not**. Hosted proposals come from managed Claude via the AI Gateway; local proposals go through the agent to your endpoint; scripted replays the intent's worked example — all through identical gates, in your browser for browser projects, or against files on disk for repository projects. Contract-time emission (catalogs from contracts) and runtime rendering (AG-UI events → A2UI processor → registry) are the same machinery the Studio exhibit demonstrates. Deeper docs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (why the product is shaped this way — the thesis, the invariants, what Composer deliberately does not do), [docs/COMPOSER.md](docs/COMPOSER.md) (what runs where), [docs/renderer-abstraction.md](docs/renderer-abstraction.md), [docs/AUDIT.md](docs/AUDIT.md). The twelve-prompt enterprise acceptance corpus, its expected classification, and a reproducible harness live in [acceptance/gateway-corpus](acceptance/gateway-corpus/README.md).

## The Studio (second app)

[studio.aesthetic-function.com](https://studio.aesthetic-function.com) (`apps/web`) is the replay exhibit built on the same pipeline: curated recorded runs you can scrub, fork, break on purpose, and X-ray — plus interactive human-in-the-loop scenarios. It needs no keys and no agent; live generation there is bring-your-own-machine. `pnpm dev` runs it.

## Workspace

| Path | Kind | Purpose |
|---|---|---|
| `apps/composer` | app | Composer — the authoring product |
| `apps/web` | app | The Studio replay exhibit |
| `apps/agent` | app | The local agent: AG-UI server, project routes, provider bridge, folder picker |
| `packages/composer-core` | lib | Composer's shared core: project manifest, ledger, build folding, planning |
| `packages/contracts` | lib | Packaged reference contracts/profiles (Astryx + shadcn/ui v3) and catalog emission |
| `packages/a2ui-ingest` | lib | Generic A2UI catalog → renderer adapter (canvas, registries, coverage) |
| `packages/shadcn-renderers` | lib | Native shadcn/ui visuals behind catalog names |
| `packages/astryx-renderers` | lib | Native Astryx visuals behind catalog names |
| `packages/wireframe-renderers` | lib | The universal wireframe registry (fallback + inspection) |
| `packages/agui-bridge` | lib | Pipeline events ↔ AG-UI events |
| `packages/replay` | lib | Recorded-run fixtures, recorder, timeline player |
| `packages/scenarios` | lib | Studio scenario configs and fixtures |

Published dependencies doing the heavy lifting: `@aestheticfunction/dspack-gen` (generation + gates), `@aestheticfunction/dspack-emit` (emission), `@aestheticfunction/dspack-export` (discovery), `@aestheticfunction/dspack-spec` (the validation harness).

## Development

```sh
pnpm typecheck                                                # whole repo
pnpm test                                                     # EVERY workspace test script (the exact command CI runs)
pnpm --filter composer test                                   # composer unit tests
pnpm --filter agent test                                      # agent unit tests
pnpm --filter composer build                                  # static export → apps/composer/out
pnpm build:contracts                                          # contracts → gated catalogs (drift-checked)
npx playwright test --config playwright.composer-smoke.config.ts       # composer smoke (serves the static export)
npx playwright test --config playwright.composer-agent.config.ts       # agent-mode e2e (starts the agent, real files)
npx playwright test --config playwright.composer-production.config.ts  # smoke against the deployed composer
pnpm e2e                                                      # studio e2e against its static export
```

CI runs contract gates, sync checks, unit tests, typecheck, static exports, and the Playwright suites on every PR.

## Deployment

The hosted Composer ([composer.aesthetic-function.com](https://composer.aesthetic-function.com)) deploys automatically from `main` via Cloudflare Workers Builds; `pnpm build:deploy:composer` produces the same static artifact locally (`apps/composer/out`), and the hosted-AI routes live in a small Worker alongside it. The Studio deploys separately from `apps/web`. Details, including the deliberate separation of static artifact and agent, are in [docs/deployment.md](docs/deployment.md). No provider keys are ever part of the client bundle.

## Known limitations

- **Native renderer coverage is partial** for shadcn/ui (11 of 27 A2UI components); the rest render as intentional wireframe stand-ins. Astryx is fully covered.
- **The native folder picker** is macOS (`osascript`) and Linux (`zenity`) only, and its OS dialog is verified manually — elsewhere the path field is the way in.
- **OpenAI-compatible servers** must return raw JSON; fenced output fails the run honestly (fail-loud is a design decision, not a bug).
- **Component Workshop** (creating components a catalog doesn't yet contain) is deliberately deferred — chat never generates component implementations.

## What this is not

This repository demonstrates the open ecosystem: [dspack](https://github.com/aestheticfunction/dspack), [ds-mcp](https://github.com/aestheticfunction/ds-mcp), [dspack-export](https://github.com/aestheticfunction/dspack-export), [dspack-gen](https://github.com/aestheticfunction/dspack-gen), [dspack-emit](https://github.com/aestheticfunction/dspack-emit), with [AG-UI](https://github.com/ag-ui-protocol/ag-ui), [A2UI](https://github.com/google/A2UI), and [Astryx](https://github.com/facebook/astryx). It does not include the Aesthetic Function reconciliation engine.

## License

Apache-2.0
