import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  callJsonSchema,
  checkConstraints,
  contractDigest,
  decodeCall,
  encodeCall,
  parseBlocksSidecar,
  validateCall,
  wireIndex,
  type BlockDefinition,
  type BlocksSidecar,
} from "./index";

const repo = (rel: string) => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));
const json = (rel: string) => JSON.parse(readFileSync(repo(rel), "utf8")) as Record<string, unknown>;

const SIDECARS = {
  "shadcn-v3": { sidecar: "apps/composer/experimental/blocks/shadcn-v3.blocks.json", contract: "apps/composer/shadcn-v3-project/shadcn-ui.dspack.json" },
  astryx: { sidecar: "apps/composer/experimental/blocks/astryx.blocks.json", contract: "apps/composer/astryx-project/astryx.dspack.json" },
} as const;

function load(name: keyof typeof SIDECARS): BlocksSidecar {
  const result = parseBlocksSidecar(json(SIDECARS[name].sidecar));
  if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.issues, null, 2)}`);
  return result.sidecar;
}

const block = (sidecar: BlocksSidecar, id: string) => sidecar.blocks.find((b) => b.id === id) as BlockDefinition;

describe("draft sidecars parse and bind to their reference", () => {
  for (const name of Object.keys(SIDECARS) as Array<keyof typeof SIDECARS>) {
    it(`${name}: parses, binds to the base contract digest, and every example call passes B1 and constraints`, async () => {
      const sidecar = load(name);
      const contract = json(SIDECARS[name].contract);
      expect(sidecar.reference).toEqual({ name: contract.name, dspack: contract.dspack, version: contract.version });
      // The pin is the ratchet: a contract edit must fail loudly, never silently disable blocks.
      expect(sidecar.baseSha256).toBe(await contractDigest(contract));
      const intents = new Set(((contract.intents as Array<{ id: string }>) ?? []).map((i) => i.id));
      for (const b of sidecar.blocks) {
        for (const intent of b.intents) expect(intents.has(intent), `${b.id} intent ${intent}`).toBe(true);
        for (const example of b.examples) {
          expect(validateCall(b, example.call), `${b.id}/${example.id}`).toEqual([]);
          expect(checkConstraints(b, example.call), `${b.id}/${example.id}`).toEqual([]);
        }
      }
    });
  }

  it("both design systems declare the same named signatures (one block, two renderings)", () => {
    const a = load("shadcn-v3");
    const b = load("astryx");
    expect(a.blocks.map((x) => x.id)).toEqual(b.blocks.map((x) => x.id));
    for (const x of a.blocks) expect(block(b, x.id).props).toEqual(x.props);
  });
});

describe("structural checks fail closed", () => {
  const base = () => json(SIDECARS["shadcn-v3"].sidecar) as unknown as BlocksSidecar;
  const issuesOf = (doc: unknown) => {
    const result = parseBlocksSidecar(doc);
    return result.ok ? [] : result.issues.map((i) => `${i.path}: ${i.message}`);
  };

  it("rejects a required prop after an optional one (positional order)", () => {
    const doc = base();
    doc.blocks[0]!.props.push({ name: "late", required: true, type: "boolean" });
    expect(issuesOf(doc).join("\n")).toMatch(/required prop 'late' follows an optional one/);
  });

  it("rejects unbounded strings and arrays", () => {
    const doc = base();
    delete doc.blocks[0]!.props[0]!.maxLength;
    delete doc.blocks[0]!.props[2]!.maxItems;
    const issues = issuesOf(doc).join("\n");
    expect(issues).toMatch(/string values must declare maxLength/);
    expect(issues).toMatch(/array values must declare maxItems/);
  });

  it("rejects reserved prop names", () => {
    const doc = base();
    doc.blocks[0]!.props.push({ name: "version", type: "boolean" });
    expect(issuesOf(doc).join("\n")).toMatch(/'version' is reserved/);
  });

  it("rejects unknown directives, unresolvable paths and non-loop $index", () => {
    const doc = base();
    const t = doc.blocks[0]!.template as unknown as { children: Array<Record<string, unknown>> };
    t.children.push({ component: "badge", text: { $eval: "1+1" } });
    t.children.push({ component: "badge", text: { $prop: "nope" } });
    t.children.push({ component: "badge", text: { $index: "title" } });
    t.children.push({ $each: "title", as: "x", children: [] });
    const issues = issuesOf(doc).join("\n");
    expect(issues).toMatch(/unknown or ambiguous directive/);
    expect(issues).toMatch(/'nope' does not resolve/);
    expect(issues).toMatch(/'title' is not an enclosing \$each or \$map variable/);
    expect(issues).toMatch(/'title' does not name an array/);
  });

  it("rejects a $case that leaves an enum value unmapped without a default", () => {
    const doc = base();
    const auth = doc.blocks[1]!.template as unknown as { children: Array<{ children: unknown[] }> };
    auth.children.push({ component: "badge", text: { $case: "mode", map: { "sign-in": "x" } } } as never);
    expect(issuesOf(doc).join("\n")).toMatch(/no mapping for 'sign-up' and no default/);
  });

  it("rejects constraints over undeclared values", () => {
    const doc = base();
    doc.blocks[1]!.constraints!.push({ kind: "includes-when", when: { prop: "mode", equals: "sign-in" }, path: "fields", values: ["phone"] });
    expect(issuesOf(doc).join("\n")).toMatch(/'phone' is not a value of 'fields'/);
  });
});

describe("the call contract (named canonical, positional projection, B1)", () => {
  const records = () => block(load("shadcn-v3"), "records-table");
  const auth = () => block(load("shadcn-v3"), "auth-form");

  it("round-trips every example call through the positional projection", () => {
    for (const name of Object.keys(SIDECARS) as Array<keyof typeof SIDECARS>) {
      for (const b of load(name).blocks) {
        for (const example of b.examples) {
          const compact = encodeCall(b, example.call);
          const decoded = decodeCall(b, compact);
          expect(decoded.ok, `${name}/${b.id}`).toBe(true);
          if (decoded.ok) expect(decoded.call).toEqual(example.call);
        }
      }
    }
  });

  it("writes objects positionally, trims trailing optionals, and nulls a skipped middle optional", () => {
    const b = records();
    const compact = encodeCall(b, {
      block: "records-table",
      version: 1,
      title: "T",
      caption: "C",
      columns: ["A"],
      rows: [{ cells: ["x"] }],
      actions: ["export"],
    });
    expect(compact).toEqual({ b: "records-table", v: 1, p: ["T", "C", ["A"], [[["x"]]], null, null, ["export"]] });
    expect(wireIndex(b, "actions")).toBe(6);
  });

  it("B1 refuses unknown keys, missing requireds, out-of-bounds and wrong types, with paths", () => {
    const issues = validateCall(records(), {
      block: "records-table",
      version: 1,
      caption: "",
      columns: [],
      rows: [{ cells: ["a"], tone: "loud" }],
      statusColumn: 9,
      secret: "x",
    }).map((i) => `${i.path} ${i.message}`);
    expect(issues).toEqual(
      expect.arrayContaining([
        "$.title required",
        "$.caption shorter than 1",
        "$.columns fewer than 1 items",
        "$.rows.0.tone expected one of neutral, info, success, warning, critical",
        "$.statusColumn above 8",
        "$.secret 'secret' is not declared",
      ]),
    );
  });

  it("B1 is non-vacuous on every example: a corrupted call never passes", () => {
    for (const b of load("astryx").blocks) {
      const bad = { ...b.examples[0]!.call, version: 99 };
      expect(validateCall(b, bad).length).toBeGreaterThan(0);
    }
  });

  it("constraints catch a reset form that asks for a password", () => {
    const call = { block: "auth-form", version: 1, mode: "reset", title: "Reset", fields: ["email", "password"] };
    expect(validateCall(auth(), call)).toEqual([]);
    expect(checkConstraints(auth(), call).map((i) => i.message)).toEqual(["when mode is 'reset', 'fields' must not include password"]);
  });

  it("decode fails closed on a wrong envelope or too many positional values", () => {
    expect(decodeCall(records(), { b: "auth-form", v: 1, p: [] }).ok).toBe(false);
    expect(decodeCall(records(), { b: "records-table", v: 1, p: [1, 2, 3, 4, 5, 6, 7, 8] }).ok).toBe(false);
  });

  it("derives a selected-block schema in both encodings, with no surface vocabulary", () => {
    const named = callJsonSchema(auth(), "named");
    expect(named.required).toEqual(["block", "version", "mode", "title", "fields"]);
    const positional = callJsonSchema(auth(), "positional") as { properties: { p: { prefixItems: unknown[]; minItems: number; maxItems: number } } };
    expect(positional.properties.p.prefixItems).toHaveLength(6);
    expect(positional.properties.p.minItems).toBe(3);
    expect(JSON.stringify(named)).not.toMatch(/"component"/);
  });

  it("no block exposes a slot for entered values, defaults or credentials", () => {
    const forbidden = /^(value|values|defaultValue|default|password|secret|token|credential|placeholder|checked)$/i;
    const walk = (props: BlockDefinition["props"]): string[] =>
      props.flatMap((p) => [p.name, ...(p.props ? walk(p.props) : []), ...(p.items?.props ? walk(p.items.props) : [])]);
    for (const name of Object.keys(SIDECARS) as Array<keyof typeof SIDECARS>) {
      for (const b of load(name).blocks) for (const prop of walk(b.props)) expect(forbidden.test(prop), `${b.id}.${prop}`).toBe(false);
    }
  });
});
