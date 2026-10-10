# Interface blocks (experimental)

**Status: Phase 0.** Nothing here changes what Composer does today. The block format is an RFC that is not proposed upstream. The three block definitions are drafts that the owner rewrites before any evaluation result counts. The format specification is [blocks/RFC-dspack-blocks.md](blocks/RFC-dspack-blocks.md). The measurements are in [packages/block-bench/RESULTS.md](../packages/block-bench/RESULTS.md).

## What an interface block is

**Governed interface patterns with typed data, state, and host-owned actions.**

A block is a named, versioned signature that the model fills with content, plus a closed declarative template. Deterministic machinery expands the call into an ordinary dspack surface before any governance gate runs. The model chooses words and data. The owner-authored template decides composition. S1, S2 and S3 judge the expanded surface exactly as they judge any other.

```
plan ─▶ block call ─▶ B1 shape ─▶ B2 completeness ─▶ expand ─▶ S1/S2 + emit check ─▶ runPipeline (S1-S3, repair, emit, A1-A3) ─▶ render
  │                                                                 │
  └─ block: null ─▶ primitive generation, unchanged                 └─ template defect ─▶ fail closed, block disabled
```

Blocks are interaction contracts, not application features. `auth-form` describes a sign-in surface; it does not authenticate anyone. Actions are semantic names that only a host binds to effects. Composer never executes them, which is unchanged from [ARCHITECTURE.md §9](ARCHITECTURE.md).

The first three blocks are `records-table`, `auth-form` and `guide-steps`. Each one exists for both packaged references, shadcn/ui v3 and Astryx. A block has the same named signature on both and a different template per design system. No design-system-specific code is involved.

## Why: what the bench measured

These figures come from offline, deterministic runs of the real code paths. Tokens are a js-tiktoken o200k_base estimate, not Claude's tokenizer. Bytes are exact.

- **Hosted input is dominated by schema text.**
  - On shadcn/ui v3, a fresh hosted generation request carries 52,413 to 56,427 input tokens, and 83% to 90% of that is the generation schema. The Worker pastes the schema into the system prompt as text (`apps/composer/worker/propose.mjs`, `guidedSystem`). Request bodies are 220 to 240 KB.
  - On Astryx the same request is 9,352 to 9,862 tokens, of which 79% to 83% is schema text.
- **A block's selected-block schema is a few hundred tokens:** 239 to 352 in the named encoding, against 47,090 tokens of surface schema for shadcn/ui v3. Model output shrinks too: draft calls are 49 to 122 tokens named and 40 to 106 positional, against expanded surfaces of 198 to 488 tokens. Both figures are provisional: the drafts are not owner-approved and no model has produced them.
- **Structural validity is not governance.** 5 of 6 recorded live attempts that fail S3 pass every structural check: A1 to A3 on both A2UI versions, and the json-render J2/J3 offline check. The sixth is refused by the emitter. The scope is narrow: local models, Astryx, recorded July 2026. This is not hosted evidence.

So the input side is the first-order lever on hosted cost. The external research's output-token savings are real but second-order.

## Security boundary

- **Model output is untrusted.** A call is data. It is validated, never executed, and the template decides every component.
- **No value slots.** Block signatures have no slot for entered values, defaults, credentials, secrets or runtime state. `auth-form` declares which fields to ask for, never what was typed. A test asserts this structurally.
- **Bounded.** Every string and array in a signature declares a maximum.
- **Allowlisted actions.** A block may only dispatch its declared action names. Names are deterministic dspack-emit slugs of literal template ids, so the model cannot coin one.
- **Fail closed.** A template that expands to anything S1, S2 or the emitter rejects is a definition defect. The block is disabled for the session and reported, never repaired by the model and never masked by fallback.
- **Ineligible projects get nothing.** Imported and repository projects never receive block metadata in a prompt. Composer never infers that an external contract supports a block.

## Decisions

### ADR-B1: blocks are governed data, expanded before the gates

**Context.** The external research proposes composite React components that own their layout. That would put design-system-specific code in the product, hide composition from S2 and S3, and turn a governed tree into one opaque node.

**Decision.**
- A block is owner-authored data: a signature plus a closed template.
- Expansion is a deterministic pre-step at the proposal seam, the one seam that already varies by provider.
- `runPipeline` stays the authority for S1 to S3, repair, emit and audit.

