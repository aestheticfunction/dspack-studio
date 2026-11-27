/**
 * The structure of a composition and where each rendered component came from (structure.ts): definition-level
 * identities that do not depend on data, and a component-to-element map that agrees with the bindings' own
 * per-item evidence or is not given at all.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Governor } from "./governance";
import { instantiate, type Instance } from "./instantiate";
import type { CompositionDefinition } from "./schema";
import { compositions, datasets, governorFor } from "./spike/fixtures";
import { actionNameFor, findInStructure, flattenStructure, instanceElements, statesWithElement, structureOf } from "./structure";

let g: Governor;
let cs: Record<string, CompositionDefinition>;
let ds: Record<string, any>;
beforeAll(async () => {
  g = await governorFor();
  cs = await compositions();
  ds = datasets();
});

const results = () => cs["hotel-results"]!;
async function show(c: CompositionDefinition, data: any, n = 1): Promise<Instance> {
  const r = await instantiate(g, c, { surfaceId: `${c.id}-s-${n}`, data });
  if (!r.ok) throw new Error(`${r.stage}: ${r.reason}`);
  return r.instance;
}

describe("structure: definition-level identity", () => {
  it("a literal id is the identity in every state; an unnamed node is its state and template path", () => {
    const ready = structureOf(results().states.find((s) => s.id === "ready")!);
    const keys = flattenStructure(ready).map((n) => n.key);
    expect(keys).toContain("#results");
    expect(keys).toContain("#choose");
    expect(keys).toContain("#new-search");
    expect(keys).toContain("ready@");
    expect(keys).toContain("ready@2.0"); // the repeat over hotels
    expect(keys).toContain("ready@2.0.0"); // the selectable card the repeat yields
    expect(new Set(keys).size).toBe(keys.length);
    const search = cs["hotel-search"]!;
    expect(statesWithElement(search, "#destination").sort()).toEqual(["invalid", "ready"]);
    expect(statesWithElement(results(), "#reserve")).toEqual(["confirm"]);
  });

  it("a repeated element knows the repeat it sits in, and the repeat is a node of its own", () => {
    const ready = structureOf(results().states.find((s) => s.id === "ready")!);
    const trail = findInStructure(ready, "#choose")!;
    expect(trail.map((n) => n.kind)).toEqual(["element", "element", "repeat", "element", "element"]);
    expect(trail.at(-1)!.within).toEqual([{ each: "hotels", as: "hotel" }]);
    expect(trail[2]!.repeat).toEqual({ each: "hotels", as: "hotel" });
    expect(actionNameFor("new-search")).toBe("new_search");
  });

  it("structure does not depend on data: it is the same whatever the example", async () => {
    const ready = results().states.find((s) => s.id === "ready")!;
    expect(JSON.stringify(structureOf(ready))).toBe(JSON.stringify(structureOf(structuredClone(ready))));
    for (const set of ["three", "two", "twenty"]) {
      const map = instanceElements(results(), await show(results(), ds[set]), ds[set])!;
      expect([...map.byKey.keys()].sort(), set).toEqual(flattenStructure(structureOf(ready)).filter((n) => n.kind === "element").map((n) => n.key).sort());
    }
  });
});

describe("instance map: from a rendered component to its element", () => {
  it("every emitted component maps to one element; a repeated one also to its item", async () => {
    const instance = await show(results(), ds.three);
    const map = instanceElements(results(), instance, ds.three)!;
    expect(map).not.toBeNull();
    const all = instance.messages.flatMap((m: any) => m.updateComponents?.components ?? []).map((x: any) => x.id);
    expect([...map.byComponent.keys()].sort()).toEqual([...all].sort());
    expect(map.byKey.get("#choose")).toHaveLength(3);
    expect(map.byComponent.get("root_col")).toEqual({ key: "ready@" }); // the emitter's layout wrapper renders the card
    expect(map.byKey.get("#choose")!.map((id) => map.byComponent.get(id)!.item!.index)).toEqual([0, 1, 2]);
  });

  it("a repeated action's item, read from the map, is the item whose payload the bindings attached", async () => {
    for (const set of ["three", "reordered", "removed", "twenty"]) {
      const instance = await show(results(), ds[set]);
      const map = instanceElements(results(), instance, ds[set])!;
      const choose = instance.actions.filter((a) => a.name === "choose");
      expect(choose.length, set).toBe(ds[set].hotels.length);
      for (const a of choose) {
        const item = map.byComponent.get(a.componentId)!.item!;
        expect(item.as).toBe("hotel");
        expect(a.payload.hotelId, set).toBe(ds[set].hotels[item.index].id);
      }
    }
  });

  it("inputs and single actions map to their own literal-id elements", async () => {
    const search = cs["hotel-search"]!;
    const instance = await show(search, {});
    const map = instanceElements(search, instance, {})!;
    for (const i of instance.inputs) expect(map.byComponent.get(i.componentId)!.key).toBe(`#${search.inputs.find((x) => x.name === i.name)!.node}`);
    expect(map.byComponent.get("search")).toEqual({ key: "#search" });
  });

  it("fails closed: a different state's instance, a tampered expansion, or a condition gives no map", async () => {
    const instance = await show(results(), ds.three);
    const swapped = structuredClone(instance) as Instance;
    (swapped as any).expansion.root.children.reverse();
    expect(instanceElements(results(), swapped, ds.three)).toBeNull();
    const lying = structuredClone(instance) as Instance;
    (lying.actions.find((a) => a.name === "choose" && a.item!.index === 0)!.item as any).index = 2;
    expect(instanceElements(results(), lying, ds.three)).toBeNull();
    const withCondition = structuredClone(results());
    const ready = withCondition.states.find((s) => s.id === "ready")!;
    (ready.template as any).children.splice(1, 0, { $if: "destination", children: [{ component: "text", text: "Where to" }] });
    expect(instanceElements(withCondition, instance, ds.three)).toBeNull();
    // The structure is still available when the canvas map is not.
    expect(findInStructure(structureOf(ready), `${ready.id}@1`)![1]!.kind).toBe("condition");
  });
});
