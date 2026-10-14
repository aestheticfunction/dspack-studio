# Interface blocks (experimental)

**Status: Phase 0.** Nothing here changes what Composer does today. The block format is an RFC that is not proposed upstream. The owner approved the three block definitions on each reference, and the frozen Phase 1B corpus, on 2026-10-11; their wording, templates, keywords and action names are owner-authored governance. The format specification is [blocks/RFC-dspack-blocks.md](blocks/RFC-dspack-blocks.md). The measurements are in [packages/block-bench/RESULTS.md](../packages/block-bench/RESULTS.md).

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
- **A block's selected-block schema is a few hundred tokens:** 239 to 352 in the named encoding, against 47,090 tokens of surface schema for shadcn/ui v3. Model output shrinks too: the example calls are 49 to 122 tokens named and 40 to 106 positional, against expanded surfaces of 198 to 488 tokens. Both figures are provisional: no model has produced them.
- **Structural validity is not governance.** 5 of 6 recorded live attempts that fail S3 pass every structural check: A1 to A3 on both A2UI versions, and the json-render J2/J3 offline check. The sixth is refused by the emitter. The scope is narrow: local models, Astryx, recorded July 2026. This is not hosted evidence.

So the input side is the first-order lever on hosted cost. The external research's output-token savings are real but second-order.

## Security boundary

- **Model output is untrusted.** A call is data. It is validated, never executed, and the template decides every component.
- **No value slots.** Block signatures have no slot for entered values, defaults, credentials, secrets or runtime state. `auth-form` declares which fields to ask for, never what was typed. A test asserts this structurally.
- **Bounded.** Every string and array in a signature declares a maximum.
- **Allowlisted actions.** A block may only dispatch its declared action names. Names are deterministic dspack-emit slugs of template ids built only from literals and enum-bounded props, and B2 rejects any emitted name outside the block's declared `actions`, so the model cannot coin one.
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

**Addendum, fixed before any hosted result** ([blocks/ADR-B3-ADDENDUM.md](blocks/ADR-B3-ADDENDUM.md)). The thresholds, corpus, labels, scoring and arms do not change. What the addendum adds:
- The rule is a descriptive product decision rule, not a statistical test.
- The independent unit is the prompt thread: a prompt's fresh build and its refinements on one reference in one arm. The minimum of 20 counts threads, never cells.
- Arms are compared paired by prompt, with 95% paired cluster-bootstrap intervals over the prompts every compared arm evaluated.
- Every rate is reported with its counts.
- The evaluation runs in stages and stops as soon as the decision is clear.

**Amendment 2, adopted** ([blocks/ADR-B3-AMENDMENT-2.md](blocks/ADR-B3-AMENDMENT-2.md)). Corpus v2 corrects the add and remove templates, and the guide-steps structural one, that a static audit found cannot apply to every prompt or design system they are used on, and makes the add and remove check binding, the same for every arm. The owner adopted it whole on 2026-10-12, before any refinement cell ran live, and its merge to main (`3aae0ea`) made v2 the corpus a run measures. The thresholds, arms, budgets, block contracts and model prompts do not change; corpus v1 and the two smokes measured on it stay as they are, systems evidence only.

### ADR-B4: call budget, fallback classification, fairness

- **Budget.**
  - At most **3 provider generation calls** per run, counting the Worker's internal parse retry. Planning is its own call, outside the budget.
  - In block mode, every gateway request carries `maxCalls: 1`. The block phase hands `runPipeline` the remaining budget: `maxRepairs = 3 - k` after an expansion (attempt 0 replays the expansion and costs no call), and `3 - k - 1` on fallback (attempt 0 is itself a provider call), where k is the number of block-phase calls.
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

