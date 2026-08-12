import { describe, expect, it } from "vitest";
import { buildFlowPlanRequest, flowPlanDeterministic, flowPlanSchema, reconcileFlowPlan } from "./flow-plan";

/**
 * P4 Phase C — flow decomposition planning (fail-first).
 *
 * "Build a flow" turns ONE workflow goal into an editable plan of 2–8 steps,
 * each step an ordinary single-surface build (title + generation goal +
 * governed intent picked from the contract's OWN taxonomy). Same layer and
 * idioms as plan.ts: a provider-agnostic request tested SHAPE-ONLY (no live
 * gateway call anywhere), a reconciler that clamps model output to the
 * contract, and a deterministic fallback that never blocks.
 */

const contract = {
  name: "demo/ui",
  intents: [
    {
      id: "structured-input",
      name: "Structured input",
      description: "Collects structured values and commits them on an explicit action — a form the user fills and submits.",
    },
    {
      id: "destructive-action",
      name: "Destructive action",
      description: "Performs an irreversible or high-consequence operation: deleting records or accounts, revoking access.",
    },
    {
      id: "record-collection",
      name: "Record collection",
      description: "Presents many records of the same kind — tickets, orders, members — in a table or list.",
    },
    {
      id: "record-detail",
      name: "Record detail",
      description: "Shows one record in full: an order, an account, a project, with its fields and related actions.",
    },
  ],
  components: {
    button: { whenToUse: "Trigger an action" },
    input: { whenToUse: "Collect a single-line text value" },
    card: { whenToUse: "Group related content" },
    table: { whenToUse: "Present rows of records" },
  },
};

const intentIds = contract.intents.map((i) => i.id);

/** A Gateway-#12-style lifecycle goal (the corpus text lives outside this
 *  repo; this fixture mirrors its shape: one workflow, numbered stations). */
const LIFECYCLE_GOAL = [
  "The whole request lifecycle for a customer integration:",
  "1. Browse the catalog of integration packages in a table and pick one.",
  "2. Fill in an estimate form with quantities and the delivery window.",
  "3. Review the estimate and confirm the order irreversibly.",
  "4. Show the created project record with its status fields.",
].join("\n");

describe("buildFlowPlanRequest — provider-agnostic decomposition request (shape only)", () => {
  it("carries the goal as the user message and names the design system + governed contexts", () => {
    const req = buildFlowPlanRequest(LIFECYCLE_GOAL, contract);
    expect(req.messages).toEqual([{ role: "user", content: LIFECYCLE_GOAL }]);
    expect(req.system).toContain("demo/ui");
    for (const id of intentIds) expect(req.system).toContain(id);
    // The decomposition rules, stated: bounded ordered steps, one screen each,
    // intents from the listed ids only, no invented steps.
    expect(req.system).toMatch(/2–8 ordered steps|2-8 ordered steps/);
    expect(req.system).toContain("ONE screen");
    expect(req.system).toContain("Do not invent steps");
  });

  it("schemas the plan strictly: 2–8 steps, closed objects, intent as a REAL-id enum", () => {
    const schema = buildFlowPlanRequest("a goal", contract).jsonSchema as {
      additionalProperties?: boolean;
      required?: string[];
      properties: { name: unknown; steps: { minItems?: number; maxItems?: number; items: { additionalProperties?: boolean; required?: string[]; properties: { intent?: { enum?: string[] } } } } };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["name", "steps"]);
    expect(schema.properties.steps.minItems).toBe(2);
    expect(schema.properties.steps.maxItems).toBe(8);
    const item = schema.properties.steps.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(["title", "goal"]); // intent stays optional; the reconciler fills it
    expect(item.properties.intent?.enum).toEqual(intentIds);
  });

  it("flowPlanSchema degrades to a plain string intent when a contract has no intents", () => {
    const schema = flowPlanSchema([]) as { properties: { steps: { items: { properties: { intent: unknown } } } } };
    expect(schema.properties.steps.items.properties.intent).toEqual({ type: "string" });
  });
});

