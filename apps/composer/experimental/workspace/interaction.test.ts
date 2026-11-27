/**
 * Interaction authoring (experimental workspace): typed input and actions declared on a selected element of a
 * draft, through editDraft and the packaged loader. Approved versions never change; safeguards are never
 * relaxed; a private field is masked before its version can be approved.
 */
import { findInStructure, instantiate, structureOf, type CompositionDefinition } from "@dspack-studio/composer-core/compositions";
import { describe, expect, it } from "vitest";
import { approveVersion, createDraft, editDraft } from "./authoring";
import {
  actionProblem,
  applyActionChange,
  applyInputChange,
  carriableInputs,
  describeInteractionChanges,
  inputNameFor,
  inputProblem,
  interactionIssues,
  isMasked,
  payloadFields,
  plainInteractionIssue,
  roleOf,
  type ActionChange,
  type InputChange,
} from "./interaction";
import { checkVersion, governorFor, loadLibrary, type LoadedLibrary } from "./runtime";
import type { KeyValueStore } from "./storage";

process.env.NEXT_PUBLIC_COMPOSER_TOOLCHAIN ??= JSON.stringify({ lint: "0.0.0-test", emit: "0.0.0-test", runtime: "test" });

const memory = (): KeyValueStore => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

async function draftOf(id: string) {
  const store = memory();
  const loaded = await loadLibrary(store);
  // hotel-results ships a packaged draft (v2); hotel-search gets one made from approved v1.
  const existing = loaded.library.entry(id)?.draft;
  if (existing) return { store, loaded, version: existing.version, draft: existing };
  const r = await createDraft(loaded, id, store);
  if (!r.ok) throw new Error(r.reason);
  return { store, loaded: r.loaded, version: r.version, draft: r.loaded.library.get(id, r.version)! };
}

const node = (c: CompositionDefinition, state: string, key: string) => findInStructure(structureOf(c.states.find((s) => s.id === state)!), key)!.at(-1)!;

/** The UI's path: a plain check first, then the edit through editDraft (which runs the packaged loader). */
async function input(loaded: LoadedLibrary, id: string, version: number, change: InputChange, store: KeyValueStore) {
  const before = loaded.library.get(id, version)!;
  const problem = inputProblem(before, change);
  if (problem) return { ok: false as const, reason: problem };
  return editDraft(loaded, id, version, (d) => applyInputChange(d, change), store);
}
async function action(loaded: LoadedLibrary, id: string, version: number, change: ActionChange, store: KeyValueStore) {
  const problem = actionProblem(loaded.library.get(id, version)!, change);
  if (problem) return { ok: false as const, reason: problem };
  return editDraft(loaded, id, version, (d) => applyActionChange(d, change), store);
}

describe("what an element can be", () => {
  it("a text field takes typed input, a button or dialog sends an action, anything else shows content; repeated fields cannot be typed into", async () => {
    const { draft } = await draftOf("hotel-results");
    expect(roleOf(draft, node(draft, "empty", "#new-destination"))).toMatchObject({ kind: "input", input: { name: "destination" } });
    expect(roleOf(draft, node(draft, "ready", "#choose"))).toMatchObject({ kind: "action", confirmation: false, action: { name: "choose" } });
    expect(roleOf(draft, node(draft, "confirm", "#reserve"))).toMatchObject({ kind: "action", confirmation: true, action: { consequential: true } });
    expect(roleOf(draft, node(draft, "ready", "ready@0"))).toEqual({ kind: "content" });
    const repeatedField = structuredClone(draft);
    ((repeatedField.states.find((s) => s.id === "ready")!.template as any).children[2].children[0].children[0].children as any[]).push({ component: "text-input", id: "note", props: { label: "Note" } });
    expect(roleOf(repeatedField, node(repeatedField, "ready", "#note"))).toMatchObject({ kind: "input", blocked: expect.stringContaining("repeated for each item") });
  });

  it("a repeated action can send only its own item's fields; a single action, the composition's declared fields", async () => {
    const { draft } = await draftOf("hotel-results");
    expect(payloadFields(draft, node(draft, "ready", "#choose")).map((f) => f.path)).toEqual(["hotel.id", "hotel.name", "hotel.area", "hotel.price", "hotel.rating"]);
    expect(payloadFields(draft, node(draft, "confirm", "#reserve")).map((f) => f.path)).toEqual(expect.arrayContaining(["destination", "nights", "selection.id", "selection.total"]));
    expect(payloadFields(draft, node(draft, "confirm", "#reserve")).map((f) => f.path)).not.toContain("hotel.id");
  });
});