**Amendments from Phase 1A (the landed behavior).**
- The block repair runs only while the budget can still pay for a surface attempt afterwards. A first call that is invalid when fewer than two calls remain falls back at once, so the fallback is never left with a negative repair bound.
- A re-issue inside the block phase counts toward the phase's calls like any other, and a re-issue of the block repair is allowed when the budget allows it: one rule, both arms.
- A call the budget refuses never reaches a provider. It fails as a typed adapter error of kind `budget`, so the run ends as `failed-adapter` with the words "the model-call budget of 3 is exhausted", never as a plain exception and never as a synthetic outcome.
- Every exit of the budgeted adapter is a typed adapter error: a plain `Error` from any adapter is wrapped before it can reach `runPipeline`.
- The budget wording in a failure counts calls from the recorder, not attempts: a replayed provider failure is an attempt that made no call.

### ADR-B5: provenance is project data, never contract data

- **Browser reference projects.** An accepted block surface records `{block, version, intent, call, binding, expansionDigest}` in a per-project store that follows the `flows.ts` idiom. It travels in project export as an additive optional field.
- **Stored only when it is true.** It is written only when the accepted surface is byte-equal to its expansion.
- **Never inside contract files or surfaces.** It never enters a synchronized contract file, an example entry, or a surface.
- **Validated calls only, never model text.** Durable state holds the validated named call and safe diagnostics only. The block trace is a turn-level, in-memory record that keeps the model's literal text for the live receipt. Nothing persists it as it is: provenance stores the expansion's validated call, and the Phase 1B run log stores `durableTrace(trace)`. That form keeps a sha256 and a byte count in place of each literal answer, the call of validated attempts only, issue paths and classifications, and no sentinel reason. Error messages are kept without dspack-gen's output head.
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
| **0.5** (this change) | Usage accounting: canonical keys, every call recorded (including failures and the planning call), timings, receipts | Request hashes unchanged at the real call sites |
| **1A** (this change) | Private PoC behind a build-time flag: B0/B1/B2, expander, selection with explicit `null`, block phase with budget, trace, compact refinement, provenance | Flag-off requests byte-identical; default builds contain no block code |
| **1B** | The live evaluation, run by the owner, against frozen corpora; the harness is its own change (`packages/block-bench/live/`) | The ADR-B3 decision rule |
| **2** | Only if 1B passes: ratify dspack `blocks` upstream-first, move expansion into dspack-gen, agent parity, a Blocks catalog | Upstream-first sync green |

## The experimental build (Phase 1A)

Blocks exist only in an experimental build. The default build, the one every deploy path produces, is today's artifact byte for byte, and four things keep it that way.

- **The flag is inlined.** `next.config.mjs` writes `NEXT_PUBLIC_COMPOSER_EXPERIMENTAL` into the bundle as `"0"` or `"1"`. Every gated site spells the literal `process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL === "1"`, which Next folds away in the default build. There is no shared constant: a constant imported from another module is not folded, and a source ratchet (`apps/composer/lib/experimental-guard.test.mjs`) reads the syntax tree of every app source and fails on any `import()` of block code that is not enclosed by the literal check (the then-branch of an `if`, the true arm of a ternary, or the right side of an `&&` whose chain begins with the literal), and on any static import or re-export of block code from app code.
- **The directory is aliased away.** Unless the flag is on, `apps/composer/experimental/` (the sidecars and the runtime) resolves to nothing.
- **The flag and the output directory must agree.** `NEXT_PUBLIC_COMPOSER_EXPERIMENTAL=1` builds only into `out-experimental/` (`pnpm --filter composer build:experimental`); the flag alone fails the build, as does the directory alone. `out-experimental/` is git-ignored and is never the deploy artifact.
- **The artifact is scanned.** `scripts/check-default-artifact.mjs` runs at the end of the app's own `build` script, on every path that builds the deploy artifact, and fails on the sidecar key or any block id. The composer smoke suite scans the served chunks the same way, and a seeded preference key is proven to change nothing. `deploy-composer.yml` refuses to run when the variable is set.

**Running it.**

```
pnpm --filter composer build:experimental
pnpm exec playwright test --config playwright.composer-experimental.config.ts
```

