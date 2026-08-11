import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emittedActionNames,
  emittedActionsBySurface,
  flowLint,
  loadFlows,
  mintStepId,
  nextFlowId,
  parseFlow,
  saveFlows,
  slugify,
  type Flow,
} from "./flows";
import { createProject, duplicateProject, removeProject } from "./projects";

/**
 * P4 Phase A — flows as project-layer data (fail-first).
 *
 * A flow is an ordered list of REFERENCES to existing worked-example surfaces:
 * stored beside the authored-examples delta (same quota-honest idiom), linted
 * as references (never as surfaces), and never touching contracts, dspack-gen,
 * dspack-emit, or A2UI. These specs pin the store lifecycle, id minting, the
 * flow-lint cases, and the emitted-action walker Preview's advanceOn rests on.
 */

/* ------------------------------------------------------------------ */
/* localStorage stub: vitest runs in node (no jsdom anywhere in this   */
/* repo), and projects.ts/flows.ts both degrade through storage() when */
/* window is absent — so the store is exercised through a minimal      */
/* window.localStorage stub, and quota failure through a throwing one. */
/* ------------------------------------------------------------------ */

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
}

let store: MemoryStorage;

beforeEach(() => {
  store = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: store };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const flowFixture: Flow = {
  id: "flow.flow-1",
  name: "Order walkthrough",
  description: "Review the order, then confirm the deletion.",
  steps: [
    { id: "step.review-the-order", title: "Review the order", surfaceId: "ex.order-detail-summary", advanceOn: ["download_invoice"] },
    { id: "step.delete-the-account", title: "Delete the account", surfaceId: "ex.delete-account-confirmation", terminal: true },
  ],
};

const key = (id: string) => `composer.project.flows.${id}`;

describe("flows store — the examples-delta idiom, per project id", () => {
  it("saves and loads a project's flows (quota-honest boolean save)", () => {
    expect(saveFlows("p1", [flowFixture])).toBe(true);
    expect(loadFlows("p1")).toEqual([flowFixture]);
  });

  it("an EMPTY array removes the key rather than storing []", () => {
    saveFlows("p1", [flowFixture]);
    expect(store.getItem(key("p1"))).not.toBeNull();
    expect(saveFlows("p1", [])).toBe(true);
    expect(store.getItem(key("p1"))).toBeNull();
    expect(loadFlows("p1")).toEqual([]);
  });

  it("loadFlows filters malformed entries instead of throwing or leaking them", () => {
    store.setItem(
      key("p1"),
      JSON.stringify([
        flowFixture,
        null,
        42,
        { id: "flow.no-name", steps: [] },
        { id: "flow.bad-steps", name: "Bad", steps: "nope" },
        { id: "flow.bad-step-entry", name: "Bad step", steps: [{ id: "step.x", title: "X" }] }, // no surfaceId
      ]),
    );
    expect(loadFlows("p1")).toEqual([flowFixture]);
  });

  it("non-array or corrupt payloads load as [] (never a crash)", () => {
    store.setItem(key("p1"), JSON.stringify({ not: "an array" }));
    expect(loadFlows("p1")).toEqual([]);
    store.setItem(key("p1"), "{corrupt");
    expect(loadFlows("p1")).toEqual([]);
  });

  it("reports a failed save honestly when storage throws (quota)", () => {
    store.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(saveFlows("p1", [flowFixture])).toBe(false);
  });

  it("degrades to a no-op store when window is absent (SSR/static prerender)", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(saveFlows("p1", [flowFixture])).toBe(false);
    expect(loadFlows("p1")).toEqual([]);
  });
});

describe("project lifecycle hooks — duplicate copies flows, remove clears them", () => {
  it("duplicateProject carries the flows UNCONDITIONALLY when non-empty (like the examples delta)", () => {
    const p = createProject({ name: "Original", source: { kind: "reference", referenceId: "shadcn" } });
    saveFlows(p.id, [flowFixture]);
    const copy = duplicateProject(p.id)!;
    expect(copy).not.toBeNull();
    expect(loadFlows(copy.id)).toEqual([flowFixture]);
  });

  it("duplicating a project without flows writes no flows key for the copy", () => {
    const p = createProject({ name: "Flowless", source: { kind: "reference", referenceId: "shadcn" } });
    const copy = duplicateProject(p.id)!;
    expect(store.getItem(key(copy.id))).toBeNull();
  });

  it("removeProject clears the flows store (no orphaned keys)", () => {
    const p = createProject({ name: "Doomed", source: { kind: "reference", referenceId: "shadcn" } });
    saveFlows(p.id, [flowFixture]);
    removeProject(p.id);
    expect(store.getItem(key(p.id))).toBeNull();
    expect(loadFlows(p.id)).toEqual([]);
  });
});

