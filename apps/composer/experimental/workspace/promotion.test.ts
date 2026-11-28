/**
 * Block promotion in the workspace (slice D): promoting a packaged Astryx block makes a new stored draft and a
 * provenance record; the block and every packaged version stay byte-identical; approval is refused while any
 * block action is unresolved, even when the checks pass; resolving through the ordinary editing (declare an
 * action, remove or replace an element) lets it be approved; and discarding it removes its provenance.
 */
import { removeNode, type CompositionDefinition } from "@dspack-studio/composer-core/compositions";
import { describe, expect, it } from "vitest";
import { approveVersion, discardDraftVersion, editDraft, promoteBlockDraft } from "./authoring";
import { applyActionChange, applyInputChange } from "./interaction";
import { checkVersion, governorFor, loadLibrary, promotableBlocks, promotionBlockers } from "./runtime";
import { KEYS, readRecord, type KeyValueStore } from "./storage";
import { applyInsert } from "./template-editing";

process.env.NEXT_PUBLIC_COMPOSER_TOOLCHAIN ??= JSON.stringify({ lint: "0.0.0-test", emit: "0.0.0-test", runtime: "test" });

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** The Structure key of the first repeat or condition matching a test. */
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

const authForm = async () => (await promotableBlocks()).find((b) => b.id === "auth-form")!;

describe("promoting a block on this device", () => {
  it("offers the packaged Astryx blocks, and a promotion is a new stored draft with its provenance; nothing else changes", async () => {
    const blocks = await promotableBlocks();
    expect(blocks.map((b) => b.id).sort()).toEqual(["auth-form", "guide-steps", "records-table"]);
    const store = memory();
    const loaded = await loadLibrary(store);
    const packagedBefore = loaded.library.entries.flatMap((e) => e.versions).map((v) => JSON.stringify(v));
    const block = await authForm();
    const blockBefore = JSON.stringify(block);
    const r = await promoteBlockDraft(loaded, block, "Astryx", store);
    expect(r).toMatchObject({ ok: true, id: "auth-form", version: 1 });
    if (!r.ok) return;
    expect(JSON.stringify(block)).toBe(blockBefore);
    expect(r.loaded.library.entry("auth-form")).toMatchObject({ approved: null, draft: { status: "draft", version: 1 } });
    expect(r.report.mappings.find((m) => m.name === "auth_submit")).toMatchObject({ status: "mappable" });
    const reloaded = await loadLibrary(store);
    expect(reloaded.library.entry("auth-form")!.draft!.version).toBe(1);
    expect(reloaded.origin.get("auth-form@1")).toBe("device");
    expect(reloaded.stored.promotions).toEqual([{ composition: "auth-form", block: "auth-form", version: 1, reference: "Astryx" }]);
    expect(readRecord("promotions", store).status).toBe("ok");
    const others = reloaded.library.entries.filter((e) => e.id !== "auth-form").flatMap((e) => e.versions).map((v) => JSON.stringify(v));
    expect(others).toEqual(packagedBefore);
    // A second promotion of the same block takes the next free id; the first is untouched.
    const again = await promoteBlockDraft(reloaded, block, "Astryx", store);
    expect(again).toMatchObject({ ok: true, id: "auth-form-2" });
  });

  it("a stored promotion record that is not the promotions shape is set aside, not trusted", async () => {
    const store = memory();
    store.setItem(KEYS.promotions, JSON.stringify({ version: 1, data: { promoted: [{ composition: "Not An Id", block: "x", version: 1, reference: "Astryx" }] } }));
    expect(readRecord("promotions", store).status).toBe("malformed");
  });
});