The experimental suite (`e2e/composer-blocks.spec.ts`) is agent-free and stubs the gateway, so it never calls a model. CI builds the experimental artifact after the default suites and runs it on port 3315; the default configs are unchanged.

**What a person sees in an experimental build.** A Settings section, "Experimental", with one preference (off by default) and each reference's load status. With it on, an eligible build shows a Block row as the first row of the pipeline detail, a block note on the context line, and receipts that count block calls. Eligible means a packaged reference project or an Example session on its unedited design system, built in the browser; imported and repository projects, local models, an edited contract or profile, and a block an invariant failure disabled this session are never offered blocks, and the note says which.

## The live evaluation (Phase 1B)

The harness lives in `packages/block-bench/live/` and is run by the owner; nothing in it runs in CI except its own tests and a dry run on the scripted provider. It measures the real code paths, never a re-implementation: composer-core's block phase, budget and refinement decision; dspack-gen's `runPipeline`; the request bytes the app posts (`proposeBody`); the app's fold (`foldBuildEvents`). The hosted client is held to the app's gateway adapter by a parity test over every reply shape.

**Preconditions.** The deployed Worker must name the model of every call (Option B): the harness posts an empty body, which every Worker refuses, and proceeds only when the refusal carries `calls: []` and advertises `per-call-model` among its `capabilities`. It records the deployed build id and the sidecar status with the run. A draft sidecar or block runs only with `--allow-drafts`, and its report is then marked provisional. The production configuration it compares against is fixed in `docs/blocks/BASELINE.md`.