**Consequences.**
- No new rendering path. The catalog stays derived.
- Both references prove the same mechanism.
- Governance never sees anything a template could hide.

### ADR-B2: the named call is the contract; positional is a projection

**Decision.**
- The named canonical call (`{"block": "auth-form", "version": 1, "mode": "sign-in", ...}`) is what internal APIs, traces, provenance and docs use.
- The compact positional call (`{"b": "auth-form", "v": 1, "p": [...]}`) is a decodable projection that records each prop's wire index.
- Positional order is **not** yet a compatibility commitment. Phase 1B benchmarks named against positional before anyone relies on it.

**Consequences.** Required props precede optional ones, and signatures are append-only within a version. A breaking change means a new version or a new block id.

### ADR-B3: metrics and decision rule, frozen before any run

**Primary metric:** hosted tokens per successful result. That is provider-reported input plus output across every call (planning, generation, repairs, fallback, refinement), divided by the number of results that pass.

**Decision rule:** blocks graduate only if both hold:
- The primary metric falls by at least 30%.
- The end-to-end pass rate is non-inferior within a 5-point margin, against **both** a budget-matched primitive arm and today's uncapped production configuration.

**Also reported:**
- first-attempt pass rate and repairs per success;
- block-selection accuracy, with explicit `null` and an omitted field counted separately;
- fallback rate by classification, plus invariant-failure count;
- time to first valid preview, which today equals completion and is reported as such;
- time to first gated attempt, block-phase latency, emit time and total latency;
- input bytes;
- semantic parity, measured with a committed per-prompt structural checklist;
- refinement retention, the share of refinements that stay in block mode.

### ADR-B4: call budget, fallback classification, fairness

- **Budget.**
  - At most **3 provider generation calls** per run, counting the Worker's internal parse retry. Planning is its own call, outside the budget.
  - In block mode, every gateway request carries `maxCalls: 1`, and the block phase hands `runPipeline` the remaining budget as `maxRepairs`.
  - An exhausted budget ends as an ordinary `failed-lint-exhausted` or `failed-gate`, with its real findings visible. No error is invented.
- **Classification.** Unknown error kinds count as provider failures. That fails safe: no further call.

  | Condition | Behavior |
  |---|---|
  | `block: null` (planner, selector, ineligible project, planning provider failure) | Primitive generation, exactly as today |
  | Unsupported refinement (sentinel answer, or no valid prior trace) | Visible switch to primitive |
  | A response that fails B1 or B2 | One feedback block repair, then primitive fallback, within budget |
  | Unusable output at any call | Re-issue the identical request once if budget remains; the same rule in both arms |
  | Rate limit, busy, unavailable, timeout, transport, unknown | No further call; a `failed-adapter` report shaped as today |
  | Sidecar invalid, template defect, non-deterministic expansion | `invariant-failure`: zero further calls, block disabled, honest failure kind |
  | Expanded surface fails S3 only | Ordinary surface repair within the remaining budget |

- **Fairness.** Both evaluation arms share one budgeted adapter, so they share the unusable-output rule. Pass rates are stratified by path (block, block repair, fallback) and by the budget remaining at fallback.

### ADR-B5: provenance is project data, never contract data

- **Browser reference projects.** An accepted block surface records `{block, version, call, binding, expansionDigest}` in a per-project store that follows the `flows.ts` idiom. It travels in project export as an additive optional field.
- **Stored only when it is true.** It is written only when the accepted surface is byte-equal to its expansion.
- **Never inside contract files or surfaces.** It never enters a synchronized contract file, an example entry, or a surface.
- **Repository projects.** These are ineligible in Phase 1A. Phase 2 places provenance in an agent-written file beside the contract, keyed by example id and admitted by the agent's `saveExample`.

### ADR-O1: OpenUI is an independent, experimental emit track

