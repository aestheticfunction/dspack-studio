/**
 * Template editing (template.ts): stable identity across insertion, removal and reordering; atomic id changes;
 * dependency-aware removal; and repeated items still sending their own values after structural changes. Every
 * result is also put through the loader's checks.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Governor } from "./governance";
import { instantiate } from "./instantiate";
import { compositionIssues } from "./load";
import type { CompositionDefinition } from "./schema";
import { compositions, contract, datasets, governorFor } from "./spike/fixtures";
import { instanceElements, structureOf, flattenStructure } from "./structure";
import { allIds, assignId, dependenciesOf, insertNode, locate, moveNode, removeNode, renameId, uniqueId } from "./template";

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
const keys = (c: CompositionDefinition, state: string) => flattenStructure(structureOf(c.states.find((s) => s.id === state)!)).map((n) => n.key);

describe("identity", () => {
  it("an element without an id gets one: unique, never emitted like another, and its key becomes #id", () => {
    const c = draft("hotel-results");
    expect(assignId(c, "ready", "ready@0", "results-title")).toEqual({ ok: true, key: "#results-title" });
    expect(keys(c, "ready")).toContain("#results-title");
    expect(assignId(c, "ready", "ready@1", "results-title")).toMatchObject({ ok: false, reason: expect.stringContaining("already has the id") });
    expect(assignId(c, "ready", "ready@1", "new_search")).toMatchObject({ ok: false, reason: expect.stringContaining("lowercase letters") });
    expect(assignId(c, "ready", "#choose", "x")).toMatchObject({ ok: false, reason: expect.stringContaining("rename it instead") });
    expect(uniqueId(c, "Choose")).toBe("choose-2");
    expect(loaderIssues(c)).toEqual([]);
  });

  it("renaming an id changes every reference in one operation: nodes in every state, inputs, actions (and their names), and a repeat's list", async () => {
    const search = draft("hotel-search");
    expect(renameId(search, "check-in", "arrival-date")).toEqual({ ok: true, key: "#arrival-date" });
    expect(search.states.map((s) => locate(s, "#arrival-date") !== null)).toEqual([true, true]);
    expect(search.inputs.find((i) => i.name === "checkIn")!.node).toBe("arrival-date");
    expect(renameId(search, "search", "find-hotels")).toEqual({ ok: true, key: "#find-hotels" });
    expect(search.actions[0]).toMatchObject({ name: "find_hotels", node: "find-hotels" });
    expect(loaderIssues(search)).toEqual([]);
    expect((await instantiate(g, search, { surfaceId: "hotel-search-r-1", data: {} })).ok).toBe(true);

    const results = draft("hotel-results");
    expect(renameId(results, "results", "hotel-list")).toEqual({ ok: true, key: "#hotel-list" });
    expect(results.actions.find((a) => a.name === "choose")!.repeat!.list).toBe("hotel-list");
    expect(loaderIssues(results)).toEqual([]);
    const r = await instantiate(g, results, { surfaceId: "hotel-results-r-1", data: ds.three });
    expect(r.ok).toBe(true);
    // Refused, and nothing changed: a taken id, or one emitted like another.
    const before = JSON.stringify(results);
    expect(renameId(results, "hotel-list", "choose")).toMatchObject({ ok: false });
    expect(renameId(results, "hotel-list", "new-search")).toMatchObject({ ok: false });
    expect(renameId(results, "nothing", "anything")).toMatchObject({ ok: false });
    expect(JSON.stringify(results)).toBe(before);
  });
});

describe("structure", () => {
  it("insert before, after and inside; refused beside the root, inside a component that holds nothing, or with a taken id", () => {
    const c = draft("hotel-search");
    const n = { component: "text", props: { type: "supporting" }, text: "We never share these details." };
    const r = insertNode(c, "ready", { key: "#search", position: "before" }, n);
    expect(r).toEqual({ ok: true, key: "ready@6" });
    expect(keys(c, "ready").slice(7, 9)).toEqual(["ready@6", "#search"]);
    expect(insertNode(c, "ready", { key: "ready@", position: "inside" }, { component: "badge", props: { label: "New" } })).toMatchObject({ ok: true, key: "ready@8" });
    expect(insertNode(c, "ready", { key: "ready@", position: "after" }, n)).toMatchObject({ ok: false, reason: expect.stringContaining("outermost") });
    expect(insertNode(c, "ready", { key: "#search", position: "inside" }, n)).toMatchObject({ ok: false, reason: "a button does not hold other elements" });
    expect(insertNode(c, "ready", { key: "#search", position: "after" }, { component: "button", id: "destination", props: { label: "x" } })).toMatchObject({ ok: false, reason: expect.stringContaining("already has the id") });
    // Bindings are by id: every input still binds the field it bound.
    for (const i of c.inputs) expect(locate(c.states.find((s) => s.id === "ready")!, `#${i.node}`)!.node.component).toBe("text-input");
    expect(loaderIssues(c)).toEqual([]);
  });

  it("reordering inside a repeated item keeps each item's action and payload together", async () => {
    const c = draft("hotel-results");
    // Move the Choose button above the details list, inside each hotel's card.
    const moved = moveNode(c, "ready", "#choose", { key: "ready@2.0.0.0", position: "before" });
    expect(moved).toEqual({ ok: true, key: "#choose" });
    expect(loaderIssues(c)).toEqual([]);
    for (const set of ["three", "reordered", "removed"]) {
      const r = await instantiate(g, c, { surfaceId: `hotel-results-m-${set}`, data: ds[set] });
      expect(r.ok, set).toBe(true);
      if (!r.ok) continue;
      const map = instanceElements(c, r.instance, ds[set])!;
      expect(map, set).not.toBeNull();
      for (const a of r.instance.actions.filter((x) => x.name === "choose")) {
        expect(map.byComponent.get(a.componentId)!.key).toBe("#choose");
        expect(a.payload.hotelId).toBe(ds[set].hotels[map.byComponent.get(a.componentId)!.item!.index].id);
      }
    }
  });

  it("a move into itself, outside its state or into a component that holds nothing is refused and changes nothing", () => {
    const c = draft("hotel-results");
    const before = JSON.stringify(c);
    expect(moveNode(c, "ready", "#results", { key: "ready@2.0.0", position: "inside" })).toMatchObject({ ok: false, reason: "an element cannot be moved into itself" });
    expect(moveNode(c, "ready", "#new-search", { key: "#choose", position: "inside" })).toMatchObject({ ok: false, reason: "a button does not hold other elements" });
    expect(moveNode(c, "ready", "#new-search", { key: "#reserve", position: "after" })).toMatchObject({ ok: false });
    expect(moveNode(c, "ready", "ready@", { key: "#choose", position: "after" })).toMatchObject({ ok: false, reason: "the outermost element cannot be moved" });
    expect(JSON.stringify(c)).toBe(before);
  });

  it("a move the loader refuses: two elements per hotel would break the item-to-button association", () => {
    const c = draft("hotel-results");
    expect(moveNode(c, "ready", "#new-search", { key: "ready@2.0.0", position: "after" }).ok).toBe(true);
    expect(loaderIssues(c).join("\n")).toContain("each item must expand to exactly one node");
  });
});

describe("removal and dependencies", () => {
  it("names what depends on an element, refuses without resolution, and with it changes exactly those declarations", () => {
    const c = draft("hotel-search");
    // Search is shown in two states: removing it from one keeps the action, sent from the other.
    expect(dependenciesOf(c, "ready", "#search")).toEqual({ inputs: [], actions: [{ name: "search", effect: "no-longer-in-state" }], carries: [] });
    expect(removeNode(c, "ready", "#search")).toEqual({ ok: false, reason: "other declarations depend on it" });
    expect(removeNode(c, "ready", "#search", true)).toEqual({ ok: true, key: "ready@" });
    expect(c.actions[0]!.states).toEqual(["invalid"]);
    expect(loaderIssues(c)).toEqual([]);
    // The loyalty field, from both states: its input goes, and Search stops sending it.
    expect(removeNode(c, "ready", "#member-number", true).ok).toBe(true);
    expect(dependenciesOf(c, "invalid", "#member-number")).toEqual({ inputs: ["memberNumber"], actions: [], carries: [{ action: "search", input: "memberNumber" }] });
    expect(removeNode(c, "invalid", "#member-number", true).ok).toBe(true);
    expect(c.inputs.map((i) => i.name)).not.toContain("memberNumber");
    expect(c.actions[0]!.carries).not.toContain("memberNumber");
    expect(allIds(c).has("member-number")).toBe(false);
    expect(loaderIssues(c)).toEqual([]);
  });

  it("removing a whole list removes the repeated action on it; unrelated declarations stay", () => {
    const c = draft("hotel-results");
    const d = dependenciesOf(c, "ready", "#results")!;
    expect(d.actions).toEqual([{ name: "choose", effect: "removed" }]);
    expect(removeNode(c, "ready", "#results", true).ok).toBe(true);
    expect(c.actions.map((a) => a.name)).toEqual(["new_search", "search_again", "reserve", "back"]);
    expect(c.inputs.map((i) => i.name)).toEqual(["destination"]);
    expect(loaderIssues(c)).toEqual([]);
  });
});