**Corpus.** `live/corpora/blocks.json` (v1), frozen on 2026-10-10 and approved by the owner on 2026-10-11: 22 prompts per block and at least 20 null prompts per reference, each with its expected block (or null), its expected intent per reference, and a parity checklist (labels that must appear in the surface's text, components that must appear). Near-miss nulls (a kanban board, a contact form, an order summary) sit inside the block intents on purpose. A validity test holds every rule. Frozen means pinned: `live/corpora/frozen.json` holds the corpus's name, version, freeze date and content digest, a test holds the corpus to it, and the CLI refuses to run on anything else. A deliberate edit re-freezes the corpus, changing the date and the digest together. Versions sit side by side: v2 (`live/corpora/blocks.v2.json`, pinned by `live/corpora/frozen.v2.json`, adopted by amendment 2) keeps every v1 prompt, label and checklist and corrects the add and remove templates, and the guide-steps structural one, that cannot apply everywhere (`live/applicability.ts`). A run measures v2 unless it passes `--corpus 1`, each version is held to its own pin, and a run's manifest pins the version it measured, so a v1 run is never resumed on v2. The decision thresholds are frozen in code and pinned by a test the same way.

**Arms and conditions.** `production` is today's path (the planning call, `maxRepairs` 2, the Worker's parse retry on). `capped` is the budget-matched primitive arm (the same planning call, `budgetedInner` with the budget of 3, `maxCalls` 1). `block` is the experimental path (the planning call with the block question, the block phase, then the preloaded, fallback or replayed pipeline; a null selection is today's path, as in the app). `block-positional` is the same path with the model answering the compact positional call (ADR-B2), which the block phase decodes to the named call before B1, so the gates, the expansion and the parity check are the named arm's. Each prompt runs fresh, then four refinements on the arm's own fresh result: a content change, adding a repeated item, removing one, and a structural change the blocks do not support. The cells run prompt-major, so a run stopped at any point holds balanced comparisons.

**Pacing and re-runs.** Hosted requests are spaced and capped twice. `--max-requests` caps one invocation. `--max-total-requests`, which a hosted run must state to start, caps the whole run: the manifest records it, `requests.jsonl` counts every request before it is sent, and each resume continues that count, so no number of resumes sends more than the run allows. A hosted run in a run directory must have a pacer, whatever the caller passes. The count adds what invocations from before the ledger reported to what the ledger holds. One invocation runs a directory at a time: `run.lock` refuses a concurrent one. The lock names its holder's pid, host and a nonce, and is linked into place whole. A lock left by a killed invocation on the same host is taken over one invocation at a time: the takeover holds `run.lock.takeover` while it moves the lock aside, checks it, and takes its place, so a lock that is held is never moved. An invocation removes only its own lock. A lock that names no host and pid (empty, or still being written), and a takeover left by a killed invocation, are never judged gone, and need deleting by hand. Each request is sent only if the lock still names its invocation, checked after the request's line is on the disk, so an invocation whose lock was lost any other way stops before sending, and one that took the lock over has already counted every request it sent. A dollar ceiling must be at most $9,007,199, the most the ledger's whole nanodollars count exactly. A resume changes the run's cap only by naming a new one, and the manifest records the change. A request count is not a dollar ceiling, so a hosted run must also state `--max-total-usd`, the dollars it may commit (`live/cost.ts`). Each request is recorded, with an id and its priced worst case, and flushed to the disk before it is sent: every call it may make at the Worker's max_tokens, at most one input token per byte the model reads plus framing, capped at the model's context window, at Claude Haiku 4.5's prices plus Cloudflare's 5% credit fee. A request is sent only while its absolute worst case, from the model's documented context and output limits alone, still fits under the ceiling. After the reply, the reservation ends one of three ways. A refusal that reached no model releases it. A reply proving it stayed inside its price (its calls itemized, at least one provider call and no more than priced, each within its bounds, with at least one input token, an output token for an answer, and Claude Haiku 4.5 named by a whole id; each figure stated once, under whichever spellings the app reads; and its total, when it gives one, the sum of its calls) settles it at what the calls reported. Anything else (usage missing, a figure past its bound or stated two ways, a total that is not its calls' sum, an extra call, no call reported, a call naming no model of its own, no reply) raises it to that absolute worst case, or to what the reply can have cost if that is more, counted figure by figure (each call reporting whole counts, once, that a call reaching the model can report, at what it reported; any other at the most one call can read and write, or at what it shows if that is more; each call its request was priced for that the reply does not list, as one it could not see; and the reply's total wherever it shows more), so the ceiling holds even if the pricing's assumptions fail. A reply that does not itemize its calls, or no reply, is raised to the most any request can cost, since it may come from a Worker that ignores `maxCalls`. A reply naming another model (at its top or on any call it lists), reporting usage past the model's documented limits (a figure past every count, such as JSON's `1e400`, included), or reporting more calls than its request allows is raised the same way and stops the run: what it cost may exceed every bound the prices rest on. Each settlement names its request and its final amount, so the ledger is read by id, in any order: a duplicate counts once, a settlement that would take its request below nothing is ignored, and a request with no settlement (its reply never read, or its settlement never written), wherever it sits, is raised the same way on the next resume. A ledger line that cannot be written stops the run. The ledger counts in whole nanodollars, so its sums and its comparisons with the ceiling are exact. A resume changes the ceiling only by naming a new one, on the record, and neither limit can be lowered below what the run has already sent or committed. A cell is admitted only when both caps cover its worst case (four requests, each refused and retried through the whole backoff schedule) and the ceiling covers four requests at their absolute worst case, so no cap cuts a cell off after it has spent. A request the gateway refused before any model ran is retried after a backoff: the zone limiter's 429 carries no call, and the gateway's busy 503 reports the one call it rejected, with no usage. The refused attempt is recorded as model-free, and the request's bytes count once. The pacing configuration, the requests sent and every wait are written into the report. A run directory carries a manifest, and a resume that does not match it is refused, so a report never mixes two deployments, two versions of the code or two configurations. The manifest records the provider, the corpus digest, each reference's contract, emit profile and sidecar by digest, the code (a digest of the harness and composer-core sources, and the dspack package versions), the local model's digest for an Ollama run, the deployment and the selection. A provider or policy failure that ends a run is not an arm result: it is reported separately and re-run with `--rerun-failed`. The re-run moves the records it replaces to `runs.superseded.jsonl`, and their spend stays in the report's totals. A re-run fresh cell takes along the refinements that were skipped for want of it. Every invocation's pacing is appended to `pacing.jsonl` and stated in the report. A cut-off last line in the log is set aside and its cell runs again; any other unreadable line stops the resume, named by file and line. That includes a failed planning call, which ends the cell before generation, so an outage cannot send one arm's prompts down another path. An unusable planning output is the model's answer: the cell routes deterministically, as the app does, and selection counts it as a planning failure, never as a null. In a hosted run, a planning call that reached the provider and then failed stops the run instead (integrity stops, below), because the failed call reports no usage; an unusable planning output that reports its usage and the run's model routes deterministically like any other. A planning call refused before any provider call still ends the cell as a planning failure. Budget exhaustion, fallback and invariant failures are arm results.

