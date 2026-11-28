/**
 * State authoring (states.ts): create, duplicate, rename, order and remove states with every reference kept in
 * step; conditions over declared fields only; the states an action is sent from. Every result is also put
 * through the loader's checks, and instantiated through the governed pipeline where it should render.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Governor } from "./governance";
import { instantiate } from "./instantiate";
import { compositionIssues } from "./load";
import type { CompositionDefinition } from "./schema";
import { compositions, contract, datasets, governorFor } from "./spike/fixtures";
import { addState, duplicateState, guardProblem, moveState, removeState, renameState, setActionStates, setGuard, stateDependencies, statesShowingAction, uniqueStateId, unreachableStates } from "./states";

let g: Governor;
let cs: Record<string, CompositionDefinition>;
let ds: Record<string, any>;
beforeAll(async () => {
  g = await governorFor();
  cs = await compositions();
  ds = datasets();
});

const draft = (id: string) => ({ ...structuredClone(cs[id]!), status: "draft" as const, version: 9 });
const loaderIssues = (c: CompositionDefinition) => compositionIssues(c, contract()).map((i) => `${i.path}: ${i.message}`);
const ids = (c: CompositionDefinition) => c.states.map((s) => s.id);

describe("creating and ordering", () => {
  it("a new state goes before the first state that always holds, so the data can choose it; it renders through the pipeline", async () => {
    const c = draft("hotel-results");
    expect(addState(c, { id: "sold-out", purpose: "transactional-review", guard: { empty: "hotels" } })).toEqual({ ok: true, id: "sold-out" });
    expect(ids(c)).toEqual(["confirm", "empty", "sold-out", "ready"]);
    expect(loaderIssues(c)).toEqual([]);
    // A new state is governed like any other: judged as a transactional review, its starting card presents no
    // options and is refused by that rule; judged as structured editing, it renders.
    const refused = await instantiate(g, c, { surfaceId: "hotel-results-s-1", data: ds.none, state: "sold-out" });
    expect(!refused.ok && refused.failures?.[0]?.rule).toBe("rule.review-presents-options");
    c.states.find((s) => s.id === "sold-out")!.purpose = "structured-editing";
    const shown = await instantiate(g, c, { surfaceId: "hotel-results-s-2", data: ds.none, state: "sold-out" });
    expect(shown.ok && shown.instance.state).toBe("sold-out");
    expect(addState(c, { id: "sold-out", purpose: "transactional-review" })).toMatchObject({ ok: false, reason: expect.stringContaining("already") });
    expect(addState(c, { id: "Sold out", purpose: "transactional-review" })).toMatchObject({ ok: false, reason: expect.stringContaining("lowercase") });
    expect(uniqueStateId(c, "Sold out")).toBe("sold-out-2");
  });

  it("order is the order the data chooses in; a state after one that always holds is never chosen by the data", () => {
    const c = draft("hotel-results");
    expect(unreachableStates(c)).toEqual([]);
    expect(moveState(c, "ready", "earlier")).toEqual({ ok: true, id: "ready" });
    expect(unreachableStates(c)).toEqual(["empty"]);
    expect(moveState(c, "confirm", "earlier")).toMatchObject({ ok: false, reason: expect.stringContaining("first") });
  });
});

describe("conditions", () => {
  it("only declared fields; a number of items only for a list", () => {
    const c = draft("hotel-results");
    expect(guardProblem(c, { present: "selection" })).toBeNull();
    expect(guardProblem(c, { present: "selection.name" })).toBeNull();
    expect(guardProblem(c, { minItems: { path: "hotels", min: 2 } })).toBeNull();
    expect(guardProblem(c, { all: [{ present: "selection" }, { minItems: { path: "hotels", min: 1 } }] })).toBeNull();
    expect(guardProblem(c, { present: "coupon" })).toContain("not a declared field");
    expect(guardProblem(c, { minItems: { path: "destination", min: 1 } })).toContain("not a list");
    expect(setGuard(c, "empty", { present: "coupon" })).toMatchObject({ ok: false });
    expect(c.states.find((s) => s.id === "empty")!.guard).toEqual({ empty: "hotels" });
    expect(setGuard(c, "empty", { minItems: { path: "hotels", min: 0 } })).toEqual({ ok: true, id: "empty" });
    expect(loaderIssues(c)).toEqual([]);
  });
});

describe("duplicating and renaming", () => {
  it("a duplicate keeps its elements' ids and is sent the same actions; the loader accepts it", () => {
    const c = draft("hotel-results");
    expect(duplicateState(c, "ready", "ready-compact")).toEqual({ ok: true, id: "ready-compact" });
    expect(ids(c)).toEqual(["confirm", "empty", "ready", "ready-compact"]);
    expect(c.actions.find((a) => a.name === "choose")!.states).toEqual(["ready", "ready-compact"]);
    expect(c.actions.find((a) => a.name === "new_search")!.states).toEqual(["ready", "ready-compact"]);
    expect(loaderIssues(c)).toEqual([]);
  });

  it("a confirmation state is not duplicated: its consequential action is sent from exactly one state", () => {
    const c = draft("hotel-results");
    const before = JSON.stringify(c);
    expect(duplicateState(c, "confirm", "confirm-again")).toMatchObject({ ok: false, reason: expect.stringContaining("consequential") });
    expect(JSON.stringify(c)).toBe(before);
  });

  it("a rename updates every action and every example that names the state, in one operation", () => {
    const c = draft("hotel-results");
    c.scenarios[0]!.state = "confirm";
    expect(renameState(c, "confirm", "review-booking")).toEqual({ ok: true, id: "review-booking" });
    expect(c.actions.find((a) => a.name === "reserve")!.states).toEqual(["review-booking"]);
    expect(c.scenarios[0]!.state).toBe("review-booking");
    expect(renameState(c, "ready", "empty")).toMatchObject({ ok: false, reason: expect.stringContaining("already") });
    expect(loaderIssues(c)).toEqual([]);
  });
});

describe("removing", () => {
  it("says what depends on a state, refuses without resolving, and changes exactly that when asked", () => {
    const c = draft("hotel-results");
    c.scenarios.find((s) => s.id === "none")!.state = "empty";
    const deps = stateDependencies(c, "empty")!;
    expect(deps.actions).toEqual([{ name: "search_again", effect: "removed" }]);
    expect(deps.inputs).toEqual(["destination"].filter((x) => c.inputs.some((i) => i.name === x)));
    expect(deps.scenarios).toEqual(["none"]);
    const before = JSON.stringify(c);
    expect(removeState(c, "empty")).toMatchObject({ ok: false, reason: "other declarations depend on it" });
    expect(JSON.stringify(c)).toBe(before);
    expect(removeState(c, "empty", true)).toMatchObject({ ok: true });
    expect(ids(c)).toEqual(["confirm", "ready"]);
    expect(c.actions.map((a) => a.name)).not.toContain("search_again");
    expect(c.scenarios.find((s) => s.id === "none")!.state).toBeUndefined();
    expect(loaderIssues(c)).toEqual([]);
  });

  it("the last state stays", () => {
    const c = draft("hotel-search");
    expect(removeState(c, "invalid", true)).toMatchObject({ ok: true });
    expect(removeState(c, "ready", true)).toMatchObject({ ok: false, reason: expect.stringContaining("at least one state") });
  });
});

describe("what actions do", () => {
  it("an action is sent only from states that show its element; a consequential action from exactly one", () => {
    const c = draft("hotel-results");
    duplicateState(c, "ready", "ready-compact");
    expect(statesShowingAction(c, "choose")).toEqual(["ready", "ready-compact"]);
    expect(setActionStates(c, "choose", ["ready"])).toEqual({ ok: true, id: "choose" });
    expect(c.actions.find((a) => a.name === "choose")!.states).toEqual(["ready"]);
    expect(setActionStates(c, "choose", ["confirm"])).toMatchObject({ ok: false, reason: expect.stringContaining("does not show") });
    expect(setActionStates(c, "choose", [])).toMatchObject({ ok: false, reason: expect.stringContaining("at least one") });
    expect(loaderIssues(c)).toEqual([]);
  });
});
