# R1. A composition is an interface block, evolved

> **Amended at R1a** (2026-11-26, from [R0-REVIEW.md](../R0-REVIEW.md) §6.1 item 6 and A10). Sidecar 0.2 is the composition format (`packages/composer-core/src/compositions/schema.ts`). A composition has parameters (a block's props, fixed at authoring or approval), data (validated at instantiation), inputs, actions with literal payloads, and states. Each state has its own purpose, a guard in a closed form and its own template. A 0.1 sidecar is upcast in memory: every block becomes a composition with one always-state per intent. Expanding it equals the block expander byte for byte on every packaged example (`load.test.ts`), and the 0.1 file is never rewritten. **Version coexistence** of an approved version beside a newer draft of one composition is explicitly deferred: the loader refuses two compositions with one id. The decision is owed before any "draft, approved, v-number" interface.

**Status:** draft for review. Accepted in principle by the owner as D1 (2026-11-24).

## Context

Composer needs reusable, named, versioned arrangements of components that an agent can find and fill with task data. The experimental interface blocks (`packages/composer-core/src/blocks/`, `docs/blocks/RFC-dspack-blocks.md`) already have a stable id and integer version, a closed typed signature, a closed expansion template, declared action names, gates B0 to B2 and H1, provenance that re-expands to prove identity, and an export manifest. Phase 1B measured them: tokens per successful build fell 53% on Astryx with the pass rate inside the pre-registered margin. They lack data inputs, action payloads, states, usage guidance and user authoring.

The alternatives were a new composition schema beside blocks (duplicates all of the above), or parameters on contract worked examples (impossible: `examples` entries are closed objects in the dspack schema).

## Decision

Evolve the block sidecar from 0.1 to 0.2 and call the result a composition in the product. Additions: `useWhen` and `avoidWhen`; `data` inputs in the same closed type language; action declarations with a kind, a flat typed payload and a consequential flag; `states`, each naming its purpose; template directives that read data, repeat over data and attach a payload to an action node; `scenarios`. A composition still expands to a plain `dspackSurface` 0.1 and is judged by S1 to S3 and A1 to A3 unchanged.

## Consequences

- 0.1 sidecars and v1 provenance stay valid: a loader dispatches on version and upcasts 0.1 in memory, never rewriting files. The Phase 1B goldens and request hashes must reproduce byte for byte.
- Block code leaves "experimental only" in stages; users can author compositions in the experimental build first.
- The blocks RFC is superseded by a compositions RFC, drafted under D12 and not proposed upstream until there is M2 evidence.
- Reversible: sidecars are project data beside the contract.
