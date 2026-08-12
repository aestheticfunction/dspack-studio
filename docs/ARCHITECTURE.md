# Composer — architectural rationale

*This is the document a person joining this project needs. It explains why Composer is shaped the way it is, which decisions are load-bearing, and what it deliberately refuses to do. It is not a changelog; the phase-by-phase history lives in PR bodies and the release notes. For "what runs where," see [COMPOSER.md](COMPOSER.md); for setup, the [README](../README.md).*

## 1. What Composer is

Composer turns a plain-language goal into an interface built **only** from a design system's approved components, checked as it is built — and lets several of those interfaces be composed into a workflow.

The problem it exists to solve: AI generates UI by guessing. It invents component names, fabricates props, hardcodes colors, and ignores the patterns a team has already agreed on. Every generated file then needs manual correction. The usual industry answer is a better prompt. Composer's answer is that **a design system is a contract, and generation should be checked against it mechanically**.

## 2. The thesis: UI over seams that already existed

The founding proposal's central claim was that Composer is *"UI over seams that already exist, not a new pipeline."* Three seams were already shipped code when Composer began:

- **discovery** — `dspack-export`'s framework adapters extract components from a real codebase;
- **mapping** — `dspack-emit`'s `Profile` is pure data describing how contract components project onto A2UI;
- **rendering** — `a2ui-ingest`'s `Registry` maps catalog names to concrete visuals.

Composer added an authoring and conversation layer over those seams. It has never added a pipeline of its own, and that rule has survived every milestone since — including the workflow layer (§6), which introduced zero pipeline changes.

**Why this matters:** the ecosystem's failure mode, seen in earlier attempts, is a UI tool that grows its own private generation path and drifts away from the contract everything else validates against. Keeping Composer as *UI over seams* means the thing users see is the same thing the CLI, the MCP server, and CI see.

There was also a measured reason. Full-vocabulary generation schemas exceeded the structured-output grammar ceiling in **72 of 72** hosted evaluation runs. Project-scoped vocabularies fit. Scoping was never an optimization — it is why the product works at all, and why it works on hardware users own.

## 3. The core loop

1. Pick a project (a design system plus your work).
2. Describe what you want, in your own words.
3. Composer infers the **governed context** — which of the design system's intents your goal belongs to — and says which one it chose.
4. `dspack-gen` proposes a surface, constrained by a schema built from that project's approved vocabulary.
5. Gates run visibly: **S1** structure, **S2** approved-vocabulary + containment, **S3** the design system's own rules. Failures become a bounded repair turn, not a silent retry.
6. `dspack-emit` compiles the contract into an A2UI catalog and the surface into A2UI messages, refusing anything it cannot represent honestly. Gates **A1/A2/A3** validate the emitted result.
7. The surface renders through the project's real registry.
8. You refine conversationally, or accept — an accepted surface becomes a governed worked example that seeds future generation.

## 4. Why the AI proposes and deterministic machinery decides

This is the load-bearing decision of the whole product.

The model's output is a **proposal**. Every consequential judgment after it is deterministic: whether the vocabulary is approved (S2), whether the design system's rules hold (S3), whether the result can be represented at all (emit + A1/A2/A3), and whether it may be saved (the same gates run again at accept). A model can be wrong, slow, unavailable, or replaced; none of those events change what Composer will *accept*.

Three consequences worth understanding before changing anything:

- **The schema cannot express an unapproved component.** Generation is mechanically incapable of inventing vocabulary; S2 catches anything that slips through another path.
- **Refusals are first-class.** When the emitter cannot represent something, it says so with the reason, and that refusal is shown, not smoothed over. A declared casualty is a documented gap in the mapping, not a bug to route around.
- **Governance is never AI-authored.** Intents, rules, and every rationale are owner-written. The model may propose interfaces; it may not propose the standards those interfaces are judged by.

Corollary: **scripted mode is first-class.** The entire experience — streaming, gates, rendering, accept — works with no model at all. If the AI layer disappeared tomorrow, Composer would still be a governed authoring tool.

## 5. The product model

- **Project** — an identity plus a source of vocabulary. Three sources: a packaged **reference** design system, an **imported** project file, or a connected **repository** (through the local agent).
- **Contract** — the design system as data: components, props, intents, rules, and worked examples. Owner-authored; the source of truth for what may be built.
- **Profile** — how the contract projects onto A2UI. Pure data, editable, and the reason a catalog is *derived, never edited*.
- **Surface** — one governed screen. Generated or hand-authored, always validated the same way.
- **Flow** — an ordered set of surfaces that tells one story (§6).
- **Catalog** — the emitted A2UI vocabulary. **Always derived** from contract + profile; there is deliberately no catalog editor, because an editable catalog is how contract drift starts.

