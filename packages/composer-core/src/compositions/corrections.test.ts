/**
 * Regression tests for the independent R1a review (docs/repositioning/R1A-REVIEW.md §3).
 * Each failed against the implementation at 3036584; the failing run is recorded in
 * docs/repositioning/spikes/r1a/evidence/failing-first.txt.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expandInstance } from "./expand";
import type { Governor } from "./governance";
import { createGovernor } from "./governance";
import { createHost, recheck, type Host } from "./host";
import { instantiate } from "./instantiate";
import { compositionIssues, loadCompositions, stateIdFor } from "./load";
import type { CompositionDefinition } from "./schema";
import { compositions, contract, datasets, governorFor, lint, profileJson, readJson, TOOLCHAIN } from "./spike/fixtures";

let g: Governor;
let cs: Record<string, CompositionDefinition>;
let ds: Record<string, any>;
beforeAll(async () => {
  g = await governorFor();
  cs = await compositions();
  ds = datasets();
});

async function approvedHost(governor = g): Promise<Host> {
  const host = await createHost({ governor, compositions: Object.values(cs) });
  for (const c of Object.values(cs)) host.approve(c.id, (await recheck(governor, c)).approval!);
  return host;
}

const press = (instance: any, name: string, k = 0) => {
  const a = instance.actions.filter((x: any) => x.name === name)[k];
  return { name, surfaceId: instance.surfaceId, sourceComponentId: a.componentId, context: { ...a.payload } };
};

describe("H1: a surface governed under earlier rules does not run again after a re-approval", () => {
  it("refuses an action on the old surface until it is replaced", async () => {
    const host = await approvedHost();
    const old = await host.show("hotel-results", { data: ds.twenty });
    if (!old.ok) throw new Error("show");
    // A rule the declared scenarios never exercise: the re-check passes, but the twenty-hotel surface now fails it.
    const edited = contract();
    edited.rules.push({ id: "rule.no-oriente", type: "forbidden-composition", severity: "must", component: "selectable-card", forbiddenProps: [{ prop: "label", values: ["Oriente Tower"] }], rationale: "Test rule." });
    const g2 = await governorFor(edited);
    expect((await instantiate(g2, cs["hotel-results"]!, { surfaceId: "x", data: ds.twenty })).ok).toBe(false);
    const again = await recheck(g2, cs["hotel-results"]!);
    expect(again.ok).toBe(true);
    host.setGovernor(g2);
    host.approve("hotel-results", again.approval!);
    await new Promise((r) => setTimeout(r, 10)); // the approval's pin refresh lands
    expect(host.act(press(old.instance, "choose", 19))).toMatchObject({ accepted: false, code: "needs-recheck" });
    // A replacement governed under the new rules runs.
    const next = await host.show("hotel-results", { data: ds.three });
    if (!next.ok) throw new Error(JSON.stringify(next.refusal));
    expect(host.act(press(next.instance, "choose", 0)).accepted).toBe(true);
  });
});

describe("H2: a governor's rules cannot change after its pins are taken", () => {
  it("an in-place edit of the caller's contract changes nothing the governor decides", async () => {
    const c = contract();
    const gov = await createGovernor({ contract: c, profileJson: profileJson(), lintSurface: lint, toolchain: TOOLCHAIN });
    expect((await instantiate(gov, cs["hotel-results"]!, { surfaceId: "h2-1", data: ds.one })).ok).toBe(false);
    c.rules.find((r: any) => r.id === "rule.review-offers-alternatives").requiredSubComponents[0].min = 1;
    expect((await instantiate(gov, cs["hotel-results"]!, { surfaceId: "h2-2", data: ds.one })).ok).toBe(false);
  });

  it("the governor's own contract and profile are frozen", async () => {
    const gov = await createGovernor({ contract: contract(), profileJson: profileJson(), lintSurface: lint, toolchain: TOOLCHAIN });
    expect(Object.isFrozen(gov.contract)).toBe(true);
    expect(Object.isFrozen((gov.contract.rules as unknown[])[0])).toBe(true);
  });
});

describe("M1: replacements run one at a time", () => {
  it("two overlapping shows each delete the surface before them, and no surface is orphaned", async () => {
    const host = await approvedHost();
    const first = await host.show("hotel-results", { data: ds.three });
    if (!first.ok) throw new Error("show");
    const [x, y] = await Promise.all([host.show("hotel-results", { data: ds.two }), host.show("hotel-results", { data: ds.removed })]);
    if (!x.ok || !y.ok) throw new Error("show");
    expect(x.batch[0]).toEqual({ version: "v0.9", deleteSurface: { surfaceId: first.instance.surfaceId } });
    expect(y.batch[0]).toEqual({ version: "v0.9", deleteSurface: { surfaceId: x.instance.surfaceId } });
    expect(host.current()?.surfaceId).toBe(y.instance.surfaceId);
  });
});

describe("M2: emitted id collisions never bind the wrong field", () => {
  it("two literal ids that emit the same id are refused at load", () => {
    const c = structuredClone(cs["hotel-search"]!);
    const ready = c.states.find((s) => s.id === "ready")!;
    (ready.template.children as any[]).splice(1, 0, { component: "text-input", id: "check_in", props: { label: "Promo code" } });
    const issues = compositionIssues(c, contract()).map((i) => i.message).join("\n");
    expect(issues).toContain("check_in");
  });

  it("a declared input renamed by the emitter's deduplication is refused at instantiation", async () => {
    const c = structuredClone(cs["hotel-results"]!);
    const ready = c.states.find((s) => s.id === "ready")!;
    const item = (ready.template.children as any[])[2].children[0].children[0];
    item.children.push({ component: "text-input", id: "note", props: { label: "Note" } });
    // Declared after the list: the emitter has already given item 2's field the id 'note_2'.
    (ready.template.children as any[]).push({ component: "text-input", id: "note_2", props: { label: "Message to the hotel" } });
    c.inputs.push({ name: "message", node: "note_2", kind: "text", maxLength: 200 });
    expect(compositionIssues(c, contract())).toEqual([]);
    const r = await instantiate(g, c, { surfaceId: "m2", data: ds.three });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("note_2");
  });
});

describe("M5: a 0.1 block's constraints still hold through the composition path", () => {
  it("refuses a call the block's own constraint refuses", async () => {
    const raw = readJson("apps/composer/experimental/blocks/astryx.blocks.json");
    const loaded = await loadCompositions(raw, { baseContract: contract() });
    const auth = loaded.usable.find((x) => x.id === "auth-form")!;
    const example = raw.blocks.find((b: any) => b.id === "auth-form").examples[0];
    const { block: _b, version: _v, ...parameters } = example.call;
    expect(expandInstance(auth, { parameters, state: stateIdFor(example.intent), reference: { name: "Astryx" } }).ok).toBe(true);
    const broken = { ...parameters, mode: "sign-up", fields: ["name", "email"] }; // sign-up must include password
    const r = expandInstance(auth, { parameters: broken, state: stateIdFor(example.intent), reference: { name: "Astryx" } });
    expect(r).toMatchObject({ ok: false, stage: "data" });
    if (!r.ok) expect(r.reason).toContain("password");
  });
});

describe("M6: a consequential action carries literals only", () => {
  it("refuses a consequential action that carries typed input", () => {
    const c = structuredClone(cs["hotel-search"]!);
    c.actions[0]!.consequential = true;
    c.actions[0]!.states = ["ready"];
    const issues = compositionIssues(c, contract()).map((i) => i.message).join("\n");
    expect(issues).toContain("consequential");
  });
});
