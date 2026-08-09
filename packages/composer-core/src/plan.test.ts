import { describe, it, expect } from "vitest";
import { buildPlanRequest, planSchema, planDeterministic, reconcilePlan, intentLabel } from "./plan";

const contract = {
  name: "demo/ui",
  intents: [
    { id: "structured-input", name: "Structured input", description: "Collects structured values and commits them on an explicit action — a form the user fills and submits." },
    { id: "destructive-action", name: "Destructive action", description: "Performs an irreversible or high-consequence operation: deleting records or accounts, revoking access." },
    { id: "record-collection", name: "Record collection", description: "Presents many records of the same kind — tickets, orders, members — in a table or list." },
  ],
  components: {
    button: { whenToUse: "Trigger an action" },
    input: { whenToUse: "Collect a single-line text value" },
    card: { whenToUse: "Group related content" },
    table: { whenToUse: "Present rows of records" },
  },
};

describe("planDeterministic (scripted routing)", () => {
  it("routes a form-like goal to structured-input by description overlap", () => {
    const plan = planDeterministic("a sign-up form that collects an email and submits", contract);
    expect(plan.intent).toBe("structured-input");
    expect(plan.source).toBe("scripted");
    expect(plan.feasible).toBe(true);
  });

  it("routes a delete goal to destructive-action", () => {
    const plan = planDeterministic("a confirmation for deleting a user account", contract);
    expect(plan.intent).toBe("destructive-action");
  });

  it("routes a list goal to record-collection", () => {
    expect(planDeterministic("show a table of all support tickets", contract).intent).toBe("record-collection");
  });

  it("always returns a real intent id even for an unmatched goal", () => {
    const plan = planDeterministic("xyzzy", contract);
    expect(["structured-input", "destructive-action", "record-collection"]).toContain(plan.intent);
  });
});

describe("buildPlanRequest", () => {
  it("scopes the plan schema's intent to real intent ids and carries the goal as the user message", () => {
    const req = buildPlanRequest("book a table for two", contract);
    expect(req.messages).toEqual([{ role: "user", content: "book a table for two" }]);
    const intentSchema = (req.jsonSchema as any).properties.intent;
    expect(intentSchema.enum).toEqual(["structured-input", "destructive-action", "record-collection"]);
    // The vocabulary + contexts are given to the model as context.
    expect(req.system).toContain("structured-input");
    expect(req.system).toContain("Approved component vocabulary");
  });
});

describe("reconcilePlan (normalizing a model plan)", () => {
  it("keeps a valid intent and dedupes/validates alsoConsidered", () => {
    const plan = reconcilePlan(
      { intent: "structured-input", alsoConsidered: ["destructive-action", "structured-input", "not-real"], restated: "A signup form", feasible: true, reason: "collects values" },
      contract,
      "make a signup form",
    );
    expect(plan.intent).toBe("structured-input");
    expect(plan.alsoConsidered).toEqual(["destructive-action"]); // self + unknown dropped
    expect(plan.feasible).toBe(true);
  });

  it("clamps an unknown intent back to a real one via the deterministic classifier", () => {
    const plan = reconcilePlan({ intent: "made-up", restated: "x", feasible: true }, contract, "delete my account permanently");
    expect(plan.intent).toBe("destructive-action");
  });

  it("surfaces a genuine vocabulary gap only when the model names the missing capability", () => {
    const gap = reconcilePlan({ intent: "structured-input", feasible: false, missingCapability: "a date-range picker" }, contract, "pick a date range");
    expect(gap.feasible).toBe(false);
    expect(gap.missingCapability).toBe("a date-range picker");

    // feasible:false with NO named capability is not an honest gap — treat as feasible.
    const noName = reconcilePlan({ intent: "structured-input", feasible: false }, contract, "something");
    expect(noName.feasible).toBe(true);
    expect(noName.missingCapability).toBeNull();
  });

  it("falls back to the raw goal when the model omits a restatement", () => {
    expect(reconcilePlan({ intent: "structured-input" }, contract, "  raw goal  ").restated).toBe("raw goal");
  });
});

describe("planSchema + intentLabel", () => {
  it("emits an enum-constrained intent so the model cannot invent one", () => {
    expect((planSchema(["a", "b"]) as any).properties.intent).toEqual({ enum: ["a", "b"] });
  });
  it("labels an intent by its human name", () => {
    expect(intentLabel(contract, "structured-input")).toBe("Structured input");
    expect(intentLabel(contract, "unknown")).toBe("unknown");
  });
});