**Base + delta.** A project's working vocabulary is always *packaged base + the project's own authored delta*. Reference design systems are never mutated; your accepted work lands in a delta merged over the base on open. This is what lets Composer ship teaching material and user work in the same view without either pretending to be the other.

## 6. Why flows live *above* surfaces

Real enterprise requests are workflows: configure → review → confirm → result. The obvious implementation — teach the generator to emit one big multi-step surface — was measured and rejected. It produced surfaces that *described* a workflow (step labels as typography) without being one, and it pushed generation into exactly the compound-composition shapes the emitter refuses.

So a flow is **project data, not contract data**: an ordered list of steps, each a *reference* to an existing governed surface. Nothing about a flow reaches the contract, the emitter, the protocol, or the renderer. Preview walks the steps; each step renders through the identical single-surface path.

The consequences are the point:

- Every governance guarantee is preserved automatically, because the pipeline never learns flows exist.
- The same surface can appear in many flows without duplication.
- Deleting every flow leaves every surface exactly as it was.
- Flows can be exported, versioned, diffed, and validated as plain data.

Flow transitions are **view state**: a step may name emitted action names that advance the walk. No data moves between steps at runtime — continuity is authored into the surfaces themselves. This is a deliberate honesty boundary, not an oversight (§9).

## 7. The browser/agent boundary

Composer runs the **same deterministic pipeline** in two homes:

- **Browser projects** — everything runs in the page: gates, emission, rendering, accept. Work persists in browser storage and travels through project export. Nothing about the user's machine is required.
- **Repository projects** — the local agent reads and writes real files in a connected repo. The contract, profile, and emitted output are files the team version-controls.

The rule: **the agent is a bridge to your machine, never a privileged decision-maker.** It holds endpoints and credentials so the browser never does; it runs the same gates with the same verdicts. Where the hosted path needs a model it calls one Worker route for the model turn only — the pipeline stays client-side, and no project source leaves the browser.

Anything implemented twice across this boundary is a liability. Where behavior must match, it belongs in `composer-core` with equivalence tests; the historical divergences found this way are why that rule now exists in writing.

## 8. Invariants — the things that must not change casually

1. The AI proposes; deterministic machinery decides.
2. Generation is scoped to the project's approved vocabulary.
3. The catalog is derived, never edited.
4. Reference design systems are never mutated by user work.
5. Governance (intents, rules, rationales) is owner-authored.
6. Refusals and casualties are shown honestly, with their reason.
7. Composer never generates component implementations.
8. Scripted mode keeps the product usable with no model.
9. Flows compose existing surfaces; they never become a new generation or rendering path.

## 9. What Composer deliberately does not do

Composer composes and governs **interface representations**. It does not:

- bind those representations to live application or enterprise data;
- execute workflows, call external systems, or run MCP/Gateway tools;
- carry state between flow steps at runtime;
- generate component implementations (that is a separate, human-reviewed concern, deliberately kept off the fast path);
- manage accounts, teams, or collaboration.

These are honest boundaries, not hidden features. Runtime binding is a coherent future chapter; pretending it exists today would make the product untrustworthy in exactly the dimension it competes on.

## 10. Evolutions worth knowing about

Several early constraints were deliberately reversed. Each loosened *access* while tightening *honesty* — a useful pattern to recognize before proposing the next reversal:

| Originally | Today | Why |
|---|---|---|
| No hosted AI | Managed model through a governed gateway | Reachability without installing anything; gates still run client-side |
| Build requires the local agent | Browser-only Build works | The pipeline runs in the page; the agent is for real files |
| The user picks an intent explicitly | Goal-first inference, with the picker as an advanced override | People describe outcomes, not our taxonomy — and inference degrades to a deterministic classifier, never blocking |
| All state is files in the user's repo | Three project sources, two browser-local | Trying the product must not require a checkout |

The invariants in §8 were never traded for any of these.

## 11. Where the evidence lives

- **The acceptance corpus** — a real twelve-prompt enterprise suite lives in `acceptance/gateway-corpus/`, with its expected classification and a reproducible harness. It is the honest measuring stick for whether the product actually builds enterprise software; it is deliberately **not** run in normal CI, because it makes live model calls.
- **Gates and refusals** — every run produces an audit report; failures name their cause and the layer that owns it.
- **Tests** — unit suites cover the deterministic layers; end-to-end suites cover the product paths; renderer parity tests assert that a design system cannot widen or narrow the vocabulary the contract defines, and that a required catalog prop cannot be silently ignored by a renderer.
