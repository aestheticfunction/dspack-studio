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

Deviations:
- None from the approved architecture. Fixture #1 recording is in flight;
  if no local model produces a caught violation, fallback is a scripted
  fixture labeled mode:"scripted" plus a follow-up to re-record live
  (honest-magic rule keeps the distinction visible).

Follow-ups:
- Upstream: export `PipelineEvent` (+ consider `GateReport`) from
  dspack-gen's root entry.
- Record fixtures #2/#3 (clean run; multi-repair run) once #1 lands.
- Playwright e2e for the replay view (scrub assertions).
