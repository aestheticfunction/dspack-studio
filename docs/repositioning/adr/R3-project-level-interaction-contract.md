# R3. The interaction contract belongs to the project

**Status:** draft for review. Accepted in principle by the owner as D3 (2026-11-24).

## Context

Data types and action declarations describe a product's domain (a hotel, a booking), not a design system. The dspack specification scopes renderer- and transport-facing features out ("proposals to add them are scope changes requiring an explicit design decision"), and the packaged reference contracts are immutable and byte-synced with upstream (`check-sync`), so nothing can be added inside them.

## Decision

Each project has an interaction contract beside its design-system contract: data types and action declarations, owner-authored (a model may propose entries, a person accepts them). Compositions bind to both by hash: the contract's `baseSha256` (as blocks do today) and a new `interactionSha256`. Published packages carry it as `interaction.json`, labelled an Aesthetic Function extension.

## Consequences

- No change to the dspack specification or any sibling repository to start.
- An upstream RFC follows evidence (D12), not the other way round.
- The project file gains an optional key; the default build must carry it through import, save and export untouched even before it uses it, or a default build would silently drop it (today unknown keys are dropped on read).
