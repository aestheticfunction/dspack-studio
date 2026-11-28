/**
 * Transition intent (decision 81, schema 0.3): `leadsTo`, and a state's `title` and `description`.
 *
 * Compatibility: 0.2 documents and definitions keep their meaning and hashes; the new fields need a 0.3 document,
 * and a 0.2 reader refuses rather than misreads them. Integrity: every target is a state of the composition,
 * renames carry it, removal reports and resolves it, a consequential action never leads back to its own
 * confirmation. Evidence: each target is reached by an example's data, by the pipeline's own selection.
 * Semantics: intent never moves the pipeline; the data still chooses.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Governor } from "./governance";
import { compositionPins, instantiate } from "./instantiate";
import { compositionIssues, loadCompositions } from "./load";
import { parseCompositionsSidecar, requiredSidecarVersion, type CompositionDefinition } from "./schema";
import { compositions, contract, datasets, governorFor, readJson } from "./spike/fixtures";
import { removeState, renameState, setStateDescription, setStateTitle, stateDependencies } from "./states";
import { exampleState, leadsToOptions, setLeadsTo, transitionEvidence, transitionIssues } from "./transitions";

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
const doc = (version: string, c: CompositionDefinition) => ({ compositionsSidecar: version, status: "draft", reference: { name: "Astryx", dspack: "0.4", version: "0.1.4" }, baseSha256: "0".repeat(64), blocks: [], compositions: [c] });

/** The packaged definitions' hashes as loaded before the 0.3 fields existed (computed on this change's base). */
const BEFORE_03 = [
  "hotel-search@1 856b491b237bb451b422ff33d04af2cdd04b71f9de08b4f16b27ecd3c130e4f8",
  "hotel-results@1 232a1fe4fced886cf199eef6fca846cde693cda5071be0b8737e39dfbe0ed913",
  "hotel-results@2 29fef68ba0a29981731caf765be49babef5c31433c6cbd16c5f9005c0270038c",
];

describe("compatibility", () => {
  it("every packaged definition is still 0.2, loads as before, and keeps its hash whether read as 0.2 or 0.3", async () => {
    const packaged = readJson("apps/composer/experimental/compositions/astryx.compositions.json");
    expect(packaged.compositionsSidecar).toBe("0.2");
    const as02 = await loadCompositions(packaged, { baseContract: contract() });
    const as03 = await loadCompositions({ ...packaged, compositionsSidecar: "0.3" }, { baseContract: contract() });
    expect(as02.from).toBe("0.2");
    expect(as03.from).toBe("0.3");
    expect(as02.usable.length).toBe(packaged.compositions.length);
    for (const [i, c] of as02.usable.entries()) {
      expect(requiredSidecarVersion(c)).toBe("0.2");
      expect((await compositionPins(as03.usable[i]!)).compositionSha256).toBe((await compositionPins(c)).compositionSha256);
      // Each hash is exactly what it was before 0.3 existed (computed on the base of this change).
      expect(`${c.id}@${c.version} ${(await compositionPins(c)).compositionSha256}`).toBe(BEFORE_03[i]);
    }
  });

  it("the new fields need a 0.3 document: a 0.2 reader refuses them rather than misreading them; an unknown version is refused", () => {
    const c = draft("hotel-results");
    c.actions.find((a) => a.name === "choose")!.leadsTo = ["confirm"];
    expect(parseCompositionsSidecar(doc("0.2", c))).toMatchObject({ ok: false, issues: [{ message: expect.stringContaining("need compositionsSidecar 0.3") }] });
    expect(parseCompositionsSidecar(doc("0.3", c)).ok).toBe(true);
    expect(requiredSidecarVersion(c)).toBe("0.3");
    const titled = draft("hotel-results");
    titled.states[0]!.title = "Confirm the stay";
    expect(parseCompositionsSidecar(doc("0.2", titled)).ok).toBe(false);
    expect(parseCompositionsSidecar(doc("0.4", c)).ok).toBe(false);
  });

  it("a definition with intent has its own identity: its hash differs from the same definition without it", async () => {
    const plain = draft("hotel-results");
    const intent = draft("hotel-results");
    intent.actions.find((a) => a.name === "choose")!.leadsTo = ["confirm"];
    expect((await compositionPins(intent)).compositionSha256).not.toBe((await compositionPins(plain)).compositionSha256);
  });

  it("titles and descriptions are bounded", () => {
    const c = draft("hotel-results");
    expect(setStateTitle(c, "confirm", "x".repeat(61))).toMatchObject({ ok: false });
    expect(setStateDescription(c, "confirm", "x".repeat(241))).toMatchObject({ ok: false });
    expect(setStateTitle(c, "confirm", "  Confirm the stay ")).toEqual({ ok: true, id: "confirm" });
    expect(c.states[0]!.title).toBe("Confirm the stay");
    expect(setStateTitle(c, "confirm", "")).toEqual({ ok: true, id: "confirm" });
    expect(c.states[0]!.title).toBeUndefined();
    const long = draft("hotel-results");
    (long.states[0] as any).title = "x".repeat(61);
    expect(parseCompositionsSidecar(doc("0.3", long)).ok).toBe(false);
  });
});