describe("id minting — flow.flow-N monotonic, step.<slug> collision-safe", () => {
  it("nextFlowId starts at flow.flow-1 and is monotonic + gap-tolerant over existing ids", () => {
    expect(nextFlowId([])).toBe("flow.flow-1");
    expect(nextFlowId(["flow.flow-1"])).toBe("flow.flow-2");
    expect(nextFlowId(["flow.flow-1", "flow.flow-7"])).toBe("flow.flow-8"); // gap-tolerant, like ex.chat-N
    expect(nextFlowId(["flow.gateway-lifecycle", "flow.flow-2"])).toBe("flow.flow-3"); // non-matching ids ignored
  });

  it("nextFlowId never collides with an existing id", () => {
    const existing = ["flow.flow-1", "flow.flow-2", "flow.flow-3"];
    expect(existing).not.toContain(nextFlowId(existing));
  });

  it("slugify produces the lowercase kebab idiom ids are built from", () => {
    expect(slugify("Review the order")).toBe("review-the-order");
    expect(slugify("  Confirm & create!  ")).toBe("confirm-create");
    expect(slugify("ex.chat-1")).toBe("ex-chat-1");
    expect(slugify("???")).toBe("");
  });

  it("mintStepId slugs the title and suffixes on collision; empty slugs fall back to step-N", () => {
    const taken = new Set<string>();
    const first = mintStepId("Review the order", taken);
    expect(first).toBe("step.review-the-order");
    taken.add(first);
    const second = mintStepId("Review the order", taken);
    expect(second).toBe("step.review-the-order-2");
    expect(second).not.toBe(first);
    const fallback = mintStepId("???", new Set());
    expect(fallback).toMatch(/^step\.step-\d+$/);
  });
});

describe("parseFlow — the one strict shape authority (store filter + import gate)", () => {
  it("round-trips a well-formed flow, dropping unknown keys", () => {
    const parsed = parseFlow({ ...flowFixture, unknownKey: "dropped" });
    expect(parsed).toEqual(flowFixture);
    expect(parsed && "unknownKey" in (parsed as unknown as Record<string, unknown>)).toBe(false);
  });

  it("refuses missing/mistyped required fields and mistyped optionals", () => {
    expect(parseFlow(null)).toBeNull();
    expect(parseFlow({ name: "No id", steps: [] })).toBeNull();
    expect(parseFlow({ id: "flow.x", steps: [] })).toBeNull(); // no name
    expect(parseFlow({ id: "flow.x", name: "X" })).toBeNull(); // no steps
    expect(parseFlow({ id: "flow.x", name: "X", steps: [{ id: "step.a", title: "A" }] })).toBeNull(); // step without surfaceId
    expect(parseFlow({ id: "flow.x", name: "X", steps: [], description: 42 })).toBeNull();
    expect(
      parseFlow({ id: "flow.x", name: "X", steps: [{ id: "step.a", title: "A", surfaceId: "ex.a", advanceOn: "confirm" }] }),
    ).toBeNull(); // advanceOn must be string[]
    expect(
      parseFlow({ id: "flow.x", name: "X", steps: [{ id: "step.a", title: "A", surfaceId: "ex.a", on: [{ event: "confirm" }] }] }),
    ).toBeNull(); // on entries need {event, to}
    expect(
      parseFlow({ id: "flow.x", name: "X", steps: [{ id: "step.a", title: "A", surfaceId: "ex.a", terminal: "yes" }] }),
    ).toBeNull(); // terminal must be boolean
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
    expect(parseFlow(withOn)).toEqual(withOn);
  });
});

describe("emitted-action walker — the names advanceOn may reference", () => {
  const messages = [
    { version: "v0.9", createSurface: { surfaceId: "s1", catalogId: "https://example.com/catalog.json" } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "s1",
        components: [
          { id: "b1", component: "Button", child: "b1l", action: { event: { name: "download_invoice", context: {} } } },
          { id: "b1l", component: "Text", text: "Download invoice" },
          { id: "dlg", component: "AlertDialog", action: { event: { name: "delete_account", context: {} } } },
          { id: "deep", component: "Card", props: { nested: [{ event: { name: "deep_event", context: {} } }] } },
          { id: "notevent", component: "Text", event: "not-an-object" },
          { id: "badname", component: "Text", event: { name: 42 } },
        ],
      },
    },
  ];

  it("collects every {event: {name}} object, however nested; ignores non-conforming shapes", () => {
    expect(emittedActionNames(messages)).toEqual(new Set(["download_invoice", "delete_account", "deep_event"]));
  });

  it("maps action names per surface; surfaces without messages contribute an empty set", () => {
    const map = emittedActionsBySurface([
      { name: "ex.order-detail-summary", messages },
      { name: "ex.refused" }, // emit refusal: no messages
    ]);
    expect(map.get("ex.order-detail-summary")).toEqual(new Set(["download_invoice", "delete_account", "deep_event"]));
    expect(map.get("ex.refused")).toEqual(new Set());
  });
});

