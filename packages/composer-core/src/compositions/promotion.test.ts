/**
 * Block promotion (promotion.ts): the real Astryx blocks become new draft compositions through the 0.1 upcast,
 * with props as data and examples as examples; the source block is unchanged; every interaction is reported as
 * mappable, computed or missing; nothing that cannot be carried is dropped silently; and approval stays blocked
 * until each block action is declared or its element removed.
 */
import { slug } from "@aestheticfunction/dspack-emit";
import { beforeAll, describe, expect, it } from "vitest";
import { parseBlocksSidecar, type BlockDefinition } from "../blocks/schema";
import type { Governor } from "./governance";
import { instantiate } from "./instantiate";
import { compositionIssues } from "./load";
import { promoteBlock, promotedId, promotionIssues, promotionMappings } from "./promotion";
import { contract, governorFor, readJson } from "./spike/fixtures";
import { removeNode } from "./template";

let g: Governor;
let blocks: Record<string, BlockDefinition>;
beforeAll(async () => {
  g = await governorFor();
  const parsed = parseBlocksSidecar(readJson("apps/composer/experimental/blocks/astryx.blocks.json"));
  if (!parsed.ok) throw new Error("the Astryx blocks sidecar does not parse");
  blocks = Object.fromEntries(parsed.sidecar.blocks.map((b) => [b.id, b]));
});

const loaderIssues = (c: Parameters<typeof compositionIssues>[0]) => compositionIssues(c, contract()).map((i) => `${i.path}: ${i.message}`);

/** The Structure key of the first repeat or condition matching a test, at any depth of a state's template. */
function keyOf(stateId: string, template: any, test: (child: any) => boolean): string {
  const find = (n: any, path: string): string | null => {
    for (const [i, ch] of ((n.children ?? []) as any[]).entries()) {
      const p = path ? `${path}.${i}` : String(i);
      if (test(ch)) return `${stateId}@${p}`;
      const deeper = find(ch, p);
      if (deeper) return deeper;
    }
    return null;
  };
  return find(template, "")!;
}

describe("promoting a block", () => {
  it("auth-form becomes a new draft: props as data, one state for its intent, its example as an example; the block is unchanged", async () => {
    const block = blocks["auth-form"]!;
    const before = JSON.stringify(block);
    const { composition: c, report } = promoteBlock(block, { reference: "Astryx", taken: new Set(["hotel-search", "hotel-results"]) });
    expect(JSON.stringify(block)).toBe(before);
    expect(c).toMatchObject({ id: "auth-form", version: 1, status: "draft", name: block.name, parameters: [], actions: [], inputs: [] });
    expect(c.data.map((p) => p.name)).toEqual(block.props.map((p) => p.name));
    expect(c.states).toHaveLength(1);
    expect(c.states[0]).toMatchObject({ id: "data-collection", purpose: "data-collection", guard: { always: true } });
    expect(JSON.stringify(c.states[0]!.template)).toBe(JSON.stringify(block.template));
    expect(c.scenarios.map((s) => s.id)).toEqual(block.examples.map((e) => e.id.replace(/^blk\./, "")));
    expect(report.source).toEqual({ block: "auth-form", version: 1, reference: "Astryx" });
    expect(loaderIssues(c)).toEqual([]);
    // Until its actions are mapped, the pipeline refuses it: a button would send an action nobody declared.
    const refused = await instantiate(g, c, { surfaceId: "auth-form-p-1", data: c.scenarios[0]!.data });
    expect(!refused.ok && refused.stage).toBe("attach");
    expect(!refused.ok && refused.reason).toContain("auth_submit");
    // Mapped (Submit on its own button), and the parts it cannot bind removed (the provider buttons, computed
    // for each provider; Forgot, shown only when recovery is set), it renders.
    c.actions.push({ name: "auth_submit", node: "auth-submit", states: ["data-collection"] });
    const t = c.states[0]!.template as any;
    expect(removeNode(c, "data-collection", keyOf("data-collection", t, (x) => x.$each === "providers"))).toMatchObject({ ok: true });
    expect(removeNode(c, "data-collection", keyOf("data-collection", t, (x) => x.$if === "recovery"))).toMatchObject({ ok: true });
    const shown = await instantiate(g, c, { surfaceId: "auth-form-p-2", data: c.scenarios[0]!.data });
    expect(shown.ok ? "shown" : JSON.stringify(shown).slice(0, 300)).toBe("shown");
  });

  it("each block action is mappable (a literal id), computed (an id built from data) or missing; typed fields likewise", () => {
    const { composition: c } = promoteBlock(blocks["auth-form"]!, { reference: "Astryx", taken: new Set() });
    const m = promotionMappings(c, blocks["auth-form"]!.actions);
    expect(m.find((x) => x.name === "auth_submit")).toEqual({ kind: "action", name: "auth_submit", status: "mappable", node: "auth-submit" });
    expect(m.find((x) => x.name === "auth_forgot")).toEqual({ kind: "action", name: "auth_forgot", status: "conditional", node: "auth-forgot", when: "recovery" });
    expect(m.find((x) => x.name === "auth_provider_google")).toMatchObject({ status: "computed", repeat: "providers" });
    expect(m.filter((x) => x.kind === "input")).toEqual([{ kind: "input", name: "Text fields repeated for each item in “fields”", status: "computed", repeat: "fields" }]);
  });

  it("what a composition cannot carry is said, never dropped silently: records-table's cross-field check", () => {
    const { report } = promoteBlock(blocks["records-table"]!, { reference: "Astryx", taken: new Set() });
    expect(report.notCarried.join(" ")).toContain("columns and rows.*.cells have the same length");
    expect(report.mappings.filter((m) => m.kind === "action").every((m) => m.status === "computed")).toBe(true);
    const auth = promoteBlock(blocks["auth-form"]!, { reference: "Astryx", taken: new Set() }).report.notCarried;
    expect(auth).toHaveLength(1);
    expect(auth[0]).toContain("4 checks between its fields: when mode is sign-in, fields includes password;");
    expect(auth[0]).toContain("when mode is reset, fields does not include password.");
  });

  it("a second promotion takes the next free id", () => {
    expect(promotedId("auth-form", new Set(["auth-form"]))).toBe("auth-form-2");
    expect(promotedId("auth-form", new Set(["auth-form", "auth-form-2"]))).toBe("auth-form-3");
  });
});

