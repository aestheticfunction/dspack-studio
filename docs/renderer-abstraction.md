# Renderer abstraction

The studio's rendering stack is layered so the design system is a plug-in,
not a foundation. This document states the boundaries as they exist in code
today (verified by `packages/a2ui-ingest/src/registry-abstraction.test.ts`).
Since the FM-10 groundwork the swap is real: `packages/shadcn-renderers`
supplies a second registry (11 of 12 catalog names; `Dialog` renders the
unimplemented placeholder by design), selected in the restyle view and
applied to every canvas. The e2e proof (`e2e/design-swap.spec.ts`) replays
one fixture under both design systems and asserts the receipt hash is
identical while the rendered DOM differs.

## The layers

```
AG-UI            transport: ordered events (runs, tool calls, CUSTOM telemetry,
                 action round-trips). Owned by packages/agui-bridge.
  ↓
A2UI             description: catalogs (vocabulary + JSON-Schema shapes) and
                 operations (createSurface / updateComponents /
                 updateDataModel). Owned by packages/a2ui-ingest.
  ↓
Aesthetic        the contract layer: dspack constrains generation and
Function         validates surfaces; dspack-emit compiles the contract into
                 the A2UI catalog and surfaces into operations. Owned by
                 packages/contracts (profile) + published npm packages.
  ↓
Renderer         the adapter: catalog JSON + a Registry -> renderable
                 components. buildComponentApi derives each component's
                 accepted schema FROM THE CATALOG (zod), so the renderer
                 accepts exactly what the contract validated. Owned by
                 packages/a2ui-ingest (generic; names no components).
  ↓
Design system    the visuals: a Registry maps catalog names to concrete
                 components. Owned by packages/astryx-renderers — the ONLY
                 place Astryx imports live (plus theme packages in apps/web).
```

## Renderer interfaces

- `Registry` (`a2ui-ingest`): `{ reuseBasic: Set<string>, custom: Record<string, FC> }`.
  A design system supplies exactly this — nothing else.
- `buildCatalog(catalogJson, registry) -> BuiltCatalog`: iterates
  `catalog.components` (the catalog is the source of names — the registry
  can never add vocabulary), derives each schema via `buildComponentApi`,
  and binds visuals.
- Render contract: each visual is `FC<{ props, buildChild, context }>` —
  resolved props (bindings already evaluated; `setX` setters generated for
  bound dynamic props; actions as callables), `buildChild(id)` for
  composition, `context.componentModel/dataContext` for advanced cases.

## Component capability discovery

`BuiltCatalog.names` lists every component the catalog admits;
`BuiltCatalog.unimplemented` lists catalog components the registry gave no
visual. `planRegistry(names, registry)` is the pure form used by tests. A
design system can therefore be adopted incrementally: unsupported components
render a visible placeholder (distinct from the renderer's "unknown
component" state, which means the name is not in the catalog at all) and
everything else works.

## Unsupported-component behavior

- Not in the catalog: the A2UI renderer's own unknown-component state — the
  contract/emitter should have prevented this (an emitter refusal upstream).
- In the catalog, no visual: `makeUnimplemented` placeholder — legal
  vocabulary, missing pixels; the run is otherwise unaffected.

## Theme ownership

Themes belong to the DESIGN SYSTEM layer, never to the protocol or contract:
A2UI ops carry structure and state only (matching A2UI v1.0's
surfaceProperties direction); dspack tokens stay in the contract for
governance and documentation. Astryx themes are `<Theme theme mode>` +
imported theme.css files, wired in `astryx-renderers/themes.ts` and applied
by the app. A second design system brings its own theme mechanism without
touching any other layer.

## What a design-system swap requires (and nothing more)

1. A new registry package exporting a `Registry` (visuals for the catalog's
   names — or a subset; the placeholder covers the rest).
2. Its own theming wiring, if any.
3. An emit profile IF the new system's contract differs (the Astryx profile
   lives in packages/contracts; the shadcn profile ships in dspack-emit).

Application logic (RunView, inspectors, scenarios, actions, replay) is
untouched: it renders through `A2uiCanvas(catalog, registry, messages)` and
never imports a design system.

## Validated by test

`registry-abstraction.test.ts` builds the REAL emitted catalog against a
minimal alternate registry (plain-HTML visuals for a 3-component subset) and
asserts: names come from the catalog alone; the unimplemented set is exactly
the complement of the registry; catalog-derived schemas accept contract-valid
props and reject unknown ones — i.e. the design system cannot widen or
narrow the accepted vocabulary.