describe("flowLint — reference validation with the finding() shape, gate 'flow'", () => {
  const ctx = () => ({
    exampleIds: new Set(["ex.order-detail-summary", "ex.delete-account-confirmation"]),
    actionsBySurface: new Map([
      ["ex.order-detail-summary", new Set(["download_invoice", "start_a_return"])],
      ["ex.delete-account-confirmation", new Set(["delete_account", "cancel"])],
    ]),
  });

  it("a clean flow lints to [] — and every finding elsewhere carries gate 'flow'", () => {
    expect(flowLint([flowFixture], ctx())).toEqual([]);
  });

  it("a dangling surfaceId is an ERROR targeted <flowId>/<stepId>", () => {
    const flows: Flow[] = [
      { id: "flow.flow-1", name: "Dangles", steps: [{ id: "step.gone", title: "Gone", surfaceId: "ex.does-not-exist" }] },
    ];
    const findings = flowLint(flows, ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].gate).toBe("flow");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].target).toBe("flow.flow-1/step.gone");
    expect(findings[0].message).toContain("ex.does-not-exist");
  });

  it("duplicate step ids within a flow are ERRORS", () => {
    const flows: Flow[] = [
      {
        id: "flow.flow-1",
        name: "Dup steps",
        steps: [
          { id: "step.same", title: "One", surfaceId: "ex.order-detail-summary" },
          { id: "step.same", title: "Two", surfaceId: "ex.delete-account-confirmation" },
        ],
      },
    ];
    const findings = flowLint(flows, ctx());
    expect(findings.some((f) => f.severity === "error" && f.target === "flow.flow-1/step.same")).toBe(true);
  });

  it("duplicate flow ids are ERRORS targeted at the flow id", () => {
    const a: Flow = { id: "flow.flow-1", name: "A", steps: [{ id: "step.a", title: "A", surfaceId: "ex.order-detail-summary" }] };
    const b: Flow = { id: "flow.flow-1", name: "B", steps: [{ id: "step.b", title: "B", surfaceId: "ex.order-detail-summary" }] };
    const findings = flowLint([a, b], ctx());
    expect(findings.some((f) => f.severity === "error" && f.target === "flow.flow-1")).toBe(true);
  });

  it("a reserved on[].to that names no step in the SAME flow is an ERROR (F4: validated, not executed)", () => {
    const flows: Flow[] = [
      {
        id: "flow.flow-1",
        name: "Branchy",
        steps: [
          {
            id: "step.a",
            title: "A",
            surfaceId: "ex.order-detail-summary",
            on: [
              { event: "download_invoice", to: "step.b" },
              { event: "start_a_return", to: "step.missing" },
            ],
          },
          { id: "step.b", title: "B", surfaceId: "ex.delete-account-confirmation" },
        ],
      },
    ];
    const findings = flowLint(flows, ctx());
    const errors = findings.filter((f) => f.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].target).toBe("flow.flow-1/step.a");
    expect(errors[0].message).toContain("step.missing");
  });

  it("an advanceOn name the referenced surface never emits is a WARN (surfaces evolve)", () => {
    const flows: Flow[] = [
      {
        id: "flow.flow-1",
        name: "Stale advance",
        steps: [{ id: "step.a", title: "A", surfaceId: "ex.order-detail-summary", advanceOn: ["confirm_and_create"] }],
      },
    ];
    const findings = flowLint(flows, ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].gate).toBe("flow");
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].target).toBe("flow.flow-1/step.a");
    expect(findings[0].message).toContain("confirm_and_create");
  });

  it("an empty steps array is a WARN targeted at the flow", () => {
    const findings = flowLint([{ id: "flow.flow-1", name: "Empty", steps: [] }], ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].target).toBe("flow.flow-1");
  });

  it("a dangling surface does NOT also warn about its advanceOn (one cause, one finding)", () => {
    const flows: Flow[] = [
      { id: "flow.flow-1", name: "Gone", steps: [{ id: "step.a", title: "A", surfaceId: "ex.gone", advanceOn: ["anything"] }] },
    ];
    const findings = flowLint(flows, ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });
});
