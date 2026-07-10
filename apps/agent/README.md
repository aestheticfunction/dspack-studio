# apps/agent

Phase 2: the AG-UI agent server — an `AbstractAgent` wrapping dspack-gen's `runPipeline`,
translating pipeline events (start/attempt/repair/emitted/done/error) into AG-UI events
(RUN_*, STEP_*, CUSTOM dspack.gates / dspack.repair / dspack.emit / dspack.audit) and
delivering surfaces as A2UI operations via @ag-ui/a2ui-toolkit.

## Dependency plan (post publish-prep, 2026-07-09)

- `@aestheticfunction/dspack-gen@^0.1.0` in this app's `dependencies` (runtime,
  not dev): release 0.1.0 is prepared on the `release/npm-0.1.0` branch of the
  dspack-gen repo and validated from a local tarball; switch from tarball to
  the registry version once the owner publishes.
- The bridge calls the programmatic API directly — `runPipeline({ contract,
  intent, prompt, adapter, emitProfile, onEvent })` — with:
  - `emitProfile: astryxProfile` from `@dspack-studio/contracts` (added in
    0.1.0: without it the a2ui target is hard-wired to the shadcn profile and
    refuses Astryx surfaces with exit 3),
  - `onEvent` feeding the agui-bridge event mapping (no NDJSON hop in-process).
- `dspack-gen serve` (NDJSON over localhost) remains the *external* integration
  point for local dev and the existing Playwright harness; the deployed agent
  wraps `runPipeline` in-process instead.
- Compatibility: ESM only, Node >= 20 (we run 22+ for Astryx anyway);
  `@aestheticfunction/dspack-emit@^0.3.1` stays aligned with the contracts
  package's own dependency.
