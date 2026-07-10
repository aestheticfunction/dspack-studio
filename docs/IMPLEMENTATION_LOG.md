# dspack-studio implementation log

Running log distinguishing completed work, discoveries, deviations from the
approved plan, and follow-ups. Newest entries at the bottom of each phase.

## Phase 1 — Foundation (2026-07-09) — COMPLETE

Completed:
- Monorepo scaffold (pnpm workspaces; turborepo deferred — plain `pnpm -r` is
  sufficient at this size; revisit when the build graph warrants it).
- `packages/a2ui-ingest` extracted from dspack-emit's demo + new `A2uiCanvas`
  (apps never import `@a2ui/*` — import-isolation rule).
- `packages/contracts`: astryx.dspack.json + hand-authored A2UI profile;
  catalogs v0.9.1 + v1.0 emit with A1/A2/A3 passing; worked example emitted.
- `packages/astryx-renderers`: all catalog components on `@astryxdesign/core`
  with `data-a2ui-id` provenance tagging; 7 prebuilt themes.
- `apps/web`: Next 15 static export; worked example renders; FM-5 theme dial
  verified changing pixels while surface JSON stays fixed; A2UI action
  dispatch verified (`alert_dialog` synthesized slug round-trips).
- Astryx vocabulary drift check (report-only) driven by `astryx component --json`.

Discoveries:
- Astryx built themes are named exports and need their theme.css imported
  (scoped by `[data-astryx-theme]`).
- Node 25 ships a stub `localStorage` global (getItem undefined without
  `--localstorage-file`) that crashes Next dev SSR through typeof guards;
  dev script sets the flag; canvas is client-only.
- `A2uiClientAction` is flat: `{name, surfaceId, sourceComponentId, ...}`.
- Contract drift vs Astryx 0.1.4 (card.variant, text.as) — found by the drift
  check, fixed in a spun-off session (contract now v0.1.4-aligned; drift check
  clean; text gained a semantic `type` prop).

Deviations:
- dspack-gen was not on npm (`private: true`) — resolved below.
- GitHub repo creation for dspack-studio requires owner action (permission
  classifier); repo remains local.

## Interlude — dspack-gen publish prep (2026-07-09) — COMPLETE

- Release prep merged as dspack-gen PR #38: publish metadata, `dspack-gen`
  bin (node shebang + --help), `RunOptions.emitProfile` (a2ui target was
  hard-wired to the shadcn profile — Astryx contracts refused with exit 3),
  OIDC release workflow, CHANGELOG. Externally validated from the tarball
  (node16 types, /core + root APIs, CLI exit codes).
- Discovery: `runPipeline` needed `emitProfile` threaded into `emitSurface`
  and per-version `transform` — found only by external-consumer validation.

## Phase 2 — Protocol infrastructure (started 2026-07-10)

Goal: agui-bridge event mapping, agent server wrapping runPipeline, replay
recorder/player, FM-2 timeline engine, fixture #1.

Completed:
- Published `@aestheticfunction/dspack-gen@0.1.0` verified on the registry
  (version, bin, engines, integrity) after a propagation wait; resolved into
  the workspace from npm (there was never a git dep to remove — Phase 1 only
  documented the plan). `apps/agent` consumes it as a runtime dependency.