describe("approval waits until every block action is resolved", () => {
  it("is refused while an action is unmapped or an element is computed, even with passing checks, and allowed once resolved", async () => {
    const store = memory();
    const governor = await governorFor();
    const promoted = await promoteBlockDraft(await loadLibrary(store), await authForm(), "Astryx", store);
    if (!promoted.ok) throw new Error(promoted.reason);
    let loaded = promoted.loaded;
    const draft = () => loaded.library.get("auth-form", 1)!;
    const edit = async (f: (d: CompositionDefinition) => void) => {
      const r = await editDraft(loaded, "auth-form", 1, f, store);
      if (!r.ok) throw new Error(r.reason);
      loaded = r.loaded;
    };
    expect((await promotionBlockers(loaded, draft())).length).toBe(5);
    // Its four checks between fields cannot be carried while the composition still shows "fields" (decision 82).
    expect((await promotionBlockers(loaded, draft())).at(-1)).toContain("4 checks between fields");

    // Map Submit on its own button; remove the conditional Forgot and the provider buttons computed per provider.
    await edit((d) => applyActionChange(d, { op: "declare", node: "auth-submit" }));
    await edit((d) => void removeNode(d, "data-collection", keyOf("data-collection", d.states[0]!.template, (x) => x.$if === "recovery")));
    await edit((d) => void removeNode(d, "data-collection", keyOf("data-collection", d.states[0]!.template, (x) => x.$each === "providers")));
    // The text fields repeated per field still have computed ids: the checks can pass, and approval still waits.
    let check = await checkVersion(governor, draft(), store);
    expect(check.approval).not.toBeNull();
    const refused = await approveVersion(loaded, governor, "auth-form", 1, check, store);
    expect(refused).toEqual({ ok: false, reason: expect.stringContaining("computed ids") });

    // Replace them with text fields of their own (through the ordinary insert), the password one private.
    for (const label of ["Email address", "Password"]) await edit((d) => void applyInsert(d, { stateId: "data-collection", at: { key: "#auth-submit", position: "before" }, component: "text-input", label }));
    await edit((d) => void removeNode(d, "data-collection", keyOf("data-collection", d.states[0]!.template, (x) => x.$each === "fields")));
    const password = draft().inputs.find((i) => i.node === "password")!;
    await edit((d) => applyInputChange(d, { op: "update", name: password.name, patch: { sensitive: true } }));
    expect(await promotionBlockers(loaded, draft())).toEqual([]);
    check = await checkVersion(governor, draft(), store);
    expect(check.approval, JSON.stringify(check.scenarios)).not.toBeNull();
    const approved = await approveVersion(loaded, governor, "auth-form", 1, check, store);
    expect(approved.ok ? approved.approved.status : approved.reason).toBe("approved");
    // It reopens from the Library on this device, approved, with its provenance.
    const reopened = await loadLibrary(store);
    expect(reopened.library.entry("auth-form")).toMatchObject({ approved: { version: 1 }, draft: null });
    expect(reopened.stored.promotions?.[0]).toMatchObject({ composition: "auth-form", block: "auth-form" });
  });

  it("if the block it came from cannot be found, approval stays blocked", async () => {
    const store = memory();
    const promoted = await promoteBlockDraft(await loadLibrary(store), await authForm(), "Astryx", store);
    if (!promoted.ok) throw new Error(promoted.reason);
    const loaded = { ...promoted.loaded, stored: { ...promoted.loaded.stored, promotions: [{ composition: "auth-form", block: "auth-form", version: 9, reference: "Astryx" }] } };
    expect(await promotionBlockers(loaded, loaded.library.get("auth-form", 1)!)).toEqual([expect.stringContaining("is not available")]);
  });

  it("discarding a promoted draft removes it and its provenance; the block is still offered", async () => {
    const store = memory();
    const promoted = await promoteBlockDraft(await loadLibrary(store), await authForm(), "Astryx", store);
    if (!promoted.ok) throw new Error(promoted.reason);
    const gone = await discardDraftVersion(promoted.loaded, "auth-form", 1, store);
    expect(gone.ok).toBe(true);
    const reloaded = await loadLibrary(store);
    expect(reloaded.library.entry("auth-form")).toBeUndefined();
    expect(reloaded.stored.promotions).toEqual([]);
    expect((await promotableBlocks()).some((b) => b.id === "auth-form")).toBe(true);
  });
});
