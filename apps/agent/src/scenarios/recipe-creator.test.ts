import { describe, expect, it } from "vitest";
import { enhanceGeneratedRecipeOps, recipeRespond, recipeStartOps } from "./recipe-creator";

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

  it("enhancement retargets component updates onto the generated surface's ids", () => {
    const generated = [
      {
        version: "v0.9",
        createSurface: { surfaceId: "structured_editing", catalogId: "c" },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "structured_editing",
          components: [
            { id: "root", component: "Card", child: "col" },
            { id: "my_title", component: "Text", variant: "h2", text: "Pasta" },
            { id: "my_badge", component: "Badge", label: "none" },
            { id: "my_servings", component: "Text", variant: "body", text: "Servings: 2" },
            { id: "my_table", component: "Table", columns: ["Ingredient", "Amount"] },
            { id: "my_input", component: "TextField", label: "Dietary constraint" },
            { id: "my_apply", component: "Button", label: "Apply constraint", variant: "secondary" },
            { id: "my_status", component: "Text", variant: "caption" },
            { id: "my_regen", component: "Button", label: "Regenerate", variant: "primary" },
            { id: "col", component: "Column", children: [] },
          ],
        },
      },
    ];
    const { notes } = enhanceGeneratedRecipeOps(generated);
    expect(notes.join("\n")).toContain("table: 'my_table'");
    // The responder now writes to the generated ids — rows land on the
    // rendered table instead of orphaning on the authored 'ingredients'.
    const resp = recipeRespond("apply_constraint", { constraint: "vegetarian" }, `s-${Math.random()}`);
    const comps = (resp.ops as any[]).flatMap((o) => o?.updateComponents?.components ?? []);
    const table = comps.find((c: any) => c.component === "Table");
    expect(table.id).toBe("my_table");
    expect(table.data.length).toBeGreaterThan(0);
    expect(comps.find((c: any) => c.component === "Badge").id).toBe("my_badge");
    expect(comps.find((c: any) => c.variant === "h2").id).toBe("my_title");
    // A deterministic start restores the authored targets.
    recipeStartOps();
    const after = recipeRespond("regenerate", {}, `s-${Math.random()}`);
    const afterComps = (after.ops as any[]).flatMap((o) => o?.updateComponents?.components ?? []);
    expect(afterComps.find((c: any) => c.component === "Table").id).toBe("ingredients");
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
