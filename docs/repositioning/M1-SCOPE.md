# M1 scope and dependencies, updated at R0

**Status:** proposal for owner review at R0. M1 is not authorized.

This replaces the M1 row in PROPOSAL.md section E3 where they differ. Changes from the proposal are marked **(changed at R0)** with the M0 evidence behind them.

## Goal

Make compositions real in the experimental build: one definition, many governed instances, data and actions declared, and proven against an independent A2UI host before any Playground work starts.

## Order of work

| # | Work | Gate or review | Notes |
|---|---|---|---|
| 0 | Merge decisions for the M0 pull requests, and N1 to N5 in DECISIONS.md | Owner | M1 builds on fix (a)'s `scriptedReplaySource` and `acceptedExampleEntry` |
| 1 | ADRs R1 to R4 finalized; compositions RFC drafted (documents only, D12) | Owner sign-off | |
| 2 | Interaction contract: types, loader, store, an additive project-file field. **The default build carries the new keys through import, save and export untouched** (changed at R0: today unknown keys are dropped on read, so this ships in the default build even though nothing uses it there) | Tests: round-trip of a newer project file in the default build | |
| 3 | Sidecar 0.2 dispatcher; 0.1 upcast in memory; ratchet that the Phase 1B goldens and request hashes reproduce byte for byte | | |
| 4 | Expander: data input, trace and bound mode; load-time checks | Goldens per composition, state and scenario | |
| 5 | **Interoperability spike, gate R1a.** One composition (hotel results), three data sets including one the rules refuse; S1 to S3 and A1 to A3 on each; A2UI 0.9.1 messages; the upstream validator check from PROTOCOL.md on every instance (level 1); render in a standalone host on an unmodified upstream React renderer outside `apps/composer` (level 2) | **Owner review before step 6 onward** | (changed at R0) PROTOCOL.md's scripts are reused as the level 1 check. The spike uses 0.9.1 only: final 1.0 needs upstream emitter work |
| 6 | Binding compiler by tracing; bindability map from the emitted catalog; gates I0 to I3, rule coverage and update integrity, with every negative test listed in ADR R4 | | |
| 7 | Template children in `a2ui-ingest` and the renderers | Proven neutral for the default build by the existing parity tests and exhibit suite | Shared packages |
| 8 | Compose canvas preview with scenario and state pickers, and a report of what is bound, expanded or unbindable | | Built in the "one workspace, three coordinated views" direction if N5 is accepted |
| 9 | Promote to composition (canonical comparison) | | |
| 10 | Library, evolved from the Blocks catalog section | | |
| 11 | Storage: a migration and backward-compatibility design for owner review (D14), then the migration | Owner review of the design first | |
| 12 | Hash routes for project and view (deferred from M0) | | In the new shell |
| 13 | Example-integrity review in the product (if N3 is accepted) | | Uses the detector from fix (a)'s branch |
| 14 | Task plan, plan checks, composition discovery, the wiring proposal | Live measurement only if authorized (N2) | |
| 15 | First compositions with scenarios: hotel search, hotel results, a multi-variant mutation confirmation from corpus prompt 8 | | Under the purposes from N4 |

## Dependencies

| On | For | Status |
|---|---|---|
| Owner decisions N1 to N5 | Steps 0, 8, 13, 14, 15 | Open |
| A2UI upstream React renderer, a published release | Step 5, level 2 | Available (0.16.1); the spike uses it standalone, without upgrading Composer's pin |
| dspack-emit final-1.0 support | Public release (D6), not M1 | Not started; Track 2 |
| Any sibling repository | Nothing in M1 | M1 needs no upstream change |

## Acceptance (unchanged from the proposal, plus)

- **(changed at R0)** Every composition instance produced in M1 passes the upstream validator check in PROTOCOL.md, not only Composer's own A3.
- **(changed at R0)** A default build opens, saves and exports a project file written by the experimental build without losing any key.

## Explicitly not in M1

The Playground, stateful flows, live agents, publishing and MCP tools, the `@a2ui/*` upgrade, A2UI 1.0 surfaces, and any change to production configuration.
