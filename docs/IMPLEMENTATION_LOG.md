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
