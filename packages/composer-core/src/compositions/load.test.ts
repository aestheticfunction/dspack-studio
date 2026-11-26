import { describe, expect, it } from "vitest";
import { expandBlock } from "../blocks/expand";
import { parseBlocksSidecar } from "../blocks/schema";
import { expandInstance, guardHolds, selectState } from "./expand";
import { compositionIssues, loadCompositions, stateIdFor, upcastBlock } from "./load";
import { parseCompositionsSidecar } from "./schema";
import { contract, readJson, sidecarJson } from "./spike/fixtures";

const REFERENCES = [
  { sidecar: "apps/composer/experimental/blocks/astryx.blocks.json", contract: "apps/composer/astryx-project/astryx.dspack.json" },
  { sidecar: "apps/composer/experimental/blocks/shadcn-v3.blocks.json", contract: "apps/composer/shadcn-v3-project/shadcn-ui.dspack.json" },
];

describe("sidecar 0.1 upcast", () => {
  for (const ref of REFERENCES) {
    it(`expands every packaged example of ${ref.sidecar.split("/").pop()} byte for byte as the block expander does`, () => {
      const raw = readJson(ref.sidecar);
      const parsed = parseBlocksSidecar(raw);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      let compared = 0;
      for (const block of parsed.sidecar.blocks) {
        const composition = upcastBlock(block);
        for (const example of block.examples) {
          const { block: _b, version: _v, ...parameters } = example.call as Record<string, unknown>;
          const viaBlock = expandBlock(block, example.call, { reference: parsed.sidecar.reference, intent: example.intent });
          const viaComposition = expandInstance(composition, { parameters, state: stateIdFor(example.intent), reference: parsed.sidecar.reference });
          expect(viaBlock.ok && viaComposition.ok).toBe(true);
          if (viaBlock.ok && viaComposition.ok) expect(JSON.stringify(viaComposition.surface)).toBe(JSON.stringify(viaBlock.surface));
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(0);
    });

    it(`loads ${ref.sidecar.split("/").pop()} as 0.1 without modifying it`, async () => {
      const raw = readJson(ref.sidecar);
      const before = JSON.stringify(raw);
      const loaded = await loadCompositions(raw, { baseContract: readJson(ref.contract) });
      expect(loaded.from).toBe("0.1");
      expect(loaded.binding).toBe("ok");
      expect(loaded.usable.map((c) => c.id)).toEqual(raw.blocks.map((b: { id: string }) => b.id));
      expect(loaded.usable.every((c) => c.upcastFrom && c.data.length === 0 && c.inputs.length === 0)).toBe(true);
      expect(JSON.stringify(raw)).toBe(before);
    });
  }
});

describe("scenario titles (D0)", () => {
  it("a scenario may carry a short human title; an empty or overlong one is refused", async () => {
    const { parseCompositionsSidecar } = await import("./schema");
    const { sidecarJson } = await import("./spike/fixtures");
    const ok = sidecarJson();
    ok.compositions[1].scenarios[0].title = "Three hotels";
    const parsed = parseCompositionsSidecar(ok);
    expect(parsed.ok && parsed.sidecar.compositions[1]!.scenarios[0]!.title).toBe("Three hotels");
    for (const bad of ["", "   ", "x".repeat(61)]) {
      const doc = sidecarJson();
      doc.compositions[1].scenarios[0].title = bad;
      expect(parseCompositionsSidecar(doc).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("sidecar 0.2", () => {
  it("parses and loads the R1a compositions with no disabled composition", async () => {
    const loaded = await loadCompositions(sidecarJson(), { baseContract: contract() });
    expect(loaded).toMatchObject({ from: "0.2", binding: "ok", disabled: [], issues: [] });
    expect(loaded.usable.map((c) => c.id)).toEqual(["hotel-search", "hotel-results"]);
  });

  it("refuses an unknown version, and a base the sidecar is not bound to", async () => {
    expect((await loadCompositions({ compositionsSidecar: "0.3" }, { baseContract: contract() })).binding).toBe("invalid");
    const moved = { ...contract(), description: "edited" };
    expect((await loadCompositions(sidecarJson(), { baseContract: moved })).binding).toBe("mismatch");
  });

  it("refuses unknown keys and inconsistent declarations", () => {
    const raw = sidecarJson();
    raw.compositions[0].extra = true;
    expect(parseCompositionsSidecar(raw).ok).toBe(false);
    const raw2 = sidecarJson();
    raw2.compositions[1].actions[0].states = ["nowhere"];
    const r = parseCompositionsSidecar(raw2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.message).join()).toContain("unknown state 'nowhere'");
  });

  const withResults = (edit: (c: any) => void) => {
    const parsed = parseCompositionsSidecar(sidecarJson());
    if (!parsed.ok) throw new Error("fixture");
    const c = structuredClone(parsed.sidecar.compositions[1]!);
    edit(c);
    return compositionIssues(c, contract()).map((i) => `${i.path}: ${i.message}`).join("\n");
  };

  it("refuses an input inside a repeat, and an input on a node that is not a text field", () => {
    expect(withResults((c) => (c.inputs[0].node = "choose"))).toContain("not a text-input");
    expect(
      withResults((c) => {
        const ready = c.states.find((s: any) => s.id === "ready");
        ready.template.children[2].children[0].children[0].children.push({ component: "text-input", id: "note", props: { label: "Note" } });
        c.inputs.push({ name: "note", node: "note", kind: "text", maxLength: 10 });
      }),
    ).toContain("inside $each");
  });

  it("refuses a repeated button without a declared repeat, and a per-item payload that reads outside the item", () => {
    expect(withResults((c) => delete c.actions[0].repeat)).toContain("declare its repeat");
    expect(withResults((c) => (c.actions[0].payload.hotelId = { $prop: "destination" }))).toContain("reads the item only");
  });

  it("refuses a list that holds more than its repeat, and a purpose the contract does not have", () => {
    expect(
      withResults((c) => {
        const ready = c.states.find((s: any) => s.id === "ready");
        ready.template.children[2].children.push({ component: "text", text: "extra" });
      }),
    ).toContain("exactly one $each");
    expect(withResults((c) => (c.states[0].purpose = "booking"))).toContain("not an intent of this contract");
  });
});

describe("state selection", () => {
  const parsed = parseCompositionsSidecar(sidecarJson());
  if (!parsed.ok) throw new Error("fixture");
  const results = parsed.sidecar.compositions[1]!;

  it("is decided by data, first guard that holds", () => {
    expect(selectState(results, { hotels: [] })).toMatchObject({ ok: true, state: { id: "empty" } });
    expect(selectState(results, { hotels: [{}, {}] })).toMatchObject({ ok: true, state: { id: "ready" } });
    expect(selectState(results, { hotels: [{}, {}], selection: { id: "x" } })).toMatchObject({ ok: true, state: { id: "confirm" } });
  });

  it("uses a requested state only when its own guard holds", () => {
    expect(selectState(results, { hotels: [] }, "confirm")).toMatchObject({ ok: false });
    expect(selectState(results, { hotels: [{}] }, "ready")).toMatchObject({ ok: true, state: { id: "ready" } });
    expect(selectState(results, {}, "nope")).toMatchObject({ ok: false });
  });

  it("evaluates every closed guard form", () => {
    expect(guardHolds({ minItems: { path: "a", min: 2 } }, { a: [1, 2] })).toBe(true);
    expect(guardHolds({ minItems: { path: "a", min: 2 } }, { a: [1] })).toBe(false);
    expect(guardHolds({ all: [{ present: "a" }, { empty: "b" }] }, { a: 1 })).toBe(true);
    expect(guardHolds({ present: "a.b" }, { a: { b: null } })).toBe(false);
  });

  it("refuses data that breaks its declared types or bounds, and undeclared data", () => {
    const tooMany = { destination: "Lisbon", nights: 3, hotels: Array.from({ length: 21 }, (_, i) => ({ id: `h${i}`, name: `H${i}`, area: "A", price: 1, rating: "1" })) };
    expect(expandInstance(results, { data: tooMany, reference: { name: "Astryx" } })).toMatchObject({ ok: false, stage: "data" });
    expect(expandInstance(results, { data: { destination: "Lisbon", nights: 0, hotels: [] }, reference: { name: "Astryx" } })).toMatchObject({ ok: false, stage: "data" });
    expect(expandInstance(results, { data: { destination: "Lisbon", nights: 3, hotels: [], secret: "x" }, reference: { name: "Astryx" } })).toMatchObject({ ok: false, stage: "data" });
  });
});