describe("approval stays blocked until every interaction is resolved", () => {
  it("unmapped and computed interactions are issues; declaring the mappable actions and removing the computed elements clears them", () => {
    const block = blocks["auth-form"]!;
    const { composition: c } = promoteBlock(block, { reference: "Astryx", taken: new Set() });
    const first = promotionIssues(c, block.actions);
    expect(first.some((i) => i.includes("“auth_submit” action is not mapped"))).toBe(true);
    expect(first.some((i) => i.includes("computed for each item in “providers”"))).toBe(true);
    expect(first.some((i) => i.includes("computed ids"))).toBe(true);
    expect(first.some((i) => i.includes("shown only when “recovery” is set"))).toBe(true);
    // Resolve: declare Submit on its own button; remove the conditional Forgot, the provider buttons and the fields.
    c.actions.push({ name: slug("auth-submit"), node: "auth-submit", states: ["data-collection"] });
    const t = c.states[0]!.template as any;
    for (const test of [(x: any) => x.$each === "providers", (x: any) => x.$if === "recovery", (x: any) => x.$each === "fields"]) expect(removeNode(c, "data-collection", keyOf("data-collection", t, test))).toMatchObject({ ok: true });
    expect(promotionIssues(c, block.actions)).toEqual([]);
    expect(loaderIssues(c)).toEqual([]);
  });
});

describe("the part an unresolved mapping sits in", () => {
  it("is found by its repeat or condition, and removing it by that key resolves the mapping", async () => {
    const { promotionPartKey } = await import("./promotion");
    const { composition: c } = promoteBlock(blocks["auth-form"]!, { reference: "Astryx", taken: new Set() });
    const part = promotionPartKey(c, "condition", "recovery")!;
    expect(part).toEqual({ state: "data-collection", key: keyOf("data-collection", c.states[0]!.template, (x) => x.$if === "recovery") });
    expect(promotionPartKey(c, "repeat", "providers")!.key).toBe(keyOf("data-collection", c.states[0]!.template, (x) => x.$each === "providers"));
    expect(removeNode(c, part.state, part.key)).toMatchObject({ ok: true });
    expect(promotionPartKey(c, "condition", "recovery")).toBeNull();
    expect(promotionMappings(c, blocks["auth-form"]!.actions).find((m) => m.name === "auth_forgot")!.status).toBe("missing");
  });
});

describe("checks between fields that a composition cannot carry (decision 82)", () => {
  it("block approval while the composition still shows what they protect; are genuinely resolved once it does not", async () => {
    const { constraintStandings } = await import("./promotion");
    const block = blocks["auth-form"]!;
    const { composition: c } = promoteBlock(block, { reference: "Astryx", taken: new Set() });
    expect(constraintStandings(c, block.constraints).map((k) => k.status)).toEqual(["blocking", "blocking", "blocking", "blocking"]);
    expect(promotionIssues(c, block.actions, block.constraints).some((i) => i.includes("4 checks between fields") && i.includes("still shows those fields"))).toBe(true);
    // Remove what reads "fields" (the repeated text fields): the checks no longer protect anything shown.
    expect(removeNode(c, "data-collection", keyOf("data-collection", c.states[0]!.template, (x) => x.$each === "fields"))).toMatchObject({ ok: true });
    expect(constraintStandings(c, block.constraints).every((k) => k.status === "moot")).toBe(true);
    expect(promotionIssues(c, block.actions, block.constraints).some((i) => i.includes("checks between fields"))).toBe(false);
    // records-table: the table shows both columns and rows, so its check blocks approval.
    const rt = blocks["records-table"]!;
    const { composition: table } = promoteBlock(rt, { reference: "Astryx", taken: new Set() });
    expect(constraintStandings(table, rt.constraints)).toEqual([{ text: "columns and rows.*.cells have the same length", status: "blocking" }]);
    // An unknown kind of check always blocks.
    expect(constraintStandings(table, [{ kind: "something-new", path: "nothing" }])[0]!.status).toBe("blocking");
  });
});
