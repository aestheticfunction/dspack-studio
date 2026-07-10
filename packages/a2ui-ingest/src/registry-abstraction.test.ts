/**
 * Renderer-abstraction validation (docs/renderer-abstraction.md): the
 * catalog owns the vocabulary and schemas; a registry only supplies visuals.
 * A minimal alternate "design system" (plain-HTML visuals for a subset)
 * proves the boundary without duplicating any application logic.
 */
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildComponentApi } from "./buildComponentApi";
import { planRegistry } from "./classify";

const catalog = JSON.parse(
  readFileSync(new URL("../../contracts/out/catalog.v0_9_1.json", import.meta.url), "utf8"),
);
const names = Object.keys(catalog.components);

/** A minimal alternate design system: three plain-HTML visuals, nothing else. */
const plainRegistry = {
  reuseBasic: new Set<string>(),
  custom: {
    Text: (p: any) => createElement("p", null, p.props?.text),
    Button: (p: any) => createElement("button", null, p.props?.label),
    Card: (p: any) => createElement("section", null),
  },
};

describe("renderer abstraction (catalog owns vocabulary; registry owns pixels)", () => {
  it("component discovery comes from the catalog alone", () => {
    expect(names).toEqual(expect.arrayContaining(["Button", "Card", "TextField", "Badge", "Table", "AlertDialog", "Dialog", "Text", "Column"]));
    const plan = planRegistry(names, plainRegistry);
    // The registry cannot add vocabulary: plan covers exactly the catalog names.
    expect([...plan.reuseBasic, ...plan.custom, ...plan.unimplemented].sort()).toEqual([...names].sort());
  });

  it("a partial registry yields placeholders for exactly the uncovered subset", () => {
    const plan = planRegistry(names, plainRegistry);
    expect(plan.custom.sort()).toEqual(["Button", "Card", "Text"]);
    expect(plan.unimplemented).toEqual(expect.arrayContaining(["TextField", "Badge", "Table", "AlertDialog", "Dialog", "Column"]));
    expect(plan.unimplemented).not.toContain("Text");
  });

  it("accepted schemas derive from the catalog — a design system cannot widen them", () => {
    const button = buildComponentApi(catalog, "Button");
    expect(button.schema.safeParse({ label: "Delete project", variant: "destructive", action: { event: { name: "x" } } }).success).toBe(true);
    // Unknown props are rejected regardless of what any registry renders.
    expect(button.schema.safeParse({ label: "ok", madeUpProp: true }).success).toBe(false);
    // Enum vocabularies come from the contract via the catalog.
    expect(button.schema.safeParse({ label: "ok", variant: "sparkly" }).success).toBe(false);
  });
});
