# Composer: repositioning proposal and phased plan

Prepared for product-owner review. Nothing in this document has been implemented. Investigation was read-only against `dspack-studio` at `8053151` (2026-10-17), the five sibling repositories at their heads (2026-08-10 to 08-12), the A2UI, AG-UI, json-render and Astryx repositories at their heads (2026-11-23/24), and the live site on 2026-11-24.

## Status: revision 2, after the product-owner decision

**Owner decision (2026-11-24): accepted in principle; M0 authorized; no later milestone authorized.** This revision records that decision and applies its refinements. Approving it releases M0 execution only. I stop at review R0.

What changed from revision 1:

| Owner's instruction | Where it is applied |
|---|---|
| Decisions D1 to D16 | Recorded in F, with each condition |
| D4: later data updates must not get around governance, with negative tests | C3 "After the first render", C6 update-integrity row, M1 and M2 acceptance |
| D5: document D5b, name the owner-authored purposes the vertical needs; no upstream change | M0 deliverable 9 |
| D6: verified final A2UI 1.0 is a condition of the public release | E3 public cutover gate |
| D8, section 4: no paid inference in M0; a costed proposal with a small pilot first | M0 deliverable 8; E7 |
| Hosted AI availability investigation | M0 deliverable 5 |
| Scripted example integrity, non-destructive | M0 deliverables 6 and 10 |
| Three workspace approaches, clickable | Section D.11; M0 deliverable 7 |
| Four fixes versus five listed; hash routing | M0 has four fixes; hash routing is deferred to the new shell in M1 |
| Early interoperability spike in M1 | E3 M1 step 5 and its gate R1a |
| Package reader is not independent agent consumption | C7, M3 acceptance, E6 |
| M4 and M5 sequencing | M4 is a release candidate; public cutover follows M5 |

M0 runs inside these boundaries: work on a branch; no merge, no deploy, no change to production infrastructure, credentials, Access, gateway or deployment settings; no change to sibling repositories; no paid inference; no new paid dependency; the release freeze stands; the twelve corpus prompts and existing evidence are untouched.

Evidence tags used throughout: **[live]** observed on composer.aesthetic-function.com in a real browser; **[code]** read in source; **[doc]** stated in repository documentation; **[upstream]** read in a sibling or external repository; **[inferred]** my reasoning, not directly observed; **[unverified]** could not be checked here.

## Context

Composer today proves a narrow, valuable thing: an AI can propose a screen and deterministic gates decide whether a design system allows it. The product says of itself, in three places in the live UI, that it "composes and governs interface *representations*" and that "binding them to live data, running the workflow, and carrying state between steps is where this is going next" **[live]**. `docs/ARCHITECTURE.md` §9 calls runtime binding "a coherent future chapter", and `docs/blocks/POST-BETA-BACKLOG.md` names the UI redesign as "the next planning phase". This proposal is that chapter and that phase, planned together: evolve Composer from a workbench that checks static surfaces into the place where a team authors, governs, tests and publishes interfaces an agent can instantiate with real data and real interaction.

## Recommendation in brief

Proceed with the repositioning, with these main revisions to the brief's draft plan (the full list is in section H).

1. **Composition should be the existing interface block, evolved, not a new object.** The experimental blocks subsystem already has versioned typed signatures, closed templates, declared actions, provenance and an export manifest. It lacks data, bindings, action payloads, states and user authoring. Extending it avoids a second schema and keeps the Phase 1B evidence: tokens per successful build fell 53% on Astryx with pass rate inside the margin, and 62% on shadcn/ui v3 with an uncertain pass-rate result **[doc]**.
2. **The missing layer is an interaction contract, and it belongs to the project, not the design-system contract.** dspack deliberately excludes bindings and actions ("renderer- or transport-facing features do not belong in this format") **[upstream]**. Data types and action declarations describe a product domain, so they sit beside the contract. This preserves "A2UI defines what can render. dspack defines what is correct."
3. **Instantiate by governed expansion first; bind second.** Checking the design against the emitter showed that most emitted properties cannot carry a data binding today, and that rules are judged on literal surfaces, so content moved into a data model leaves the gates' sight (A4 items 13 and 14). Every instance should therefore be expanded from its composition with its data and pass S1 to S3. Bindings are kept for what must stay live in the renderer: entered values, action payloads and volatile text (C3).
4. **Most of the runtime already exists in this repository, in the wrong app.** The Studio exhibit (`apps/web`, `apps/agent`, `packages/replay`, `packages/scenarios`) runs a real A2UI data-model and action loop, but with bindings hand-written per scenario. The Playground should generalise that loop and delete the per-scenario code, not build a new runtime.
5. **Sequence around one vertical slice and land the new navigation progressively**, inside the existing experimental build, instead of holding the redesign to Phase 4.
6. **Add a small Milestone 0 before any model work**: a reproducible deterministic baseline, four trust fixes for the first-run experience, an offline protocol check, two investigations (hosted AI availability, scripted example integrity) and clickable design explorations. It is the recommended first authorized milestone (section H).

Two findings the owner should know immediately:

- **The public site cannot generate anything today.** `GET /api/models` returns `{"models":["scripted"]}` and Settings shows Hosted AI "Unavailable" **[live]**. A first-time visitor who types the hotel reservation request receives a "Choose a plan" pricing card with four green checks, and "Build a flow" yields two steps: that pricing card and a support-ticket table **[live]**.
- **"A2UI Composer" already exists upstream**: a CopilotKit-powered widget builder in the A2UI repository (`tools/composer`, hosted at a2ui-editor.ag-ui.com) **[upstream]**. Positioning and naming need to account for it (decision D13).

---

## A. Current-state assessment

### A1. Executive summary

Composer's engineering is unusually disciplined: gates are deterministic, losses are reported, evaluation is pre-registered and costed. Its product surface has not caught up with its own roadmap. Three gaps explain most of the concerns in the brief.

1. **No interaction model in the authoring layer.** A surface is a literal tree with no data, bindings, actions or states. The render path below it already supports all of these.
2. **No task model in the generation layer.** Planning chooses one governance intent. Nothing decomposes a request, carries context between steps, or checks that the result does what was asked.
3. **An architecture-shaped interface.** Navigation mirrors the pipeline (Build, Preview, Surfaces, Flows, Catalog, Governance, Checks), one stored object goes by five names, and publishing is two unrelated download buttons.

### A2. What was examined, and limits

| Examined | How |
|---|---|
| All docs listed in the brief, plus `docs/BLOCKS.md`, `docs/blocks/**`, `docs/PHASE-NEXT.md`, workflows, wrangler and Playwright configs | Read in full |
| `apps/composer`, `packages/composer-core`, `apps/agent`, `packages/agui-bridge`, `packages/contracts`, `a2ui-ingest`, three renderer packages, `replay`, `scenarios`, `block-bench`, `apps/web`, `e2e/` | Source read; key claims re-checked at line level |
| `dspack`, `dspack-gen`, `dspack-emit`, `ds-mcp`, `dspack-export` | Shallow clones, read only |
| A2UI, AG-UI, json-render, Astryx | Shallow clones, read only |
| Deployed app | Headless Chromium at 1440 px and 390 px: first run, every tab of the Astryx example, project creation, the hotel prompt as a single build and as a flow, reload, focus order, landmarks |
| Issues and PRs | 8 open issues, no open PRs |
| The proposed design itself | An independent review against `composer-core`, dspack-emit and the A2UI renderer source. It overturned my first design (bind first, with a hand-written overlay); A4 items 13 and 14 and the design in C3 are the result |

Limits and blockers:

- **No live model run was possible or attempted.** Hosted AI is off on production, the experimental build is behind Cloudflare Access, and no provider key or local runner exists in this environment. Every statement about model behaviour is from recorded evidence **[doc]** or code reading, not reproduction.
- **Dependencies were not installed** (read-only engagement), so no test suite was executed. Test counts come from reading spec files.
- **a2ui.org is blocked by this environment's network policy.** The A2UI repository's `specification/` directory was used instead.
- **Sibling repositories were last pushed in August 2026.** Composer pins their latest versions, so there is no drift, but nothing upstream has moved in three months.
- `docs/AUDIT.md`, `docs/NAV-REFACTOR.md` and `docs/IMPLEMENTATION_LOG.md` describe the Studio exhibit, not Composer. Composer's July to October build-out is recorded only in PR titles **[doc]**.

### A3. The brief's preliminary concerns: verdicts

| # | Concern | Verdict | Evidence |
|---|---|---|---|
| 1 | Too many architectural concepts exposed | **Confirmed** | Seven workspace destinations plus Projects, Export and Settings; the bar wraps to two rows at 1440 px. Checks lists raw codes ("A3 surface-synthesized-action"). Terms on screen: registry, casualty, governed context, emit warnings, intent ids, `EX.CHAT-1` **[live]**. Build already softens S1 to S3 into plain words; the jargon concentrates in Preview, Catalog, Governance and Checks. |
| 2 | Components, compositions, surfaces, examples, catalogs and flows are not distinct | **Confirmed, and worse than stated** | One stored object is called a surface, a worked example, an example surface, an `ex.*` entry and "context the next build learns from". "Examples" also means read-only sample projects. "Flows" opens the Preview view. Composition is not an object at all outside a flagged build **[live][code]**. |
| 3 | Output can pass governance without doing the task | **Confirmed in scripted mode; structurally true in every mode** | Hotel request returns a pricing card, four checks green **[live]**. No gate measures task fit: S1 to S3 judge design-system correctness, A1 to A3 judge protocol validity **[code][upstream]**. Not reproduced with a model. |
| 4 | Accepted surfaces lack parameterisation | **Confirmed** | Examples are literal trees `{id,intent,name,prompt,surface}` (`apps/composer/app/state.tsx:1522-1528`). `acceptance/gateway-corpus/EXPECTED.md` row 8 records "parameterized reuse, deliberately deferred". Blocks take parameters only at generation time. |
| 5 | Flows are sequences of screens | **Confirmed** | `FlowStep{surfaceId, advanceOn?}`; branching `on:[{event,to}]` is "RESERVED, validated, never executed" (`packages/composer-core/src/flows.ts`). No state is shared. |
| 6 | Data binding, action dispatch, continuity and agent consumption are incomplete | **Refined** | The protocol layer works: `A2uiCanvas` drives `@a2ui/web_core`'s `MessageProcessor`, which applies `updateDataModel`, resolves `{path}` bindings and reports actions; replay fixtures 005, 006 and 009 exercise it. The authoring layer has none of it, and Composer discards action events (Build: no-op; Preview: log). Dynamic collections are genuinely unsupported: `childIds()` returns `[]` for template children (`packages/a2ui-ingest/src/provenance.tsx:24-27`) **[code]**. |
| 7 | Renderer coverage and projection limits block valid compositions | **Refined** | Astryx: 12 of 12 catalog names native. shadcn/ui v3: 11 of 27, rest wireframe. Declared casualties: dropdown-menu (Astryx); tooltip, accordion, breadcrumb, pagination (shadcn). Emit-time losses are reported. Three runtime losses are silent: template children, renderer-ignored props on Astryx, schema defaults **[code]**. |
| 8 | Complex requests exceed the planning and generation strategy | **Confirmed structurally; magnitude unmeasured for multi-stage tasks** | One intent per goal; surface versus flow is a manual toggle; flow steps are independent builds with no shared context (`apps/composer/app/planning.ts`, `views/build-view.tsx`). Hosted model is Claude Haiku 4.5 with the generation schema pasted into the prompt, 8,192 output tokens, two repairs (`apps/composer/worker/propose.mjs:28-31,65-82`). Recorded: "composition-heavy prompts flip between runs"; shadcn structural refinements passed 52.2% **[doc]**. |
| 9 | Authoring-to-publishing relationship is unclear | **Confirmed** | "Export" in the header is a project backup; "Export catalog" inside Preview is the only agent-facing output; the action manifest ships only in the experimental build **[live][code]**. |
| 10 | Hard for a first-time user | **Confirmed** | See A4 items 1 to 3. |

### A4. Further verified findings