**Integrity stops.** A hosted run measures one model through one deployment (ADR-B3), and every call that reaches the provider is held to that (`live/integrity.ts`). The call must report both usage figures, each stated once (a figure under two spellings that disagree, or a reply's total that is not its calls' sum, stops the run too), and name on its own `calls[]` entry the model that served it. That model must be Claude Haiku 4.5, by one of the whole ids this deployment can return (`anthropic/claude-haiku-4.5`, `claude-haiku-4.5`, `claude-haiku-4-5`, or a dated snapshot of it), and it must be the model the run's first metered call reported: the manifest records it once (`servedModel`), before that call returns, and once the run's records show it measured, every resume holds to it. The model is on the disk before the run takes it as its own: a write that fails stops the run with the model uncommitted, never in memory and claimed by no record. The run's records are the authority on that model: each settlement in `requests.jsonl` made once a model is recorded claims it (`servedModel`), no cell is logged before one does, and each logged cell's provider calls name it (`runs.jsonl`, and `runs.superseded.jsonl` for cells a re-run replaced). A resume is refused, before anything is sent, when the manifest's `servedModel` is malformed (anything but a Claude Haiku 4.5 id and the time it was recorded), or names another model, or none, than the one the records show. So removing or replacing it by hand cannot release the run from the model it measured, and once a logged cell names that model, not even with the ledger deleted. When the records show no model, the run has measured none: it is fresh, it stopped before any reply could record one, or a reply recorded a model that no settlement claimed (that settlement, or the manifest's directory sync, failed, or the machine stopped first). A served model the manifest names is then set aside, whatever a hand edit made of it: the manifest records it (`setAside`, with when and by which invocation) on the disk before anything is sent, and keeps it through every later write, and the log and the report say so. A `setAside` that is not a non-empty list of entries in the shape the run writes refuses the resume too; the list is a record for the reader, with no say over the model. The resume records its first model afresh. Any reply but a refusal the Worker made before any provider call must report, itemized, a call that reached the provider. A call that breaks any of these stops the run cleanly. The cell in flight logs no record, the request is settled in `requests.jsonl` like any other, the summary and the report state the stop as `integrity`, apart from arm results, and the CLI exits 3. A resume continues the run once the cause is understood. Every stop stays on the record: each invocation's entry in `pacing.jsonl` carries it, and the report lists them all however the run ended, because a resume runs the cell each stopped again from its start, drawing its result again. A refusal that reached no model is released before these checks and is retried as before. Each call is held to its own model (Option B): the Worker names the model that served every call on that call's entry, read from the provider's response as soon as it arrives, so a parse retry, an unusable output and an answer the Worker could not serialize are ordinary results when every call reports its complete usage and the run's model. A call that names no model of its own (a call the provider rejected, which returned nothing, or one from a Worker before Option B) stops the run, as does a provider failure after a call, whose failed call reports no usage, and a reply whose top-level model (kept for the app) is not its calls' model. A resume runs a stopped cell again from its start. A stop whose own settlement cannot be written is reported as that write failure (`error`, exit 1), never as `integrity`: the record comes first, and the next resume raises the request to the most any request can cost.

