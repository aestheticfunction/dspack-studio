import { describe, expect, it } from "vitest";
import { planRegistry } from "@dspack-studio/a2ui-ingest";
import { defaultRegistryId, registryFor, nativeRegistryFor, resolveRegistryId, wireframeFallbackNames } from "./registries";
import shadcnEmit from "./demo/generated/emit.shadcn.json";
import astryxEmit from "./demo/generated/emit.astryx.json";

/**
 * The design-system boundary's fallback contract: the registry a canvas
 * renders with covers EVERY catalog name (wireframe fills native gaps), the
 * honest coverage report comes from the PRE-merge native registry, and
 * repeated lookups return the same object (A2uiCanvas memoizes ingestion on
 * registry identity — the Build canvas calls registryFor in its render body).
 */
const shadcnCatalog = (shadcnEmit as { catalog: { components: Record<string, unknown> } }).catalog;
const astryxCatalog = (astryxEmit as { catalog: { components: Record<string, unknown> } }).catalog;

describe("registryFor — wireframe fallback composition", () => {
  it("the merged shadcn registry covers every catalog name (no unimplemented placeholder in the product)", () => {
    const names = Object.keys(shadcnCatalog.components);
    const plan = planRegistry(names, registryFor("shadcn", shadcnCatalog));
    expect(plan.unimplemented).toEqual([]);
  });

  it("the honest gap is still reported from the PRE-merge native registry", () => {
    const names = Object.keys(shadcnCatalog.components);
    const nativePlan = planRegistry(names, nativeRegistryFor("shadcn")!);
    expect(nativePlan.unimplemented.length).toBeGreaterThan(0); // shadcn is partial today
    expect(wireframeFallbackNames("shadcn", shadcnCatalog)).toEqual(nativePlan.unimplemented);
    // The known trio from the field report renders via wireframe, not raw text.
    for (const name of ["Separator", "Checkbox", "Textarea"]) {
      expect(nativePlan.unimplemented).toContain(name);
      expect(registryFor("shadcn", shadcnCatalog).custom[name]).toBeTypeOf("function");
    }
  });

  it("full-coverage systems and the wireframe registry report no fallback", () => {
    expect(wireframeFallbackNames("astryx", astryxCatalog)).toEqual([]);
    expect(wireframeFallbackNames("wireframe", shadcnCatalog)).toEqual([]);
  });

  it("returns the SAME registry object for the same (id, catalog) — identity the canvas memoizes on", () => {
    expect(registryFor("shadcn", shadcnCatalog)).toBe(registryFor("shadcn", shadcnCatalog));
    expect(registryFor("wireframe", shadcnCatalog)).toBe(registryFor("wireframe", shadcnCatalog));
    expect(registryFor("shadcn", shadcnCatalog)).not.toBe(registryFor("shadcn", astryxCatalog));
  });

  it("native visuals win over the wireframe fallback name-by-name", () => {
    const merged = registryFor("shadcn", shadcnCatalog);
    const native = nativeRegistryFor("shadcn")!;
    for (const name of Object.keys(native.custom)) {
      expect(merged.custom[name]).toBe(native.custom[name]);
    }
  });
});

/**
 * B5 — Preview opens on the project's OWN design system. Wireframe is the
 * inspection mode and the fallback for a project that has no native one; it is
 * no longer what every project meets first.
 */
describe("defaultRegistryId — a project previews as itself", () => {
  it("defaults to the project's native registry when it has one", () => {
    expect(defaultRegistryId("shadcn")).toBe("shadcn");
    expect(defaultRegistryId("astryx")).toBe("astryx");
  });

  it("falls back to wireframe only when there is no native registry", () => {
    expect(defaultRegistryId("wireframe")).toBe("wireframe");
    expect(defaultRegistryId(undefined)).toBe("wireframe");
    expect(defaultRegistryId("")).toBe("wireframe");
    expect(defaultRegistryId("vue-someday")).toBe("wireframe");
  });
});

describe("resolveRegistryId — a stale selection clamps safely", () => {
  it("honours an explicit choice this project can render", () => {
    expect(resolveRegistryId("wireframe", "shadcn")).toBe("wireframe"); // inspection mode stays available
    expect(resolveRegistryId("shadcn", "shadcn")).toBe("shadcn");
  });

  it("clamps a selection carried over from ANOTHER project back to this one's default", () => {
    expect(resolveRegistryId("astryx", "shadcn")).toBe("shadcn");
    expect(resolveRegistryId("shadcn", "astryx")).toBe("astryx");
    expect(resolveRegistryId("shadcn", undefined)).toBe("wireframe");
  });

  it("no selection, or an unknown one, is the project's default", () => {
    expect(resolveRegistryId(null, "astryx")).toBe("astryx");
    expect(resolveRegistryId(undefined, "shadcn")).toBe("shadcn");
    expect(resolveRegistryId("not-a-registry", "shadcn")).toBe("shadcn");
    expect(resolveRegistryId("not-a-registry", undefined)).toBe("wireframe");
  });
});
