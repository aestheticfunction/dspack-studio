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

/**
 * The registry that draws a catalog's components for a design system. Unknown
 * or "wireframe" falls back to the universal wireframe registry, which is
 * generated to cover exactly the given catalog.
 */
export function registryFor(id: string | undefined, catalog: unknown): Registry {
  if (id === "shadcn") return shadcnRegistry;
  if (id === "astryx") return astryxRegistry;
  return wireframeRegistryFor(catalog as never);
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
