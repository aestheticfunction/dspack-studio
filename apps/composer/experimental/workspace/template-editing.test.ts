/**
 * Visual template editing at the workspace's level: content as parts of the existing template language, fields
 * in scope, the contract's props, insertion with its declarations in one edit, and every result going through
 * editDraft (the packaged loader) and the governed pipeline.
 */
import { findInStructure, instantiate, structureOf, type CompositionDefinition } from "@dspack-studio/composer-core/compositions";
import { describe, expect, it } from "vitest";
import { approveVersion, createDraft, editDraft } from "./authoring";
import { checkVersion, contractFor, governorFor, loadLibrary } from "./runtime";
import type { KeyValueStore } from "./storage";
import { applyContent, applyInsert, contentProblem, editableContent, fieldsInScope, fromParts, insertOptions, plainTemplateIssue, removeNode, statesShowing, toParts } from "./template-editing";

process.env.NEXT_PUBLIC_COMPOSER_TOOLCHAIN ??= JSON.stringify({ lint: "0.0.0-test", emit: "0.0.0-test", runtime: "test" });

const memory = (): KeyValueStore => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const contract = contractFor("none");
const node = (c: CompositionDefinition, state: string, key: string) => findInStructure(structureOf(c.states.find((s) => s.id === state)!), key)!.at(-1)!;

async function draftOf(id: string) {
  const store = memory();
  const loaded = await loadLibrary(store);
  const existing = loaded.library.entry(id)?.draft;
  if (existing) return { store, loaded, version: existing.version, draft: existing };
  const r = await createDraft(loaded, id, store);
  if (!r.ok) throw new Error(r.reason);
  return { store, loaded: r.loaded, version: r.version, draft: r.loaded.library.get(id, r.version)! };
}

describe("content", () => {
  it("text is parts of the existing template language: fixed text, declared fields, or both joined", () => {
    expect(toParts("Hello")).toEqual([{ kind: "text", value: "Hello" }]);
    expect(toParts({ $prop: "title", default: "Find a hotel" })).toEqual([{ kind: "field", path: "title", fallback: "Find a hotel" }]);
    expect(toParts({ $concat: ["Choose ", { $prop: "hotel.name" }] })).toEqual([{ kind: "text", value: "Choose " }, { kind: "field", path: "hotel.name" }]);
    expect(toParts({ $if: "x" })).toBeNull();
    expect(fromParts([{ kind: "text", value: "Choose " }, { kind: "field", path: "hotel.name" }])).toEqual({ $concat: ["Choose ", { $prop: "hotel.name" }] });
    expect(fromParts([{ kind: "field", path: "title", fallback: "Find a hotel" }])).toEqual({ $prop: "title", default: "Find a hotel" });
    expect(fromParts([{ kind: "text", value: "" }])).toBe("");
  });

  it("the controls are the contract's own props for the component; a field's type stays with Private", async () => {
    const { draft } = await draftOf("hotel-search");
    expect(editableContent(contract, node(draft, "ready", "#search")).map((p) => p.name)).toEqual(["label", "variant", "size", "isDisabled", "isIconOnly", "tooltip"]);
    expect(editableContent(contract, node(draft, "ready", "#search")).find((p) => p.name === "variant")!.values).toEqual(["primary", "secondary", "ghost", "destructive"]);
    expect(editableContent(contract, node(draft, "ready", "#destination")).map((p) => p.name)).not.toContain("type");
    expect(editableContent(contract, node(draft, "ready", "ready@0")).map((p) => p.name)).toEqual(["text", "type", "as"]);
  });

  it("fields in scope: data, parameters and their object fields, and inside a repeat the item's fields too", async () => {
    const { draft } = await draftOf("hotel-results");
    expect(fieldsInScope(draft, node(draft, "ready", "#choose")).map((f) => f.path)).toEqual(expect.arrayContaining(["destination", "nights", "selection.name", "hotel.name", "hotel.price"]));
    expect(fieldsInScope(draft, node(draft, "ready", "#new-search")).map((f) => f.path)).not.toContain("hotel.name");
  });

  it("an invalid change is refused in plain words: an undeclared field, a field out of scope, a value not in the contract, an empty label", async () => {
    const { draft } = await draftOf("hotel-results");
    expect(contentProblem(draft, contract, { stateId: "ready", key: "#new-search", field: "label", value: { $prop: "hotel.name" } })).toBe("“hotel.name” is not a declared field of this composition.");
    expect(contentProblem(draft, contract, { stateId: "ready", key: "#new-search", field: "variant", value: "loud" })).toBe("“loud” is not one of the choices for variant.");
    expect(contentProblem(draft, contract, { stateId: "ready", key: "#new-search", field: "label", value: "" })).toBe("A label cannot be empty: a person needs to know what this is.");
    expect(contentProblem(draft, contract, { stateId: "ready", key: "#new-search", field: "onClick", value: "x" })).toContain("has no “on click”");
    expect(contentProblem(draft, contract, { stateId: "ready", key: "#choose", field: "label", value: { $concat: ["Book ", { $prop: "hotel.name" }] } })).toBeNull();
  });

  it("a change to an element with an id applies in every state that shows it, previews through the pipeline, and leaves v1 alone", async () => {
    const { store, loaded, version, draft } = await draftOf("hotel-search");
    expect(statesShowing(draft, "ready", "#destination")).toEqual(["invalid", "ready"]);
    const v1 = JSON.stringify(loaded.library.get("hotel-search", 1));
    const r = await editDraft(loaded, "hotel-search", version, (d) => applyContent(d, { stateId: "ready", key: "#destination", field: "label", value: "Where to" }), store);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.loaded.library.get("hotel-search", version)!;
    for (const s of ["invalid", "ready"]) expect(node(d, s, "#destination").props!.label).toBe("Where to");
    expect(JSON.stringify(r.loaded.library.get("hotel-search", 1))).toBe(v1);
    const shown = await instantiate(await governorFor(), d, { surfaceId: "hotel-search-c-1", data: {} });
    expect(shown.ok && JSON.stringify(shown.instance.messages)).toContain("Where to");
  });
});

