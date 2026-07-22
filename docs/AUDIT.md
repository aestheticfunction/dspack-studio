# Implementation-status audit: plan vs product (July 2026)

This audit maps the original dspack-studio implementation plan to the shipped
implementation, with evidence, and records the product-improvement pass that
followed it. Statuses: Complete, Partial, Missing, Intentionally changed.

## Capability map

| Capability | Status | Evidence |
|---|---|---|
| Repository and package structure (plan §9) | Complete, one deviation | pnpm monorepo: `apps/web`, `apps/agent`, `packages/{a2ui-ingest, astryx-renderers, agui-bridge, contracts, replay, scenarios}`. The planned `packages/provenance` never grew content (its function lives in `astryx-renderers/src/provenance.tsx` and `replay/src/node-history.ts`); the stub was removed in this pass. |
| Astryx renderer integration | Complete | `astryx-renderers/src/registry.tsx`: all 9 contract components render through real `@astryxdesign/core@0.1.4`, each wrapped with `data-a2ui-id` provenance tagging. CI drift-checks the contract vocabulary against the Astryx CLI. |
| Theme switching (FM-5) | Complete | 7 prebuilt Astryx themes + default, runtime `<Theme>` swap with light/dark, in the "restyle it" view. The FM-5 caption ("Nothing about this interface changed...") was added in this pass. |
| AG-UI bridge | Complete | `agui-bridge` isolates all `@ag-ui/*` imports and re-exports the sanctioned surface; SSE + protobuf re-encoding (`encodeEventBinary`) for the wire view. |
| A2UI rendering | Complete | `a2ui-ingest` isolates `@a2ui/react@0.10.1` / `@a2ui/web_core@0.10.3` (the stable 0.9.1 line, per plan); v1.0 catalog emitted and gated at contract build. |
| Replay fixtures | Complete | 6 fixtures, all `mode:"live"` recorded real runs (Ollama `gemma4:e4b` / `gpt-oss`), with per-event timings and provenance. Recording is gated (`record-fixture.ts` honesty flags; fixture-005/006 recorded through the browser by gated e2e tests, interactions included). |
| Timeline and time travel (FM-2) | Complete | `replay/src/player.ts` pure event-prefix reducers; scrubber + per-event ticks; e2e asserts un-building. |
| X-ray and provenance (FM-4) | Complete | Canvas click-to-trace, provenance card (node, catalog entry, creating/updating events, rules), reverse violet wash for the playhead delivery. This pass added a keyboard path: "trace" buttons in the inspector components tab. |
| Governed repair / "argues back" (FM-1) | Complete | fixture-001 carries two real repairs (`rule.destructive-requires-alertdialog`, `rule.alertdialog-action-label-specific`); gate ticker + gates tab show findings and verbatim repair messages. |
| Break-it mode (FM-8) | Complete | 7 conditions across 6 failure kinds through the ordinary RunView. This pass added offline behavior: three conditions replay their recorded catch when the local agent is absent (the deployed static site); live-only conditions say so plainly. |
| Scenarios | Complete | 6 ready (project-deletion, appointment-booking, recipe-creator, support-triage, onboarding, hotel-reservations); no planned placeholders remain. support-triage, onboarding, and hotel-reservations shipped 2026-07-21 with owner-authored governance (record-collection, data-collection, transactional-review) and live gpt-oss recordings (fixtures 010-016). hotel-reservations rode the selection vocabulary (list, selectable-card, metadata-list) that plan §17 deferred; the planned-entry shelf treatment stands by for the next expansion. |
| Recipe shared-state experience (FM-6) | Complete | Real dishes, per-serving amounts, constraint swaps; this pass added numbered cooking instructions that the constraint swaps rewrite, on both the deterministic and generated paths, and re-recorded fixture-006 (live `gpt-oss`, 2026-07-11) with the model laying out an instructions table and the labeled enhancement seeding responder content into it. |
| Live BYO-key mode | Intentionally changed | The plan's "browser BYO key" became "no credentials in the browser": modelRef selects `scripted` or local `ollama:*`; hosted keys live only in the agent's env. Stricter than the plan; documented in the UI. |
| HITL (FM-7) | Partial | Appointment booking pauses for slot selection and validates round-trips; the agent's question is not itself a governed AlertDialog. Post-MVP. |
| Fork / branching (FM-3) | Complete | Pure prefix forks with provenance + downloadable; deterministic live continuation (`POST /fork`, 409 on divergence); branch compare with state diff. |
| Audit reports / receipts (FM-12) | Complete | Canonical byte-match boundary + SHA-256, verifyReceipt, e2e recomputes the hash independently and asserts cross-run mismatch is loud. |
| Wire view (FM-9) | Complete | Raw ordered AG-UI events; protobuf shown as an explicitly labeled re-encoding. |
| Design-system swap (FM-10) | Missing by plan | Post-launch headline in the plan; not started. |
| Take-it-home / ds-mcp (FM-11) | Missing by plan | Post-launch in the plan; not started. |
| Documentation | Complete | README, IMPLEMENTATION_LOG, deployment, renderer-abstraction, this audit. |
| Deployment + AF-site integration | Complete | Static export on Cloudflare (studio.aesthetic-function.com); AF tokens/fonts transcribed from af-site `af.css`; prod-smoke suite runs against the deployed site. |
| Automated tests and honesty checks | Complete | Unit suites per package; ~21 Playwright specs incl. receipts byte-match, fixture import fidelity, a11y (axe), production smoke; CI gates contract sync + drift. |

## Intentional divergences from the plan

- **No conversation rail.** The pipeline emits no TEXT_MESSAGE narration;
  synthesizing one would violate the honest-magic rule. The gate ticker,
  finding cards, pipeline view, and tour carry the story instead.
- **No browser key entry.** Stricter than the planned BYO-key: credentials
  never transit the browser; local Ollama is the visitor-runnable live mode.
- **`packages/provenance` removed.** Provenance shipped as renderer tagging
  (`astryx-renderers`) plus event-log folds (`replay/node-history.ts`);
  a separate package was never needed.
- **Contract changes stay upstream.** CI byte-diffs
  `packages/contracts/astryx.dspack.json` against dspack main, so the recipe
  worked example there still lacks instructions; the studio-local authored
  surface carries them, and the labeled enhancement covers generated
  surfaces whose model omitted an instructions table. Upstreaming the
  example is owner-authored governance content (plan §17).

## The July 2026 product-improvement pass (this change)

1. Governance-first hero: the design-system story now precedes any protocol
   name; protocols are introduced in How-it-works.
2. Per-view helper line under the switcher; "worked example + themes"
   renamed "restyle it"; FM-5 caption added.
3. How-it-works pipeline diagram in the AF `.dgm` visual language (node
   cards over the green bus), static and screen-reader-readable.
4. Agent availability honesty: the switcher marks live/break when the local
   agent is offline; break mode replays recorded catches (fixture-001/003)
   or states live-only plainly; nothing dead-ends silently.
5. Recipe instructions end to end: responder data + steps rewritten by
   constraint swaps, authored surface nodes, enhancer table disambiguation
   by column names, content seeding at enhancement (labeled in the stream),
   fixture-006 re-recorded live.
6. Planned scenarios are reachable controls that reveal their blockers on
   tap/keyboard (previously title-attr tooltips, unreachable on touch).
7. Responsive: two-column panels collapse under 640px; main padding
   tightens; diagram collapses without its bus.
8. X-ray keyboard path via inspector "trace" buttons.
9. New e2e: `studio-shell.spec.ts` (comprehension layer), `break-offline.spec.ts`
   (production break-mode behavior, agent blocked at the network layer).
