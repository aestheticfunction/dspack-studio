import { beforeAll, describe, expect, it } from "vitest";
import { validateCatalog } from "@aestheticfunction/dspack-emit";
import { bindingLayoutIssues, childRefs } from "./bindings";
import type { Governor } from "./governance";
import { instantiate, type Instance } from "./instantiate";
import type { CompositionDefinition } from "./schema";
import { compositions, datasets, governorFor } from "./spike/fixtures";

let g: Governor;
let cs: Record<string, CompositionDefinition>;
let ds: Record<string, any>;
beforeAll(async () => {
  g = await governorFor();
  cs = await compositions();
  ds = datasets();
});

const results = (data: unknown, surfaceId = "hotel-results-t-1") => instantiate(g, cs["hotel-results"]!, { surfaceId, data: data as never });

function components(instance: Instance) {
  const out = new Map<string, any>();
  for (const m of instance.messages) for (const c of m.updateComponents?.components ?? []) out.set(c.id, c);
  return out;
}

/**
 * The ids under `root`, root included, walked here rather than through the implementation's own subtree()
 * (R1A-REVIEW E2): A2UI 0.9 names children in `child` (one id) or `children` (an id array).
 */
function descendants(cs: Map<string, any>, root: string): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    if (out.includes(id)) return;
    out.push(id);
    const c = cs.get(id);
    if (!c) return;
    if (typeof c.child === "string") visit(c.child);
    if (Array.isArray(c.children)) for (const x of c.children) if (typeof x === "string") visit(x);
  };
  visit(root);
  return out;
}

/** Item k's button payload, found by structure only: the list's k-th child and the ids under it. */
function payloadsByStructure(instance: Instance): Array<Record<string, unknown> | undefined> {
  const cs = components(instance);
  const list = cs.get("results");
  return (list.children as string[]).map((root) => {
    const buttons = descendants(cs, root).map((id) => cs.get(id)).filter((c) => c?.action?.event?.name === "choose");
    return buttons.length === 1 ? buttons[0].action.event.context : undefined;
  });
}

describe("approved data sets", () => {
  it.each([
    ["three", "ready", 3],
    ["two", "ready", 2],
    ["reordered", "ready", 3],
    ["removed", "ready", 2],
    ["twenty", "ready", 20],
  ])("%s: governed, and each button carries its own item's payload", async (name, state, n) => {
    const r = await results(ds[name]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.instance.state).toBe(state);
    const expected = ds[name].hotels.map((h: any) => ({ hotelId: h.id }));
    expect(payloadsByStructure(r.instance)).toEqual(expected);
    expect(r.instance.actions.filter((a) => a.name === "choose")).toHaveLength(n);
  });

  it("one result is refused with the rule's own reason, and nothing is emitted", async () => {
    const r = await results(ds.one);
    expect(r).toMatchObject({ ok: false, stage: "lint", state: "ready", purpose: "transactional-review" });
    if (!r.ok) {
      expect(r.failures?.[0]).toMatchObject({ gate: "S3", rule: "rule.review-offers-alternatives" });
      expect(r.reason).toContain("A choice of one is not a comparison");
    }
  });

  it("no results selects the empty state by its guard, under its own purpose", async () => {
    const r = await results(ds.none);
    expect(r).toMatchObject({ ok: true, instance: { state: "empty", purpose: "data-collection" } });
  });

  it("two items that render the same name are refused: a person could not tell them apart", async () => {
    const r = await results(ds["duplicate-names"]);
    expect(r).toMatchObject({ ok: false, stage: "attach" });
    if (!r.ok) expect(r.reason).toContain("could not tell them apart");
  });

  it("the confirmation state carries the selection's literal payload on its consequential action", async () => {
    const r = await results(ds.confirm);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.instance.state).toBe("confirm");
    expect(r.instance.actions.find((a) => a.name === "reserve")).toMatchObject({ payload: { hotelId: "h-102" }, consequential: true });
  });
});