- **Independent.** OpenUI never gates blocks. It is a text-only dspack-emit target under an `./experimental/openui` subpath, with a fidelity ledger from day one.
- **Isolated gate package.** Its conformance gates run in an isolated package pinned exactly to a `@openuidev/lang-core` release at least 14 days old, installed with `--ignore-scripts` and `OPENUI_TELEMETRY_DISABLED=1`. The package's postinstall sends install telemetry by default.
- **Not a renderer.** The generated library uses inert sentinel components; it is a schema and prompt validator, never a renderer.
- **Not A2UI interop.** `@openuidev/a2ui` carries OpenUI Lang statements inside A2UI-like envelopes that standard A2UI renderers cannot read.
- **Never the hosted service.** The Thesys Gateway and its cloud are never used.

## Phases

Each phase is a separately reviewable change that must be green before the next begins.

| Phase | Scope | Exit |
|---|---|---|
| **0** (this change) | This document, the RFC, the pure block schema module, the call-site refactor, draft sidecars and goldens, `packages/block-bench` | All tests green; request hashes recorded as the byte-identity oracle |
| **0.5** | Usage accounting: canonical keys, every call recorded (including failures and the planning call), timings, receipts | Request hashes unchanged at the real call sites |
| **1A** | Private PoC behind a build-time flag: B0/B1/B2, expander, selection with explicit `null`, block phase with budget, trace, compact refinement, provenance | Flag-off requests byte-identical; default builds contain no block code |
| **1B** | Live evaluation, run by the owner, against frozen corpora | The ADR-B3 decision rule |
| **2** | Only if 1B passes: ratify dspack `blocks` upstream-first, move expansion into dspack-gen, agent parity, a Blocks catalog | Upstream-first sync green |

## The twelve blocks

The external research ranked twelve block families. Admission is not by rank. A block enters only with governed vocabulary, native rendering or an accepted fallback, a prompt corpus, and a measured benefit.

| Research rank | Block | Status | Coverage in today's vocabularies |
|---:|---|---|---|
| 1 | Search, browse, compare | Later | Expressible on both references (Astryx: selectable-card, metadata-list) |
| 2 | Analytics dashboard | Vocabulary-gated | KPI cards and tables only; no chart vocabulary exists |
| 3 | Task workflow | Later | List and table views only |
| 4 | **Record manager** (`records-table`) | **Draft** | Native on both; per-row actions blocked by the dropdown-menu casualty |
| 5 | Product detail, cart, checkout | Later | Expressible; host-authoritative pricing |
| 6 | Booking | Later | Pre-offered slots only; no date picker |
| 7 | **Step-by-step guide** (`guide-steps`) | **Draft** | Tables on both; checking off steps is presentation state |
| 8 | Quiz, assessment | Later | Expressible on shadcn/ui v3 |
| 9 | Calendar | Vocabulary-gated | Agenda table only |
| 10 | Map | Vocabulary-gated | List only; provider and licensing decision required |
| 11 | **Account access** (`auth-form`) | **Draft** | Native on both; autocomplete purposes are a vocabulary gap |
| 12 | Status monitor | Later | Expressible |

## Open decisions

- **Owner rewrite.** The drafts' wording, templates, keywords and action names are owner-authored governance. The sidecars carry `"status": "draft"` until then.
- **Positional encoding.** Whether to commit to it is decided by 1B evidence, not before.
- **Vocabulary gaps.** Input `autocomplete` purposes, row actions (dropdown-menu items), charts, calendars and maps each need upstream vocabulary first.
- **OpenUI pin.** When to move the gate package from lang-core 0.3.x to 0.4.x, once 0.4.x is at least 14 days old.

## Suggested website copy

For the why-af comparison table (agent-UI protocol and catalog row):

> OpenUI defines what can render. dspack defines what is correct.

For the "later, deliberately" list:

> OpenUI Lang as an experimental emit target, behind its own conformance gates, once its specification settles. Measured first: in recorded runs, five of six surfaces that failed governance still passed every structural check.

## Files

- `packages/composer-core/src/blocks/` holds the sidecar schema, the call contract (named, positional, B1, constraints), the generation view (B0's oracle) and the binding digest. It is pure and not wired into the app.
- `packages/composer-core/src/requests.ts` holds the request builders the app actually uses. They are the byte-identity oracle's source.
- `apps/composer/experimental/blocks/*.blocks.json` holds the draft sidecars. They are never statically imported.
- `packages/block-bench/` holds the bench, its goldens and its committed results. `pnpm test` fails on any drift; `pnpm --filter @dspack-studio/block-bench bench` regenerates them.