describe("integrity", () => {
  it("targets are states of the composition; a consequential action never leads back to its own confirmation", () => {
    const c = draft("hotel-results");
    expect(setLeadsTo(c, "choose", ["nowhere"])).toEqual({ ok: false, reason: "there is no “nowhere” state" });
    expect(leadsToOptions(c, "reserve")).not.toContain("confirm");
    expect(setLeadsTo(c, "reserve", ["confirm"])).toMatchObject({ ok: false, reason: expect.stringContaining("cannot lead back") });
    expect(setLeadsTo(c, "choose", ["ready", "confirm"])).toEqual({ ok: true });
    expect(c.actions.find((a) => a.name === "choose")!.leadsTo).toEqual(["confirm", "ready"]);
    expect(setLeadsTo(c, "choose", [])).toEqual({ ok: true });
    expect(c.actions.find((a) => a.name === "choose")!.leadsTo).toBeUndefined();
    // The loader refuses the same things when they are written by hand.
    const bad = draft("hotel-results");
    bad.actions.find((a) => a.name === "reserve")!.leadsTo = ["confirm"];
    expect(parseCompositionsSidecar(doc("0.3", bad))).toMatchObject({ ok: false, issues: [{ message: expect.stringContaining("cannot lead back") }] });
    bad.actions.find((a) => a.name === "reserve")!.leadsTo = ["gone"];
    expect(parseCompositionsSidecar(doc("0.3", bad))).toMatchObject({ ok: false, issues: [{ message: "unknown state 'gone'" }] });
  });

  it("renaming a state carries every intent that names it, in one operation", () => {
    const c = draft("hotel-results");
    setLeadsTo(c, "choose", ["confirm"]);
    setLeadsTo(c, "back", ["ready"]);
    expect(renameState(c, "confirm", "review")).toEqual({ ok: true, id: "review" });
    expect(c.actions.find((a) => a.name === "choose")!.leadsTo).toEqual(["review"]);
    expect(loaderIssues(c)).toEqual([]);
    expect(parseCompositionsSidecar(doc("0.3", c)).ok).toBe(true);
  });

  it("removing a state reports the intents that name it, is refused without consent, and removes them with it", () => {
    const c = draft("hotel-results");
    setLeadsTo(c, "new_search", ["empty", "ready"]);
    expect(stateDependencies(c, "empty")!.leadsTo).toEqual(["new_search"]);
    expect(removeState(c, "empty")).toEqual({ ok: false, reason: "other declarations depend on it" });
    expect(c.states.some((s) => s.id === "empty")).toBe(true);
    expect(removeState(c, "empty", true)).toMatchObject({ ok: true });
    expect(c.actions.find((a) => a.name === "new_search")!.leadsTo).toEqual(["ready"]);
    expect(parseCompositionsSidecar(doc("0.3", c)).ok).toBe(true);
  });
});

describe("reachability evidence, and what it does not prove", () => {
  it("each target is reached by an example's data through the pipeline's own selection; a target no example reaches blocks approval", async () => {
    const c = draft("hotel-results");
    setLeadsTo(c, "choose", ["confirm"]);
    expect(exampleState(c, "confirm")).toBe("confirm");
    expect(transitionEvidence(c)).toEqual([{ action: "choose", target: "confirm", examples: ["confirm"] }]);
    expect(transitionIssues(c)).toEqual([]);
    // The example is really shown in that state by the pipeline.
    const shown = await instantiate(g, c, { surfaceId: "hotel-results-t-1", data: c.scenarios.find((s) => s.id === "confirm")!.data });
    expect(shown.ok && shown.instance.state).toBe("confirm");
    // Remove the only example that reaches it: no evidence, and approval would be blocked.
    c.scenarios = c.scenarios.filter((s) => s.id !== "confirm");
    expect(transitionEvidence(c)[0]!.examples).toEqual([]);
    expect(transitionIssues(c)).toEqual([expect.stringContaining("no example reaches that state")]);
    // An example expected to be refused is not evidence.
    expect(exampleState(c, "one")).toBeNull();
  });

  it("intent never moves the pipeline: the data still chooses the state, whatever an action declares", async () => {
    const c = draft("hotel-results");
    setLeadsTo(c, "choose", ["confirm"]);
    const r = await instantiate(g, c, { surfaceId: "hotel-results-t-2", data: ds.three });
    expect(r.ok && r.instance.state).toBe("ready");
    const plain = await instantiate(g, draft("hotel-results"), { surfaceId: "hotel-results-t-3", data: ds.three });
    expect(r.ok && plain.ok && r.instance.actions.map((a) => a.name)).toEqual(plain.ok ? plain.instance.actions.map((a) => a.name) : []);
  });
});
