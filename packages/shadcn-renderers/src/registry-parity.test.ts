/**
 * The registry-abstraction parity suite for the shadcn registry, against
 * the REAL emitted catalog (the same posture as a2ui-ingest's
 * registry-abstraction.test.ts): names come from the catalog alone, the
 * unimplemented set is exactly the complement of this registry, and the
 * catalog-derived schemas are untouched by which design system renders —
 * the registry cannot widen or narrow the vocabulary.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildComponentApi, planRegistry } from "@dspack-studio/a2ui-ingest";
import { shadcnRegistry } from "./registry";

const catalog = JSON.parse(
  readFileSync(new URL("../../contracts/out/catalog.v0_9_1.json", import.meta.url), "utf8"),
);
const names = Object.keys(catalog.components);

describe("shadcn registry parity (catalog owns vocabulary; registry owns pixels)", () => {
  it("covers exactly the catalog names, with Dialog as the deliberate placeholder", () => {
    const plan = planRegistry(names, shadcnRegistry);
    expect([...plan.reuseBasic, ...plan.custom, ...plan.unimplemented].sort()).toEqual([...names].sort());
    expect(plan.unimplemented).toEqual(["Dialog"]);
    expect(plan.custom.sort()).toEqual(
      ["AlertDialog", "Badge", "Button", "Card", "Column", "List", "MetadataList", "SelectableCard", "Table", "Text", "TextField"].sort(),
    );
  });

  it("supplies visuals only — no vocabulary beyond the catalog", () => {
    for (const name of Object.keys(shadcnRegistry.custom)) {
      expect(names).toContain(name);
    }
  });

  it("catalog-derived schemas accept contract-valid props and reject unknown ones, regardless of registry", () => {
    const api = buildComponentApi(catalog, "Button");
    expect(api.schema.safeParse({ label: "Delete", variant: "destructive", action: { event: { name: "x" } } }).success).toBe(true);
    expect(api.schema.safeParse({ label: "x", variant: "not-a-variant" }).success).toBe(false);
    expect(api.schema.safeParse({ label: "x", madeUpProp: true }).success).toBe(false);
  });
});
