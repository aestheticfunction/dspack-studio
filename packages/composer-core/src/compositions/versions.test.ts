/**
 * Version coexistence (owner decision 15; M1 Slice B): compositions are identified by id and version,
 * approved versions are immutable, one newer draft may coexist with them, and approvals stay tied to the
 * exact version, its hash and the contract and toolchain pins.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Governor } from "./governance";
import { createHost, recheck } from "./host";
import { loadCompositions } from "./load";
import type { CompositionDefinition } from "./schema";
import { contract, datasets, governorFor, sidecarJson } from "./spike/fixtures";
import { approvalRecord, approvalStatus, approveDraft, createLibrary, discardDraft, editComposition, versionKey, type ApprovalRecord } from "./versions";

let g: Governor;
let base: CompositionDefinition[];
const ds = datasets();

/** hotel-results v1 approved, v2 a draft whose only change is its wording. */
function withDraft(doc = sidecarJson()) {
  for (const c of doc.compositions) c.status = "approved";
  const v2 = structuredClone(doc.compositions.find((c: any) => c.id === "hotel-results"));
  v2.version = 2;
  v2.status = "draft";
  const ready = v2.states.find((s: any) => s.id === "ready");
  ready.template.children[1].text.$concat[1] = " nights. Prices are per night, before taxes.";
  doc.compositions.push(v2);
  return doc;
}

async function load(doc: unknown) {
  return loadCompositions(doc, { baseContract: contract() });
}

beforeAll(async () => {
  g = await governorFor();
  const loaded = await load(withDraft());
  base = loaded.usable;
});

describe("the loader reads versions of one composition side by side", () => {
  it("an approved version and a newer draft of one id are both usable", async () => {
    const loaded = await load(withDraft());
    expect(loaded.disabled).toEqual([]);
    expect(loaded.usable.map((c) => versionKey(c.id, c.version)).sort()).toEqual(["hotel-results@1", "hotel-results@2", "hotel-search@1"]);
  });

  it("refuses a repeated id and version, a second draft, and a draft that is not newer than an approved version", async () => {
    const doc = withDraft();
    doc.compositions.push(structuredClone(doc.compositions[0]));
    const third = structuredClone(doc.compositions.find((c: any) => c.id === "hotel-results" && c.version === 2));
    third.version = 3;
    doc.compositions.push(third);
    const stale = structuredClone(doc.compositions.find((c: any) => c.id === "hotel-search"));
    stale.version = 1;
    stale.status = "draft";
    doc.compositions.push(stale);
    const loaded = await load(doc);
    const why = Object.fromEntries(loaded.disabled.map((d) => [d.composition, d.issues.join("; ")]));
    expect(why["hotel-search@1"]).toMatch(/given twice|not newer/);
    expect(why["hotel-results@3"]).toMatch(/more than one draft/);
    expect(loaded.usable.filter((c) => c.id === "hotel-results").map((c) => c.version)).toEqual([1, 2]);
  });
});

