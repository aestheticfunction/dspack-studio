/**
 * Undo history (decision 62, F3): element and structure steps only. Undo puts back the template, inputs and actions
 * and keeps every other edit made since; a step that no longer matches the draft conflicts; one the loader would
 * now refuse changes nothing.
 */
import { moveNode, type CompositionDefinition } from "@dspack-studio/composer-core/compositions";
import { describe, expect, it } from "vitest";
import { createDraft, editDraft } from "./authoring";
import { loadLibrary } from "./runtime";
import type { KeyValueStore } from "./storage";
import { applyContent } from "./template-editing";
import { DEPTH, emptyHistory, plan, record, restoreTracked, settle } from "./undo-history";

process.env.NEXT_PUBLIC_COMPOSER_TOOLCHAIN ??= JSON.stringify({ lint: "0.0.0-test", emit: "0.0.0-test", runtime: "test" });

const memory = (): KeyValueStore => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

async function draftOf(id: string) {
  const store = memory();
  const loaded = await loadLibrary(store);
  const existing = loaded.library.entry(id)?.draft;
  if (existing) return { store, loaded, version: existing.version };
  const r = await createDraft(loaded, id, store);
  if (!r.ok) throw new Error(r.reason);
  return { store, loaded: r.loaded, version: r.version };
}

describe("undo history", () => {
  it("undo puts back only the elements: a summary edited since stays, and redo brings the step back", async () => {
    const { store, loaded, version } = await draftOf("hotel-results");
    const d0 = loaded.library.get("hotel-results", version)!;
    const moved = await editDraft(loaded, "hotel-results", version, (d) => void moveNode(d, "ready", "#new-search", { key: "ready@1", position: "before" }), store);
    if (!moved.ok) throw new Error(moved.reason);
    const d1 = moved.loaded.library.get("hotel-results", version)!;
    let h = record(emptyHistory(), d0, d1, "Moved up");
    const summary = await editDraft(moved.loaded, "hotel-results", version, (d) => void (d.summary = "Hotels the search found."), store);
    if (!summary.ok) throw new Error(summary.reason);
    const d2 = summary.loaded.library.get("hotel-results", version)!;
    const p = plan(h, d2, "undo");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const undone = await editDraft(summary.loaded, "hotel-results", version, (d) => restoreTracked(d, p.target), store);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    const d3 = undone.loaded.library.get("hotel-results", version)!;
    expect(JSON.stringify(d3.states)).toBe(JSON.stringify(d0.states));
    expect(d3.summary).toBe("Hotels the search found.");
    h = settle(h, "undo");
    expect(h.past).toHaveLength(0);
    const r = plan(h, d3, "redo");
    expect(r.ok && JSON.stringify(r.target.states)).toBe(JSON.stringify(d1.states));
  });

  it("a step conflicts when the draft's elements changed another way since: nothing is put back", async () => {
    const { store, loaded, version } = await draftOf("hotel-results");
    const d0 = loaded.library.get("hotel-results", version)!;
    const a = await editDraft(loaded, "hotel-results", version, (d) => applyContent(d, { stateId: "ready", key: "#new-search", field: "label", value: "Search again" }), store);
    if (!a.ok) throw new Error(a.reason);
    const h = record(emptyHistory(), d0, a.loaded.library.get("hotel-results", version)!, "Label change");
    // An edit outside the history changes the same elements (for example, from another tab).
    const b = await editDraft(a.loaded, "hotel-results", version, (d) => applyContent(d, { stateId: "ready", key: "#new-search", field: "label", value: "Look again" }), store);
    if (!b.ok) throw new Error(b.reason);
    expect(plan(h, b.loaded.library.get("hotel-results", version)!, "undo")).toEqual({ ok: false, reason: "conflict" });
  });

  it("a step the loader would now refuse changes nothing, and the draft stays as it is", async () => {
    const { store, loaded, version } = await draftOf("hotel-results");
    const d0 = loaded.library.get("hotel-results", version)!;
    // A step whose earlier elements are no longer valid for this draft: here, a repeat over a list its repeated
    // action does not name. Putting it back must be refused by the loader, not applied.
    const earlier = structuredClone(d0);
    const ready = earlier.states.find((s) => s.id === "ready")! as unknown as { template: { children: Array<{ children: Array<Record<string, unknown>> }> } };
    ready.template.children[2]!.children[0]!.$each = "rooms";
    const h = record(emptyHistory(), earlier, d0, "Text change");
    const p = plan(h, d0, "undo");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const undone = await editDraft(loaded, "hotel-results", version, (d) => restoreTracked(d, p.target), store);
    expect(undone.ok).toBe(false);
    expect(JSON.stringify(loaded.library.get("hotel-results", version))).toBe(JSON.stringify(d0));
  });

  it("an edit that changes none of the tracked parts is not a step, and the history keeps at most its depth", async () => {
    const { loaded, version } = await draftOf("hotel-search");
    const d = loaded.library.get("hotel-search", version)!;
    const same = { ...structuredClone(d), summary: "Another summary" } as CompositionDefinition;
    expect(record(emptyHistory(), d, same, "Details")).toEqual(emptyHistory());
    let h = emptyHistory();
    const other = structuredClone(d);
    other.actions = [];
    for (let i = 0; i < DEPTH + 5; i++) h = record(h, d, other, `Step ${i}`);
    expect(h.past).toHaveLength(DEPTH);
    expect(h.past.at(-1)!.what).toBe(`Step ${DEPTH + 4}`);
  });
});
