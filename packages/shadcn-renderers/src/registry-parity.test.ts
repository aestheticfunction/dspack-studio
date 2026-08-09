/**
 * The registry-abstraction parity suite for the shadcn registry (the posture of
 * a2ui-ingest's registry-abstraction.test.ts): the catalog owns the vocabulary
 * and schemas; a registry only supplies visuals, and can neither widen nor
 * narrow what the catalog defines.
 *
 * This registry serves TWO governed catalogs in this repo, and the suite proves
 * the boundary against BOTH:
 *
 *   - the NEUTRAL 12-name catalog (contracts/out/catalog.v0_9_1.json, emitted
 *     from the Astryx reference contract) that the apps/web exhibit renders with
 *     shadcn pixels. Here the registry is COMPLETE — every name has a shadcn
 *     visual, so the exhibit shows no wireframe placeholder.
 *
 *   - the PRODUCTION shadcn/ui v3 catalog (27 names) the hosted composer renders.
 *     Here the registry is a first-class PARTIAL cover: Select and Alert — the
 *     two gaps live goal-first flows exposed — are now native, and everything
 *     not yet drawn falls back to wireframe. Partial coverage is a designed
 *     state, not a defect (preview-view.tsx treats it as first-class).
 *
 * Both catalogs are baked in-package by the contracts `prepare` build, so this
 * suite reads real emitter output — never a hand-written name list that can
 * drift from it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildComponentApi, planRegistry } from "@dspack-studio/a2ui-ingest";
import { shadcnRegistry } from "./registry";

const neutral = JSON.parse(
  readFileSync(new URL("../../contracts/out/catalog.v0_9_1.json", import.meta.url), "utf8"),
);
const neutralNames = Object.keys(neutral.components);

const shadcnProd = JSON.parse(
  readFileSync(new URL("../../contracts/out/catalog.shadcn-v3.v1_0.json", import.meta.url), "utf8"),
);
const shadcnNames = Object.keys(shadcnProd.components);

describe("shadcn registry parity (catalog owns vocabulary; registry owns pixels)", () => {
  it("is COMPLETE over the neutral catalog the exhibit renders — no placeholders", () => {
    const plan = planRegistry(neutralNames, shadcnRegistry);
    // The registry cannot add vocabulary: the plan covers exactly the catalog names.
    expect([...plan.reuseBasic, ...plan.custom, ...plan.unimplemented].sort()).toEqual([...neutralNames].sort());
    // Every neutral name has a native shadcn visual — the exhibit needs no fallback.
    expect(plan.unimplemented).toEqual([]);
    expect(plan.custom.sort()).toEqual(
      ["AlertDialog", "Badge", "Button", "Card", "Column", "Dialog", "List", "MetadataList", "SelectableCard", "Table", "Text", "TextField"].sort(),
    );
  });

  it("is a first-class PARTIAL cover of the production shadcn catalog — native where drawn, wireframe otherwise", () => {
    const plan = planRegistry(shadcnNames, shadcnRegistry);
    // Same invariant: the partition is exactly the catalog names, no invention.
    expect([...plan.reuseBasic, ...plan.custom, ...plan.unimplemented].sort()).toEqual([...shadcnNames].sort());
    // Select and Alert — the two live goal-first gaps this milestone closed — are native.
    expect(plan.custom).toContain("Select");
    expect(plan.custom).toContain("Alert");
    // The exact covered subset (regression guard: adding a renderer must update this).
    expect(plan.custom.sort()).toEqual(
      ["Alert", "AlertDialog", "Badge", "Button", "Card", "Column", "Dialog", "Select", "Table", "Text", "TextField"].sort(),
    );
    // Coverage is deliberately partial — the remainder falls back to wireframe,
    // NOT a broad renderer-completeness program.
    expect(plan.unimplemented.length).toBeGreaterThan(0);
    expect(plan.unimplemented).toEqual(
      expect.arrayContaining(["DropdownMenu", "Popover", "Sheet", "Tabs", "Textarea", "Checkbox", "RadioGroup"]),
    );
  });

  it("supplies visuals only — no vocabulary beyond the catalogs it renders", () => {
    // A renderer name is legitimate iff some governed catalog defines it. The
    // union blesses the neutral-only names (List/SelectableCard/MetadataList,
    // for the exhibit) and the shadcn-only names (Select/Alert, for production),
    // while still failing on a name no catalog defines.
    const governed = new Set([...neutralNames, ...shadcnNames]);
    for (const name of Object.keys(shadcnRegistry.custom)) {
      expect(governed).toContain(name);
    }
  });

  it("catalog-derived schemas accept contract-valid props and reject unknown ones, regardless of registry", () => {
    const api = buildComponentApi(neutral, "Button");
    expect(api.schema.safeParse({ label: "Delete", variant: "destructive", action: { event: { name: "x" } } }).success).toBe(true);
    expect(api.schema.safeParse({ label: "x", variant: "not-a-variant" }).success).toBe(false);
    expect(api.schema.safeParse({ label: "x", madeUpProp: true }).success).toBe(false);
  });
});
