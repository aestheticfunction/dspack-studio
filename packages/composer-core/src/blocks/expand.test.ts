/**
 * The expander (RFC section 5): a pure function of (block, named call,
 * reference, intent). The six hand-expanded goldens are its oracle, byte for
 * byte; the synthetic cases pin every rule the drafts do not happen to
 * exercise, including each fail-closed path.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  expandBlock,
  expansionDigest,
  parseBlocksSidecar,
  sha256Hex,
  type BlockDefinition,
  type BlocksSidecar,
} from "./index";

const repo = (rel: string) => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(repo(rel), "utf8");

const REFERENCES = {
  "shadcn-v3": "apps/composer/experimental/blocks/shadcn-v3.blocks.json",
  astryx: "apps/composer/experimental/blocks/astryx.blocks.json",
} as const;

function load(path: string): BlocksSidecar {
  const result = parseBlocksSidecar(JSON.parse(read(path)));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.sidecar;
}

describe("expansion reproduces every hand-expanded golden byte for byte", () => {
  for (const [ref, path] of Object.entries(REFERENCES)) {
    const sidecar = load(path);
    for (const block of sidecar.blocks) {
      for (const example of block.examples) {
        it(`${ref}: ${block.id} / ${example.id}`, () => {
          const result = expandBlock(block, example.call, { reference: sidecar.reference, intent: example.intent });
          if (!result.ok) throw new Error(`${result.path}: ${result.message}`);
          const golden = read(`packages/block-bench/goldens/${ref}/${block.id}.${example.id}.dsurface.json`);
          expect(JSON.stringify(result.surface, null, 2) + "\n").toBe(golden);
        });
      }
    }
  }
});

describe("determinism and the expansion digest", () => {
  const sidecar = load(REFERENCES.astryx);
  const block = sidecar.blocks.find((b) => b.id === "auth-form")!;
  const example = block.examples[0]!;

  it("the same inputs give byte-identical output", () => {
    const a = expandBlock(block, example.call, { reference: sidecar.reference, intent: example.intent });
    const b = expandBlock(block, structuredClone(example.call), { reference: sidecar.reference, intent: example.intent });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("expansionDigest is sha256 of the compact JSON", async () => {
    const result = expandBlock(block, example.call, { reference: sidecar.reference, intent: example.intent });
    if (!result.ok) throw new Error(result.message);
    expect(await expansionDigest(result.surface)).toBe(await sha256Hex(JSON.stringify(result.surface)));
  });
});

// ---------------------------------------------------------------------------
// Synthetic block: every directive and rule, independent of the drafts.

const REF = { name: "Test", dspack: "0.4", version: "1.0.0" };

function synthetic(template: unknown, props: unknown[] = DEFAULT_PROPS): BlockDefinition {
  return {
    id: "t-block",
    version: 1,
    status: "draft",
    name: "T",
    summary: "t",
    intents: ["i"],
    keywords: [],
    props,
    actions: [],
    streaming: "static-safe",
    template,
    examples: [],
  } as unknown as BlockDefinition;
}

const DEFAULT_PROPS = [
  { name: "title", type: "string", maxLength: 40, required: true },
  { name: "mode", type: "enum", values: ["a", "b"], required: true },
  { name: "items", type: "array", maxItems: 5, items: { type: "object", props: [{ name: "label", type: "string", maxLength: 20, required: true }, { name: "note", type: "string", maxLength: 20 }] } },
  { name: "intro", type: "string", maxLength: 40 },
  { name: "flag", type: "boolean" },
  { name: "count", type: "integer", minimum: 0, maximum: 9 },
];

const expand = (template: unknown, call: Record<string, unknown>, intent = "i") => expandBlock(synthetic(template), call, { reference: REF, intent });
const ok = (result: ReturnType<typeof expandBlock>) => {
  if (!result.ok) throw new Error(`${result.path}: ${result.message}`);
  return result.surface;
};

describe("expansion semantics (RFC section 5)", () => {
  it("wraps the root as {dspackSurface, system, intent, root}", () => {
    const surface = ok(expand({ component: "card", id: "c" }, { title: "x", mode: "a" }));
    expect(surface).toEqual({ dspackSurface: "0.1", system: "Test", intent: "i", root: { component: "card", id: "c" } });
  });

  it("node keys come out as component, id, props, text, children whatever the template order", () => {
    const surface = ok(expand({ children: [{ component: "text", text: "hi" }], text: "t", props: { a: 1 }, id: "c", component: "card" }, { title: "x", mode: "a" }));
    expect(Object.keys(surface.root)).toEqual(["component", "id", "props", "text", "children"]);
  });

  it("an absent optional value is omitted; props with every value absent is omitted; empty children are omitted", () => {
    const surface = ok(
      expand(
        { component: "card", id: "c", props: { sub: { $prop: "intro" } }, text: { $prop: "intro" }, children: [{ $each: "items", as: "item", children: [{ component: "text", text: "x" }] }] },
        { title: "x", mode: "a" },
      ),
    );
    expect(surface.root).toEqual({ component: "card", id: "c" });
  });

  it("$prop falls back to its default, then to absent", () => {
    const surface = ok(expand({ component: "card", props: { a: { $prop: "intro", default: "none" }, b: { $prop: "intro" } } }, { title: "x", mode: "a" }));
    expect(surface.root.props).toEqual({ a: "none" });
  });

  it("props keep template key order, and nested literal objects drop absent keys", () => {
    const surface = ok(expand({ component: "card", props: { z: 1, a: { keep: "k", drop: { $prop: "intro" } }, m: 2 } }, { title: "x", mode: "a" }));
    expect(JSON.stringify(surface.root.props)).toBe('{"z":1,"a":{"keep":"k"},"m":2}');
  });

  it("$each binds each item and $index counts from 1; an absent array yields nothing", () => {
    const template = {
      component: "list",
      children: [{ $each: "items", as: "item", children: [{ component: "row", id: { $concat: ["row-", { $index: "item" }] }, text: { $prop: "item.label" } }] }],
    };
    const surface = ok(expand(template, { title: "x", mode: "a", items: [{ label: "one" }, { label: "two" }] }));
    expect(surface.root.children).toEqual([
      { component: "row", id: "row-1", text: "one" },
      { component: "row", id: "row-2", text: "two" },
    ]);
    expect(ok(expand(template, { title: "x", mode: "a" })).root).toEqual({ component: "list" });
  });

  it("$if takes children when truthy and else otherwise; absent, null, false, empty string and empty array are falsy", () => {
    const template = { component: "card", children: [{ $if: "intro", children: [{ component: "yes" }], else: [{ component: "no" }] }] };
    expect(ok(expand(template, { title: "x", mode: "a", intro: "hello" })).root.children).toEqual([{ component: "yes" }]);
    for (const intro of [undefined, ""]) {
      expect(ok(expand(template, { title: "x", mode: "a", ...(intro === undefined ? {} : { intro }) })).root.children).toEqual([{ component: "no" }]);
    }
    const byItems = { component: "card", children: [{ $if: "items", children: [{ component: "yes" }] }] };
    expect(ok(expand(byItems, { title: "x", mode: "a", items: [] })).root).toEqual({ component: "card" });
    const byFlag = { component: "card", children: [{ $if: "flag", children: [{ component: "yes" }] }] };
    expect(ok(expand(byFlag, { title: "x", mode: "a", flag: false })).root).toEqual({ component: "card" });
    const byCount = { component: "card", children: [{ $if: "count", children: [{ component: "yes" }] }] };
    expect(ok(expand(byCount, { title: "x", mode: "a", count: 0 })).root.children).toEqual([{ component: "yes" }]);
  });

  it("$eq compares evaluated values; absent equals only absent", () => {
    const template = (b: unknown) => ({ component: "card", children: [{ $if: { $eq: [{ $prop: "intro" }, b] }, children: [{ component: "eq" }], else: [{ component: "ne" }] }] });
    expect(ok(expand(template({ $prop: "intro" }), { title: "x", mode: "a" })).root.children).toEqual([{ component: "eq" }]);
    expect(ok(expand(template("hi"), { title: "x", mode: "a" })).root.children).toEqual([{ component: "ne" }]);
    expect(ok(expand(template("hi"), { title: "x", mode: "a", intro: "hi" })).root.children).toEqual([{ component: "eq" }]);
    expect(ok(expand({ component: "card", children: [{ $if: { $eq: [{ $prop: "mode" }, "b"] }, children: [{ component: "b" }] }] }, { title: "x", mode: "a" })).root).toEqual({ component: "card" });
  });

  it("$case maps enums by own key and booleans by 'true'/'false', with a default", () => {
    const template = { component: "card", props: { m: { $case: "mode", map: { a: "A", b: "B" } }, f: { $case: "flag", map: { true: "on" }, default: "off" } } };
    expect(ok(expand(template, { title: "x", mode: "b", flag: true })).root.props).toEqual({ m: "B", f: "on" });
    expect(ok(expand(template, { title: "x", mode: "a" })).root.props).toEqual({ m: "A", f: "off" });
  });

  it("$map evaluates its value once per item; an absent source is absent", () => {
    const template = { component: "table", props: { columns: { $map: "items", as: "item", value: { key: { $concat: ["c", { $index: "item" }] }, label: { $prop: "item.label" } } } } };
    expect(ok(expand(template, { title: "x", mode: "a", items: [{ label: "L" }] })).root.props).toEqual({ columns: [{ key: "c1", label: "L" }] });
    expect(ok(expand(template, { title: "x", mode: "a" })).root).toEqual({ component: "table" });
  });

  it("$concat stringifies numbers", () => {
    expect(ok(expand({ component: "c", id: { $concat: ["n-", { $prop: "count" }] } }, { title: "x", mode: "a", count: 3 })).root.id).toBe("n-3");
  });

  it("reads own properties of the call only", () => {
    const call = Object.assign(Object.create({ intro: "inherited" }), { title: "x", mode: "a" });
    expect(ok(expand({ component: "c", text: { $prop: "intro" } }, call)).root).toEqual({ component: "c" });
  });
});

describe("expansion fails closed with a pathed reason", () => {
  const fails = (template: unknown, call: Record<string, unknown>, path: RegExp, intent = "i") => {
    const result = expand(template, call, intent);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toMatch(path);
  };

  it("an intent the block does not declare", () => fails({ component: "c" }, { title: "x", mode: "a" }, /intent/, "other"));
  it("an absent value inside $concat", () => fails({ component: "c", id: { $concat: ["a", { $prop: "intro" }] } }, { title: "x", mode: "a" }, /template\.id\.\$concat\.1/));
  it("a boolean inside $concat", () => fails({ component: "c", id: { $concat: ["a", { $prop: "flag" }] } }, { title: "x", mode: "a", flag: true }, /template\.id/));
  it("an absent array element", () => fails({ component: "c", props: { list: ["a", { $prop: "intro" }] } }, { title: "x", mode: "a" }, /template\.props\.list\.1/));
  it("$case with no mapping and no default", () => fails({ component: "c", props: { m: { $case: "mode", map: { a: "A" } } } }, { title: "x", mode: "b" }, /template\.props\.m/));
  it("$case on an absent source with no default", () => fails({ component: "c", props: { f: { $case: "flag", map: { true: "on", false: "off" } } } }, { title: "x", mode: "a" }, /template\.props\.f/));
  it("$each over a present non-array", () => fails({ component: "c", children: [{ $each: "title", as: "t", children: [] }] }, { title: "x", mode: "a" }, /template\.children\.0/));
  it("$map over a present non-array", () => fails({ component: "c", props: { l: { $map: "title", as: "t", value: 1 } } }, { title: "x", mode: "a" }, /template\.props\.l/));
  it("$index of a name that is not a loop variable", () => fails({ component: "c", props: { n: { $index: "title" } } }, { title: "x", mode: "a" }, /template\.props\.n/));
  it("an unknown directive", () => fails({ component: "c", props: { n: { $eval: "1+1" } } }, { title: "x", mode: "a" }, /template\.props\.n/));
});