describe("insertion", () => {
  it("offers only what fits the place, and says why the rest does not", async () => {
    const { draft } = await draftOf("hotel-results");
    const inside = (key: string) => Object.fromEntries(insertOptions(draft, contract, "ready", key, "inside").map((o) => [o.component, o.blocked ?? "ok"]));
    expect(inside("#new-search").text).toBe("A button does not hold other elements.");
    expect(inside("ready@2.0.0")["text-input"]).toBe("A text field holds one value, so it cannot be repeated for each item.");
    expect(inside("ready@2.0.0").button).toBe("ok");
    expect(inside("#results").badge).toBe("A list holds selectable cards.");
  });

  it("a button comes with its action, and a text field with its typed input, in one edit the loader accepts", async () => {
    const { store, loaded, version } = await draftOf("hotel-search");
    const r = await editDraft(loaded, "hotel-search", version, (d) => void applyInsert(d, { stateId: "ready", at: { key: "#search", position: "before" }, component: "button", label: "Clear the form" }), store);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.loaded.library.get("hotel-search", version)!;
    expect(d.actions.find((a) => a.node === "clear-the-form")).toEqual({ name: "clear_the_form", node: "clear-the-form", states: ["ready"] });
    const f = await editDraft(r.loaded, "hotel-search", version, (x) => void applyInsert(x, { stateId: "ready", at: { key: "#guests", position: "after" }, component: "text-input", label: "Promo code" }), store);
    expect(f.ok && f.loaded.library.get("hotel-search", version)!.inputs.at(-1)).toEqual({ name: "promoCode", node: "promo-code", kind: "text", maxLength: 80 });
    const shown = await instantiate(await governorFor(), d, { surfaceId: "hotel-search-i-1", data: {} });
    expect(shown.ok && shown.instance.actions.map((a) => a.name).sort()).toEqual(["clear_the_form", "search"]);
  });

  it("a button inside each hotel's card becomes a repeated action whose items send their own values", async () => {
    const { store, loaded, version } = await draftOf("hotel-results");
    const r = await editDraft(loaded, "hotel-results", version, (d) => void applyInsert(d, { stateId: "ready", at: { key: "ready@2.0.0", position: "inside" }, component: "button", label: "Show on map" }), store);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.loaded.library.get("hotel-results", version)!;
    const action = d.actions.find((a) => a.node === "show-on-map")!;
    // Items are told apart by what Choose already uses: the hotel's name, which each card shows.
    expect(action.repeat).toEqual({ list: "results", each: "hotels", as: "hotel", witness: ["hotel.name"] });
    // Give it the hotel's id to send, then show the real thing.
    const withPayload = await editDraft(r.loaded, "hotel-results", version, (x) => void (x.actions.find((a) => a.node === "show-on-map")!.payload = { hotelId: { $prop: "hotel.id" } }), store);
    expect(withPayload.ok).toBe(true);
    if (!withPayload.ok) return;
    const data = d.scenarios.find((s) => s.id === "three")!.data as any;
    const shown = await instantiate(await governorFor(), withPayload.loaded.library.get("hotel-results", version)!, { surfaceId: "hotel-results-i-1", data });
    expect(shown.ok).toBe(true);
    if (shown.ok) for (const a of shown.instance.actions.filter((x) => x.name === "show_on_map")) expect(a.payload.hotelId).toBe(data.hotels[a.item!.index].id);
  });

  it("an insertion the loader refuses changes nothing, and its reason reads plainly", async () => {
    const { store, loaded, version } = await draftOf("hotel-results");
    const before = JSON.stringify(loaded.library.get("hotel-results", version));
    const r = await editDraft(loaded, "hotel-results", version, (d) => void applyInsert(d, { stateId: "ready", at: { key: "ready@2.0", position: "inside" }, component: "badge", label: "Deal" }), store);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(plainTemplateIssue(r.reason)).toContain("Each item of a repeat must be one element");
    expect(JSON.stringify(loaded.library.get("hotel-results", version))).toBe(before);
  });
});

describe("approval after editing", () => {
  it("an edited, checked draft can be approved; v1 stays byte-identical; removing a bound element without resolving is refused", async () => {
    const { store, loaded, version } = await draftOf("hotel-results");
    const v1 = JSON.stringify(loaded.library.get("hotel-results", 1));
    const r = await editDraft(loaded, "hotel-results", version, (d) => applyContent(d, { stateId: "ready", key: "#new-search", field: "label", value: "Search again" }), store);
    if (!r.ok) throw new Error(r.reason);
    const governor = await governorFor();
    const d = r.loaded.library.get("hotel-results", version)!;
    const check = await checkVersion(governor, d, null);
    expect(check.approval).toBeTruthy();
    const approved = await approveVersion(r.loaded, governor, "hotel-results", version, check, store);
    expect(approved.ok).toBe(true);
    expect(JSON.stringify(approved.ok && approved.loaded.library.get("hotel-results", 1))).toBe(v1);
    const copy = structuredClone(d);
    expect(removeNode(copy, "ready", "#new-search")).toEqual({ ok: false, reason: "other declarations depend on it" });
  });
});
