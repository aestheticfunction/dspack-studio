import { describe, expect, it } from "vitest";
import { recipeRespond, recipeStartOps } from "./recipe-creator";

const dmOf = (ops: unknown[]) =>
  Object.fromEntries(ops.filter((o: any) => o.updateDataModel).map((o: any) => [o.updateDataModel.path, o.updateDataModel.value]));
const tableOf = (ops: unknown[]) => {
  let last;
  for (const o of ops as any[]) {
    const t = o?.updateComponents?.components?.find((c: any) => c.id === "ingredients");
    if (t) last = t;
  }
  return last;
};

describe("recipe-creator responder (deterministic co-editing)", () => {
  it("start ops carry the overlay, initial table, and data model", () => {
    const ops = recipeStartOps() as any[];
    const components = ops.flatMap((o) => o?.updateComponents?.components ?? []);
    expect(components.find((c: any) => c.id === "constraint_input").value).toEqual({ path: "/recipe/constraint" });
    expect(components.find((c: any) => c.id === "servings_up").action.event.name).toBe("change_servings");
    expect(tableOf(ops).data.length).toBeGreaterThan(0);
    expect(dmOf(ops)["/recipe"]).toMatchObject({ servings: 2, constraint: "" });
  });

  it("servings changes rescale the delivered table and clamp with a recoverable rejection", () => {
    const sid = `s-${Math.random()}`;
    const up = recipeRespond("change_servings", { delta: 1 }, sid);
    expect(up.outcome).toBe("accepted");
    expect(tableOf(up.ops).data[0].cells[1]).toMatch(/^270/); // 90g * 3
    // clamp: drive down to 1 then reject below
    recipeRespond("change_servings", { delta: -1 }, sid);
    recipeRespond("change_servings", { delta: -1 }, sid);
    const under = recipeRespond("change_servings", { delta: -1 }, sid);
    expect(under.outcome).toBe("rejected");
    expect(under.detail).toMatch(/1–12/);
  });

  it("constraints validate against the known set; valid ones swap ingredients", () => {
    const sid = `s-${Math.random()}`;
    const bad = recipeRespond("apply_constraint", { constraint: "keto" }, sid);
    expect(bad.outcome).toBe("rejected");
    expect(bad.detail).toMatch(/vegetarian, vegan, gluten-free/);
    const good = recipeRespond("apply_constraint", { constraint: "vegetarian" }, sid);
    expect(good.outcome).toBe("accepted");
    const names = tableOf(good.ops).data.map((r: any) => r.cells[0]);
    expect(names).toContain("Smoked tofu");
    expect(names).not.toContain("Pancetta");
  });

  it("regenerate cycles deterministic variants, preserving servings and constraint", () => {
    const sid = `s-${Math.random()}`;
    recipeRespond("change_servings", { delta: 2 }, sid); // 4 servings
    recipeRespond("apply_constraint", { constraint: "vegan" }, sid);
    const regen = recipeRespond("regenerate", {}, sid);
    expect(regen.outcome).toBe("accepted");
    expect(dmOf(regen.ops)["/recipe/status"]).toMatch(/Lemon herb risotto/);
    const names = tableOf(regen.ops).data.map((r: any) => r.cells[0]);
    expect(names).toContain("Vegetable stock"); // vegan swap survives regeneration
  });
});
