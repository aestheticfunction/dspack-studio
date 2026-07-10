# apps/agent

Phase 2: the AG-UI agent server — an `AbstractAgent` wrapping dspack-gen's `runPipeline`,
translating pipeline events (start/attempt/repair/emitted/done/error) into AG-UI events
(RUN_*, STEP_*, CUSTOM dspack.gates / dspack.repair / dspack.emit / dspack.audit) and
delivering surfaces as A2UI operations via @ag-ui/a2ui-toolkit.

Note: @aestheticfunction/dspack-gen is not yet published to npm (the package is marked
private); this app will consume it as a git dependency pinned to a commit until it is
published.