describe("repeated element identity (R0-REVIEW 6.1 item 2)", () => {
  it("by witness: item k's subtree renders item k's name and no other item's", async () => {
    const r = await results(ds.three);
    if (!r.ok) throw new Error(r.reason);
    const cs = components(r.instance);
    const names = ds.three.hotels.map((h: any) => h.name);
    (cs.get("results").children as string[]).forEach((root, k) => {
      const text = JSON.stringify(descendants(cs, root).map((id) => cs.get(id)));
      expect(text).toContain(names[k]);
      for (const [j, other] of names.entries()) if (j !== k) expect(text).not.toContain(other);
    });
  });

  it("by structure: every item root is a SelectableCard listed in order, and no button sits outside the items", async () => {
    const r = await results(ds.twenty);
    if (!r.ok) throw new Error(r.reason);
    const cs = components(r.instance);
    const roots = cs.get("results").children as string[];
    expect(roots.map((id) => cs.get(id).component)).toEqual(Array(20).fill("SelectableCard"));
    const inside = new Set(roots.flatMap((root) => descendants(cs, root)));
    for (const c of cs.values()) if (c.action?.event?.name === "choose") expect(inside.has(c.id)).toBe(true);
  });

  /** A small seeded PRNG so the property test is reproducible. */
  const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  it("by property test: random lists and item shapes are associated correctly or refused, never misassociated", async () => {
    const pool = ds.twenty.hotels as any[];
    const base = cs["hotel-results"]!;
    const shapes = [
      (item: any) => item,
      // A wrapper the emitter keeps.
      (item: any) => ({ ...item, children: [{ component: "card", props: { variant: "muted" }, children: item.children }] }),
      // A conditional badge inside the item.
      (item: any) => ({ ...item, children: [...item.children, { $if: "hotel.rating", children: [{ component: "badge", props: { label: { $prop: "hotel.rating" } } }] }] }),
      // Extra text before the button.
      (item: any) => ({ ...item, children: [{ component: "text", text: { $prop: "hotel.area" } }, ...item.children] }),
    ];
    const random = rng(20261126);
    let associated = 0;
    let refused = 0;
    for (let trial = 0; trial < 60; trial++) {
      const n = 2 + Math.floor(random() * 15);
      const picked = [...pool].sort(() => random() - 0.5).slice(0, n);
      // Sometimes duplicate a name, which must be refused.
      if (random() < 0.15) picked[n - 1] = { ...picked[n - 1], name: picked[0].name };
      const shape = shapes[Math.floor(random() * shapes.length)]!;
      const c: CompositionDefinition = structuredClone(base);
      const ready = c.states.find((s) => s.id === "ready")!;
      const list = (ready.template.children as any[])[2];
      list.children[0].children[0] = shape(structuredClone(list.children[0].children[0]));
      const data = { destination: "Lisbon", nights: 2, hotels: picked };
      const r = await instantiate(g, c, { surfaceId: `p-${trial}`, data });
      const dup = new Set(picked.map((h) => h.name)).size !== picked.length;
      if (!r.ok) {
        expect(dup, r.reason).toBe(true);
        expect(r.reason).toContain("could not tell them apart");
        refused++;
        continue;
      }
      expect(dup).toBe(false);
      expect(payloadsByStructure(r.instance)).toEqual(picked.map((h) => ({ hotelId: h.id })));
      associated++;
    }
    expect(associated).toBeGreaterThan(40);
    expect(refused).toBeGreaterThan(0);
  });

  it("collection changes: three, two, the same three reordered; each screen equals a fresh emission", async () => {
    for (const name of ["three", "removed", "reordered"]) {
      const a = await results(ds[name], "same-id");
      const b = await results(ds[name], "same-id");
      if (!a.ok || !b.ok) throw new Error("refused");
      expect(JSON.stringify(a.instance.messages)).toBe(JSON.stringify(b.instance.messages));
      expect(payloadsByStructure(a.instance)).toEqual(ds[name].hotels.map((h: any) => ({ hotelId: h.id })));
    }
  });
});

describe("instance messages", () => {
  it("are one creation batch under a unique surface id, with inputs bound to leaf paths and nothing else bound", async () => {
    const r = await instantiate(g, cs["hotel-search"]!, { surfaceId: "hotel-search-s-1", data: {}, inputValues: { destination: "Lisbon" } });
    if (!r.ok) throw new Error(r.reason);
    const kinds = r.instance.messages.map((m) => Object.keys(m).find((k) => k !== "version"));
    expect(kinds).toEqual(["createSurface", "updateComponents", "updateDataModel"]);
    expect(r.instance.messages.every((m) => (m.createSurface ?? m.updateComponents ?? m.updateDataModel).surfaceId === "hotel-search-s-1")).toBe(true);
    const fields = [...components(r.instance).values()].filter((c) => c.component === "TextField");
    expect(fields.map((f) => f.value)).toEqual([{ path: "/input/destination" }, { path: "/input/checkIn" }, { path: "/input/checkOut" }, { path: "/input/guests" }, { path: "/input/memberNumber" }]);
    expect(r.instance.messages[2].updateDataModel).toEqual({ surfaceId: "hotel-search-s-1", path: "/input", value: { destination: "Lisbon", checkIn: "", checkOut: "", guests: "", memberNumber: "" } });
    const search = components(r.instance).get("search");
    expect(search.action.event).toEqual({ name: "search", context: { destination: { path: "/input/destination" }, checkIn: { path: "/input/checkIn" }, checkOut: { path: "/input/checkOut" }, guests: { path: "/input/guests" }, memberNumber: { path: "/input/memberNumber" } } });
  });

  it("differ from the plain emission only by the two attachments", async () => {
    const r = await results(ds.three);
    if (!r.ok) throw new Error(r.reason);
    const plain = g.emit(r.instance.expansion, r.instance.surfaceId);
    if (!plain.ok) throw new Error("emit");
    const strip = (messages: any[]) =>
      JSON.stringify(messages, (k, v) => (k === "context" ? {} : v));
    expect(strip(r.instance.messages)).toBe(strip(plain.messages));
  });
});

