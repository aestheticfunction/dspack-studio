/**
 * The design-system boundary, in ONE place: a catalog owns the vocabulary; a
 * registry only supplies the pixels. Every view that renders a surface asks
 * here which registry draws it and how to scope the canvas — so adding a design
 * system is a data change, never a new special case sprinkled across views.
 *
 * Native design systems (shadcn/ui, Astryx) own a fixed set of visuals and
 * cover their catalog partially or fully; the wireframe registry covers ANY
 * catalog and is the universal fallback/inspection mode. The choice is the
 * project's `previewRegistry`; providers (scripted / hosted-ai / local) are
 * orthogonal to it.
 */
import type { Registry } from "@dspack-studio/a2ui-ingest";
import { wireframeRegistryFor } from "@dspack-studio/wireframe-renderers";
import { shadcnRegistry } from "@dspack-studio/shadcn-renderers";
import { astryxRegistry } from "@dspack-studio/astryx-renderers";

export type PreviewRegistryId = "shadcn" | "astryx" | "wireframe";

/** The native (non-wireframe) design systems a project can preview through. */
export const NATIVE_REGISTRIES: PreviewRegistryId[] = ["shadcn", "astryx"];

/** The pre-merge native registry, or null for wireframe/unknown — what honest
 *  coverage reporting computes from (the merged registry covers everything). */
export function nativeRegistryFor(id: string | undefined): Registry | null {
  if (id === "shadcn") return shadcnRegistry;
  if (id === "astryx") return astryxRegistry;
  return null;
}

/**
 * Per-catalog registry cache. A2uiCanvas memoizes catalog ingestion on the
 * registry OBJECT IDENTITY, and the Build canvas calls registryFor in its
 * render body — so repeated calls for the same (id, catalog) must return the
 * SAME object or every render re-ingests the catalog. Keyed by catalog object
 * (stable per emit) then registry id.
 */
const registryCache = new WeakMap<object, Map<string, Registry>>();

/**
 * The registry that draws a catalog's components for a design system.
 *
 * A native design system covers its catalog partially or fully; for every
 * catalog name it lacks, the UNIVERSAL WIREFRAME VISUAL fills in — native
 * renderer when available, wireframe fallback when not, never the raw
 * `[unimplemented: …]` placeholder in the product canvas. "wireframe" (or
 * unknown) is the all-wireframe registry.
 */
export function registryFor(id: string | undefined, catalog: unknown): Registry {
  const key = id === "shadcn" || id === "astryx" ? id : "wireframe";
  const cacheable = !!catalog && typeof catalog === "object";
  if (cacheable) {
    const hit = registryCache.get(catalog as object)?.get(key);
    if (hit) return hit;
  }
  const wireframe = wireframeRegistryFor(catalog as never);
  const native = nativeRegistryFor(key);
  // Native wins name-by-name; wireframe supplies the rest. Both native
  // registries have an empty reuseBasic, so precedence is purely the spread.
  const registry: Registry = native ? { reuseBasic: native.reuseBasic, custom: { ...wireframe.custom, ...native.custom } } : wireframe;
  if (cacheable) {
    const perCatalog = registryCache.get(catalog as object) ?? new Map<string, Registry>();
    perCatalog.set(key, registry);
    registryCache.set(catalog as object, perCatalog);
  }
  return registry;
}

/**
 * The catalog names a native registry has NO visual for — rendered through the
 * wireframe fallback by registryFor. Empty for full-coverage systems and for
 * the wireframe registry itself (which covers everything by construction).
 */
export function wireframeFallbackNames(id: string | undefined, catalog: unknown): string[] {
  const native = nativeRegistryFor(id);
  if (!native || !catalog || typeof catalog !== "object") return [];
  const names = Object.keys(((catalog as { components?: Record<string, unknown> }).components ?? {}) as Record<string, unknown>);
  return names.filter((n) => !native.reuseBasic.has(n) && !native.custom[n]);
}

/**
 * Canvas wrapper scope so the active system's theming applies to the preview and
 * never leaks into the studio shell. shadcn's styles are CSS-variable-scoped
 * under [data-design-system]; Astryx styles itself through @astryxdesign/core
 * and needs no scope attribute; wireframe uses the shell's own dim surface.
 */
export function canvasScopeFor(
  id: string | undefined,
  mode: "light" | "dark" = "light",
): { attrs: Record<string, string>; background: string } {
  if (id === "shadcn") return { attrs: { "data-design-system": "shadcn", "data-mode": mode }, background: mode === "dark" ? "#0c0a09" : "#ffffff" };
  if (id === "astryx") return { attrs: { "data-astryx-canvas": "" }, background: "var(--astryx-bg, #ffffff)" };
  return { attrs: {}, background: "var(--bg-1)" };
}

/** True when this registry draws real design-system visuals (not wireframe). */
export function isNativeRegistry(id: string | undefined): id is PreviewRegistryId {
  return id === "shadcn" || id === "astryx";
}

/**
 * The registry a project's Preview OPENS on: its own design system.
 *
 * A project that has a native registry should look like itself the moment you
 * open it — the wireframe is the universal fallback and the explicit
 * inspection mode, not the thing every project meets first. Falls back to
 * wireframe only when the project has no native registry at all (a repository
 * whose target has no renderers yet, an unrecognised value from an older
 * export).
 */
export function defaultRegistryId(previewRegistry: string | undefined): PreviewRegistryId {
  return isNativeRegistry(previewRegistry) ? previewRegistry : "wireframe";
}

/**
 * Resolve a possibly-stale selection against the project that is open now.
 * "wireframe" is always honoured (every catalog renders through it); the
 * project's own native id is honoured; anything else — no choice yet, a
 * registry belonging to a DIFFERENT project, a value from a future version —
 * clamps to this project's default rather than rendering the wrong system.
 */
export function resolveRegistryId(selected: string | null | undefined, previewRegistry: string | undefined): PreviewRegistryId {
  const fallback = defaultRegistryId(previewRegistry);
  if (selected === "wireframe") return "wireframe";
  return selected && selected === previewRegistry && isNativeRegistry(selected) ? selected : fallback;
}