describe("typed input", () => {
  it("rename follows into every action that sends the field; a taken name, a bad name or removing a field still sent is refused in plain words", async () => {
    const { store, loaded, version } = await draftOf("hotel-search");
    const renamed = await input(loaded, "hotel-search", version, { op: "update", name: "checkIn", patch: { name: "arrival" } }, store);
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    const d = renamed.loaded.library.get("hotel-search", version)!;
    expect(d.inputs.map((i) => i.name)).toContain("arrival");
    expect(d.actions.find((a) => a.name === "search")!.carries).toEqual(["destination", "arrival", "checkOut", "guests", "memberNumber"]);
    expect(await input(renamed.loaded, "hotel-search", version, { op: "update", name: "arrival", patch: { name: "destination" } }, store)).toEqual({ ok: false, reason: "Another typed field is already called “destination”. Choose a different name." });
    expect(await input(renamed.loaded, "hotel-search", version, { op: "update", name: "arrival", patch: { name: "Arrival date" } }, store)).toMatchObject({ ok: false, reason: expect.stringContaining("letters and digits") });
    expect(await input(renamed.loaded, "hotel-search", version, { op: "remove", name: "arrival" }, store)).toEqual({ ok: false, reason: "“Search” sends what is typed here. Stop sending it there first." });
    // The packaged loader is the last word, and its refusals read plainly too.
    const dup = await editDraft(renamed.loaded, "hotel-search", version, (x) => {
      x.inputs[1]!.name = "destination";
      x.actions[0]!.carries = x.actions[0]!.carries!.filter((c) => c !== "arrival");
    }, store);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(plainInteractionIssue(dup.reason)).toBe("Another typed field is already called “destination”. Choose a different name.");
  });

  it("declare, constrain and stop taking input; a whole number needs a range; the approved version never changes", async () => {
    const { store, loaded, version } = await draftOf("hotel-results");
    const approvedBefore = JSON.stringify(loaded.library.get("hotel-results", 1));
    const removed = await input(loaded, "hotel-results", version, { op: "remove", name: "destination" }, store);
    // "Search again" sends it, so it cannot simply be removed.
    expect(removed).toMatchObject({ ok: false });
    const stop = await action(loaded, "hotel-results", version, { op: "update", name: "search_again", patch: { carries: [] } }, store);
    expect(stop.ok).toBe(true);
    if (!stop.ok) return;
    const gone = await input(stop.loaded, "hotel-results", version, { op: "remove", name: "destination" }, store);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    const back = await input(gone.loaded, "hotel-results", version, { op: "declare", node: "new-destination" }, store);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const d = back.loaded.library.get("hotel-results", version)!;
    expect(d.inputs).toEqual([{ name: inputNameFor({ ...d, inputs: [] }, "new-destination"), node: "new-destination", kind: "text", maxLength: 80 }]);
    expect(inputProblem(d, { op: "update", name: "newDestination", patch: { kind: "integer", minimum: 5, maximum: 2 } })).toBe("The smallest value is larger than the largest value.");
    expect(inputProblem(d, { op: "update", name: "newDestination", patch: { minLength: 90 } })).toBe("The shortest it can be is longer than the longest it can be.");
    const integer = await input(back.loaded, "hotel-results", version, { op: "update", name: "newDestination", patch: { kind: "integer" } }, store);
    expect(integer.ok && integer.loaded.library.get("hotel-results", version)!.inputs[0]).toMatchObject({ kind: "integer", minimum: 1, maximum: 100 });
    expect(JSON.stringify(back.loaded.library.get("hotel-results", 1))).toBe(approvedBefore);
    // An approved version is never edited here.
    expect(await editDraft(back.loaded, "hotel-results", 1, (x) => applyInputChange(x, { op: "remove", name: "destination" }), store)).toMatchObject({ ok: false, reason: expect.stringContaining("only a draft") });
  });

  it("private means masked: marking a field private masks it in every state; the approved version's unmasked field blocks approval of its draft until masked", async () => {
    const { store, loaded, version, draft } = await draftOf("hotel-search");
    // Packaged v1 marks the loyalty number private but does not mask it; its draft inherits that.
    expect(isMasked(draft, "member-number")).toBe(false);
    expect(interactionIssues(draft)).toEqual([expect.objectContaining({ node: "member-number", text: expect.stringContaining("Mask it before this version can be approved") })]);
    const governor = await governorFor();
    const check = await checkVersion(governor, draft, null);
    expect(check.approval).toBeTruthy();
    expect(await approveVersion(loaded, governor, "hotel-search", version, check, store)).toMatchObject({ ok: false, reason: expect.stringContaining("member number is private") });
    const masked = await input(loaded, "hotel-search", version, interactionIssues(draft)[0]!.fix, store);
    expect(masked.ok).toBe(true);
    if (!masked.ok) return;
    const d = masked.loaded.library.get("hotel-search", version)!;
    expect(isMasked(d, "member-number")).toBe(true);
    expect(interactionIssues(d)).toEqual([]);
    expect(describeInteractionChanges(loaded.library.get("hotel-search", 1)!, d)).toEqual(["“Member number” is masked on screen."]);
    // The masked field renders obscured, and its value is still never prefilled.
    const r = await instantiate(governor, d, { surfaceId: "hotel-search-m-1", data: {} });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const field = r.instance.messages.flatMap((m: any) => m.updateComponents?.components ?? []).find((x: any) => x.id === "member_number");
      expect(field).toMatchObject({ component: "TextField", variant: "obscured", value: { path: "/input/memberNumber" } });
      expect(r.instance.inputValues.memberNumber).toBe("");
    }
    // Making a field no longer private takes its mask away too.
    const unmasked = await input(masked.loaded, "hotel-search", version, { op: "update", name: "memberNumber", patch: { sensitive: false } }, store);
    expect(unmasked.ok && isMasked(unmasked.loaded.library.get("hotel-search", version)!, "member-number")).toBe(false);
    const again = await checkVersion(governor, d, null);
    const approved = await approveVersion(masked.loaded, governor, "hotel-search", version, again, store);
    expect(approved).toMatchObject({ ok: true });
    if (!approved.ok) return;
    // v2 is approved now: nothing edits it.
    expect(await input(approved.loaded, "hotel-search", version, { op: "update", name: "destination", patch: { sensitive: true } }, store)).toMatchObject({ ok: false, reason: expect.stringContaining("only a draft") });
  });
});

