/**
 * The Catalog export (Preview's "export catalog"). The beta's experimental
 * build adds a per-surface action manifest (docs/blocks/HOST-ACTIONS.md); the
 * default build's export must stay byte-identical (docs/blocks/PHASE-2-RELEASE-PLAN.md,
 * §12). The oracle below is the export as main wrote it before the action
 * manifest (exportBundle in app/views/preview-view.tsx at 3edd589), kept
 * verbatim minus the download, and the default export is held to it, byte for
 * byte, over real project emits.
 */
import { describe, expect, it } from "vitest";
import { catalogBundle, catalogJson } from "./catalog-export";
import { REFERENCES } from "./demo-data";
import { browserEmit, contractSurfaces } from "./validation";

type Emit = { catalog?: Record<string, any>; surfaces?: Array<{ name: string; messages?: unknown[] }> };

/** main's exportBundle at 3edd589, minus the download: the bytes it wrote. */
function todaysBytes(emit: Emit, exportedAt: string): string {
  const bundle = {
    a2uiCatalog: emit.catalog,
    surfaces: (emit.surfaces ?? [])
      .filter((s) => s.messages)
      .map((s) => ({ name: s.name, messages: s.messages })),
    exportedAt,
  };
  return JSON.stringify(bundle, null, 2);
}

const AT = "2026-10-16T12:00:00.000Z";

describe("the default Catalog export is byte-identical to today's", () => {
  for (const id of Object.keys(REFERENCES)) {
    it(`${id}: the reference's own emit, every surface, exported exactly as before`, () => {
      const { contract, profile } = REFERENCES[id]!;
      const emit = browserEmit(contract as Record<string, unknown>, profile as Record<string, unknown>, contractSurfaces(contract as Record<string, unknown>)) as Emit;
      expect(emit.surfaces?.length).toBeGreaterThan(0);
      const bytes = catalogJson(catalogBundle(emit, AT));
      expect(bytes).toBe(todaysBytes(emit, AT));
      expect(Object.keys(JSON.parse(bytes))).toEqual(["a2uiCatalog", "surfaces", "exportedAt"]);
      expect(bytes).not.toContain("actionManifest");
    });
  }

  it("a refused surface is left out and a missing catalog is omitted, as before", () => {
    const emit: Emit = { surfaces: [{ name: "kept", messages: [{ version: "v0.9" }] }, { name: "refused" }] };
    expect(catalogJson(catalogBundle(emit, AT))).toBe(todaysBytes(emit, AT));
    expect(JSON.parse(catalogJson(catalogBundle(emit, AT)))).toEqual({ surfaces: [{ name: "kept", messages: [{ version: "v0.9" }] }], exportedAt: AT });
  });

  it("an emit with no surfaces exports an empty list, as before", () => {
    const emit: Emit = { catalog: { components: {} } };
    expect(catalogJson(catalogBundle(emit, AT))).toBe(todaysBytes(emit, AT));
  });
});