describe("emission equivalence with bound inputs (R1A-REVIEW E6)", () => {
  it.each([
    ["search, ready, with a carried value", "hotel-search", {}, { destination: "Lisbon", guests: "2" }],
    ["search, invalid, with every value carried", "hotel-search", { errors: ["Check-out must be after check-in."] }, { destination: "Lisbon", checkIn: "2026-03-13", checkOut: "2026-03-10", guests: "2" }],
    ["results, empty, with its own input", "hotel-results", { destination: "Lisbon", nights: 3, hotels: [] }, { destination: "Porto" }],
  ] as const)("%s: the messages are the plain emission plus exactly the two attachments", async (_label, id, data, values) => {
    const c = cs[id]!;
    const r = await instantiate(g, c, { surfaceId: `${id}-e6-1`, data: data as never, inputValues: values as never });
    if (!r.ok) throw new Error(r.reason);
    const plain = g.emit(r.instance.expansion, r.instance.surfaceId);
    if (!plain.ok) throw new Error("emit");
    const messages = structuredClone(r.instance.messages) as any[];
    // Attachment 1: the trailing data model write, holding exactly the declared inputs' values.
    const last = messages.pop();
    const shownInputs = c.inputs.filter((i) => r.instance.inputs.some((b) => b.name === i.name)).map((i) => i.name);
    expect(last).toEqual({ version: "v0.9", updateDataModel: { surfaceId: r.instance.surfaceId, path: "/input", value: Object.fromEntries(shownInputs.map((n) => [n, (values as Record<string, string>)[n] ?? ""])) } });
    // Attachment 1: each declared input's field value, and nothing else bound on any field.
    const byId = new Map<string, any>(messages.flatMap((m) => m.updateComponents?.components ?? []).map((x: any) => [x.id, x]));
    for (const b of r.instance.inputs) {
      expect(byId.get(b.componentId).value).toEqual({ path: `/input/${b.name}` });
      delete byId.get(b.componentId).value;
    }
    // Attachment 2: each declared action's context, as the declaration says: its payload, then the inputs it carries.
    for (const b of r.instance.actions) {
      const spec = c.actions.find((a) => a.name === b.name)!;
      const want = { ...b.payload, ...Object.fromEntries((spec.carries ?? []).map((n) => [n, { path: `/input/${n}` }])) };
      expect(byId.get(b.componentId).action.event.context).toEqual(want);
      delete byId.get(b.componentId).action.event.context;
    }
    const plainStripped = structuredClone(plain.messages) as any[];
    for (const comp of plainStripped.flatMap((m) => m.updateComponents?.components ?? [])) if (comp.action?.event && Object.keys(comp.action.event.context ?? {}).length === 0) delete comp.action.event.context;
    expect(JSON.stringify(messages)).toBe(JSON.stringify(plainStripped));
  });
});

describe("the binding layout (what keeps renderer writes away from governed content)", () => {
  it("holds on every evidence instance: the only data paths are input leaves, on a text field's value or in an action context", async () => {
    for (const [id, data] of [["hotel-search", {}], ["hotel-results", ds.three], ["hotel-results", ds.none], ["hotel-results", ds.confirm]] as const) {
      const r = await instantiate(g, cs[id]!, { surfaceId: `layout-${id}`, data: data as never });
      if (!r.ok) throw new Error(r.reason);
      expect(bindingLayoutIssues(r.instance.messages)).toEqual([]);
    }
  });

  it("refuses a path on a governed property, a path outside /input, a nested path, and a bound text field outside /input", async () => {
    const r = await instantiate(g, cs["hotel-search"]!, { surfaceId: "layout-neg", data: {} });
    if (!r.ok) throw new Error(r.reason);
    const variants: Array<[string, (comps: any[]) => void]> = [
      ["a text's content bound to an input", (c) => (c.find((x) => x.component === "Text").text = { path: "/input/destination" })],
      ["a field's label bound", (c) => (c.find((x) => x.component === "TextField").label = { path: "/input/destination" })],
      ["a field's value bound outside /input", (c) => (c.find((x) => x.component === "TextField").value = { path: "/secrets" })],
      ["a field's value bound to /input itself", (c) => (c.find((x) => x.component === "TextField").value = { path: "/input" })],
      ["a nested input path", (c) => (c.find((x) => x.component === "TextField").value = { path: "/input/destination/city" })],
      ["an action context path outside /input", (c) => (c.find((x) => x.id === "search").action.event.context.destination = { path: "/session/token" })],
    ];
    for (const [label, edit] of variants) {
      const messages = structuredClone(r.instance.messages);
      edit(messages[1].updateComponents.components);
      expect(bindingLayoutIssues(messages).length, label).toBeGreaterThan(0);
    }
  });
});

