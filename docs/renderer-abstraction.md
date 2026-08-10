# Renderer abstraction

The studio's rendering stack is layered so the design system is a plug-in,
not a foundation. This document states the boundaries as they exist in code
today (verified by `packages/a2ui-ingest/src/registry-abstraction.test.ts`).
The swap is real: three registry packages ship — `packages/astryx-renderers`
(full coverage of the 12-name Astryx catalog), `packages/shadcn-renderers`
(native visuals for 11 of the production shadcn/ui v3 catalog's 27 names),
and `packages/wireframe-renderers` (the universal registry, generated to
cover ANY catalog). A registry is still free to leave a catalog name
unrendered, and today shadcn genuinely does — partial adoption is a shipped
state, not a hypothetical. What a user sees in that case is a policy
decision made at the app boundary, not in the packages (below). The e2e
proof (`e2e/design-swap.spec.ts`) replays one fixture under both design
systems and asserts the receipt hash is identical while the rendered DOM
differs.

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
                 components. Owned by packages/{astryx,shadcn,wireframe}-
                 renderers — the ONLY places a design system's imports live
                 (plus theme packages in apps/web).
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

Two layers, deliberately separate:

**Package layer (a2ui-ingest), unchanged:**

- Not in the catalog: the A2UI renderer's own unknown-component state — the
  contract/emitter should have prevented this (an emitter refusal upstream).
- In the catalog, no visual: `makeUnimplemented` placeholder — legal
  vocabulary, missing pixels; the run is otherwise unaffected. This is the
  package's honest "no visual at all" signal, and the parity suites reason
  about it.

**App layer (Composer), the policy:** `apps/composer/app/registries.ts`
composes the wireframe registry UNDER the native one — native wins
name-by-name, wireframe fills every remaining catalog name — so a partially
covered design system renders as native visuals plus labeled wireframe
stand-ins, and the placeholder never reaches a user. The composition is
cached per (catalog, registry id) because `A2uiCanvas` memoizes catalog
ingestion on registry identity. Honest reporting comes from the PRE-merge
registry (`nativeRegistryFor`, `wireframeFallbackNames`): the merged registry
covers everything by construction, so coverage must never be computed from
it. Rule: native renderer where available → wireframe fallback where not →
never raw placeholder text in the product canvas.

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
   names — or a subset; in Composer the wireframe registry covers the rest,
   and in a bare package consumer the placeholder does).
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