1. **First-run trust failure.** With only the scripted provider available, any request replays the saved example for the nearest intent. The page does say so in one amber line, but four green checks and a rendered result carry more weight **[live]**.
2. **Accepting a scripted replay pollutes the example corpus.** "Add to project" stores the user's unrelated request as the example's `prompt` and name (`state.tsx:1519-1528`), and the confirmation says it is now "context the next build learns from" **[live][code]**. dspack-gen uses same-intent examples verbatim as few-shot context **[upstream]**, so a pricing card filed under a hotel prompt can steer later generations.
3. **The deterministic flow outline is not a plan.** The hotel sentence becomes two steps titled "Create a hotel reservation experience where" and "Review the outcome of: Create a" (`packages/composer-core/src/flow-plan.ts:169-190`) **[live][code]**.
4. **A working interaction loop already exists but is hand-wired.** `apps/agent/src/scenarios/appointment-booking.ts` attaches bindings and actions to fixed component ids and grounds generated buttons by label heuristics; its header calls this the layer "dspack v0.4 declares out of scope". This is the "hardcoded demonstration" risk the brief warns about, already present in the exhibit **[code]**.
5. **Blocks exclude data by design.** "There is deliberately no type that can carry an entered value, a default, a credential or runtime state" (`docs/blocks/RFC-dspack-blocks.md` §2). Host-action rule 7 requires empty action context. Repositioning must change this boundary deliberately, not accidentally (decision D2).
6. **Surface ids collide.** Emitted `surfaceId` is the slug of the intent, so two surfaces of one intent share it (`docs/blocks/HOST-ACTIONS.md` §3). Multi-surface runtime needs unique ids; `emitSurface` already accepts one **[upstream]**.
7. **Hosted generation is unconstrained by necessity.** Anthropic's structured-output path rejects the generation schema at every depth; the limit found was about two components (`dspack-gen/docs/evidence/2026-07-04-hosted-probes`) **[upstream]**. A block call's schema is small by comparison, which is why blocks cut tokens; whether small closed schemas fit constrained decoding on the hosted path is untested (dspack-gen#33). This shapes the generation design in C5.
8. **Vocabulary, not rendering, limits the hotel scenario on Astryx.** The Astryx contract (v0.1.4) has 12 components and no date, number, select, loading, empty-state or banner vocabulary; `text-input.type` is text, password or email. Upstream Astryx is at 0.7.18 with DateInput, DateRangeInput, NumberInput, Selector, Skeleton, EmptyState and Banner **[code][upstream]** (decision D5).
9. **Every pinned protocol package is behind.** A2UI 1.0 is the current stable specification and 0.9.1 is closed; `@a2ui/react` and `web_core` are at 0.16.1 against pins of 0.10.1 and 0.10.3; AG-UI is at 1.0.5 against 0.0.57, with compatibility shims expiring 2027-09-17 **[upstream]**. Composer emits "1.0" catalogs it cannot render, and they are a pre-release shape: dspack-emit's 1.0 definitions write a binding as `{path}` (`dspack-emit/src/transform/inline-defs.ts:67-77`) where final 1.0 requires `@path` **[upstream]**. A green A3 on the 1.0 catalog therefore says nothing about bindings.
10. **Browser projects lose work.** Persistence is localStorage only. Rule, mapping and catalog edits in a browser project are session-only and vanish on reload unless exported (`state.tsx:846-877`). No view has a URL: reload and Back return to the hub **[live][code]**.
11. **Accessibility structure gaps outside the tested beta path.** Workspace views expose no headings, navigation lacks `aria-current`, there is no skip link, and Checks overflows horizontally at 390 px **[live]**. Axe suites exist for build, agent and blocks paths **[code]**.
12. **Merging to `main` deploys production.** Workers Builds auto-deploys the default artifact on merge (`docs/deployment.md:168-181`). Every default-build change in this plan is therefore a production change and stays an unmerged PR until the owner merges it.
13. **Most emitted properties cannot carry a binding.** dspack-emit types every mapped design-system property as a static string, number or boolean (`dspack-emit/src/transform/mapping.ts:245-248`); only a mapping's structural slots are dynamic. On Astryx that leaves `Text.text`, `TextField.value`, `Dialog.title`, child lists and actions. Button, badge and selectable-card labels, alert-dialog text, metadata items and table data are static **[upstream][code]**.
14. **Rules are judged on literal surfaces.** `rule.review-offers-alternatives` requires at least two selectable cards in a list, and `rule.review-presents-options` requires list, selectable card and button for that purpose (`packages/contracts/astryx.dspack.json`). A data-bound list could pass the gate with two literal children and render one or none at run time, unchecked. A loading or empty state cannot pass under the purpose of its ready state at all. Binding first would quietly move correctness outside governance **[code]**.

### A5. Root causes

| Root cause | Produces |
|---|---|
| **The contract ceiling was treated as a product ceiling.** dspack rightly excludes bindings and actions; no other layer was given ownership of them, so they were synthesised (emit profile), hand-written (agent scenarios) or dropped (Composer). | Concerns 4, 5, 6; findings 4, 5 |
| **Intent routing stands in for task understanding.** The only inference step answers "which governance context?", never "what must this interface let the user do, with what data?". | Concerns 3, 8; finding 3 |
| **Correctness is defined only against the design system.** A surface can be fully governed and irrelevant. Nothing declares what a task requires, so nothing can check it deterministically. | Concern 3; findings 1, 2 |
| **The UI was built "over seams that already exist"** (`ARCHITECTURE.md:13`). That kept the pipeline honest and made the navigation a pipeline diagram. | Concerns 1, 2, 9, 10 |
| **Two product lineages never merged.** The exhibit shows live interaction without authoring; Composer shows authoring without interaction. | Concern 6; finding 4 |
| **Hosted schema size.** Full-vocabulary generation cannot use constrained decoding and spends 79 to 90% of input tokens on schema text **[doc]**. | Concern 8; cost |

### A6. Strengths to preserve and assets to reuse

Preserve without change: invariants 1 to 8 of `ARCHITECTURE.md` §8; S1/S2/S3 and A1/A2/A3; derived catalogs; base-plus-delta immutability and `check-sync`; the fidelity and casualty reporting; the fail-closed import and accept gates; the pre-registered evaluation method (ADR-B3); per-request dollar ceilings; the scripted no-model path; the experimental-build isolation. Invariant 9 and the §9 non-goals are evolved explicitly (D2).

| Need in the new product | Existing asset to reuse | Location |
|---|---|---|
| Composition definition, parameters, expansion | Block sidecar schema, call validation, pure expander, B0/B1/B2 | `packages/composer-core/src/blocks/{schema,call,expand}.ts` |
| Semantic discovery | `selectBlockDeterministic`, `eligibleBlocks`, planner block question | `blocks/select.ts`, `apps/composer/experimental/blocks-runtime.ts` |
| Verifying a composition instance | Provenance and re-expansion verdict (`expansionDigest`) | `blocks/provenance.ts`, `blocks/manifest.ts` |
| Action declaration and safety | H1 literal-only action ids, B2 subset check, action manifest | `blocks/actions.ts`, `blocks/manifest.ts`, `docs/blocks/HOST-ACTIONS.md` |
| Rendering data and actions | `A2uiCanvas` with `onAction`; `buildComponentApi` maps DynamicString, ChildList, Action, CheckRule | `packages/a2ui-ingest/src/` |
| Session recording, timeline, data-model and action inspectors | `createRecorder`, `dataModelAt`, `actionLifecyclesAt`, `a2uiMessagesAt`, fixtures | `packages/replay/src/` |
| Action lifecycle events | `STUDIO_EVENT` pending/accepted/rejected/failed; `a2uiDeliveryEvents` | `packages/agui-bridge/src/` |
| Deterministic simulated provider with fault injection | `fake:scripted` provider, `faultFor` | `packages/block-bench/live/` |
| Mock tool grounding | `resolveAction`, capability registry | `packages/scenarios/src/capabilities.ts` |
| Live evaluation with cost control | Harness, frozen corpora, parity checklists, ledgers, ceilings | `packages/block-bench/live/`, `acceptance/gateway-corpus/harness.mjs` |
| Staged rollout | Experimental artifact, guards, Access-gated deploy, separate Playwright config | `apps/composer/experimental/`, `lib/experimental-guard*.mjs` |
| Stateful flows | Reserved `on:[{event,to}]`, `flowLint`, `emittedActionNames` | `packages/composer-core/src/flows.ts` |
| Agent-facing validation | ds-mcp `validate-ui`, `get-generation-context` | `ds-mcp/src/tools/` |
| Onboarding an organisation's design system | dspack-export discovery, ledger merge, Repository view | `apps/agent/src/project.ts`, `dspack-export` |

---

## B. Target product strategy

### B1. Positioning

**Composer: design for agents, not just screens.** A design environment for governed generative interfaces: author compositions from your design system, define what data and actions they carry, test how they behave with an agent, and publish them as artifacts any agent can instantiate.

Where it sits: Storybook documents components for people who write code. Agent frameworks and A2UI renderers run interfaces. Composer is the stage between, where a team decides what an agent may assemble and proves it behaves. It complements A2UI, AG-UI, CopilotKit and design-system tooling; it replaces none of them.

### B2. Users and jobs

| User | Job | What they need from Composer |
|---|---|---|
| Design-system team | Decide what agents may build with our system | Rules with rationale, vocabulary coverage, impact of a rule change on published compositions |
| Product designer, design engineer | Design an agent-driven task once and have every agent render it consistently | Describe, generate, adjust; define data and actions without writing protocol JSON; try the empty, error and slow cases |
| AI platform or agent engineer | Give our agents approved UI and catch violations before users do | A versioned package, MCP tools, a validator for CI, message examples |
| Design lead, reviewer | Approve what ships | Draft and approved status, a readable validation report, a diff between versions (later) |

### B3. Differentiation

| Alternative | What it does | What Composer adds |
|---|---|---|
| A2UI Composer (upstream tool) | Chat to build an A2UI widget from the basic catalog, copy the JSON | Your design system as the vocabulary; owner-authored rules; deterministic validation; data and action contracts; interaction testing; versioned publishing |
| Agent frameworks with generative UI (CopilotKit, AG-UI middleware, json-render) | Render what the model emits at run time | Decide beforehand what may be emitted, and verify it afterwards with the same gates |
| Storybook and design-system docs | Show components and states to humans | Machine-readable compositions and governance an agent can discover and a gate can enforce |
| Prompt libraries, UI templates | Static snippets | Parameterised, data-bound, validated, and still open to novel generation |

The defensible core is the combination no neighbour has: deterministic governance bound to a real design system, plus a contract for data and actions, plus evidence (reports, receipts, reproducible evaluation).

### B4. Recommended terminology

One name per thing. The left column is what users see; internal names in code and docs may stay.

| Use | For | Replaces on screen |
|---|---|---|
| **Design system** | Components, rules and how they map to protocols | reference, contract, profile, registry |
| **Component** | One approved building block | catalog entry |
| **Composition** | A reusable, named arrangement with parameters, data and actions | interface block; (new for most users) |
| **Surface** | One composition, or one free-form generation, filled in for a moment | example surface, worked example, accepted surface, `ex.*` |
| **Flow** | Surfaces connected by actions with shared task state | flow (kept; now stateful) |
| **Purpose** | What a surface is for (selects rules) | intent, governed context |
| **Rules** | What the design system requires, with reasons | governance |
| **Validation** | The result of checking; gate codes live one level down | checks, gates, S1/A3 |
| **Data** and **Actions** | What a composition needs and what it can ask an agent to do | (new) |
| **Scenario** | A named set of sample data and simulated responses | (new) |
| **Package** | The published, versioned output | catalog export, project export |
| **Not representable in A2UI** | A component the protocol mapping cannot express | casualty |
| **Sample project** | Read-only starter | example |
| **Demo replay** | The no-model mode | scripted |
| **Composer bridge** | The local companion process for files and local models | local agent (frees "agent" to mean the AI consuming the UI) |

### B5. Core journeys

1. **First five minutes.** Open, pick a sample design system, describe a task or pick a suggested one, watch a plan appear, see a working surface with sample data, press its button and watch the simulated agent respond. No setup, no protocol terms.
2. **Author a composition.** Describe, generate, adjust parameters, confirm data fields and actions, check states, save as draft, approve.
3. **Build a flow.** Describe a multi-step task, edit the proposed plan (stages, data, actions, confirmations), reuse or generate a composition per stage, run it under several scenarios.
4. **Publish.** Choose compositions and flows, read the validation and compatibility report, download a package or point an agent at it through MCP.
5. **Consume (agent engineer).** Load the package, discover a composition by purpose, instantiate it with data, validate, send A2UI messages; or generate a novel surface and validate it against the same rules.
6. **Govern (design-system team).** Connect a repository, author rules, see which compositions each rule touches.

### B6. Scope

**Near term (this plan):** compositions with data, actions, states and scenarios; a stateful flow model; a simulated playground; a portable package and MCP access; a simpler shell; one complete vertical (hotel reservation) and one contrasting enterprise scenario.

**Future, designed for but not built:** shared libraries across projects, review and approval workflow, version diffs and regression across agents, private catalogs, organisation accounts, hosted collaboration, billing. The package format and stable ids are the seams these attach to. None is started without separate authorization.

**Explicitly not Composer's job:** real tool execution, authorization, business logic, production data access, workflow automation. Composer simulates and publishes contracts; hosts and agents act.

---

## C. Target architecture

### C1. Today and proposed

Today:

```
request ─► plan: one purpose ─► dspack-gen runPipeline ───────────────► dspack-emit ─► A2UI 0.9.1
           composer-core        schema · model · S1 S2 S3 · repair ≤2    A1 A2 A3       createSurface
                                         │                                              updateComponents
                                         ▼                                                   │
                               literal surface tree,                                         ▼
                               saved as a contract example ─► flow: ordered list     canvas: actions logged,
                                                                                     then dropped
                                                              export: catalog + static messages

Studio exhibit (separate app): canvas ─ action ─► local agent; bindings hand-written per scenario
```

Proposed (new parts marked ＋):

```
┌──────────────────────────────── project ─────────────────────────────────────────────┐
│ design system: dspack contract + protocol mapping            unchanged, immutable    │
│ ＋ interaction contract: data types, action declarations      owner-authored          │
│ ＋ compositions (block sidecar 0.2) · flows with state · scenarios                    │
└───────────────────────────────────────────────────────────────────────────────────────┘
Authoring
request ─► ＋Understand ─► ＋Retrieve ─► Structure ────────► ＋Wire ───────────► composition (draft → approved)
           task plan,      discover a    runPipeline or      small closed
           plan checks     composition   composition fill;   proposal; must
                           or "novel"    S1 S2 S3, repair    re-expand exactly

Every instance, in Composer, the Playground and an external agent alike
composition + parameters + state + data ─► ＋expand ─► S1 S2 S3 ─► dspack-emit ─► ＋bind where safe ─► A2UI messages
                                           pure         unchanged   A1 A2 A3       ＋I0 I1 I2 I3
                                              │                                         │
                    ┌─────────────────────────┼─────────────────────────────────────────┤
                    ▼                         ▼                                         ▼
            Compose canvas             ＋Playground                              ＋Package ─► ds-mcp tools,
            design / preview           simulated agent ◄─► session canvas                    independent host
```

### C2. Composition model

A composition is the block definition plus the additions marked ＋, which are new in sidecar 0.2; the rest exist today (`packages/composer-core/src/blocks/schema.ts`).

| Field | Purpose | Brief's requirement |
|---|---|---|
| `id`, `version`, `status` | Stable identity, integer version, draft or approved | Identifiers and versioning |
| `name`, `summary`, `intents`, `keywords` | Discovery by purpose | Semantic intent |
| ＋ `useWhen`, `avoidWhen` | Guidance an agent reads before choosing | Appropriate and inappropriate use |
| `props` (closed six-type signature), `constraints` | What a caller may configure; a model may fill these | Configurable parameters |
| ＋ `data` | Named inputs in the same closed type language, with bounds and `sensitive` marks; supplied by a host or scenario, never by a model | Data requirements and schemas |
| ＋ `actions` as declarations: name (still derived from the node id, as H1 requires), kind (navigate, query, mutation), flat typed payload, `consequential` | What the surface can ask of an agent | Declared actions and payloads |
| ＋ `states`: each state names its purpose | Each state is an ordinary expansion checked by S1 to S3 under its own purpose | Interaction states and variants |
| `template` (closed language) with three ＋ directives: read a data value, repeat over a data array, payload on an action node | Expands, from parameters, state and data, to a plain `dspackSurface` 0.1 | Compiles to catalog components; data bindings |
| ＋ `scenarios` | Parameter and data sets: the composition's examples and test fixtures | Example instances |
| `notes`, ＋ accessibility requirements | What the design system cannot express; required names and roles | Accessibility, fidelity |
| Computed at publish: component and composition dependencies, protocol and renderer compatibility, which values are bound and which expanded, contract and interaction-contract hashes | | Dependencies, compatibility metadata |

Sketch (illustrative, trimmed):

```jsonc
{ "id": "hotel-results", "version": 1, "status": "draft",
  "summary": "Options returned by a search, compared on stated attributes, one chosen.",
  "useWhen": ["a search returned two or more comparable options"],
  "props":  [ { "name": "title", "type": "string", "maxLength": 80, "required": true } ],
  "data":   [ { "name": "hotels", "type": "array", "minItems": 2, "maxItems": 20,
                "items": { "type": "object", "props": [ "id", "name", "facts" ] } } ],
  "states": { "ready": { "intent": "transactional-review" }, "empty": { "intent": "status-feedback" } },
  "actions": [ { "name": "results_choose", "kind": "navigate",
                 "payload": [ { "name": "hotelId", "type": "string", "maxLength": 40 } ] } ],
  "template": { "component": "card", "id": "results", "children": [
    { "component": "text", "id": "results-title", "text": { "$prop": "title" } },
    { "component": "list", "id": "results-list", "children": [
      { "$each": { "$data": "hotels" }, "as": "h", "children": [
        { "component": "selectable-card", "props": { "label": { "$data": "h.name" } } },
        { "component": "button", "id": "results-choose", "props": { "label": "Choose" },
          "context": { "hotelId": { "$data": "h.id" } } } ] } ] } ] },
  "scenarios": ["three-results", "two-results", "no-availability", "search-error"] }
```

The data and payload directives live in the composition's template language, which Composer owns, not in the `dspackSurface` format, which stays at 0.1.

How the objects relate:

- **Worked example**: unchanged, a literal surface used as generation context. "Promote to composition" proposes a template and a call for it. Acceptance is deterministic: re-expanding the proposal must reproduce the saved surface byte for byte, the same test provenance uses today.
- **Surface**: either a free-form generated tree (as today) or a composition instance, stored as composition id, version, parameters, state and data reference.
- **Flow**: steps reference compositions; a flow marked stateful has its reserved `on:[{event,to}]` transitions executed in the Playground; a declared task-state schema carries data between steps; guards use the closed forms block constraints already use. Flows without the mark behave exactly as today.
- **Composition as an A2UI component**: never. A composition expands into catalog components. A2UI's own agent SDK does the same with server-side macros that expand before anything goes on the wire, and its roadmap lists a runtime templating engine as planned, not shipped **[upstream]**.
- **Not a template library**: novel generation remains the default path when discovery finds nothing suitable, and it is validated by the same gates. Compositions make reuse cheap; they do not close the vocabulary.

### C3. Data-binding and action lifecycle

The governing choice: **an instance is an expansion, and every expansion is checked.** Binding is an optimisation applied where it cannot change what the rules see.

1. **Declare.** The project's interaction contract lists data types (in the closed type language block signatures already use) and actions with flat typed payloads. People write it; a model may propose entries, which a person accepts.
2. **Instantiate.** `expand(template, parameters, state, data)` produces a `dspackSurface` 0.1. It is a pure function: the same inputs give the same bytes. This is what "instantiate a composition with task data" means, in Composer and for an external agent.
3. **Govern.** S1, S2 and S3 run on that instance, under the purpose its state names. Data that would break a rule (one result where the design system requires two alternatives) is refused here with the rule's own rationale, and the flow routes to another state.
4. **Emit.** dspack-emit produces `createSurface` and `updateComponents`. A1, A2 and A3 run unchanged. Composer passes a unique `surfaceId`.
5. **Bind where it is safe.** Values that must stay live in the renderer become bindings: entered values (`TextField.value`), action payload references, and text marked volatile. The compiler finds them by tracing, not by id arithmetic: expand once with a unique marker per data read, emit with the real emitter, and rewrite a marker to a path only where it lands whole on a property the catalog types as dynamic. A marker that was value-mapped, embedded or dropped is refused with the loss named. Check I0 then confirms that the bound messages, resolved against the data, equal the plain expansion. Template child lists are used only where the declared data bounds already satisfy the rules.
6. **Render.** The renderer resolves bindings. Inputs write to the renderer's local model. Per the A2UI specification this is local: "User inputs … do not automatically trigger network requests to the agent" **[upstream]**.
7. **Act.** On a user action the renderer resolves the payload and sends `action{name, surfaceId, sourceComponentId, timestamp, context}`.
8. **Check.** The receiver (simulator now, a host later) validates the name and payload against the declaration. Unknown or malformed actions are rejected and shown, never ignored.
9. **Respond.** For a data or state change the agent re-instantiates (steps 2 to 4, no model call) and sends only the components that changed, which stable ids make possible, plus `updateDataModel` for bound values. A stage change is `createSurface` and `deleteSurface`. Task state lives in the flow, so going back does not lose it.

**After the first render** (owner's condition on D4). A surface that passed the gates must not be changed into one that would fail them. Three rules make that true by construction, and each has negative tests in M1 and M2.

- **A bound value is one no rule reads.** A property may be bound only if the catalog types it as dynamic and no rule that applies to any state of the composition reads that property, the node's text or the number of its children. This is checked at load for every state. An `updateDataModel` to a bound path therefore cannot change any rule's verdict.
- **Everything else changes only by re-instantiation.** The new data is expanded and checked by S1 to S3 before anything is sent. If it fails, the update is refused with the rule's rationale, the previous surface stays, and the flow may route to another state.
- **The runtime accepts two kinds of change and nothing else:** a typed, in-bounds write to a bound path, or a re-instantiation. A scenario or agent event that carries raw component messages, an undeclared path, a wrong type, a list length outside its declared bounds, or a sensitive field is refused and shown.

The runtime tests assert, at every step of every recorded walk, that the rendered surface equals a governed expansion of the data at that moment (I0 holds throughout, not only at first render).

The limit, stated honestly: Composer cannot stop a third-party agent from sending arbitrary messages to its own host. The published package gives that agent the same instantiate and validate functions and says which paths may be written directly; using them is the host's responsibility, as authorizing actions already is.

Consequences worth stating plainly:

- "Different data, same composition, no hardcoded content" is met by step 2: one definition, any data, every result governed. It is not met by a frozen component tree with swapped data, because the rules would not see the swap.
- How much can be bound depends on the design system's protocol mapping. On Astryx today it is little (A4 item 13). Widening it is an upstream change to dspack-emit (dynamic kinds for mapped properties), proposed in C8 with this evidence.
- Every construct in steps 4 to 9 is in the part of A2UI that is identical in 0.9.1 and 1.0, except the binding spelling (`path` versus `@path`), so bindings are reported as verified for 0.9.1 only until 1.0 emission exists. Composition metadata is an Aesthetic Function extension and is labelled as such everywhere it is published.

### C4. Agent interaction architecture

The Playground is a simulator, not a workflow engine.

| Part | What it is | Built from |
|---|---|---|
| Simulated agent | A pure step function: (state, event) to new state, A2UI messages and a log. Linting and emission are injected, as the block phase already does (`blocks/phase.ts:70-85`). Deterministic clock and ids; no network, no code execution. | New `packages/composer-core/src/playground/` |
| Scenario | Sample data, a table of simulated tool responses per action (match, result or error, delay), and injectable agent events | New, stored with the project |
| Canvas | A session mode: one long-lived message processor that applies only new messages, so typed input survives agent updates. `processMessages` is incremental by design upstream; whether the pinned 0.10 behaves so is the milestone's first spike, with the renderer upgrade as fallback. Replay mode stays the default. | `packages/a2ui-ingest/src/A2uiCanvas.tsx` |
| Template children, input checks | Template items arrive as `{id, basePath}` pairs; today they are dropped. Render them, or refuse them visibly where a renderer cannot (tables). | `a2ui-ingest/src/provenance.tsx` and each renderer's child mapping |
| Recorder and inspectors | Timeline, action lifecycle, raw messages from the replay reducers; the data view reads the processor's own model, because the replay reducer's data model differs from the renderer's (`packages/replay/src/player.ts:217-233`) | `packages/replay`, `packages/agui-bridge` (`a2uiDeliveryEvents`, `STUDIO_EVENT`) |
| Sessions | Exported in the existing replay fixture format, so a recording is a regression test | `createRecorder`, `replayFixture: "0.1"` |

Boundaries: transitions and guards are a closed data language; simulated tools return declared fixtures only; consequential actions must pass a confirmation step; the banner always says simulated. A live mode through the Composer bridge is a later, separately authorized step (D7). The exhibit's hand-written scenario code is retired once the same scenarios run from declared wiring.

### C5. Generation pipeline

| Stage | Today | Proposed | Check that decides |
|---|---|---|---|
| Understand | One purpose chosen; user toggles surface or flow | A typed task plan: stages, data entities, actions, decision points, confirmation boundaries, required states, and per stage "reuse this composition" or "novel". The plan chooses single composition, several, or a flow. Editable before anything builds. | Plan checks: every input a stage needs is produced earlier or declared external; every consequential action has a confirmation step; data-dependent stages declare loading, empty and error; per-stage capability gaps are named |
| Retrieve | Same-purpose examples, all of them, verbatim | Composition discovery by purpose and keywords (deterministic first); relevant examples only | Eligibility as today (`eligibleBlocks`) |
| Scope | Full vocabulary in every request | A per-stage vocabulary view for generation | Validation always uses the full contract |
| Structure | `runPipeline`, or a block fill in the beta | Unchanged machinery; each stage receives shared data types, action names and summaries of earlier stages | S1 S2 S3, bounded repair, emit refusals as repair input |
| Wire | Absent | For a novel composition, a second, small proposal whose schema is closed: which values in the generated surface are data reads (paths enumerated from the data types) and what each action sends (names enumerated from the declarations) | Re-expansion equals the generated surface; I0 to I3 |
| Compile | dspack-emit | dspack-emit, then traced bindings | A1 A2 A3, catalog re-validation |

Why two proposals: the wiring schema is a set of enumerations, small enough that constrained decoding may be possible where the full surface schema is not (A4 item 7) **[inferred; to be measured]**. It also keeps the rule that a model never coins an action name.

Model evaluation: Milestone 0 measures the current pipeline; Milestone 1 compares an economical model against a stronger planning model on the same prompts (D9). Failures are classified with the harness's existing categories (provider, gate, emit refusal, vocabulary gap, renderer), extended with plan, wiring and interaction-gate failures.

Demo replay is fixed in Milestone 0 so a replay is never presented, or saved, as the answer to a typed request.

### C6. Validation and emission strategy

| Gate | Checks | Owner today | Change |
|---|---|---|---|
| S1 S2 S3 | Structure, vocabulary and containment, design-system rules | dspack-gen | None |
| A1 A2 A3 | Catalog compiles, catalog shape, instances | dspack-emit | None; A3-style validation is also run on overlaid messages |
| B0 B1 B2, H1 | Sidecar load, call bounds, constraints, action ids from literals only | composer-core | Extended to sidecar 0.2. H1 is unchanged (names still come from node ids). The manifest's "empty context" becomes "context matches the declared payload". 0.1 sidecars are upcast in memory, never rewritten, and the Phase 1B goldens must still reproduce byte for byte. |
| ＋ Plan checks | Data flow closure, confirmation boundaries, required states | composer-core | New |
| ＋ I0 equivalence | Bound messages, resolved against the data, equal the plain expansion's messages | composer-core | New |
| ＋ I1 bindings | A binding only on a property the catalog types as dynamic; every path resolves in the declared data; sensitive fields never in a payload; the whole data model is never relayed (`sendDataModel` stays off) | composer-core | New |
| ＋ I2 actions | Only declared actions; payload flat and matching its declaration; no model-written names | composer-core | New; generalises B2 |
| ＋ I3 completeness | Every required input has a control; every declared action is reachable; every flow step is reachable; consequential actions are confirmed | composer-core | New |
| ＋ Rule coverage | A value is bound only if no applicable rule reads it; a data-driven list is bound only when its declared bounds imply the rules; otherwise it is expanded and checked | composer-core | New |
| ＋ Update integrity | After first render: only typed, in-bounds writes to bound paths, or a re-instantiation that passes S1 to S3; anything else is refused and the previous surface stays | composer-core (runtime) | New |

Rules that hold: a model never edits the rules or contracts its output is judged by; reduced context is for generation only; a data read that did not survive emission is a refusal with a reason, not a silent drop; anything the protocol mapping or renderer cannot do is listed in the compatibility report.

### C7. Publishing

A package is a directory (or archive) that needs nothing from Composer to use:

```
manifest.json            name, version, contract hash, per-file sha256, protocol versions, dependencies
contract.dspack.json     the authoritative design-system contract
mapping.profile.json     protocol mapping
catalogs/                a2ui 0.9.1 catalog; 1.0 catalog (marked catalog-only until surface emission lands)
interaction.json         data types and action declarations                    [AF extension]
compositions/*.json      composition definitions                               [AF extension]
flows/*.json             flows with state and transitions                      [AF extension]
examples/<id>/<scenario>.jsonl   validated A2UI message streams, one per scenario
AGENTS.md                when to use what, in prose an agent can read
reports/validation.json, compatibility.json   gates, fidelity notes, renderer coverage, unsupported capabilities
```

The manifest generalises the existing action manifest and its `messagesSha256`. It is unsigned; the report says so.

What an agent does, and with what:

| Agent step | Through | Exists today? |
|---|---|---|
| Discover a composition by purpose | ds-mcp `search-compositions` | New tool |
| Understand use, data, actions | ds-mcp `get-composition`; `AGENTS.md` | New tool |
| Get approved vocabulary and rules | ds-mcp `get-generation-context`, `get-component`, `list-components` | Yes |
| Instantiate with data | ds-mcp `instantiate-composition`: expand, check S1 to S3, emit, return validated messages or the refusal | New tool; needs expansion in dspack-gen core and dspack-emit as a dependency |
| Adapt within constraints | Change parameters or state, re-instantiate | Same tool |
| Generate a novel surface | The agent's own model with `get-generation-context` | Yes (ds-mcp deliberately has no generate tool) |
| Validate | ds-mcp `validate-ui`, extended with interaction gates | Partly |
| Emit A2UI messages | ds-mcp `compile-a2ui` | New tool |

Independent verification is claimed level by level, and only the level actually demonstrated is claimed:

| Level | What is shown | When |
|---|---|---|
| 1. Protocol validity | The A2UI repository's validator suites, run with its Python `a2ui-core` (a separate implementation from the TypeScript renderer Composer uses), accept the catalog and messages | M0 for today's output; M1 spike for a composition |
| 2. Independent rendering | A standalone host built on an unmodified upstream A2UI renderer release, outside `apps/composer`, renders the messages from exported files alone | M1 spike |
| 3. Package portability | An in-repository reader, sharing no Composer application state, loads a package and instantiates from it | M3. This is a fallback and a test aid. It is **not** independent agent consumption and is never reported as such |
| 4. Independent agent consumption | An agent that imports nothing from this repository discovers, instantiates, validates and emits through published ds-mcp tools | M3, only once the ds-mcp work is approved and released. Until then the brief's external-agent criterion stays open |

A constraint on level 2 that follows from the product's own principle: a catalog derived from a design system can only be drawn by a host that has that design system's components. Astryx is a React library, so a stock Lit or Flutter shell cannot draw the Astryx catalog. The spike therefore uses an upstream React renderer with the Astryx renderer package and nothing else from Composer, says so, and investigates (without building) whether a basic-catalog fallback mapping would let any stock host draw a plainer version.

### C8. Cross-repository responsibilities

| Repository | Unchanged role | Proposed addition (each a separate approval, D12) | Breaking? |
|---|---|---|---|
| dspack | Contract, vocabulary, S1 to S3 definitions | Compositions RFC, superseding the blocks RFC draft; later a ratified section. A design question to settle with evidence: how rules apply to data-bound collections. Purposes for status and loading surfaces on Astryx (D5) | Additive: consumers ignore unknown top-level keys |
| dspack-export | Discovery and extraction | None | No |
| dspack-gen | Generation, linting, repair | A vocabulary-scope option; export the generation views Composer mirrors today (dspack-gen#48); composition expansion in `./core` | Additive |
| dspack-emit | Catalogs, emission, A1 to A3 | Dynamic kinds for mapped properties, so labels and similar content can be bound; an id map on the emit result; native emission of bindings and action payloads; A2UI 1.0 surface messages with final-1.0 definitions and catalog `protocolVersion` | Additive API; message bytes change only for surfaces that use the new constructs |
| ds-mcp | Contract as tools | Tools in C7; dspack-emit dependency; publish the unreleased re-vendor | Additive |
| dspack-studio | Authoring, testing, rendering, publishing | Everything in Milestones 0 to 2 without sibling changes | Additive, behind the experimental build |

Until an upstream change is approved and released, Composer carries the capability in `composer-core`, as it did for blocks, with a parity test and a removal note.

### C9. Compatibility and migration

- **Projects.** `composerProject` 0.1 and `.composerproject.json` 0.1 keep loading. New keys are optional; the export version moves to 0.2 and the reader accepts both. Import stays fail-closed.
- **No silent loss in the default build.** Today unknown project keys and unknown flow-step keys are dropped on read (`apps/composer/app/project-portability.ts:33-41`; both flow parsers). So the new shapes ship in the default build, carried through import, save and export untouched, while the behaviour stays in the experimental build. Otherwise opening a newer project in the default build would erase compositions and flow state.
- **Sidecars and provenance.** 0.1 sidecars and v1 provenance remain valid; the loader dispatches on version and upcasts in memory. New provenance is v2, adding the interaction-contract hash and the scenario.
- **Flows.** Stored flows run unchanged. Stateful execution is opt-in per flow and happens only in the Playground. Preview's linear walk, and the tests that promise `on` is not executed there (`flows.test.ts` in both packages), stay as they are.
- **Storage.** D14's migration keeps the old keys until verified.
- **Default export.** The current catalog export stays byte-identical (held by `apps/composer/app/catalog-export.test.ts` and `e2e/composer-prod-smoke.spec.ts`) until Publish replaces it at the public cutover after M5, where those tests change deliberately.
- **Corpus.** The twelve prompts are untouched. The hotel prompt, its paraphrases and adversarial cases are additions in a separate corpus directory.
- **Rollback.** New work ships in the experimental artifact; rollback is a redeploy of the previous version by the existing procedure. Because additions are optional keys, older builds still open newer project files minus the new objects.

### C10. Alternatives considered

| Question | Options | Choice and reason |
|---|---|---|
| Composition object | Evolve blocks; new schema; parameterise examples | Evolve blocks (D1) |
| How data reaches a surface | (a) expand and govern every instance, bind only where safe; (b) bind first: a fixed component tree plus a data model | (a). (b) is cheaper at run time but moves content past the rules (A4 item 14) and is barely expressible on today's mappings (item 13). |
| Where wiring is written | (a) directives in the composition template, compiled by tracing; (b) a hand-authored overlay keyed on node ids; (c) a new `dspackSurface` 0.2; (d) the emit profile; (e) json-render's state model internally | (a). (b) fails on emitter id renaming, synthesised wrappers and consumed nodes; the emitter's fidelity entries are not an address map. (c) is the likely end state but breaks the surface schema across four repositories and reopens a scope decision the spec reserves; (a)'s directives are what it would standardise. (d) is right only for capability (which properties are dynamic), since a profile is per design system and wiring is per composition. (e) would make one protocol's model the internal truth; json-render remains an emit target. |
| Interaction contract home | Project; dspack contract | Project (D3) |
| Runtime | Generalise the exhibit loop in the browser; build on the local agent; adopt an agent framework | Browser simulator: deterministic, zero-install, CI-friendly. The bridge and AG-UI serve the later live mode. |
| Task-fit check | Deterministic completeness; model as gate | Deterministic (D16) |
| Protocol | 0.9.1 only; shared core then 1.0; 1.0 first | Shared core then 1.0 (D6) |
| Redesign timing | After all model work; progressively in the experimental build | Progressively (D11) |

---

## D. UX/UI proposal

### D.1 Current experience, as audited on the live site

| Area | Observation | Tag |
|---|---|---|
| First run | Strong headline and honest scope note. Two paragraphs precede any action; the form asks for a name, description and design system before the user has seen anything; sample projects sit below the fold. No model is available, and the page does not say so until Settings. | live |
| Project creation | Three clear design-system cards. 2.8 s from "Create & build" to the Build view. "Connect a repository" needs a terminal command, explained only after the click. | live |
| Navigation | Ten items in the bar with a project open (seven workspace destinations, Projects, Export, Settings), wrapping to two rows at 1440 px. No URLs, so reload and Back lose the view. A project chip shows name and source well. | live |
| Terminology | See A3 rows 1 and 2. | live |
| Authoring | A single-line input with "e.g." placeholder text and no suggestions. Provider and "Context" selects sit beside the prompt at equal weight. "Build a flow…" is a mode switch a user finds only by reading. Results append to a vertical log; the canvas is one item in that log. | live |
| Refinement | "Refine" sits next to "Build"; which turn it refines is implicit. Open issues #41, #43 and #44 record dead ends after failed turns and failures shown without reasons. | live, doc |
| Discovery | Surfaces are chips labelled with truncated prompts and ids. No search, thumbnails or grouping. Blocks appear only as a table inside Catalog in the experimental build. | live, code |
| Canvas and preview | White canvas inside dark chrome separates work from tool clearly. Renderer switch and light/dark work. Pressing a button in the canvas produces one line of text, "actions dispatched". | live, code |
| Flow view | A strip of truncated uppercase step titles with Prev and Next. Wiring a step means typing action names into "advance on". | live, code |
| Data and action inspection | None. | live |
| Errors and recovery | Refusals are honest and specific ("Your current catalog can't express this yet"). Emit notes are disclosed, in emitter language. | live, code |
| Rules | Every rule shows its rationale: a real strength. Lists are long and flat; edits in a browser project do not survive reload. | live, code |
| AI configuration | "How AI runs" is clear about where keys live. Local models require running a second process. | live |
| Publishing | Two unrelated exports (A3 row 9). | live |
| Accessibility | Visible 2 px focus rings; polite live regions for status. No headings in workspace views, no `aria-current`, no skip link. | live |
| Responsive | Hub, Build and Preview reflow at 390 px; the navigation consumes the first screen; Checks overflows sideways (415 px content). | live |
| Performance | 2.6 s to network idle on first load. Scripted build 0.2 s. Recorded hosted median about 5.9 s per Astryx build. | live, doc |
| Visual | Distinctive identity (dark ground, condensed display caps, mono labels, one green accent). Uppercase mono is used for navigation, buttons, labels and ids alike, which flattens hierarchy and slows scanning. | live |

### D.2 Information architecture

The brief's four experiences are the right spine. Three adjustments follow from the audit.

1. **Design system stays visible as a secondary destination**, not a setting. It is one persona's home and the product's differentiator. Components, Rules, Protocol mapping and Source (repository sync) become its tabs.
2. **Validation becomes a status, not a place.** A health chip in the header opens a drawer of findings grouped by object. The raw gate table moves under "Details" and into the Publish report.
3. **Flows are not a destination.** A flow is the outline in Compose and the thing you run in Playground; Library lists it beside compositions.

| Today | New home |
|---|---|
| Projects | Home |
| Build | Compose: conversation |
| Surfaces | Compose canvas (editing) and Library: Saved surfaces |
| Preview | Compose canvas preview mode; Playground |
| Flows | Compose outline; Playground |
| Catalog | Design system: Components. The blocks table becomes Library: Compositions |
| Governance | Design system: Rules; "Rules that apply" in the Compose inspector |
| Checks | Validation chip and drawer; Publish report |
| Repository | Design system: Source |
| Export, Export catalog | Publish |
| Settings | Settings (AI, appearance, experimental) |

Routing: hash routes such as `#/p/<project>/compose/<composition>` work with the static export; the exhibit already uses hash permalinks (`e2e/hotel-reservations.spec.ts`).

### D.3 Onboarding

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◧ COMPOSER                                                       Settings    │
├──────────────────────────────────────────────────────────────────────────────┤
│  Design for agents, not just screens.                                        │
│  Describe a task. Composer builds it from your design system, checks it,     │
│  and lets you try it with a simulated agent.                                 │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │ What should your agent help someone do?                            │      │
│  │ e.g. Book a hotel: search, compare, pick a room, review, confirm   │      │
│  └────────────────────────────────────────────────────────────────────┘      │
│  Design system: (•) Astryx sample  ( ) shadcn/ui sample  ( ) Bring your own  │
│                                                         [ Start composing ]  │
│  Try one:  [Hotel reservation]  [Support ticket triage]  [Confirm a delete]  │
│                                                                              │
│  ⚠ AI generation is not available on this site right now.                    │
│    Explore a finished sample, or connect a model in Settings.                │
│                                                                              │
│  Your projects ────────────────────────────   Sample projects ─────────────  │
│  Hotel reservation · Astryx · edited 2h ago   Astryx sample · shadcn sample  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- One question starts everything. The project is created from the request and can be renamed later.
- Model availability is stated before the user types. Without a model, the offer is a finished sample labelled as a sample; a typed request is never answered with a replay.
- Three contextual prompts follow the first result: "This is a composition", "Try it in Playground", "Publish it for your agent". Each can be dismissed; there is no modal tour.

### D.4 Compose: the authoring workspace

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◧ Hotel reservation ▾   Compose  Library  Playground  Publish     ● Valid   Design system  ⚙ │
├──────────────────────┬─────────────────────────────────────────────┬────────────────────────┤
│ CONVERSATION         │ 1 Search › 2 Results › 3 Rooms › 4 Review › 5 Confirm            [+] │
│                      ├─────────────────────────────────────────────┤ INSPECTOR              │
│ You                  │ Hotel search · draft v1    [ Design | Preview ]│ Search button        │
│ Create a hotel       │ Scenario: Chicago, 3 results ▾  State: ready ▾│ ──────────────────── │
│ reservation          │ ┌─────────────────────────────────────────┐ │ Action  search_hotels  │
│ experience where…    │ │ Find a hotel                            │ │ Sends   destination    │
│                      │ │ Destination [ Chicago               ]   │ │         checkIn        │
│ Composer             │ │ Check-in [2026-12-01] Check-out [12-03] │ │         checkOut       │
│ I planned 5 steps.   │ │ Guests   [ 2 ]                          │ │         guests         │
│ 2 reuse compositions │ │                           [ Search ]    │ │ Then    → 2 Results    │
│ from your library,   │ └─────────────────────────────────────────┘ │                        │
│ 3 are new.           │ ⓘ Dates are text fields: this design system │ Data                   │
│ [View plan] [Build]  │   has no date input yet.          [Details] │  query.destination text│
│ ┌──────────────────┐ │                                             │  query.checkIn    date │
│ │ Refine or ask…  ↵│ │                                             │ Rules (2 apply) ✓      │
│ └──────────────────┘ │                                             │ Details ▸              │
└──────────────────────┴─────────────────────────────────────────────┴────────────────────────┘
```

- **Conversation** holds the request, the editable plan and refinements. Provider and purpose overrides move behind "Details".
- **Outline** is the flow. A single composition has no outline.
- **Canvas** has two modes: Design (select an element, edit its content, data or action) and Preview (the composition filled with a scenario's data in a chosen state).
- **Inspector** follows the selection: what an element shows, what it sends, where it leads, which rules apply. Plain words first; protocol detail under "Details".
- Status and version sit on the canvas title: draft, approved, v-number.

### D.5 Library

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Library                  [ Search by purpose, e.g. "pick one option" ]   [+ New composition] │
│ Compositions (7)   Flows (2)   Saved surfaces (5)       Purpose ▾   Status ▾   Source ▾      │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐                 │
│ │ ▢ preview      │ │ ▢ preview      │ │ ▢ preview      │ │ ▢ preview      │                 │
│ │ Hotel search   │ │ Option compare │ │ Records table  │ │ Confirm action │                 │
│ │ Collect input  │ │ Review & choose│ │ Browse records │ │ Destructive    │                 │
│ │ v2 · Approved  │ │ v1 · Draft     │ │ v1 · Approved  │ │ v1 · Approved  │                 │
│ └────────────────┘ └────────────────┘ └────────────────┘ └────────────────┘                 │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ Hotel search v2 · Approved                                    [Open in Compose]  [Try it]   │
│ Use when    collecting search criteria before showing options.                              │
│ Avoid when  the options are already known (use Option compare).                             │
│ Parameters  title, submitLabel      Data  query {destination, checkIn, checkOut, guests}    │
│ Actions     search_hotels(query)    States  idle, invalid      Scenarios  3                 │
│ Works with  A2UI 0.9.1 ✓   Astryx renderer ✓   Wireframe ✓                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

Search is by purpose and keywords first (deterministic), which is also what an agent's discovery call will use. "Promote to composition" appears on any saved surface.

### D.6 Playground

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Playground · Hotel reservation       Scenario: No availability ▾     ▶ Restart    ⏺ Record  │
│ ▒▒ SIMULATED AGENT · sample data · nothing leaves this browser ▒▒                            │
├───────────────────────────────────────────────┬─────────────────────────────────────────────┤
│ WHAT THE USER SEES                            │ [ Timeline | Data | Actions | Messages ]    │
│ ┌───────────────────────────────────────────┐ │ 00.0 agent  show Hotel search               │
│ │ No hotels match those dates               │ │ 04.2 user   search_hotels                   │
│ │ Try different dates or a nearby area.     │ │             {destination:"Chicago",…} ✓     │
│ │                       [ Change search ]   │ │ 04.2 agent  results: loading                │
│ └───────────────────────────────────────────┘ │ 05.0 tool   searchHotels → 0 results (mock) │
│                                               │ 05.0 agent  set /results = []               │
│ Step 2 of 5 · Results · state: empty          │ 05.0 agent  show state "empty"              │
│ Back keeps: destination, dates, guests        │ ──────────────────────────────────────────  │
│                                               │ Task state                                  │
│                                               │  query     {destination:"Chicago",guests:2} │
│                                               │  results   []          selection  none      │
├───────────────────────────────────────────────┴─────────────────────────────────────────────┤
│ Agent sends an update:  [Price changed]  [Room sold out]  [Booking fails]      Speed 1× ▾   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

- The banner is permanent in simulated mode. A live mode, when added, replaces it with "Live agent" and the endpoint.
- **Timeline** is the plain-language record; **Messages** shows the actual A2UI messages and events for those who want the wire.
- Every user action shows whether its payload matched the declared schema.
- Scenarios are named sets of sample data and simulated responses: results, none, slow, failure. Recording saves a replayable session that doubles as a regression test.

### D.7 Publish

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Publish · Hotel reservation package   v0.3.0                                                │
├──────────────────────────────┬──────────────────────────────────────────────────────────────┤
│ 1 Choose                     │ Ready to publish: 5 compositions, 1 flow                     │
│  ☑ Hotel search v2           │ ✓ Meets design-system rules      ✓ Valid A2UI 0.9.1          │
│  ☑ Hotel results v1          │ ✓ Data and actions consistent    ⚠ A2UI 1.0: catalog only    │
│  ☑ Room picker v1            │ ⚠ 1 note: dates are text fields (no date component)          │
│  ☑ Reservation review v1     │ [ View full report ]                                         │
│  ☑ Booking result v1         ├──────────────────────────────────────────────────────────────┤
│  ☑ Flow: Hotel reservation   │ What an agent gets                                           │
│ 2 Check                      │  design-system contract · protocol mapping · A2UI catalogs   │
│ 3 Deliver                    │  5 compositions · data and action schemas · message examples │
│                              │  agent instructions · validation report · manifest (sha256)  │
│                              ├──────────────────────────────────────────────────────────────┤
│                              │ Deliver  [ Download package ]  [ Copy MCP config ]           │
│                              │ Test     [ Run independent host check ]   last run: passed   │
└──────────────────────────────┴──────────────────────────────────────────────────────────────┘
```

Publishing cannot proceed past a failed check; notes and unsupported capabilities are listed, never hidden. The project backup remains under the project menu as "Back up project".

### D.8 Rules and diagnostics in context

Three levels, each one click deeper:

1. **Outcome**: "Meets your design system's rules" or "2 things to fix", on the canvas title and header chip.
2. **Finding**: on the element, in the design system's own words (the rule's rationale), with "Fix" where a bounded repair applies.
3. **Evidence**: gate codes, attempts and repairs, token receipts, emitter notes, raw messages.

"Not representable in A2UI" appears where the component is used, with what was dropped. The full findings table and fidelity notes live in the validation drawer and the Publish report.

### D.9 Accessibility and interaction

- One `h1` per view and an `h2` per panel; `aria-current="page"` in navigation; a skip link; labelled regions for conversation, canvas and inspector.
- After a build, focus stays in the prompt and a polite live region announces the outcome in one sentence.
- Panels collapse and resize from the keyboard. Outline and Library grid use roving tabindex.
- Reflow to 320 px without sideways scrolling (SC 1.4.10): panels stack, tables scroll inside their own region.
- Design, Preview and Simulate are visually and programmatically distinct (label, banner, region name).
- Streaming respects reduced motion. Targets are at least 24 px.
- The existing axe suites extend to the new shell; the manual screen-reader packet (`docs/blocks/MANUAL-A11Y-PACKET.md`) gains the four experiences.

### D.10 Visual direction

Keep the identity and the stack. No framework migration; no replacement of the chrome's CSS system.

- Reuse the tokens in `apps/composer/app/globals.css` and the `af-*` classes in `af-ui.css`. As views are touched, collect the repeated patterns into a small documented set in `app/ui.tsx`: Button, Tabs, Panel, Chip, Drawer, Table, EmptyState.
- Reserve uppercase mono for eyebrows and ids. Navigation, buttons and titles move to sentence case.
- One primary action per view carries the accent.
- The canvas keeps its light ground inside dark chrome as the edit-versus-tool boundary.

### D.11 Workspace approaches to explore before committing (M0)

The wireframes in D.3 to D.7 are one arrangement, accepted as a direction for prototyping and not as a specification (D10). The Compose layout in D.4 is conversation-led. M0 builds clickable explorations of three approaches against the same hotel task, so they can be compared on what a person can actually do.

| Approach | Starting point | Likely strength | Likely weakness to test |
|---|---|---|---|
| A. Conversation-led | The request and its plan; the canvas follows | Lowest barrier for a first-time user; refinement is natural | Direct manipulation is indirect; data and actions can feel hidden behind chat |
| B. Canvas-led | The composition itself; select an element to edit content, data, action or state | Precise control for designers; data and actions are visible on the thing they belong to | A blank canvas is a poor start; needs strong generation entry points |
| C. Flow-led | The task as stages with transitions and task state; open a stage to edit it | Makes multi-step experiences and state legible; maps to how the Playground runs | Heavy for a single composition; risk of a diagramming tool |

The question to answer is whether these are separate modes or three views of one workspace: for example, one document with a conversation panel, a canvas and a flow outline, where the entry point decides which is prominent. My working hypothesis is the second, and the explorations are built to confirm or reject it.

Each exploration covers the same five moments: first run and onboarding, authoring a composition, refining it, testing it with a scenario, and publishing. Each is judged on the same criteria:

- Can a first-time user finish the task without protocol terms, and can they tell at each step what to do next?
- Is the difference between editing, previewing and simulating always evident?
- Are data, actions and states discoverable where they apply, without opening an advanced view?
- Is a rule finding shown where it occurs, in plain words, with the evidence one step deeper?
- Does everything work from the keyboard, with a sensible reading order and visible focus, and reflow at 320 px?
- Does the interaction model hold up for the second scenario (Convert Estimate to Project), not only the hotel one?

The outcome at R0 is a recommendation with the reasons, the weaknesses found in each approach, and what remains unresolved. Visual polish is deliberately limited: the explorations use the existing tokens and are meant to settle the interaction model, not the styling. Compose, Library, Playground and Publish remain the top-level experiences in all three, with Design system visible.

A clickable HTML prototype was outside this engagement's read-only scope; the wireframes above are its starting point.

---

## E. Implementation roadmap

### E1. Sequence, and what changed from the brief's draft

| Brief's phase | This plan | Change and reason |
|---|---|---|
| Phase 0 audit | This document, plus **M0 Baseline and trust fixes** (authorized) | No baseline could be measured read-only; the first-run failure is fixable now without new architecture |
| Phase 1 composition model | **M1 Composition model**, with an early interoperability spike | Proves one composition, several data sets, governance, emission and independent rendering before the Playground is committed to |
| Phase 2 playground | **M2 Playground and the hotel vertical** | Adds the second enterprise scenario and retires the exhibit's hand-written wiring |
| Phase 3 publishing | **M3 Publish and agent consumption** | Separates package portability from independent agent consumption (C7) |
| Phase 4 redesign | **M4 Release candidate** | The four experiences are built progressively in M1 to M3 inside the experimental build; M4 completes them as a release candidate. It does not change the public build |
| Phase 5 validation | **M5 Enterprise validation and release readiness** | Must pass before any public change |
| (none) | **Public cutover** | A separate, owner-approved step after M5 |
| (none) | **Track 2 Cross-repository** | Investigation and RFC drafts only (D12); any implementation is a separate approval |

Sizes are relative (S about 3 to 5 PRs, M about 6 to 10, L more than 10). No dates are proposed until M0 establishes pace. Only M0 is authorized.

### E2. Dependencies

```
Owner decision (F)
        │
        ▼
       M0 ──R0──► M1 ─R1a─ ─R1──► M2 ──R2──► M3 ──R3──► M4 ──R4──► M5 ──R5──► public cutover
   authorized      │  ▲                       ▲         release     validation     owner-approved
                   │  └ interoperability      │         candidate
                   │    spike gates the       │ ds-mcp tools, dspack-emit final-1.0 surfaces
                   │    Playground            │ (each a separate approval; until then the
                   └─ RFC drafts (documents) ─┘  external-agent criterion stays open)
        M2 opens with a spike: persistent canvas; @a2ui upgrade if it requires one (D6)
        Astryx contract extension (D5b): documented in M0; implementation needs separate approval
```

M1 and M2 need nothing from a sibling repository. Every arrow after R0 needs explicit authorization.

### E3. Milestones

#### M0. Baseline and trust fixes (S). Authorized.

**Scope reconciliation.** Revision 1 said four trust fixes and listed five. M0 now has four. Hash routing is deferred: it changes how the app opens projects and holds view state (`apps/composer/app/composer.tsx:86-95`, `state.tsx:338`), which is refactoring, and it is rebuilt anyway by the new shell. It moves to M1 in the experimental build.

**Deliverables, in order.** Everything lands under `docs/repositioning/` unless noted.

1. **Record.** `PROPOSAL.md` (this document), `DECISIONS.md` (the register with the owner's decisions and conditions), and ADR drafts: R1 composition as evolved block, R2 lifting the data boundary, R3 project-level interaction contract, R4 expansion-first instantiation and update integrity.
2. **Deterministic baseline** (`BASELINE.md`). Install from the lockfile, then record result, counts and duration for each step CI runs (G lists them), at a named commit. Add a test that pins the hash of `acceptance/gateway-corpus/corpus.mjs`. No model is called.
3. **Deployment baseline.** What is served today: the artifact, its build marker, `/api/models`, response headers, and the zero-cost refusal from an empty `POST /api/propose`.
4. **Offline protocol check** (`PROTOCOL.md`). The A2UI repository's validator suites against the derived 0.9.1 and 1.0 catalogs and emitted messages. Findings recorded with the divergences from final 1.0 listed; nothing fixed.
5. **Hosted AI availability** (`HOSTED-AI-AVAILABILITY.md`). The code offers hosted generation only when `HOSTED_AI` is "on" (absent counts as on) and the `AI` binding exists (`apps/composer/worker/propose.mjs:53-56`). Both configs declare the binding and keep dashboard variables (`wrangler.jsonc`, `keep_vars`). So the candidates are: the kill switch set off in the dashboard (a pause does exactly this per `docs/deployment.md`), a deployed version without the binding, or a rollback that restored other variables. Method: repository and docs; the public probes in item 3; and read-only GET calls to the Cloudflare API for the Worker's bindings, plain-text variables and deployment list (allowed by the owner on 2026-11-24; no write, update or delete request is made, and no secret value is requested or recorded). Output: the verified cause, or the precise blocker to verification, and a recommended remediation for the owner to carry out. Nothing is changed.
6. **Scripted example integrity** (`EXAMPLE-INTEGRITY.md`). (a) Audit every packaged contract, sample project and fixture in the repository for examples whose prompt does not belong to their surface. (b) A deterministic detector for user projects, which live in browsers and exported files I cannot see: an authored example whose surface is canonically identical to another example of the same purpose while its prompt differs is flagged as a probable replay. (c) A non-destructive remedy, proposed and not shipped in M0 beyond the fix in item 10a: flag on project open, and offer keep, restore the source example's prompt, or leave out of generation context. Nothing is removed or rewritten automatically.
7. **Clickable design explorations** (`prototypes/`). The three approaches of D.11 for the hotel task, each covering onboarding, authoring, refinement, testing and publishing; self-contained HTML outside the product build, also published as a private page for easy viewing. With a written comparison and recommendation (`UX-EXPLORATION.md`).
8. **Live evaluation proposal** (`LIVE-EVALUATION-PROPOSAL.md`). No run and no spend. It states model and provider configuration, number of requests, sampling, estimated cost with its derivation, objectives, early-termination criteria, and the evidence that would justify further runs. It leads with a small pilot (Astryx only; the hotel request as a single build and as a flow; three corpus prompts chosen as one solved, one partial, one flow) and makes anything larger conditional on the pilot.
9. **Reference system note** (`ASTRYX-D5B.md`). What a contract extension would need (components, renderers, package upgrade, rules), and the owner-authored purposes the hotel vertical requires for its loading, empty, error and result surfaces. Investigation only.
10. **Four trust fixes to the default build**, each a separate change with regression tests:
    - (a) **Demo replay integrity.** The result names the example it replayed and is headed as a sample, not as the answer to the typed request. Saving it stores the replayed example's own prompt with a note of its origin, never the typed request. The bridge's twin does the same.
    - (b) **Checks are not fulfilment.** In every mode the result separates "meets your design system's rules" from whether it does what was asked, in one plain line; and model availability is stated on the projects hub and Build before the user types.
    - (c) **Structure.** `ViewHeader` becomes an `h1`; `aria-current` on navigation; a skip link.
    - (d) **Checks at 390 px.** The findings table scrolls inside its own region.
11. **Updated M1 scope and dependencies**, and the R0 report (below).

| | |
|---|---|
| Files changed in the product | `apps/composer/app/hosted-build.ts:460-475` (scripted replay), `app/state.tsx:1466-1525` (`acceptBuildTurn`), a pure `acceptedExampleEntry()` beside `examplePromptFor` in `packages/composer-core/src/build.ts`, `apps/agent/src/project.ts` (twin); `app/views/build-view.tsx`, `app/views/projects-view.tsx`; `app/ui.tsx:59-78` (`ViewHeader`), `app/composer.tsx:131-160` (navigation); `app/views/validate-view.tsx:62-80`; one new test for the corpus hash |
| Tests | Unit: a replayed turn is saved under the source example's prompt; the detector flags a replayed duplicate and leaves a genuine example alone. e2e: `composer-build.spec.ts` asserts the sample heading, the fulfilment line and the exported project's prompt; a 390 px spec for Checks. Heading-order and current-page assertions in the two composer a11y specs. Existing title assertions in `composer-flows.spec.ts` and `composer-prod-smoke.spec.ts` stay green. |
| Acceptance | Every existing suite passes; the default catalog export is byte-identical; the request goldens are unchanged; `BASELINE.md` reproduces on a second run; each fix has a test that fails on the parent commit and passes on the fix; the gateway corpus is unmodified (hash). |
| Delivery (owner's choice, 2026-11-24) | Separate branches, one draft pull request per concern, each branched from `main`: `claude/vibrant-shannon-v2fuf0` for documents, baseline, the corpus hash test and prototypes; `claude/m0-replay-integrity`; `claude/m0-checks-not-fulfilment`; `claude/m0-structure-a11y`; `claude/m0-checks-reflow`. No other branch is pushed. Nothing is merged: a merge to `main` deploys production. Any deviation from this plan is reported when it happens. |
| Review R0 | The report contains: repository baseline and verification results; the updated decision register; hosted AI findings; example integrity findings; prototypes and design recommendation; trust-fix implementation and regression evidence; pull request references; protocol compatibility findings; the proposed live evaluation budget; updated M1 scope and dependencies; outstanding risks, blockers and decisions. Completed verification is separated from unverified assumptions. **Work stops here until M1 is explicitly authorized.** |
| Risks | Installing dependencies or running the suites may fail in this environment (reported as a blocker, not worked around by changing tests); the hosted AI cause may be unverifiable without dashboard access; thresholds stay provisional until a live pilot is authorized. |
| Rollback | Each change reverts on its own; documents are additive. |

#### M1. Composition model (L), experimental build only. Not authorized; scope to be confirmed at R0.

| | |
|---|---|
| Deliverables, in order | 1. ADR and RFC delta for D1 to D4 (documents; owner sign-off). 2. Interaction contract: types, loader, store, an additive project-file field; the experimental guards widened in the same change. 3. Sidecar 0.2 dispatcher; 0.1 upcast in memory; a ratchet that the Phase 1B goldens and request hashes reproduce byte for byte. 4. Expander: data input, trace and bound mode; load-time checks; goldens. 5. **Interoperability spike, gate R1a.** One reusable composition; instantiated with at least three data sets, including one the rules must refuse; S1 to S3 and A1 to A3 on each; A2UI messages emitted; accepted by the upstream validator suites (C7 level 1); rendered in a standalone host on an unmodified upstream renderer outside `apps/composer` (level 2). The written result states what was and was not shown. Nothing in step 6 onward that depends on the Playground starts before the owner has seen it. 6. Binding compiler by tracing, bindability map from the emitted catalog, gates I0 to I3, rule coverage and update integrity, with one negative asset per rule. 7. Template children in `a2ui-ingest` and the renderers (shared packages, so proven neutral for the default build by the existing parity tests and exhibit e2e). 8. Compose canvas preview with scenario and state pickers, and a report of which values are bound, expanded or unbindable and why. 9. Promote to composition with canonical comparison. 10. Library, evolved from `BlocksCatalogSection`, keeping its test ids. 11. Storage: a migration and backward-compatibility design for owner review first (D14), then the migration. 12. Hash routes for project and view, in the new shell (deferred from M0). 13. Task plan, plan checks, composition discovery, the wiring proposal. 14. First compositions with scenarios: hotel search, hotel results, and a multi-variant mutation confirmation built from corpus prompt 8. |
| Files | new `packages/composer-core/src/compositions/{interaction,wire,bindability,resolve,gates,promote}.ts` and `src/task-plan.ts`; `packages/composer-core/src/blocks/{schema,call,expand,load,view,phase,provenance,actions,manifest}.ts`; `packages/composer-core/src/{plan,flow-plan,project}.ts`; `packages/a2ui-ingest/src/provenance.tsx` (a `childRefs()` beside `childIds`); list, column, text, table and selectable-card renderers in the three renderer packages; `apps/composer/lib/experimental-guard.mjs`, `scripts/check-default-artifact.mjs`; `apps/composer/experimental/*`; `apps/composer/app/{state,projects,planning,project-portability}.ts*`; `app/views/{inventory-view,scenario-view,build-view}.tsx`; `apps/composer/worker/propose.mjs` (an allowlisted planning model, only if D9 is granted; the Worker also serves production, so this is an owner-reviewed change) |
| Tests | Unit suites beside each module; goldens per composition, state and scenario; negative assets (binding a static label, a sensitive field in a payload, an undeclared action, a payload type mismatch, an unconfirmed consequential action, a repeat with a static sibling, a forbidden label, data that looks like an event). Tests changed deliberately: `blocks-ratchet.test.mjs` (empty context), `blocks/manifest*.test.ts`, `blocks-schema.test.ts`, `actions.test.ts`, `experimental-guard.test.mjs`, `project-portability.test.ts`. Tests that must not change: `catalog-export.test.ts`, the request goldens in `hosted-build.test.ts`, `packages/block-bench/results.json`. |
| Acceptance | One composition definition instantiated with three data sets yields three different surfaces, each passing S1 to S3 and A1 to A3; where values are bound, I0 holds. Data that breaks a rule (one result where two are required) is refused with the rule's rationale. Every state of every shipped composition passes under its own purpose at load. Each interaction gate rejects its negative asset with a message naming the node and reason. A promoted composition is accepted only when re-expansion equals the saved surface. Projects, sidecars and flows from before M1 load unchanged, and a default build round-trips a newer project file without losing the new keys. The default artifact contains no composition code. Live measurement (plan-check pass rate, first-attempt wiring pass rate, the D9 tiering comparison) runs only if separately authorized and costed. |
| Update-integrity tests (D4) | Each must be refused, with the previous surface kept and the reason shown: binding a property a rule reads (an alert-dialog action label; text under a required-text rule); a write to a path outside the bound set; a write of the wrong type or outside declared bounds; data that takes a list below the rule's minimum; a state change whose instance fails under its purpose; a bound list resized outside its bounds; a data value shaped like an action event; a sensitive field in a payload. |
| Review R1a, R1 | R1a: owner reviews the interoperability spike. R1: owner reviews the model on real compositions, the ADRs as amended by evidence, and the RFC drafts. |
| Risks | Reversing the block doctrine on data while its upstream ratification is pending; little is bindable on today's mappings, so the preview's bound-versus-expanded report must be honest; honest purposes for state surfaces (D5); scope creep in the template language (kept closed). |
| Rollback | The experimental artifact is redeployed at its previous version; default build untouched. |

#### M2. Playground and the hotel vertical (L), experimental build only.

| | |
|---|---|
| Deliverables, in order | 1. Spike: one long-lived message processor under the pinned renderer; decision between session mode on the pin and the `@a2ui/*` upgrade (D6). 2. `A2uiCanvas` session mode. 3. The pure playground runtime, scenario format, simulated tools, runtime refusal of undeclared or malformed actions. 4. Stateful flow shape in both parsers (the shape ships in the default build; execution is experimental), with lint for events, reachability, guards and confirmation. 5. Playground view with timeline, data, actions and messages inspectors, scenario switch, injected agent events, record and replay in the existing fixture format. 6. Input checks in TextField and Button. 7. The hotel reservation flow on Astryx: search, results, room selection, review, confirmation, completion. Scenarios: three results, two results, one result (refused by the rules and routed to a different state), none, invalid dates, slow search, changed search, different hotel or room, back without losing state, booking failure then recovery, agent-pushed price change. Golden transcripts for six scripted walks. 8. Corpus prompt 5 (Convert Estimate to Project) as a second flow that reuses the mutation confirmation, with its own scenarios: ready, not convertible, field-level validation error, timeout with unknown result (must not auto-retry), success with read-back, read-back mismatch. 9. The exhibit's booking scenario re-expressed as a declared composition; the hand-written overlay removed. |
| Files | new `packages/composer-core/src/playground/*`; `packages/composer-core/src/flows.ts:22-42,269-324`, `apps/composer/app/flows.ts:92-138`; `packages/a2ui-ingest/src/A2uiCanvas.tsx`; TextField and Button renderers; `packages/replay/src/*` and `packages/agui-bridge/src/mapper.ts` (reused, not moved); new `apps/composer/app/views/playground-view.tsx` behind the guarded import; `apps/agent/src/scenarios/appointment-booking.ts`; new `acceptance/experience-corpus/` (the corpus prompt is imported from `corpus.mjs`, never copied); new `e2e/composer-playground.spec.ts` added to `playwright.composer-experimental.config.ts` |
| Tests | Runtime unit tests per scenario with golden transcripts (messages, action log, final task state, data model); recorded sessions as replay fixtures; Playwright specs per listed behaviour; a static check that runtime, ingest and renderer packages contain no scenario-specific identifiers; axe on Playground. Both `flows.test.ts` files gain stateful cases while their existing "never executed" cases stay true for unmarked flows. |
| Acceptance | Each listed hotel behaviour passes as a deterministic e2e test. Every user interaction produces an action whose payload validates; a malformed one is rejected visibly. An agent update changes data or components without recreating the surface, and typed input survives it. Back preserves task state. A recorded session replays identically. The Convert Estimate flow runs on the same runtime with no code specific to either scenario. **Update integrity (D4):** at every step of every golden walk the rendered surface equals a governed expansion of the current data; a simulated agent event that would break a rule, write an unbound path, carry raw component messages or exceed declared bounds is refused, the previous surface stays, and the refusal appears in the timeline with the rule's rationale. Each has a scripted negative walk. |
| Review R2 | Owner walks both scenarios; decides which Track 2 implementations to authorize. |
| Risks | The pinned renderer may not support a persistent processor, forcing the upgrade and its breaking changes; vocabulary and purpose gaps on Astryx (reported, not hidden); temptation to special-case the demo; scenario data carried into exports must be synthetic; the exhibit already ships a `hotel-reservations` scenario, so the new flow needs a distinct id. |
| Rollback | As M1. |

#### M3. Publish and agent consumption (M), experimental build plus sibling repositories as approved.

| | |
|---|---|
| Deliverables | Package builder and Publish view; message examples per scenario, including update sequences; generated `AGENTS.md`; validation and compatibility reports; the host checks of C7; an in-repository package reader (level 3, a fallback and test aid); ds-mcp tools and A2UI final-1.0 surface emission only if their upstream work has been separately approved and released. |
| Acceptance, stated as two separate claims | **Package portability (level 3):** the package passes the upstream validator suites; the in-repository reader instantiates the hotel search for unseen input from the package alone; a tampered file fails the manifest check; unsupported capabilities appear in the report. **Independent agent consumption (level 4):** an agent that imports nothing from this repository discovers, instantiates, validates and emits through published ds-mcp tools; and, if a live run is authorized, a model-driven agent with MCP access does so for three unseen requests. If level 4 has not been demonstrated, the R3 report says the brief's external-agent criterion is not yet met. |
| Review R3 | Owner reviews the package format before anything depends on it, and which level was reached. |

#### M4. Release candidate (M), experimental build only.

| | |
|---|---|
| Deliverables | The new shell and vocabulary complete in the experimental build; onboarding; Design system section; validation drawer; responsive and accessibility passes; usability sessions with five first-time users; beta feedback applied; documentation; a frozen release candidate. The public default build is not changed. |
| Acceptance | Four of five first-time users create a project, obtain a working composition and complete one Playground interaction within five minutes unaided. Zero serious or critical axe findings on the four experiences; manual screen-reader pass recorded. Every pre-existing Composer e2e path has a passing equivalent in the candidate. |
| Review R4 | Owner accepts the candidate for validation. |

#### M5. Enterprise validation and release readiness (M).

Run against the frozen candidate: the unchanged gateway corpus and paraphrases; novel prompts and the adversarial sets (unsupported capability, invalid component or property, rule-violation attempts, invalid bindings, undeclared actions, incompatible catalog and renderer pairs); generation and runtime benchmarks; interoperability; migration. Complete documentation. Live runs here need their own authorization.

Release-critical gates, all required before any public change:

- Every row of E6 at the thresholds in E5, as fixed from measured baselines.
- **Verified final-specification A2UI 1.0** (owner's condition on D6): emitted catalogs and surface messages pass the upstream 1.0 validator suites, bindings included, and render in an upstream 1.0 renderer. A 0.9.1-only product does not pass this gate.
- Compatibility: every supported design system and renderer pair, with unsupported capabilities reported.
- Migration verified on project files exported from today's production, with a documented rollback.
- A release review in the existing `RELEASE-REVIEW.md` form.

#### Public cutover. A separate step after R5.

The new shell becomes the default build only after M5 passes and the owner approves at R5. The tests that hold the current default export byte-identical change deliberately in that change and nowhere earlier. Rollback is the existing redeploy procedure.

### E4. Testing strategy

- **Deterministic, in CI:** unit suites; expansion and message goldens; gate negative tests; recorded-session replay; Playwright on the experimental configuration; axe; default-build byte-identity and experimental-guard ratchets. No test in CI calls a model.
- **Live, never in CI:** the gateway harness and the block-bench live harness, extended with plan and wiring metrics, with pinned model identifiers, request configuration, per-request dollar ceilings and resumable ledgers as built for Phase 1B. Each run is pre-registered in the ADR-B3 style: what is measured, the decision rule, the ceiling.
- **Corpora:** the twelve prompts unchanged; a new experience corpus holding the hotel prompt, paraphrases, variations and the adversarial sets; parity checklists per prompt as in `packages/block-bench/live`.

### E5. Provisional thresholds (deterministic ones fixed at R0; model-dependent ones only after an authorized live pilot)

| Measure | Baseline source | Provisional target |
|---|---|---|
| Gateway corpus classification | `EXPECTED.md`; a live pilot when authorized | No row regresses; rows 5, 8 and 12 re-graded only with a written reason |
| Stage build passes all gates within the repair bound | Live pilot when authorized | Not below baseline minus 5 points (the ADR-B3 margin); composition-backed stages at least 95% |
| Task plan passes plan checks, hotel prompt and paraphrases, 20 runs | M1 | At least 90% |
| Wiring proposal passes I1 and I2 on first attempt | M1 | At least 85% |
| Hotel flow builds end to end on Astryx, 20 runs | M2 | At least 80% |
| Tokens per successful stage, Astryx | Phase 1B: 7,573 with a block, 16,048 without | Composition-backed no higher than 9,000; novel no higher than baseline |
| Median latency per stage | Phase 1B: about 5.9 s | At most 8 s; planning at most 10 s |
| Simulated action to visible update | New | At most 100 ms at the 95th percentile, excluding scripted delay |
| Cost of generating the full hotel flow | M1 | Derived at R1 from measured tokens and current prices |
| First-time task success | M4 sessions | Four of five within five minutes |
| A2UI final 1.0 | Upstream validator suites and renderer | Passes, bindings included, before public cutover |
| Accessibility | Axe, manual pass | Zero serious or critical |

### E6. Success criteria traceability

| Brief's criterion | Proven in | By |
|---|---|---|
| First-time user creates a project and a composition without protocol knowledge | M4 | Usability sessions; onboarding e2e |
| Agent generates a novel composition from approved components | M1 | Live run; S1 to S3 |
| Typed data, parameters, declared actions | M1 | Schema and gate tests |
| Different data, same composition, no hardcoded content | M1 | One definition, three data sets, each instance governed; I0 where bound |
| Interactions produce correctly structured events | M2 | Payload validation asserts |
| Task state persists across surfaces | M2 | Back-navigation e2e |
| Agent updates state without regenerating | M2 | Message-type and input-survival asserts |
| Invalid components, actions, bindings, rule violations rejected with actionable feedback | M1, M5 | Negative tests; adversarial corpus |
| Accepted artifacts pass governance and protocol validation | M1 to M3 | Existing gates, unchanged; update-integrity negative tests |
| Exports consumed by an independent A2UI host | M1 spike (levels 1 and 2), M3 for packages | Upstream validator suites; standalone host on an unmodified upstream renderer |
| Independent agent discovers and instantiates | M3, level 4 only | An agent importing nothing from this repository, through published ds-mcp tools. The in-repository reader does not satisfy this row |
| Hotel reservation end to end with simulated data | M2 | Scenario e2e suite |
| A different enterprise scenario generalises | M2 | Convert Estimate to Project (corpus prompt 5) on the same runtime |
| No regression of supported functionality | Every milestone; M5 before cutover | Existing suites; M4 equivalence list |
| Existing projects usable or migrated | M1, M5 | Import tests on pre-M1 project files; migration verified on production exports |
| Gateway corpus unchanged | Every milestone | Hash check |
| Type checks, unit, integration, accessibility, e2e pass | Every milestone | CI |

### E7. Risks and cost

| Risk | Likelihood | Response |
|---|---|---|
| Upstream is quiet (no sibling commits since August) and policy defers emitter work without demonstrated need | Medium | M1 and M2 need nothing upstream; M2 is the demonstrated need; every upstream item has an in-repository fallback |
| A2UI adds its own templating (on its roadmap) | Medium | Compositions compile to catalog components today and can target a native construct later; the format stays protocol-neutral |
| Renderer upgrade from 0.10 to 0.16 breaks rendering | Medium | Separate PR series, parity tests and replay fixtures as the safety net |
| The demo gets special-cased | Medium | Static check for scenario identifiers; second scenario on the same runtime; no scenario code outside scenario data |
| Entered values leak through action payloads | Low, high impact | Sensitive typing, I1, the host guide, and the data model never relayed whole |
| Bound content escapes the rules | Would be high with a bind-first design | Expansion-first instantiation; I0; rule coverage (C3, C6) |
| A default build silently drops new project data | High if unaddressed | The new shapes ship in the default build and round-trip untouched (C9) |
| Changes to the Worker reach production, since one Worker serves both artifacts | Medium | Existing request goldens unchanged; any new operation is an owner-reviewed change |
| State surfaces filed under a purpose that does not describe them | Medium | Owner-authored purposes (D5); never a permissive stand-in |
| Simulator grows into a workflow engine | Medium | Closed transition language; fixtures only; no code or network |
| Vocabulary gaps make the vertical look weak on Astryx | High | Say so in the product; D5b extension in parallel |
| Token cost on shadcn/ui v3 (five to seven times Astryx per successful build in Phase 1B) | High | Astryx first; shadcn measured in M5 under its own authorized budget |
| Name confusion with upstream A2UI Composer | Medium | D13 |
| Browser storage migration loses data | Low | Old keys kept until verified; export as rollback |

**Cost position after the owner's decision.** No paid inference is authorized. M0 spends nothing on models and produces `LIVE-EVALUATION-PROPOSAL.md`, which leads with a small pilot and makes any larger run conditional on its results. The only cost evidence in the repository is Phase 1B's recorded $47.48 for 1,487 requests **[doc]**; revision 1's per-milestone ceilings were estimates scaled from it and are withdrawn until that proposal is reviewed. No paid dependency or infrastructure cost is proposed.

### E8. Explicitly deferred

From M0 to M1: hash routing. Until separately authorized: every live model run, the tiering experiment, and any sibling-repository implementation. Beyond this plan: live agent mode and real tool execution; accounts, teams, review workflow, billing; shared cross-project libraries; version diffing and cross-agent regression; private catalog hosting; a component workshop; json-render and OpenUI interaction targets; signing of packages; shadcn/ui v3 native renderer completion beyond what the second scenario needs; Astryx contract extension unless D5b is approved; any change to production infrastructure, Access or deployment settings.

---

## F. Decision register

### Product-owner decisions, recorded 2026-11-24

These do not authorize M1 or any later milestone.

| # | Decision | Condition or limit |
|---|---|---|
| D1 | Accepted: interface blocks evolve into compositions | |
| D2 | Accepted: the interaction boundaries evolve | Composer stays an authoring, simulation, governance and publishing environment, never a production workflow execution platform |
| D3 | Accepted: project-level interaction contracts | |
| D4 | Accepted: expansion-first instantiation with verified bindings | Acceptance extended so later data updates cannot get around governance, with negative tests (C3, C6, M1, M2) |
| D5 | Accepted: Astryx as contracted (D5a) is the initial reference | D5b is investigated and documented only; no upstream vocabulary change without separate approval; the purposes the vertical needs are identified in M0 |
| D6 | Accepted: staged protocol migration | Verified final-specification A2UI 1.0 is required for the revised public release; 0.9.1-only is acceptable during experimental development |
| D7 | Accepted: AG-UI upgrade and live agent execution deferred | |
| D8 | Deterministic and offline baseline only | A separately costed live evaluation proposal is prepared; no paid run |
| D9 | Accepted in principle: model-tiering experiment | Execution and cost need separate authorization |
| D10 | Accepted as a direction for prototyping | Not a final UI specification; three workspace approaches are explored first (D.11) |
| D11 | Accepted: experimental rollout | |
| D12 | Cross-repository investigation and RFC drafts only | Implementation needs separate approval |
| D13 | The name Composer is kept | Qualified as Aesthetic Function Composer where appropriate |
| D14 | Accepted in principle: IndexedDB persistence | Migration and backward-compatibility strategy reviewed before implementation |
| D15 | M0 preparation and development on a working branch | The release freeze and production deployment boundaries stand |
| D16 | Accepted: deterministic task-completeness checks | Supplemented by offline evaluation rubrics |

### The register as proposed

The entries below are the analysis the decisions were made on. Where an entry's recommendation differs from the decision above, the decision governs: in particular D8 (no live run, no service token requested) and D9 (no experiment without authorization).

Each entry: the decision, the options, the recommendation, why, what follows, and how reversible it is. Decision ids (D1 to D16) are separate from the UX subsections (D.1 to D.11).

**D1. What a composition is.**
Options: (a) the interface block, evolved (sidecar 0.1 to 0.2) and renamed in the product; (b) a new composition schema beside blocks; (c) parameters added to contract worked examples.
Recommend (a). Blocks already have a typed signature, a closed template, declared actions, provenance and an export manifest, with measured benefit; (b) duplicates all of that; (c) is impossible without a spec change because `examples` entries are closed objects **[upstream]**.
Follows: block code leaves "beta only" status in stages; users can author compositions; `docs/blocks/RFC-dspack-blocks.md` is superseded by a compositions RFC.
Reversibility: high. Sidecars are project data beside the contract, and 0.1 files stay valid.

**D2. Lift two intentional boundaries.**
(i) "A block describes an interface, never its data in flight" (RFC §2; host-action rule 7: empty action context). (ii) `ARCHITECTURE.md` §9 non-goals on binding data and carrying state, and invariant 9 on flows.
Options: (a) keep both, and Composer remains a static workbench; (b) amend: compositions declare data and action payloads, Composer simulates with synthetic data and never executes a real tool; (c) go further and let Composer call real tools.
Recommend (b), recorded as an ADR. What stays true: model-filled parameters never carry runtime values; the model never names an action; fields marked sensitive can never enter an action payload; the data model is never relayed whole; hosts authorize every effect.
Follows: `HOST-ACTIONS.md` gains a payload section; the manifest's "empty context" rule becomes "context matches the declared payload".
Risk: entered values now travel in action payloads by design. Reversibility: medium, because published packages will carry payload schemas that hosts rely on.

**D3. Where the interaction contract lives.**
Options: (a) project-level files beside the contract, tied by hash; (b) new sections in the dspack spec; (c) `x-` extensions inside the contract.
Recommend (a) now, an upstream RFC later. The spec scopes renderer- and transport-facing features out; packaged references are immutable and byte-synced, so (c) cannot apply to them; (b) is a cross-repository change best made with evidence.
Reversibility: high.

**D4. How data reaches a surface, and where wiring is written.**
Options for instantiation: (a) expand and govern every instance, binding only entered values, payloads and volatile text; (b) bind first, with a fixed component tree and a data model.
Options for authoring: (c) directives in the composition's own template, compiled by tracing; (d) a hand-written overlay keyed on node ids; (e) a new `dspackSurface` 0.2; (f) the emit profile; (g) json-render's state model internally.
Recommend (a) with (c); C10 has the comparison. This keeps every rendered instance inside S1 to S3, leaves A1 to A3 untouched and needs no sibling-repository change.
Cost: an agent re-instantiates on each data change (a pure function, no model call) and needs the expander at run time, through ds-mcp or a library.
Reversibility: high. If dspack-emit later makes more properties dynamic, more values move from expanded to bound with no change to compositions.

**D5. Reference design system for the hotel vertical.**
Options: (a) Astryx as contracted today, with dates and guest count as validated text fields and states composed from text, badge and card; (b) Astryx with an owner-approved contract extension (date, number, select, loading, empty, banner) through the upstream-first protocol; (c) shadcn/ui v3.
Recommend (a) to start and (b) as a parallel track. Astryx has full native rendering of its 12 components, a fifth to a seventh of shadcn's tokens per successful build, and a clear Phase 1B pass **[doc]**; shadcn has the vocabulary but 11 of 27 native renderers and an uncertain pass.
A second gap needs an answer either way: Astryx has no purpose for loading, empty, error or result surfaces. Filing them under a permissive purpose such as scheduling would pass the gates and be dishonest. They need owner-authored purposes, either in the project's own governance (possible today, persisted by D14) or in the contract extension. shadcn/ui v3 already has `status-feedback` and `loading-state`.
Risk: (a) looks plainer and must say so; (b) needs `@astryxdesign/core` 0.1.4 to 0.7.x, new renderers and owner-authored rules.
Reversibility: high; compositions are bound to a contract hash and re-bind explicitly.

**D6. A2UI protocol target.**
Options: (a) remain on 0.9.1; (b) build on the core shared by 0.9.1 and 1.0, upgrade `@a2ui/*` to 0.16.x when the Milestone 2 spike requires it and no later than Milestone 3, add 1.0 surface emission with dspack-emit in Milestone 3; (c) move to 1.0 first.
Recommend (b). 1.0 is current and 0.9.1 is closed; the 0.16 renderers accept both; dspack-emit emits only v0.9 surface messages today, and its 1.0 catalog definitions predate the final specification **[upstream]**.
Risk: the React package changed incompatibly between 0.10 and 0.16. Reversibility: high (pinned versions, one PR series).

**D7. AG-UI and live agents.**
Options: (a) keep 0.0.57 and an in-browser simulator that needs no transport, adopting AG-UI 1.x and the `@ag-ui/a2ui-middleware` action convention when live mode is built; (b) upgrade now; (c) keep the repository's own `/action` endpoint as the live binding.
Recommend (a). Neither specification standardises how an A2UI action returns over AG-UI; the middleware is at 0.0.16 **[upstream]**. Any use is labelled non-standard and isolated in `packages/agui-bridge`. The 0.0.57 shims expire 2027-09-17.

**D8. Live baseline: access and budget.**
Options: (a) a short-lived Access service token so the existing harnesses can reach the experimental deployment (already open as backlog item O1); (b) the owner runs the harnesses, as in Phase 1B; (c) defer live measurement.
Recommend (a), else (b), with a ceiling of $50 enforced by the existing per-request ledger. Phase 1B spent $47.48 over 1,487 requests **[doc]**; the baseline in E is smaller. Without it, thresholds cannot be set honestly.

**D9. Model tiering.**
Options: (a) one economical model for every call; (b) a stronger model for the planning call and the economical model for fills, provider-neutral.
Recommend authorising the experiment, not the outcome: measure both on the hotel and corpus prompts in Milestone 1 within its ceiling, then decide. No data exists for multi-stage planning quality. The Worker pins one model today (`PRIMARY` in `apps/composer/worker/propose.mjs:28`), so tiering needs an allowlisted second model on the experimental artifact's Worker path.

**D10. Navigation and vocabulary.**
Adopt the four experiences plus Design system (section D.2) and the terms in B4, including "Composer bridge" for the local process and "Demo replay" for scripted mode. Alternative: keep current names and only regroup. Reversibility: high (copy and routes).

**D11. Rollout vehicle.**
Options: (a) build new experiences in the experimental artifact behind Access, with the default build receiving only Milestone 0 fixes until the public cutover; (b) ship incrementally to the default build; (c) a long-lived branch.
Recommend (a). The isolation, guards and deploy path exist and are tested; merges to `main` deploy production.

**D12. Cross-repository track.**
Approve drafting now (documents only) and implementation after Milestone 2 evidence: a dspack compositions RFC, including how rules apply to data-bound collections; dspack-emit dynamic kinds for mapped properties, an id map, native binding and payload emission, and final-1.0 surfaces; dspack-gen scoped vocabulary, exported generation views and core instantiation; ds-mcp tools; the Astryx contract extension. Alternative: vendor or fork (rejected: duplicates shared capability). Each upstream change is a separate approval.

**D13. Name and positioning beside upstream "A2UI Composer".**
Options: (a) keep "Composer", always qualified as Aesthetic Function Composer, and state the complement plainly (B3); (b) rename before a public launch; (c) ignore.
Recommend (a) now and revisit before public expansion; renaming grows more expensive after launch.

**D14. Browser persistence.**
Options: (a) keep localStorage; (b) IndexedDB with a one-way migration that keeps the old keys until verified, and the project file as rollback.
Recommend (b) in Milestone 1. Rule and mapping edits are session-only today, quota failures are silent for provenance (backlog P1), and compositions with scenarios and recordings are larger.

**D15. Sequencing against the beta and the freeze.**
The backlog says no redesign work starts before the owner opens that phase, and nothing merges for improvements during the freeze. Whether the Access cutover (`BETA-DEPLOY-PLAN.md` steps A to I) has completed is **[unverified]**.
Options: (a) start Milestone 0 now, as PRs the owner merges when the freeze allows; (b) wait for beta feedback before any shell work; (c) hold everything.
Recommend (a), and feed beta feedback into the Milestone 4 release candidate.

**D16. How task completeness is judged.**
Options: (a) deterministic completeness against the declared interaction contract (every required input bound, every declared action reachable, every required state present), with rubric or model-graded scoring allowed only in offline evaluation; (b) a model as a gate; (c) no check.
Recommend (a). (b) breaks "the AI proposes; deterministic machinery decides".

---

## G. Verification

**Reproducing this assessment (no changes needed):**

```bash
curl -s https://composer.aesthetic-function.com/api/models
```

returns `{"models":["scripted"]}`. On the live site: create a project on Astryx, paste the hotel request from the brief into Build, then repeat through "Build a flow…". Expected: a "Choose a plan" surface with four green checks; a two-step outline; "Add to project" saves both under the hotel prompt. Line-level evidence: `packages/a2ui-ingest/src/provenance.tsx:24-27`, `apps/composer/app/state.tsx:1519-1528`, `apps/composer/worker/propose.mjs:28-31,65-82`, `packages/composer-core/src/flow-plan.ts:169-190`, `packages/composer-core/src/flows.ts`, `docs/blocks/RFC-dspack-blocks.md` §2, `docs/blocks/HOST-ACTIONS.md` §3 and §4.

**Verifying Milestone 0.** None of these calls a model.

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm build:contracts && pnpm --filter @dspack-studio/contracts check:sync && pnpm test && pnpm typecheck
```

```bash
pnpm --filter web build && pnpm exec playwright test --trace off
```

```bash
pnpm --filter composer build && pnpm exec playwright test --config playwright.composer-smoke.config.ts --trace off
```

```bash
pnpm exec playwright test --config playwright.composer-agent.config.ts --trace off
```

```bash
pnpm --filter composer build:experimental && pnpm exec playwright test --config playwright.composer-experimental.config.ts --trace off
```

These are the steps `.github/workflows/ci.yml` runs.

- `BASELINE.md` matches on a second run at the same commit.
- Each trust fix: its new regression test fails on the parent commit and passes on the fix.
- `git diff --stat main -- acceptance/gateway-corpus` is empty, and the new hash test passes.
- The default catalog export test and the request goldens pass unmodified.
- In a browser on the locally built default artifact: a typed request in Demo replay is headed as a sample of a named example, says it was not generated from the request, and saving it stores the source example's prompt; the result line separates rule checks from fulfilment; a screen-reader heading list shows one `h1` per view; Checks does not scroll sideways at 390 px.
- The example-integrity detector flags a constructed replay duplicate and does not flag the packaged examples.
- Each of the three design explorations opens and walks onboarding, authoring, refinement, testing and publishing for the hotel task.
- The hosted AI note names a verified cause or the exact blocker, and changes nothing.
- No request is sent to a model provider, and nothing is merged or deployed.

Later milestones are verified by the acceptance rows in E3 and the traceability table in E6.

---

## H. Recommendation

**Proceed with the repositioning.** The direction follows from the product's own stated next chapter, the repository already contains most of the parts, and the governance architecture carries over intact. The evidence does not support a rewrite, a framework change, or a new composition schema.

**Revise these elements of the brief's draft:**

1. Treat Composition as the evolution of interface blocks, and state plainly that two intentional boundaries are being lifted (D1, D2).
2. Put data and action contracts at project level, outside the dspack contract, with an upstream RFC to follow evidence (D3, D12).
3. Instantiate by governed expansion and bind only where safe (D4). The brief's picture of a fixed composition fed by a data model would let data-dependent content bypass the design system's rules, and today's protocol mappings could barely express it.
4. Reuse and generalise the exhibit's interaction loop instead of building a new runtime; retire its hand-written wiring.
5. Start on Astryx as contracted, say where vocabulary and purposes are missing, and decide the contract extension separately (D5). Astryx's coverage claim is true for rendering and incomplete for vocabulary.
6. Use corpus prompt 5 (Convert Estimate to Project) as the contrasting scenario: it shares the corpus's dominant shape (review, explicit confirmation, a non-repeatable change, read-back) and needs no vocabulary Astryx lacks, so a failure points at the machinery and not at a missing component.
7. Land the redesign progressively in the experimental build, complete it as a release candidate, and cut over once, after enterprise validation (D11).
8. Add Design system as a visible secondary destination and make validation a status (section D.2).
9. Plan for A2UI 1.0 and AG-UI 1.x; the pins are many releases behind, and the "1.0" catalogs emitted today predate the final specification (D6, D7).

**Authorized now: M0 only (E3).** In order:

1. Record the proposal, the decision register and ADR drafts under `docs/repositioning/`.
2. Install from the lockfile and record the deterministic baseline and the deployment baseline.
3. Run the offline protocol check.
4. Investigate hosted AI availability and scripted example integrity; write both up.
5. Implement the four trust fixes with regression tests.
6. Build the three clickable design explorations and the comparison.
7. Write the live evaluation proposal, the Astryx note and the updated M1 scope.
8. Open draft pull requests, report at R0, and stop.

Two choices about how M0 is carried out were put to the owner and answered on 2026-11-24: separate branches with one draft pull request per concern (E3, Delivery), and read-only access to the Cloudflare configuration to verify the hosted AI cause (M0 item 5).

Open questions, each with where it is answered: whether the Access cutover has completed (M0 item 3 and 5, as far as public probes allow); how far the derived 1.0 catalogs diverge from final A2UI 1.0 beyond the binding spelling (M0 item 4); how a model performs on multi-stage planning for this product, and whether a wiring proposal fits hosted constrained decoding (only by an authorized live run); whether the pinned renderer supports a long-lived message processor (the first spike of M2); whether a basic-catalog fallback can give stock hosts a plainer rendering (investigated in the M1 spike).