describe("cached A gates", () => {
  // F2 refinement: a ratchet against drift between the cached gates and dspack-emit's own, over every evidence
  // data set and a handful of mutations of each.
  it("agree with dspack-emit's validateCatalog on every data set and on mutations of each", async () => {
    const mutations: Array<[string, (comps: any[]) => boolean]> = [
      ["none", () => true],
      ["a label that is not text", (c) => { const x = c.find((y) => y.component === "SelectableCard" || y.component === "TextField"); if (x) x.label = 42; return !!x; }],
      ["a variant outside its enum", (c) => { const x = c.find((y) => y.component === "Button"); if (x) x.variant = "loud"; return !!x; }],
      ["a component the catalog does not have", (c) => { c[c.length - 1] = { ...c[c.length - 1], component: "Marquee" }; return true; }],
      ["an extra property", (c) => { c[0].onClick = "alert(1)"; return true; }],
      ["an action event that is not an object", (c) => { const x = c.find((y) => y.action); if (x) x.action = { event: "x" }; return !!x; }],
    ];
    const sets: Array<[string, Record<string, unknown>]> = [["hotel-search", {}], ["hotel-search", { errors: ["x"] }], ...Object.keys(ds).map((n) => ["hotel-results", ds[n]] as [string, Record<string, unknown>])];
    let compared = 0;
    for (const [id, data] of sets) {
      const r = await instantiate(g, cs[id]!, { surfaceId: `${id}-f2-1`, data: data as never });
      if (!r.ok) continue;
      for (const [label, mutate] of mutations) {
        const messages = structuredClone(r.instance.messages) as any[];
        if (!mutate(messages[1].updateComponents.components)) continue;
        const ours = g.gates(messages);
        for (const version of g.versions) {
          const theirs = validateCatalog(g.catalog(version) as never, version, { messages });
          const mine = ours.failures.filter((f) => f.version === version);
          expect(theirs.pass, `${id} ${label} ${version}`).toBe(mine.length === 0);
          const theirIds = new Set((theirs.gates.find((x) => x.name === "instance")?.errors ?? []).map((e) => e.split(":")[0]));
          expect([...new Set(mine.map((f) => f.message.split(":")[0]))].sort(), `${id} ${label} ${version}`).toEqual([...theirIds].sort());
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThanOrEqual(100);
  });

  it("give dspack-emit's own validateCatalog verdict, instance by instance, for valid and broken messages", async () => {
    const r = await results(ds.three);
    if (!r.ok) throw new Error(r.reason);
    const broken = structuredClone(r.instance.messages);
    const comps = broken[1].updateComponents.components;
    comps.find((c: any) => c.component === "SelectableCard").label = 42;
    comps.find((c: any) => c.component === "Button").variant = "loud";
    for (const messages of [r.instance.messages, broken]) {
      const ours = g.gates(messages);
      for (const version of g.versions) {
        const theirs = validateCatalog(g.catalog(version) as never, version, { messages });
        const instanceGate = theirs.gates.find((x) => x.name === "instance")!;
        const theirIds = new Set((instanceGate.errors ?? []).map((e) => e.split(":")[0]));
        const ourIds = new Set(ours.failures.filter((f) => f.version === version).map((f) => f.message.split(":")[0]));
        expect([...ourIds].sort()).toEqual([...theirIds].sort());
        expect(theirs.pass).toBe(ours.failures.filter((f) => f.version === version).length === 0);
      }
    }
    expect(g.gates(broken).pass).toBe(false);
  });

  it("A3 refuses a payload the catalog's Action schema cannot carry", async () => {
    const r = await results(ds.three);
    if (!r.ok) throw new Error(r.reason);
    const broken = structuredClone(r.instance.messages);
    broken[1].updateComponents.components.find((c: any) => c.id === "choose").action = { event: "not-an-event" };
    expect(g.gates(broken).pass).toBe(false);
  });
});

describe("child references", () => {
  it("are read from child and children only", () => {
    expect(childRefs({ child: "a" })).toEqual(["a"]);
    expect(childRefs({ children: ["a", "b"] })).toEqual(["a", "b"]);
    expect(childRefs({ children: { path: "/x" } })).toEqual([]);
  });
});