**What the report holds.** The ADR-B3 decision per reference and provider, pooled over every evaluated result of every condition, refinements included, because the rule counts every call (tokens per success as the rule defines it: every metered evaluated run's provider-reported tokens, failures included, over that cohort's successes, never estimated, and a run with a call missing either figure leaves the cohort; the pass rate within the margin of both primitive arms; both boundaries inclusive; a minimum of 20 evaluated and 20 metered prompt threads per arm, with refinements counted as repeated observations of their prompt; 95% paired cluster-bootstrap intervals over the prompts every decision arm evaluated, and whether each criterion is clear or uncertain, or insufficient below the minimum of 20 prompts behind it (prompts every decision arm evaluated, and for the token figure those of them metered in the block and production arms), where no criterion is called clear; prompt-by-prompt paired counts; the decision recomputed with the add and remove refinements that did not change their lists as asked counted as failures, in each way of counting them that applies, and whether the verdict, or only its clarity, changes in any of those readings; and counts beside every rate), the fresh table per arm, every arm and condition by path (fallbacks by classification, budget remaining at fallback, invariant failures, budget exhaustion, and every condition pooled), selection accuracy with explicit null answers, omitted answers and planning failures counted apart, the refinement table with change, add-and-remove and retention rates, add and remove by block, and the failures to re-run. Named against positional encoding (ADR-B2) is set side by side per condition: the `block-positional` arm against the `block` arm. The decision reads the named block arm only.