describe("reconcileFlowPlan — clamp a model plan to the contract", () => {
  const rawPlan = {
    name: "Integration request lifecycle",
    steps: [
      { title: "Browse the catalog", goal: "a table of integration packages to pick from", intent: "record-collection" },
      { title: "Create the estimate", goal: "a form with quantities and delivery window", intent: "structured-input" },
    ],
  };

  it("keeps a valid plan verbatim, source 'model'", () => {
    const plan = reconcileFlowPlan(rawPlan, contract, LIFECYCLE_GOAL);
    expect(plan.source).toBe("model");
    expect(plan.name).toBe("Integration request lifecycle");
    expect(plan.steps.map((s) => s.intent)).toEqual(["record-collection", "structured-input"]);
    expect(plan.steps.map((s) => s.title)).toEqual(["Browse the catalog", "Create the estimate"]);
  });

  it("an invalid or missing step intent falls back to planDeterministic on THAT STEP's goal", () => {
    const plan = reconcileFlowPlan(
      {
        name: "X",
        steps: [
          { title: "A", goal: "permanently delete the account and revoke access", intent: "made-up" },
          { title: "B", goal: "a table of all support tickets" }, // no intent at all
        ],
      },
      contract,
      "goal",
    );
    expect(plan.steps[0].intent).toBe("destructive-action");
    expect(plan.steps[1].intent).toBe("record-collection");
  });

  it("bounds the plan: at most 8 steps, sliced name/title/goal lengths", () => {
    const steps = Array.from({ length: 12 }, (_, i) => ({
      title: `Step ${i} ${"t".repeat(200)}`,
      goal: `${"g".repeat(500)}`,
      intent: "structured-input",
    }));
    const plan = reconcileFlowPlan({ name: "n".repeat(400), steps }, contract, "goal");
    expect(plan.steps).toHaveLength(8);
    expect(plan.name.length).toBeLessThanOrEqual(120);
    for (const s of plan.steps) {
      expect(s.title.length).toBeLessThanOrEqual(80);
      expect(s.goal.length).toBeLessThanOrEqual(300);
    }
  });

  it("fewer than 2 usable steps (or garbage) falls back to the deterministic outline — never an empty plan", () => {
    for (const raw of [null, {}, { name: "X", steps: [] }, { name: "X", steps: [{ title: "", goal: "  " }] }, { name: "X", steps: "nope" }]) {
      const plan = reconcileFlowPlan(raw, contract, LIFECYCLE_GOAL);
      expect(plan.source).toBe("scripted");
      expect(plan.steps.length).toBeGreaterThanOrEqual(2);
      for (const s of plan.steps) expect(intentIds).toContain(s.intent);
    }
  });
});

describe("flowPlanDeterministic — the honest outline that never blocks", () => {
  it("splits a numbered lifecycle goal into its stations (the #12 shape): ≥4 steps, real intents, labeled scripted", () => {
    const plan = flowPlanDeterministic(LIFECYCLE_GOAL, contract);
    expect(plan.source).toBe("scripted");
    expect(plan.reason).toMatch(/deterministic/i);
    expect(plan.steps.length).toBeGreaterThanOrEqual(4);
    expect(plan.steps.length).toBeLessThanOrEqual(8);
    expect(plan.name.length).toBeGreaterThan(0);
    for (const s of plan.steps) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.goal.length).toBeGreaterThan(0);
      expect(intentIds).toContain(s.intent);
    }
    // The stations arrive in order: catalog table → estimate form → confirm → project record.
    expect(plan.steps[0].goal).toMatch(/catalog|packages/i);
    expect(plan.steps[0].intent).toBe("record-collection");
  });

  it("clusters a plain multi-sentence goal into one step per sentence", () => {
    const plan = flowPlanDeterministic(
      "Show one order in full detail. Let people delete their account. Show a table of remaining accounts.",
      contract,
    );
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[1].intent).toBe("destructive-action");
  });

  it("a single-sentence goal still yields an editable outline of at least 2 steps", () => {
    const plan = flowPlanDeterministic("let people book a meeting room", contract);
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    for (const s of plan.steps) expect(intentIds).toContain(s.intent);
  });

  it("a rambling goal is bounded to 6 outline steps", () => {
    const rambling = Array.from({ length: 12 }, (_, i) => `Do the ${i}th thing with records.`).join(" ");
    expect(flowPlanDeterministic(rambling, contract).steps.length).toBeLessThanOrEqual(6);
  });
});
