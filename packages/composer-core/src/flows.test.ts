import { describe, expect, it } from "vitest";
import { flowSchema, parseFlows, type Flow } from "./flows";

/**
 * P4 Phase B — the flow shape lifted into composer-core (fail-first).
 *
 * ONE shape, two gates: the browser's parseFlow (apps/composer/app/flows.ts,
 * hand-rolled, behavior pinned by its own suite) and this zod schema serving
 * the STRICT manifest (`project.json` flows) and the agent's save-flow route.
 * The rules must agree exactly: required id/name/steps (+ step
 * id/title/surfaceId), optional advanceOn string[], reserved `on`
 * [{event,to}], terminal boolean, description string; unknown keys DROPPED
 * (matching the browser parser), wrong types refused.
 */

const flow: Flow = {
  id: "flow.flow-1",
  name: "Order walkthrough",
  description: "Review, then confirm.",
  steps: [
    { id: "step.review", title: "Review the order", surfaceId: "ex.order-detail-summary", advanceOn: ["download_invoice"] },
    { id: "step.confirm", title: "Confirm", surfaceId: "ex.delete-account-confirmation", terminal: true },
  ],
};

describe("flowSchema — the zod twin of the app's parseFlow", () => {
  it("round-trips a well-formed flow and DROPS unknown keys (parity with parseFlow)", () => {
    const parsed = flowSchema.safeParse({ ...flow, unknownKey: "dropped" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(flow);
      expect("unknownKey" in (parsed.data as Record<string, unknown>)).toBe(false);
    }
  });

  it("preserves the RESERVED `on` branching annotation without acting on it (F4)", () => {
    const withOn = {
      id: "flow.x",
      name: "X",
      steps: [
        { id: "step.a", title: "A", surfaceId: "ex.a", on: [{ event: "confirm", to: "step.b" }] },
        { id: "step.b", title: "B", surfaceId: "ex.b" },
      ],
    };
    const parsed = flowSchema.safeParse(withOn);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(withOn);
  });

  it("refuses missing/mistyped required fields and mistyped optionals (parseFlow parity)", () => {
    for (const bad of [
      null,
      { name: "No id", steps: [] },
      { id: "flow.x", steps: [] }, // no name
      { id: "flow.x", name: "X" }, // no steps
      { id: "flow.x", name: "X", steps: [{ id: "step.a", title: "A" }] }, // step without surfaceId
      { id: "flow.x", name: "X", steps: [], description: 42 },
      { id: "flow.x", name: "X", steps: [{ id: "step.a", title: "A", surfaceId: "ex.a", advanceOn: "confirm" }] },
      { id: "flow.x", name: "X", steps: [{ id: "step.a", title: "A", surfaceId: "ex.a", on: [{ event: "confirm" }] }] },
      { id: "flow.x", name: "X", steps: [{ id: "step.a", title: "A", surfaceId: "ex.a", terminal: "yes" }] },
    ]) {
      expect(flowSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("parseFlows — the array gate the agent's save-flow route applies", () => {
  it("parses a valid array (and [] as the empty set)", () => {
    const one = parseFlows([flow]);
    expect(one.ok).toBe(true);
    if (one.ok) expect(one.flows).toEqual([flow]);
    const none = parseFlows([]);
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.flows).toEqual([]);
  });

  it("refuses a non-array outright", () => {
    expect(parseFlows("three of them").ok).toBe(false);
    expect(parseFlows({ 0: flow }).ok).toBe(false);
  });

  it("refuses a malformed entry with a pathed issue naming the offender", () => {
    const result = parseFlows([flow, { id: "flow.bad" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.path.startsWith("1"))).toBe(true);
    }
  });
});
