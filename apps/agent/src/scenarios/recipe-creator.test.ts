import { describe, expect, it } from "vitest";
import { enhanceGeneratedRecipeOps, recipeRespond, recipeStartOps } from "./recipe-creator";

const dmOf = (ops: unknown[]) =>
  Object.fromEntries(ops.filter((o: any) => o.updateDataModel).map((o: any) => [o.updateDataModel.path, o.updateDataModel.value]));
const tableOf = (ops: unknown[], id = "ingredients") => {
  let last;
  for (const o of ops as any[]) {
    const t = o?.updateComponents?.components?.find((c: any) => c.id === id);
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

  it("start ops carry numbered cooking instructions", () => {
    const ops = recipeStartOps() as any[];
    const instructions = tableOf(ops, "instructions");
    expect(instructions.columns).toEqual(["Step", "Instruction"]);
    expect(instructions.data.length).toBeGreaterThanOrEqual(4);
    expect(instructions.data[0].cells[0]).toBe("1");
    expect(instructions.data.map((r: any) => r.cells[1]).join(" ")).toMatch(/Spaghetti/);
  });

  it("constraints rewrite the matching instruction steps, not just the table", () => {
    const sid = `s-${Math.random()}`;
    const good = recipeRespond("apply_constraint", { constraint: "vegetarian" }, sid);
    const steps = tableOf(good.ops, "instructions").data.map((r: any) => r.cells[1]).join(" ");
    expect(steps).toContain("Smoked tofu");
    expect(steps).not.toContain("Pancetta");
    // Regenerate keeps the constraint applied to the new dish's steps.
    const regen = recipeRespond("regenerate", {}, sid);
    const regenSteps = tableOf(regen.ops, "instructions").data.map((r: any) => r.cells[1]).join(" ");
    expect(regenSteps).toContain("Vegetable stock");
    expect(regenSteps).not.toContain("Chicken stock");
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

  it("enhancement disambiguates ingredients and instructions tables by column names", () => {
    const generated = [
      { version: "v0.9", createSurface: { surfaceId: "structured_editing", catalogId: "c" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "structured_editing",
          components: [
            { id: "root", component: "Card", child: "col" },
            { id: "gen_ingredients", component: "Table", columns: ["Ingredient", "Amount"] },
            { id: "gen_steps", component: "Table", columns: ["Step", "Instruction"] },
            { id: "col", component: "Column", children: ["gen_ingredients", "gen_steps"] },
          ],
        },
      },
    ];
    const { ops, notes, grounding } = enhanceGeneratedRecipeOps(generated);
    expect(grounding.targets.table).toBe("gen_ingredients");
    expect(grounding.targets.instructions).toBe("gen_steps");
    expect(notes.join("\n")).toContain("instructions: 'gen_steps'");
    // The enhancement seeds content onto the grounded targets: the surface
    // is a full recipe before any interaction.
    const comps = (ops as any[]).flatMap((o) => o?.updateComponents?.components ?? []);
    const seededIngredients = comps.filter((c: any) => c.id === "gen_ingredients").at(-1);
    const seededSteps = comps.filter((c: any) => c.id === "gen_steps").at(-1);
    expect(seededIngredients.data.length).toBeGreaterThan(0);
    expect(seededSteps.data.map((r: any) => r.cells[1]).join(" ")).toMatch(/al dente/);
    recipeStartOps(); // restore authored targets for later tests
  });

  it("enhancement adds an instructions table, on the record, when the model omitted one", () => {
    const generated = [
      { version: "v0.9", createSurface: { surfaceId: "structured_editing", catalogId: "c" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "structured_editing",
          components: [
            { id: "root", component: "Card", child: "col" },
            { id: "only_table", component: "Table", columns: ["Ingredient", "Amount"] },
            { id: "col", component: "Column", children: ["only_table"] },
          ],
        },
      },
    ];
    const { ops, notes, grounding } = enhanceGeneratedRecipeOps(generated);
    expect(grounding.targets.table).toBe("only_table");
    expect(grounding.targets.instructions).toBe("instructions");
    expect(notes.join("\n")).toContain("added an instructions table");
    const comps = (ops as any[]).flatMap((o) => o?.updateComponents?.components ?? []);
    const added = comps.find((c: any) => c.id === "instructions");
    expect(added.columns).toEqual(["Step", "Instruction"]);
    expect(added.data.length).toBeGreaterThanOrEqual(4);
    const col = comps.find((c: any) => c.id === "col");
    expect(col.children).toContain("instructions");
    recipeStartOps();
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