- `packages/agui-bridge`: PipelineEvent -> AG-UI mapping (RUN_*/STEP_* +
  typed CUSTOM dspack.run.start/gates/repair/emit/audit; A2UI delivery as a
  `generate_a2ui` tool call whose RESULT carries the a2ui-toolkit operations
  envelope — legible to dojo/CopilotKit consumers). Also: FixtureAgent
  (AbstractAgent replaying fixtures client-side), SSE encoder wrapper, and
  deliberate re-exports so no other package imports @ag-ui/*. 4/4 tests.
- `packages/replay`: versioned fixture format (0.1) with an auditable
  mode: "live" | "scripted" field; recorder; pure event-prefix reducers
  (a2uiMessagesAt / gateStateAt / timelineTicks) = the FM-2 engine. Tests are
  driven through the real bridge mapper (5/5), including the scrub-backward
  reconstruction claim.
- `apps/agent`: node HTTP server streaming the governed pipeline as AG-UI SSE
  (content negotiation via the bridge encoder; BYO inference — modelRef in
  forwardedProps, anthropic only via server env); `record` script writes
  fixtures (with `--require-repair` for FM-1-grade recordings).
- `apps/web`: replay view with play/scrub timeline (colored per-event ticks),
  gate ticker, and you-are-here raw event card. Verified in-browser: playback
  builds the canvas; scrubbing back to event 2 un-builds it to zero.

Discoveries:
- dspack-gen S-gate reports use `status: "PASS"|"FAIL"|"SKIPPED"`, while
  audit A-gates use boolean `pass` — reducers/UI handle both (`gateFailed`).
- `PipelineEvent` is not exported from dspack-gen's package root — the bridge
  carries a documented structural mirror. Follow-up: export it upstream.
- gpt-oss:latest, given the FM-1 adversarial prompt ("just a red button that
  says OK"), complied with the contract on attempt 1 — the governed context
  steers models away from violations more strongly than expected. Getting a
  real caught-violation recording requires stronger pressure (explicit
  branding requirement) and/or a smaller model.
- gemma4:e4b with the stronger prompt exited 3 (passed lint, failed
  emission) — surfaces that lint clean can still be refused by the emitter;
  exactly the failure class the audit trail is for.

Fixture #1 (landed 2026-07-10, mode: live):
- 12-run sweep first produced a measured signature: 10/12 emitter refusals,
  all "component 'text' has children but its surface plan declares no child
  slot" — models express text hierarchy by nesting text nodes (the
  contract's own composition note invites it). S1/S2/S3-clean, unprojectable.
  Fixed as a profile CAPABILITY (not a contract change): catalog Text gained
  an optional `children` ChildList + childrenProp; `text` became optional
  (container nodes); TextRender renders nested children inside Astryx Text
  (as div when nested — p cannot contain p; zero nested-p verified in DOM).
- First post-fix attempt recorded the keeper: gemma4:e4b, 51s, 20 events,
  TWO governed repairs — attempt 0 omits the AlertDialog
  (rule.destructive-requires-alertdialog), attempt 1 obeys the adversarial
  branding requirement and labels the action "OK"
  (rule.alertdialog-action-label-specific catches the verbatim forbidden
  value), attempt 2 passes and emits. The final surface says "Delete
  Account". Verified end-to-end in the browser replay view.
- The contract v0.1.4 drift fix (spun-off session) is merged in the same
  commit; drift-check reports zero findings.

Deviations:
- None from the approved architecture.

Fixtures #2 and #3 (landed 2026-07-10, both mode: live):
- **fixture-002 "Clean first pass"** — ollama:gpt-oss:latest, 12 events,
  19.7s. Prompt: "A settings screen where a user can delete a project they
  own, with a clear explanation of the consequences." Arc: one attempt,
  S1/S2/S3 all PASS, emitted, audit passed (exit 0). Recorded first try with
  `--require-clean` (rejects any run that needed a repair).
- **fixture-003 "The emitter refuses"** — ollama:gpt-oss:latest, 12 events.
  Prompt asks for a dropdown menu to pick the reason for leaving. Arc:
  attempt 0 S3 FAIL (destructive rule) -> repair -> attempt 1 all PASS ->
  emitter refusal: "unknown component 'dropdown-menu': not a mapped
  component of the ... profile" -> audit failed-gate (exit 3). The refusal
  reason rides CUSTOM dspack.audit (report.emitted.refusal), verbatim.
  Recorded with the new `--allow-failure` flag (failures are first-class
  artifacts). Model-specific finding: gpt-oss reliably uses dropdown-menu
  when the prompt asks for one — the casualty path is easy to stage
  honestly.
- Recorder gained `--require-clean` and `--allow-failure` classes alongside
  `--require-repair`.

Replay experience + failure panel:
- Fixture picker (argues-back / clean / refusal) with one-line blurbs;
  reducers loosened to `EventSource` (any `{events}`) so a future live view
  can accumulate into the same shape and be scrubbable for free.
- Failure panel: when audit.outcome != passed, the run's ending is the
  refusal (verbatim from the audit report) instead of a surface; canvas
  shows "No surface shipped".

Playwright (6 tests, e2e/replay.spec.ts) runs against the STATIC EXPORT
(apps/web/out served by a zero-dep file server): playback, scrub forward,
scrub-backward reconstruction (FM-2), clean-run rendering, repair-run
rendering (asserts the final dialog says "Delete Account", not the
adversarial "OK"), refusal panel with the verbatim reason. Zero model calls.

Validation matrix (2026-07-10): bridge 6/6, replay 5/5, typecheck OK across
all six packages/apps, contract gates clean (A1/A2/A3 both A2UI versions),
static export builds, Playwright 6/6. Phase 2 exit criteria met.

## Run it Live + scenario framework (2026-07-10)

The unified event-source architecture, exactly as specified: a run is an
ordered `{ atMs, event }[]` whatever its source — recorded fixture, live
AG-UI stream, or a saved session. One `RunView` renders all of them; the
reducers, timeline, scrubbing, gate ticker, failure panel, and canvas are
shared. There is no separate live implementation.

Completed:
- `apps/agent`: GET / health, GET /models (Ollama discovery + "scripted"),
  CORS preflight. No credentials in code or requests (anthropic:* only via
  server env; the browser never carries a key).
- `apps/web/use-live-run.ts`: HttpAgent (via the bridge) streams the run;
  events accumulate with timings into fixture shape. Status machine:
  idle/streaming/finished/error/cancelled/offline; cancel (unsubscribe),
  retry (re-run last input), reset, agent health + model discovery.
- `RunView` (replaces replay-view): streaming mode follows the newest event
  (progressive rendering, live timeline); scrubbing detaches follow; on
  completion the run is immediately scrubbable. Recorded mode keeps paced
  playback. Bug found live: deriving the reset key from the label reset the
  playhead when streaming finished — resetKey is now an explicit prop.
- `LiveView`: seed prompts, free prompt, model picker, run/cancel/retry/
  reset, status line, agent-offline panel (with the exact command to start
  the local agent), and "download fixture" — a completed live run exports as
  a session fixture (the third event source, already round-trippable).
- `packages/scenarios`: scenarios as data ({intent, seedPrompts,
  breakItPrompts, fixtures, status}). "project-deletion" is the ready
  reference scenario (3 live fixtures); onboarding / support-triage /
  appointment-booking / recipe-creator / hotel-reservations ship as
  status:"planned" entries stating what they wait on (contract expansion is
  owner-authored governance content). The studio shell is fully
  scenario-driven: shelf -> replay | live | themes; zero per-scenario UI.
- Playwright grew live-mode coverage (scripted adapter, deterministic):
  stream->render->outcome->scrub, run-again, reset+download. Config runs two
  webServers (static export + agent). 9/9, run twice for stability; two
  non-waiting count assertions replaced with auto-waiting ones.

Verified live in-browser (not just tests): a real ollama:gpt-oss run from
the Run button — 2 -> 6 -> 16 events streaming progressively, an S3 catch +
repair mid-run, final surface rendered, then scrubbed backward; cancel
mid-stream -> "cancelled" + retry offered.

Validation (2026-07-10): unit 6/6 + 5/5; typecheck OK x7 packages/apps;
contract gates clean; static export builds; Playwright 9/9 twice.

## Session import + HITL + shared state + appointment booking (2026-07-10)

Pushed: origin = github.com/aestheticfunction/dspack-studio, main tracks
origin/main.

Session import (third event source, closed):
- `importFixture` in packages/replay: strict user-facing validation — 5 MB /
  5000-event caps, version check (0.1 only), per-event shape check, mode
  whitelist. 4 unit tests + 2 e2e (malformed JSON, future version).
- Replay pane: file picker + drag-and-drop; imported sessions labeled
  "(imported)" with provenance (recordedAt, prompt); identical RunView path.
- Round-trip proven by e2e: run live -> download -> import -> scrub to the
  same state.

HITL action round-trips:
- STUDIO_EVENT namespace (studio.action.pending/accepted/rejected/cancelled/
  failed) separate from dspack.* pipeline events; every state carries the
  same correlation actionId. UI events, agent events, and pipeline events
  are distinct namespaces in one ordered stream — replay-safe by
  construction.
- Client: sendAction (dedupe per name+source while in flight; UUID
  correlation; failure appends studio.action.failed; retry = re-send).
  Server: POST /action, idempotent by actionId (duplicates return the
  original response), scenario-neutral responder registry.
- Acting on the surface re-attaches the live follow (found by e2e: after
  scrubbing, a canvas action must snap the playhead back to now).

Shared-state co-editing (public mechanisms only):
- A2UI updateDataModel ops ({surfaceId, path, value}) = partial updates,
  ordered by the event stream; user input is optimistic-local via the
  binder's generated setters (TextFieldRender uses props.setValue when
  bound); an ACCEPTED action commits its submitted values back into the
  data model (sync-on-action per the A2UI spec) — that commit is what
  survives replay/reconstruction. Conflicts: agent-authoritative on action
  (last-committed-wins), validation rejections update /booking/status and
  ride studio.action.rejected verbatim.

Appointment booking (first interactive scenario):
- Structure from the contract: surfaces/appointment-booking.dsurface.json,
  emitted by dspack-emit at build (unscoped rules apply; note the emitter
  slugifies ids: name-input -> name_input).
- The agent adds the interaction OVERLAY (bindings + named actions with
  context paths) — exactly the layer dspack v0.4's Deliberate Ceiling
  declares out of contract scope; documented as evidence.
- State schema /booking/{name,slot,status,confirmed}; actions select_slot /
  confirm_booking / cancel_booking; deterministic responder (no provider,
  no model). Full arc verified in-browser AND by e2e: validation rejection,
  hold with committed name, confirm -> "Booked 10:30 for Ada", scrub-back
  reconstruction, start over.
- Rendering discovery: the published @a2ui/react renderer memoizes resolved
  props per surface — bound-value updates require remounting the canvas per
  delivery (keyed on ops count). A transient mid-edit compile error also
  produced a stale-bundle debugging detour; verify compile state first.

Governance boundary (owner decision needed for the LIVE-generation path):
- The contract has no `scheduling` intent, so `run it live` with a model is
  gated for booking (deterministic start + HITL work without it). Proposed
  draft for owner review:
  intents += { id: "scheduling", name: "Scheduling",
    description: "Surfaces that collect a time choice and confirm it." }
  examples += ex.book-consultation (the authored booking surface, verbatim);
  optional rule: required-composition — a scheduling surface must carry at
  least one button (the confirm affordance). Compatibility: additive
  (v0.4-safe); no existing rules change; fewshot grows by one example.

Validation (2026-07-10): frozen-lockfile install clean; unit 6/9/5;
typecheck OK x7; contract gates clean; drift-check clean (1 unverifiable
alias); static export builds; Playwright 13/13 twice (replay 6, live 3,
interactive+import 4).

Follow-ups:
- Upstream (dspack-gen): export `PipelineEvent` (+ consider `GateReport`)
  from the package root.
- Upstream (contract, owner decision): intents/rules/examples for the five
  planned scenarios; ceiling note for degenerate empty text-in-text chains.
- Load a downloaded session fixture back into the replay view (file-open) —
  the format already round-trips.
- HITL + STATE_DELTA co-editing (appointment-booking / recipe-creator
  prerequisites).

## Scheduling governance wired through (2026-07-10)

Owner-approved, additive: intent `scheduling` + worked example
`ex.book-consultation` (the authored booking surface, verbatim) added to the
AUTHORITATIVE contract (dspack repo, branch claude/agitated-lovelace-016480 —
which also now carries the previously-uncommitted v0.1.4 drift fix as its own
commit). Copies propagated to dspack-emit/input and packages/contracts.
NOTE: dspack-gen's check:sync gates against GitHub main — it will fail
upstream until the branch merges (owner PR).

Rule hypothesis (documented, NOT added, per owner decision):
- Intended failure mode: scheduling surfaces that collect a time but give
  the user no way to commit it (dead-end forms).
- Would correctly reject: a slot list with no confirm affordance; a name
  field + slots with only decorative text.
- Could incorrectly reject: availability browsing, reschedule/cancel views,
  "no slots available" informational states, read-only calendar summaries.
- Narrower candidate: apply only to a terminal booking-confirmation intent
  (e.g. `scheduling-confirmation`) or gate on a `confirmed`-writing action
  being reachable — needs eval evidence first.

Validation of the change: scheduling context compiles (fewshot=2, includes
booking); example lints S1/S2/S3 PASS; destructive-action context unchanged;
both A2UI catalogs gate clean; drift-check clean.

Mini eval vs baseline: pre-change, scheduling generation was IMPOSSIBLE (no
intent). Post-change: 3/3 live gpt-oss generations for "a screen to book a
consultation time" passed all gates first-attempt (no refusals, no
projection failures, no repairs). fixture-004 ("Scheduling, generated live",
mode live) recorded. Full 216-run matrix rerun: queued follow-up.

Booking live path: interactive scenarios now offer BOTH "start scenario"
(deterministic, the CI-stable fallback) and "generate live" (real pipeline
under the scheduling intent); labels stay honest (adapterId per run).
Finding: generated surfaces carry synthesized action slugs (not the
select_slot overlay), so HITL responses reject them gracefully as unknown
actions — wiring generated actions to responders is next-block work
alongside the inspectors, recipe-creator, and the remount benchmark.

## Generated-action resolution layer (2026-07-10, in progress)

PR verified: dspack#20 (OPEN) carries the drift fix + scheduling governance.
Full eval matrix (P5) waits on its merge (check:sync gates on GitHub main).

Implemented (unit-tested, wired, committed):
- packages/scenarios/capabilities.ts: scenario-neutral resolution.
  Capabilities declare exact action names AND component-grounded matchers
  with VALIDATED semantics (e.g. select_slot grounds on a Button whose label
  parses as HH:MM — never bare label-string matching hidden in code).
  resolveAction(action, surfaceComponents, capabilities) is pure ->
  deterministic in replay; preserves the original (synthesized) identifier
  as provenance; single-hit resolves, multi-hit -> "ambiguous", no-hit ->
  "unsupported" (both rejected clearly, never guessed). 5/5 tests incl.
  synthesized slugs, ambiguity, determinism.
- replay: surfaceComponentsAt reducer (latest component defs at playhead).
- Client: LiveView resolves before dispatch (works for deterministic AND
  generated surfaces); studio.action.resolved/unresolved recorded in the
  stream with method + provenance; unresolved actions never POST.
- Agent: /action dispatches on capability ?? name (idempotency unchanged).

Remaining in this block (next session): e2e verification of a generated
scheduling interaction + fixture-005 recording; progressive-disclosure
inspectors (P2); recipe-creator foundation + governance proposal (P3);
canvas-remount benchmark (P4); full matrix after dspack#20 merges (P5).

P1 continued (2026-07-10): generated-surface enhancement shipped —
enhanceGeneratedOps grounds ONLY unambiguous components (single TextField ->
/booking/name, single caption Text -> /booking/status, time-token-labeled
Buttons -> select_slot with context paths, single primary -> confirm, single
ghost -> cancel), every attachment recorded via CUSTOM
studio.surface.enhanced. Slot semantic widened to labels containing exactly
one HH:MM token (gpt-oss generates "Mon 9:00"-style labels); the same
extraction (slotFromLabel) is shared by client matchers and agent
enhancement. Verified in-browser: a generated scheduling surface rendered
with enhanced bindings and the initial data model ("Pick a time to begin."
via binding). A second generated run hit the emitter-refusal class (exit 3,
natural variance) and the failure panel handled it as designed. Pending
next session: full generated-interaction happy path in-browser + Playwright,
fixture-005 recording, then P2 inspectors, P3 recipe proposal, P4 remount
benchmark, P5 matrix (blocked on dspack#20 merge).

## P1 sign-off, inspectors, recipe foundation, benchmark (2026-07-10)

Merge verified: dspack/main = 86dbe85 (PR #20; drift fix 9857b85 +
scheduling 7085835). dspack-gen check:sync re-synced (--write) with FA
goldens regenerated deliberately (rationale strings now cite v0.1.4);
93/93; committed on branch sync/astryx-scheduling-contract. All three
contract copies verified byte-identical to GitHub main.

P1 SIGNED OFF:
- Scripted adapter is intent-aware (plays the worked example for the
  requested intent) — CI has a deterministic generated-booking path.
- fixture-005 (mode live, ollama:gpt-oss:latest, 27 events, 9.5s): generation
  under the merged scheduling intent -> gates -> studio.surface.enhanced
  provenance -> resolved->pending->accepted twice (slot, confirm) ->
  /booking/confirmed=true, "Booked Mon 9:00 AM for Ada". Recorded via the
  gated RECORD_LIVE Playwright spec (retry budget 4; first recording attempt
  failed on ESM __dirname — fixed to process.cwd()). Registered as the
  booking scenario's replay fixture; replayable in-app.
- e2e: deterministic generated path (pipeline -> enhancement -> semantic
  resolution -> confirm -> scrub reconstruction incl. committed name).

P2 INSPECTORS: closed-by-default disclosure inside RunView; tabs state
(model + ordered patch log with delivery correlation), actions (lifecycles
by correlation id, resolution method, rejection detail), events
(category-colored: run/step/pipeline/a2ui/user-action/agent-response/
enhancement), a2ui ops, gates (findings + repair messages + refusal),
components (bindings ⇄ paths, grounded actions). All panels are prefix
folds — synchronized with scrubbing by construction; 4 reducer unit tests
assert no-future-state; 4 e2e tests assert backward/forward sync against
fixture-005. Identical across live, replayed, imported sessions.

P3 RECIPE FOUNDATION (deterministic; governance proposal below, not applied):
- Authored contract surface (surfaces/recipe-creator.dsurface.json, intent
  structured-editing) emitted via the generalized surfaces/ build loop.
- Agent module: servings rescale the ingredients Table via updateComponents
  (component-level co-editing beyond DM patches), constraints validate
  against a known set (unknown -> recoverable rejection), regenerate cycles
  deterministic variants preserving servings+constraint; per-session state
  cleared on scenario start (first suite run exposed cross-run session
  leakage — fixed). 4 unit tests; 3 e2e tests incl. export.
- Scenario-neutral shell: SCENARIOS registry (start + respond) in the agent;
  capabilitiesByScenario in the scenarios package; live view reads both.
  "generate live" is hidden for scenarios with unmet governance needs.

P4 BENCHMARK (measured, then one adapter-level fix, no renderer changes):
- 8 rapid interactive deliveries: click->paint mean 39-45ms; total processor
  time 3.4ms (≈0.1ms/rebuild) — processing cost is a non-issue at this scale.
- Found 32 rebuilds for 8 deliveries (array-identity effect deps); fixed by
  keying the processor effect on messages.length (a prefix accumulator ⇒
  equal length = identical content): now exactly 1 rebuild per delivery.
- The real user-facing cost is FOCUS + DRAFT-INPUT LOSS on delivery
  (focusRetained=false, draftRetained=false): inherent to the remount
  workaround for @a2ui/react's per-surface memoization of resolved props.
  Verdict: acceptable for scheduling and recipe (typing precedes actions;
  agent patches land after actions, not mid-keystroke). A real fix means
  upstream reactive re-resolution in @a2ui/react — filed as a follow-up,
  explicitly NOT fork-worthy on this evidence.

P5 MATRIX: running (216 live runs, json-render target, byte-comparable to
the m3 baseline 67/216; ~14 runs in, gemma segment). Note the matrix
prompts are all destructive-action — it measures regression on the
unrelated intent (the fewshot corpus now includes ex.book-consultation
cross-intent); scheduling-specific numbers come from the recorded live runs
and a supplementary prompt set if regression review warrants it.

Validation: frozen install clean; unit 6/13/5/9; typecheck OK x7; contract
gates + drift clean; export builds; Playwright 21/21 twice (+2 gated).

## Break-it Mode, renderer abstraction, distributed eval (2026-07-10)

Ecosystem sync PRs merged upstream (dspack-gen#39, dspack-emit#19);
check:sync green on dspack-gen main.

DISTRIBUTED EVAL (zero framework changes): the 216-run matrix now executes
on two hosts sharing one outDir — the local worker in matrix order, a
remote worker (OLLAMA_HOST=<remote-gpu-host>, model digests verified identical)
walking a reversed-model-order COPY of the same matrix from the far end.
--resume treats retained per-cell reports as completed observations, so the
partitions converge without coordination; the canonical results.json comes
from a final --resume pass over the ORIGINAL matrix file (identical prompts,
models, scoring, aggregation, and report ordering). Host attribution =
per-process logs (/tmp/eval-matrix{,-remote}.log), preserved with the run
config. Second offered host (host-2) unreachable — documented.
Duplicate execution is possible only for cells in flight at the partition
meeting point (wasted compute, never duplicate observations: one retained
report per cell run). No methodology change; no runner redesign.

BREAK-IT MODE (FM-8): breakConditions data (7 curated conditions:
no-alertdialog, OK-label, unsupported component, malformed generation,
ungroundable action, invalid shared state, malformed import) + agent-side
BREAK_SCRIPTS (authored violating->repaired surface pairs played through the
ORDINARY pipeline by the scripted adapter — deterministic, CI-safe, labeled
scripted; live-model variant uses the same visitor-typable prompt). BreakView
tab: pick a condition, read the expected outcome, run it, watch the gates/
repair/refusal in the same RunView + inspectors; replay/scrub/export
inherited. 6 e2e tests (27 total passing).

RENDERER ABSTRACTION: docs/renderer-abstraction.md states the verified
boundaries (AG-UI -> A2UI -> AF contract -> renderer adapter -> design
system), interfaces (Registry, buildCatalog, render contract), capability
discovery (BuiltCatalog.names/unimplemented), unsupported-component
behavior, theme ownership (design-system layer only), and the exact swap
requirements. Validated by registry-abstraction.test.ts: a minimal plain-
HTML alternate registry against the REAL emitted catalog proves the catalog
owns vocabulary/schemas and a registry cannot widen or narrow them. No
migration performed.

Validation: frozen install; unit 3/6/13/5/9; typecheck x8; contract gates +
drift clean; check:sync green; export builds; Playwright 27 passed
(+2 gated).

Host-2 probe (2026-07-10, per owner instruction): host-2 reachable;
Ollama 0.31.1; model digests identical to local + host-1 (gemma4:e4b
c6eb396dbd59, qwen3.6:35b 07d35212591f, gpt-oss 17052f91a42e). Throughput
probe (gemma, fixed 120-token budget): 2.6 tok/s vs 33.8 tok/s on host-1 —
CPU-only in practice (CUDA_VISIBLE_DEVICES=-1; GPUs held by VLLM), 13x
slower on the smallest model. Remaining matrix cells are qwen-35B + gpt-oss
only — the worst fit for CPU. DECISION: left unused (contribution would be
negative wall-clock); no evaluation cells assigned; methodology unchanged.

## Launch-readiness block (2026-07-10)

Matrix untouched throughout (isolated in dspack-gen/out/eval/...; no eval
files modified). Progress checked without interruption.

CI: .github/workflows/ci.yml — frozen install, contract gates, authoritative
sync check (curl diff vs dspack main), Astryx drift check (local CLI, no
network), all unit suites, typechecks, static export, Playwright against the
deploy artifact (deterministic paths only; RECORD_LIVE/BENCH specs skip);
pnpm + Playwright-browser caching; report artifact on failure.

Deployment: docs/deployment.md (launch topology = static-only export to
Cloudflare Pages; live topology optional/owner-gated; health checks;
rollback = redeploy prior immutable artifact; agent stateless). .env.example
placeholders only. Agent CORS hardened: AGENT_ALLOWED_ORIGINS allowlist
(dev default *), origin echoed only when allowed, vary: origin. Verified no
private hosts/keys in the client bundle (browser sees model refs only).

Accessibility: axe (wcag2a/2aa) e2e suite + keyboard-operability test.
Real defects found and fixed: planned-chip contrast 3.36:1 -> 0.62 opacity;
inspector event-category and gate-status text palettes darkened to >=4.5:1;
tablist contained non-tab children (restructured); model select lacked an
accessible name; timeline ticks gained aria-labels; status/audit/canvas-empty
regions aria-live=polite. Automation is the floor: manual keyboard/SR passes
remain on the release checklist.

Performance (production artifact): first-load shell 103 kB; the app chunk
(Astryx + A2UI + all fixtures) is 2.1 MB uncompressed loaded async (fixtures
148 KB total); export 3.6 MB. Verdict: no optimization warranted at these
numbers; import caps (5 MB / 5000 events) bound large-session behavior;
repeated replay/reset and agent-disconnect recovery are exercised by the e2e
suite. No renderer or event-architecture changes.

Docs: CONTRIBUTING.md (setup, tests, fixture recording + provenance, adding
scenarios, governance boundary, mermaid architecture diagram, known
limitations incl. focus-loss ceiling, troubleshooting incl. the .next
corruption trap); README already MVP-focused; docs/release-checklist.md.

Validation: Playwright 29 passed (+2 gated) incl. 4 axe + keyboard tests.

## 216-run matrix complete (2026-07-10) — authoritative evaluation

Config preserved in dspack-gen/out/eval/scheduling-2026-07-10/ (results.json
with matrixSha256 a369d0d4… and contract sha e6c1632f… [dspack 0.4, Astryx],
canonical + execution-order matrix copies, both worker logs, all 216 retained
audit reports). dspack-gen at 07774f6; json-render target — byte-comparable
methodology to the m3 baseline (67/216 on the v0.1.2 contract).

Headline: 192/216 passed (88.9%) vs baseline 67/216 (31.0%). First-attempt
pass 141/216 (65.3%); repair success 51/67 (76%); ZERO emitter-gate
failures and ZERO s3-clean-but-refused (m3 had 7 residual — the ADR-D1
class is extinct in this configuration); 16 lint-exhausted; 8 failed-adapter
(qwen transport, infra class). Per model (passed/72): gemma 64 (was 17),
qwen 59 (was 9, incl. the 8 infra failures), gpt-oss 69 (was 41). Top rule
fired on first attempts: destructive-requires-alertdialog (61) — the rules
still catch; models now repair. Worst prompt a01-delete-project 12/18.

Attribution honesty: the local worker predated --resume and executed all 216
runs; the remote GPU worker independently executed ~97 overlapping cells
(reversed order, --resume) — each retained report is one valid observation
of the exact cell config; per-cell host provenance is a documented mix.
Distributed execution changed nothing methodological (same matrix, prompts,
models, scoring, aggregation; canonical pass over the original file).

Interpretation limits: the delta vs m3 conflates (a) the v0.1.4 contract
alignment (text.type semantics) and (b) the added cross-intent worked
example — not separable without an ablation run. What IS clean: adding
ex.book-consultation did not regress the destructive intent (it improved
3x alongside the drift fix), scheduling generation went from impossible to
first-attempt-clean in targeted runs, and no evidence supports any
scheduling rule (zero scheduling failures to justify one).

## Recipe governance applied + live path (2026-07-10, in progress)

Owner approved structured-editing + ex.recipe-creator (no rule). Applied to
the authoritative dspack contract on branch feat/structured-editing-intent —
PR #21 (aebecb4 + 3d6819d). Validated: example lints S1/S2/S3 clean;
few-shot contexts are INTENT-SCOPED (verified) — a correction to earlier
reporting: adding examples never changes other intents' contexts, so the
matrix improvement attributes to the v0.1.4 alignment, not few-shot growth.
Studio copy propagated byte-identical to the branch; both catalogs gate
clean. Studio CI's sync check stays red until PR #21 merges (expected).
dspack-gen/dspack-emit sync PRs follow the merge (established chain).

Live recipe generation: enabled under structured-editing; scenario registry
now carries per-scenario enhance hooks (booking + recipe); recipe
enhancement grounds only the unambiguous (single TextField ->
/recipe/constraint, single caption -> /recipe/status, single primary ->
regenerate, single secondary -> apply_constraint) — servings buttons stay
ungrounded by design (no validated semantic for +/- deltas; resolution
rejects them clearly). Deterministic path unchanged (CI fallback, offline
mode, curated demo, comparison baseline) — same state/capabilities/
transport/rendering/timeline/inspectors/replay/export.

fixture-006: BLOCKED on a measured signature. After the worked example's
empty table was populated with literal rows (teachability fix, amended into
PR #21 — generated tables then carried correct columns/data shapes), gpt-oss
still emits table-as-container (rows as child nodes) in 6+ consecutive
runs -> emitter refusal "component 'table' has children but its surface plan
declares no child slot". Same class as the Text-children finding (measured,
systematic, profile capability gap — Astryx Table natively supports a
children mode via TableRow/TableCell). NEXT STEP: synthesize TableRow/
TableCell catalog primitives + Table childrenProp in the profile with
matching renderers, then record fixture-006. Retries are not the fix.

Queued in this block: fixture-006 (after the Table capability), FM-9 Wire
View, FM-3 Fork UX, matrix archive doc.

### fixture-006 root-cause investigation (2026-07-10, evening)

The table-children capability landed (profile: catalog Table gained an
optional children ChildList; renderer: Astryx Table children mode via
TableRow/TableCell, flat children chunked into rows of one cell per
column) and eliminated the emitter-refusal class — but recordings still
failed: generated surfaces were minimal 3-6-node prefixes, text-less,
table-less. The investigation, in order of falsified hypotheses:

1. Context-window overflow (Ollama default 4096) — falsified: raising
   num_ctx/num_predict per request changed nothing; done_reason was
   "stop", not truncation. (The num_ctx raise is kept as headroom.)
2. Pipeline-vs-probe difference — falsified byte-for-byte: captured the
   adapter's outgoing body and diffed against a hand-built request;
   identical. It was sampling from one distribution all along.
3. Read the model's reasoning: gpt-oss PLANS the full rich surface
   (title text, populated table rows, constraint input, regenerate) and
   the constrained output then omits exactly what the grammar forbids.

Root cause, twofold, in dspack-gen's generation schema (grammar-
constrained decoders enforce declared shapes and property order):
  - Array-typed contract props fell through to { type: "string" } — the
    grammar FORBADE the arrays the model plans (table columns/data);
    forced deviations derailed generation right where the table starts.
  - Node properties declared text BEFORE props, while models and the
    worked examples serialize props first — node text was unreachable
    once props was emitted (text-less nodes in every live generation).

Fixes, each at its owning layer:
  - dspack-gen PR #40 (0.1.1): array props emit as arrays with optional
    contract-declared items passthrough; property order is component,
    id, props, text, children. 93/93 tests, golden regenerated.
  - dspack PR #21 (amended): table columns/data items typed (strings /
    { cells: string[] } records — matching the approved example and the
    A2UI projection; the old description claimed [{key, header}] objects
    the example never used). An earlier same-day example-reorder commit
    went the WRONG direction and is reverted on the branch.
  - Studio: enhancer grounds apply_constraint by validated label
    semantics (exactly one non-primary button labeled ~constraint — the
    slotFromLabel precedent); "single secondary" could never ground on
    example-mirroring surfaces (the example itself has three).
Measured end-to-end with local fixed source + typed contract: rich runs
carry typed columns and node text (probe: 18 nodes, 10 textful); the
minimal mode persists at ~50% but 4 recorder retries cover it (~94%).

BLOCKED: recording fixture-006 waits for dspack-gen 0.1.1 on npm (the
flagship proves the published packages; recording against unpublished
source would break the audit's schemaSha256 provenance). FM-9/FM-3
proceed meanwhile — replay-layer work, independent of generation.