**What the figures mean.** Latencies are execution time. The hosted pacer measures its own spacing and backoff waits on the monotonic clock a cell's latency uses, and each cell keeps them apart: `timings.pacingMs` beside the wall-clock figures, and an `execution` set that leaves them out (it still holds the harness's bookkeeping around each request). The report prints the execution medians, emit time among them, with the pacing median beside them. Input and output tokens are per success, the two parts of tokens per success. A passing add or remove refinement is checked for the operation it asked for (`live/operation.ts`): the refined surface against the prior one the same arm built, list by list (a node's children and the arrays in its props, each keyed by the node that owns it: for a node in a list, by its id where that id occurs exactly once in both surfaces, so a node that moves between lists keeps its own, otherwise by its place among its unmatched siblings of the same component, so a renamed or repeated id is never read as lists removed and added again), so an add must lengthen a list and shorten none, and a remove the reverse. The check judges the direction of the change, not its content or its size, and scores every arm the same way. A miss that left the surface unchanged is counted apart, and the report breaks the check down by block: an unchanged surface is the right answer where a template does not apply to the surface, but it is also what a refinement that ignored its instruction leaves (a block refinement that re-sends its prior call expands to exactly the same surface), so the readings that leave those misses out can excuse real ones. Under corpus v1 the check is a measurement beside the pass rate, never in it, because ADR-B3's pass is frozen with the corpus: under each decision the report instead recomputes it with some of those refinements counted as failures, one reading for each way of counting them that applies (the missed ones; the missed and mixed ones; and both again with only the misses that changed their surface), sets the readings side by side, and says from all of them whether the verdict, or only its clarity, changes. Under corpus v2 (amendment 2, adopted) the check is binding: a passing add or remove refinement that missed its operation is a failure in every arm, a mixed change passes, and the readings bracket the verdict with the pipeline's pass alone and with the mixed ones failing too. Parity scores the frozen checklist's labels and components. The corpus names no action names, which the plan behind ADR-B3 also lists in the checklist, and a checklist with nothing to check is counted apart rather than scored.

## Usage accounting (Phase 0.5)

Every model call Composer causes is recorded, and what it costs is shown on every turn. This is the measuring instrument for ADR-B3, and it is useful whether or not blocks graduate.

- **One record per provider call.** A `ModelCallRecord` (composer-core `usage.ts`) holds the operation (`plan`, `flow-plan`, `generate`, `refine`, `repair`), the attempt it served, provider-reported `inputTokens`/`outputTokens` when reported, a duration, and an outcome (`ok`, `unusable-output`, `provider-error`, `refused`).
- **Failed calls count.** In the browser, the gateway records every request before it returns or throws, so a `failed-adapter` turn still shows what it spent. The recorder is the record of truth; the audit report is the cross-check (`reconcileGenerationUsage`).
- **Nothing is guessed.** A provider that reports no usage is counted as unreported, never as zero. Scripted runs and requests refused before any provider call have `source: "none"`. Receipts never show estimates; the offline token estimates live only in this bench.
- **Turn ownership.** A turn records its own planning call; a refinement reuses the prior plan and reports none. Flow planning is one `flow-plan` record on the flow. Agent runs, which have no browser transport, derive their records from the audit report.
- **Timings.** Planning, first gated attempt, valid preview (today this is completion), emit, and total, all measured from submit.

**The `/api/propose` reply contract.** Usage is `{inputTokens, outputTokens}`, summed over the Worker's calls, with `calls: [{inputTokens, outputTokens, model, outcome, durationMs}]` listing each one. `model` (Option B) is the model the provider's response named, read when it arrived; a call the provider rejected, or whose response named none, has no `model`.
- **Every reply carries `calls`.** That includes errors sent after a provider call. A reply sent before any provider call has `calls: []`, and `capabilities: ["per-call-model"]`, which the harness's zero-cost probe reads.
- **The 502 keeps its error.** It stays `error: "provider-unavailable"` and adds `cause: "unusable-output" | "provider"`.
- **`maxCalls` is optional.** An optional request field of `1` or `2` caps the Worker's parse retry. It is absent today, so request bytes are unchanged, and Phase 1A sends `1` so that one request is exactly one provider call.
- **Deploy skew.** The browser still reads the legacy `{in, out}` usage.

## The twelve blocks

The external research ranked twelve block families. Admission is not by rank. A block enters only with governed vocabulary, native rendering or an accepted fallback, a prompt corpus, and a measured benefit.

| Research rank | Block | Status | Coverage in today's vocabularies |
|---:|---|---|---|
| 1 | Search, browse, compare | Later | Expressible on both references (Astryx: selectable-card, metadata-list) |
| 2 | Analytics dashboard | Vocabulary-gated | KPI cards and tables only; no chart vocabulary exists |
| 3 | Task workflow | Later | List and table views only |
| 4 | **Record manager** (`records-table`) | **Approved** | Native on both; per-row actions blocked (dropdown-menu is a casualty on Astryx, and its items carry no action on shadcn/ui v3) |
| 5 | Product detail, cart, checkout | Later | Expressible; host-authoritative pricing |
| 6 | Booking | Later | Pre-offered slots only; no date picker |
| 7 | **Step-by-step guide** (`guide-steps`) | **Approved** | Tables on both; checking off steps is presentation state |
| 8 | Quiz, assessment | Later | Expressible on shadcn/ui v3 |
| 9 | Calendar | Vocabulary-gated | Agenda table only |
| 10 | Map | Vocabulary-gated | List only; provider and licensing decision required |
| 11 | **Account access** (`auth-form`) | **Approved** | Native on both; autocomplete purposes are a vocabulary gap |
| 12 | Status monitor | Later | Expressible |

## Open decisions

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
- `apps/composer/experimental/blocks/*.blocks.json` holds the sidecars, approved by the owner. They are never statically imported.
- `packages/block-bench/` holds the bench, its goldens and its committed results. `pnpm test` fails on any drift; `pnpm --filter @dspack-studio/block-bench bench` regenerates them.
- `packages/block-bench/live/` holds the Phase 1B harness: the frozen corpus, the providers (hosted, Ollama, scripted), the arms, the metrics and decision rule, and the runner. `pnpm --filter @dspack-studio/block-bench eval:live` runs it; `baseline` records the deployment it compares against.
- `docs/blocks/BASELINE.md` fixes the production configuration the evaluation compares against.