describe("actions", () => {
  it("a payload can name only a declared field; a repeated action only its item's; a value needs a name and a value", async () => {
    const { draft } = await draftOf("hotel-results");
    expect(actionProblem(draft, { op: "update", name: "choose", patch: { payload: { hotelId: { $prop: "selection.id" } } } })).toBe("“selection.id” is not a field of each hotel; a repeated action sends its own item's values only.");
    expect(actionProblem(draft, { op: "update", name: "new_search", patch: { payload: { where: { $prop: "nowhere" } } } })).toBe("“nowhere” is not a declared field of this composition.");
    expect(actionProblem(draft, { op: "update", name: "new_search", patch: { payload: { "hotel id": "x" } } })).toContain("letters and digits");
    expect(actionProblem(draft, { op: "update", name: "new_search", patch: { payload: { reason: " " } } })).toBe("“reason” has no value. Choose a field or type a fixed value.");
    expect(actionProblem(draft, { op: "update", name: "choose", patch: { witness: [] } })).toContain("at least one field");
  });

  it("safeguards are never relaxed: a confirmation stays, a consequential action sends fixed values only, a repeated action never carries typed fields", async () => {
    const { draft } = await draftOf("hotel-results");
    expect(actionProblem(draft, { op: "update", name: "reserve", patch: { consequential: false } })).toContain("Removing a confirmation is not available");
    expect(actionProblem(draft, { op: "update", name: "reserve", patch: { carries: ["destination"] } })).toContain("fixed values only");
    expect(actionProblem(draft, { op: "update", name: "choose", patch: { carries: ["destination"] } })).toContain("its own item's values only");
    expect(actionProblem(draft, { op: "update", name: "search_again", patch: { consequential: true, carries: ["destination"] } })).toContain("fixed values only");
    // An input can be carried only where it is shown.
    expect(carriableInputs(draft, draft.actions.find((a) => a.name === "new_search")!)).toEqual([]);
    expect(actionProblem(draft, { op: "update", name: "new_search", patch: { carries: ["destination"] } })).toBe("“Destination” is not shown everywhere this action is sent from.");
  });

  it("a payload edit is previewed through the real pipeline: item k sends item k's value", async () => {
    const { store, loaded, version } = await draftOf("hotel-search");
    void store;
    const results = await draftOf("hotel-results");
    const edited = await action(results.loaded, "hotel-results", results.version, { op: "update", name: "choose", patch: { payload: { hotelId: { $prop: "hotel.id" }, hotelName: { $prop: "hotel.name" } } } }, results.store);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const d = edited.loaded.library.get("hotel-results", results.version)!;
    const data = d.scenarios.find((s) => s.id === "three")!.data as any;
    const r = await instantiate(await governorFor(), d, { surfaceId: "hotel-results-p-1", data });
    expect(r.ok).toBe(true);
    if (r.ok) for (const a of r.instance.actions.filter((x) => x.name === "choose")) expect(a.payload).toEqual({ hotelId: data.hotels[a.item!.index].id, hotelName: data.hotels[a.item!.index].name });
    expect(describeInteractionChanges(results.loaded.library.get("hotel-results", 1)!, d)).toContain("What “Choose” sends changed.");
    void loaded;
    void version;
  });

  it("an invalid declaration that passes the loader is caught by the checks: items that cannot be told apart", async () => {
    const results = await draftOf("hotel-results");
    const edited = await action(results.loaded, "hotel-results", results.version, { op: "update", name: "choose", patch: { witness: ["hotel.rating"] } }, results.store);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const d = edited.loaded.library.get("hotel-results", results.version)!;
    const data = structuredClone(d.scenarios.find((s) => s.id === "three")!.data) as any;
    data.hotels[1].rating = data.hotels[0].rating;
    const r = await instantiate(await governorFor(), d, { surfaceId: "hotel-results-w-1", data });
    expect(r).toMatchObject({ ok: false, stage: "attach", reason: expect.stringContaining("could not tell them apart") });
  });
});