describe("approved versions are immutable", () => {
  it("the library holds frozen copies: the caller's objects and the library's are separate", () => {
    const defs = structuredClone(base);
    const { library } = createLibrary(defs);
    defs[0]!.name = "changed by the caller";
    const v1 = library.get("hotel-results", 1)!;
    expect(Object.isFrozen(v1)).toBe(true);
    expect(Object.isFrozen(v1.states[0]!.template)).toBe(true);
    expect(library.get(defs[0]!.id, defs[0]!.version)!.name).not.toBe("changed by the caller");
  });

  it("editing an approved version forks a draft and leaves the approved one exactly as it was", async () => {
    const { library } = createLibrary(base.filter((c) => !(c.id === "hotel-results" && c.version === 2)));
    const before = JSON.stringify(library.get("hotel-results", 1));
    const r = editComposition(library, "hotel-results", 1, (d) => {
      d.summary = "Compares hotels and confirms one.";
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.forked).toBe(true);
    expect(r.draft).toMatchObject({ id: "hotel-results", version: 2, status: "draft", summary: "Compares hotels and confirms one." });
    expect(JSON.stringify(r.library.get("hotel-results", 1))).toBe(before);
    expect(r.library.entry("hotel-results")).toMatchObject({ approved: { version: 1 }, draft: { version: 2 } });
    // The library it came from is unchanged too.
    expect(library.get("hotel-results", 2)).toBeUndefined();
  });

  it("an approved version with a draft already open is not forked again: the draft is what gets edited", () => {
    const { library } = createLibrary(base);
    expect(editComposition(library, "hotel-results", 1, () => undefined)).toMatchObject({ ok: false });
    const r = editComposition(library, "hotel-results", 2, (d) => {
      d.name = "Hotel results (revised)";
    });
    expect(r).toMatchObject({ ok: true, forked: false, draft: { version: 2, status: "draft", name: "Hotel results (revised)" } });
  });

  it("an edit may not change a version's identity or approve it", () => {
    const { library } = createLibrary(base);
    expect(editComposition(library, "hotel-results", 2, (d) => void (d.status = "approved"))).toMatchObject({ ok: false });
    expect(editComposition(library, "hotel-results", 2, (d) => void (d.version = 1))).toMatchObject({ ok: false });
    expect(editComposition(library, "hotel-results", 2, (d) => void (d.id = "other"))).toMatchObject({ ok: false });
  });
});

describe("approvals belong to one exact version", () => {
  it("each version is re-checked on its own; the approvals differ by version and hash", async () => {
    const { library } = createLibrary(base);
    const a1 = (await recheck(g, library.get("hotel-results", 1)!)).approval!;
    const a2 = (await recheck(g, library.get("hotel-results", 2)!)).approval!;
    expect([a1.pins.version, a2.pins.version]).toEqual([1, 2]);
    expect(a1.pins.compositionSha256).not.toBe(a2.pins.compositionSha256);
  });

  it("a host governing v2 refuses v1's approval, and shows nothing until v2 is approved", async () => {
    const { library } = createLibrary(base);
    const v2 = library.get("hotel-results", 2)!;
    const host = await createHost({ governor: g, compositions: [v2] });
    const a1 = (await recheck(g, library.get("hotel-results", 1)!)).approval!;
    expect(host.approve("hotel-results", a1)).toMatchObject({ approved: false });
    expect(await host.show("hotel-results", { data: ds.three })).toMatchObject({ ok: false, refusal: { stage: "needs-recheck" } });
    expect(host.approve("hotel-results", (await recheck(g, v2)).approval!)).toEqual({ approved: true });
    const shown = await host.show("hotel-results", { data: ds.three });
    expect(shown.ok && shown.instance.pins.version).toBe(2);
  });

  it("a stored approval record is evidence, never an authorization: a host refuses it", async () => {
    const v1 = base.find((c) => c.id === "hotel-results" && c.version === 1)!;
    const stored: ApprovalRecord = JSON.parse(JSON.stringify(approvalRecord((await recheck(g, v1)).approval!)));
    const host = await createHost({ governor: g, compositions: [v1] });
    expect(host.approve("hotel-results", stored as never)).toMatchObject({ approved: false });
  });

  it("a record is current under the same rules, and needs a re-check after a rule or toolchain change", async () => {
    const v1 = base.find((c) => c.id === "hotel-results" && c.version === 1)!;
    const record = approvalRecord((await recheck(g, v1)).approval!);
    expect(await approvalStatus(record, g, v1)).toEqual({ status: "current" });
    const edited = contract();
    edited.rules.find((r: any) => r.id === "rule.review-offers-alternatives").rationale += " (edited)";
    expect(await approvalStatus(record, await governorFor(edited), v1)).toEqual({ status: "needs-recheck", changed: ["contract"] });
    const v2 = base.find((c) => c.id === "hotel-results" && c.version === 2)!;
    expect(await approvalStatus(record, g, v2)).toEqual({ status: "none" });
  });

  it("a rule change that fails the re-check issues no approval, and the last valid instance stays on screen", async () => {
    const v1 = base.find((c) => c.id === "hotel-results" && c.version === 1)!;
    const host = await createHost({ governor: g, compositions: [v1] });
    host.approve("hotel-results", (await recheck(g, v1)).approval!);
    const shown = await host.show("hotel-results", { data: ds.three });
    if (!shown.ok) throw new Error("show");
    const edited = contract();
    edited.rules.find((r: any) => r.id === "rule.review-offers-alternatives").requiredSubComponents[0].min = 4;
    const g2 = await governorFor(edited);
    host.setGovernor(g2);
    const again = await recheck(g2, v1);
    expect(again.ok).toBe(false);
    expect(again.approval).toBeUndefined();
    const refused = await host.show("hotel-results", { data: ds.three });
    expect(refused).toMatchObject({ ok: false, refusal: { stage: "needs-recheck" }, kept: { surfaceId: shown.instance.surfaceId } });
    expect(host.current()?.surfaceId).toBe(shown.instance.surfaceId);
  });
});

describe("approving and discarding drafts (M1 authoring, A1 and A4)", () => {
  it("approving a draft makes it an approved version of the same number; every other version is byte-identical", () => {
    const { library } = createLibrary(base);
    const before = JSON.stringify(library.entries.flatMap((e) => e.versions).filter((v) => !(v.id === "hotel-results" && v.version === 2)));
    const r = approveDraft(library, "hotel-results", 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.approved.status).toBe("approved");
    expect(r.approved.version).toBe(2);
    expect(Object.isFrozen(r.approved)).toBe(true);
    expect(r.library.entry("hotel-results")!.approved!.version).toBe(2);
    expect(r.library.entry("hotel-results")!.draft).toBeNull();
    expect(JSON.stringify(r.library.entries.flatMap((e) => e.versions).filter((v) => !(v.id === "hotel-results" && v.version === 2)))).toBe(before);
    // The library it was given is unchanged.
    expect(library.get("hotel-results", 2)!.status).toBe("draft");
  });

  it("the approved definition hashes differently, so the draft's approval does not carry over: it must be re-checked", async () => {
    const { library } = createLibrary(base);
    const draft = library.get("hotel-results", 2)!;
    const checked = await recheck(g, draft);
    expect(checked.approval).toBeDefined();
    const r = approveDraft(library, "hotel-results", 2);
    if (!r.ok) throw new Error(r.reason);
    const host = await createHost({ governor: g, compositions: [r.approved] });
    expect(host.approve("hotel-results", checked.approval!)).toEqual({ approved: true });
    const shown = await host.show("hotel-results", { data: ds.three as never });
    expect(shown.ok).toBe(false);
    if (!shown.ok) expect(shown.refusal.stage).toBe("needs-recheck");
    const again = await recheck(g, r.approved);
    expect(again.approval!.pins.compositionSha256).not.toBe(checked.approval!.pins.compositionSha256);
    host.approve("hotel-results", again.approval!);
    expect((await host.show("hotel-results", { data: ds.three as never })).ok).toBe(true);
  });

  it("an approved version cannot be approved again or discarded; an unknown version is refused", () => {
    const { library } = createLibrary(base);
    expect(approveDraft(library, "hotel-results", 1)).toMatchObject({ ok: false });
    expect(discardDraft(library, "hotel-results", 1)).toMatchObject({ ok: false });
    expect(approveDraft(library, "hotel-results", 9)).toMatchObject({ ok: false });
    expect(discardDraft(library, "nope", 1)).toMatchObject({ ok: false });
  });

  it("discarding a draft removes only the draft; a new draft can then be forked from the approved version", () => {
    const { library } = createLibrary(base);
    const r = discardDraft(library, "hotel-results", 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.library.get("hotel-results", 2)).toBeUndefined();
    expect(JSON.stringify(r.library.get("hotel-results", 1))).toBe(JSON.stringify(library.get("hotel-results", 1)));
    const forked = editComposition(r.library, "hotel-results", 1, (d) => void (d.summary = "Edited."));
    expect(forked).toMatchObject({ ok: true, forked: true });
    if (forked.ok) expect(forked.draft.version).toBe(2);
  });

  it("after approval, the next draft forks from the newest approved version, numbered above it", () => {
    const { library } = createLibrary(base);
    const approved = approveDraft(library, "hotel-results", 2);
    if (!approved.ok) throw new Error(approved.reason);
    const next = editComposition(approved.library, "hotel-results", 2, (d) => void (d.name = "Hotel results, compact"));
    expect(next).toMatchObject({ ok: true, forked: true });
    if (!next.ok) return;
    expect(next.draft.version).toBe(3);
    expect(next.library.entry("hotel-results")!.versions.map((v) => [v.version, v.status])).toEqual([
      [1, "approved"],
      [2, "approved"],
      [3, "draft"],
    ]);
  });
});
