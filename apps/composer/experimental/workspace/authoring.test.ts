/**
 * Composition authoring A1 to A4 (experimental workspace): drafts are created, edited, stored, discarded and
 * approved through composer-core's versioning and the workspace's validated records, and nothing changes an
 * approved version.
 */
import { describe, expect, it } from "vitest";
import { approveVersion, checkIsCurrent, createDraft, discardDraftVersion, editDraft, exampleId, exampleIssues, plainDataIssue } from "./authoring";
import { checkVersion, governorFor, loadLibrary } from "./runtime";
import { KEYS, type KeyValueStore } from "./storage";

process.env.NEXT_PUBLIC_COMPOSER_TOOLCHAIN ??= JSON.stringify({ lint: "0.0.0-test", emit: "0.0.0-test", runtime: "test" });

function memory(fail: (key: string) => boolean = () => false) {
  const data = new Map<string, string>();
  const store: KeyValueStore & { data: Map<string, string> } = {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (fail(k)) throw new DOMException("quota", "QuotaExceededError");
      data.set(k, v);
    },
  };
  return store;
}

/** A packaged version exactly as a fresh device loads it: the reference for "byte-identical". */
const packagedJson = async (id: string, version: number) => JSON.stringify((await loadLibrary(memory())).library.get(id, version));

describe("A1: create and discard drafts", () => {
  it("a draft of an approved version is numbered above it, stored, and leaves the approved version byte-identical", async () => {
    const store = memory();
    const loaded = await loadLibrary(store);
    const before = JSON.stringify(loaded.library.get("hotel-search", 1));
    const r = await createDraft(loaded, "hotel-search", store);
    expect(r).toMatchObject({ ok: true, version: 2 });
    if (!r.ok) return;
    expect(r.loaded.library.get("hotel-search", 2)).toMatchObject({ status: "draft" });
    expect(JSON.stringify(r.loaded.library.get("hotel-search", 1))).toBe(before);
    expect(JSON.stringify(r.loaded.library.get("hotel-search", 1))).toBe(await packagedJson("hotel-search", 1));
    const reloaded = await loadLibrary(store);
    expect(reloaded.library.entry("hotel-search")!.draft!.version).toBe(2);
    expect(reloaded.origin.get("hotel-search@2")).toBe("device");
    expect(JSON.stringify(reloaded.library.get("hotel-search", 1))).toBe(before);
  });

  it("when a draft exists, creating another is refused and names the draft to open", async () => {
    const loaded = await loadLibrary(memory());
    expect(await createDraft(loaded, "hotel-results", memory())).toEqual({ ok: false, reason: "draft v2 already exists; open it to keep editing" });
  });

  it("discarding a draft made here removes it; discarding the packaged draft withdraws it on this device only", async () => {
    const store = memory();
    let loaded = await loadLibrary(store);
    const made = await createDraft(loaded, "hotel-search", store);
    if (!made.ok) throw new Error(made.reason);
    const gone = await discardDraftVersion(made.loaded, "hotel-search", 2, store);
    expect(gone.ok).toBe(true);
    expect((await loadLibrary(store)).library.get("hotel-search", 2)).toBeUndefined();
    loaded = await loadLibrary(store);
    const withdrawn = await discardDraftVersion(loaded, "hotel-results", 2, store);
    expect(withdrawn.ok).toBe(true);
    const after = await loadLibrary(store);
    expect(after.library.get("hotel-results", 2)).toBeUndefined();
    expect(after.stored.retired).toEqual(["hotel-results@2"]);
    expect(JSON.stringify(after.library.get("hotel-results", 1))).toBe(await packagedJson("hotel-results", 1));
    // And a new draft can be started from v1.
    const again = await createDraft(after, "hotel-results", store);
    expect(again).toMatchObject({ ok: true, version: 2 });
    // A fresh device still has the packaged draft: nothing packaged changed.
    expect((await loadLibrary(memory())).library.get("hotel-results", 2)).toMatchObject({ status: "draft" });
  });

  it("an approved version cannot be discarded, and a storage failure discards nothing", async () => {
    const loaded = await loadLibrary(memory());
    expect(await discardDraftVersion(loaded, "hotel-results", 1, memory())).toMatchObject({ ok: false });
    const blocked = memory((k) => k === KEYS.versions);
    const r = await discardDraftVersion(loaded, "hotel-results", 2, blocked);
    expect(r).toMatchObject({ ok: false });
    expect(blocked.data.size).toBe(0);
  });
});

describe("A2: edit a draft", () => {
  it("details and examples are edited through the composition language, stored, and survive a reload", async () => {
    const store = memory();
    const made = await createDraft(await loadLibrary(store), "hotel-results", store).then(async () => loadLibrary(store));
    const r = await editDraft(made, "hotel-results", 2, (d) => {
      d.name = "Hotel results, compact";
      d.scenarios.push({ id: "two-sold-out", title: "Two hotels, one sold out", data: structuredClone(d.scenarios[1]!.data), expect: "ok" });
    }, store);
    expect(r.ok).toBe(true);
    const reloaded = await loadLibrary(store);
    const draft = reloaded.library.get("hotel-results", 2)!;
    expect(draft.name).toBe("Hotel results, compact");
    expect(draft.scenarios.map((s) => s.id)).toContain("two-sold-out");
    expect(JSON.stringify(reloaded.library.get("hotel-results", 1))).toBe(await packagedJson("hotel-results", 1));
  });

  it("an edit that is not a valid composition is refused with the reason, and nothing is stored", async () => {
    const store = memory();
    const loaded = await loadLibrary(store);
    expect(await editDraft(loaded, "hotel-results", 2, (d) => void (d.name = ""), store)).toMatchObject({ ok: false });
    expect(await editDraft(loaded, "hotel-results", 2, (d) => void (d.states[0]!.purpose = "not-an-intent"), store)).toMatchObject({ ok: false, reason: expect.stringContaining("not an intent") });
    expect(await editDraft(loaded, "hotel-results", 1, (d) => void (d.name = "x"), store)).toMatchObject({ ok: false, reason: expect.stringContaining("only a draft") });
    expect(store.data.get(KEYS.drafts)).toBeUndefined();
  });

  it("example issues are said in a designer's words", async () => {
    const loaded = await loadLibrary(memory());
    const draft = loaded.library.get("hotel-results", 2)!;
    const contract = (await governorFor()).contract;
    const bad = { id: "x", data: { ...draft.scenarios[0]!.data, nights: 0 }, expect: "refused" as const };
    const issues = exampleIssues(draft, bad, contract);
    expect(issues.some((i) => i.startsWith("Nights:"))).toBe(true);
    expect(issues).toContain("Choose the rule that should refuse this example.");
    expect(plainDataIssue("$.hotels[0].price: must be an integer")).toBe("Hotels, item 1, price: must be an integer");
    expect(exampleId("Two hotels, one sold out!", ["two-hotels-one-sold-out"])).toBe("two-hotels-one-sold-out-2");
    expect(exampleId("42", [])).toBe("example");
  });
});

describe("A3 and A4: checks and approval on this device", () => {
  it("an edit invalidates the check; a stale pass never approves", async () => {
    const store = memory();
    const governor = await governorFor();
    const loaded = await loadLibrary(store);
    const draft = loaded.library.get("hotel-results", 2)!;
    const check = await checkVersion(governor, draft, null);
    expect(await checkIsCurrent(governor, draft, check)).toBe(true);
    const edited = await editDraft(loaded, "hotel-results", 2, (d) => void (d.summary = "Compares hotels."), store);
    if (!edited.ok) throw new Error(edited.reason);
    const now = edited.loaded.library.get("hotel-results", 2)!;
    expect(await checkIsCurrent(governor, now, check)).toBe(false);
    const refused = await approveVersion(edited.loaded, governor, "hotel-results", 2, check, store);
    expect(refused).toMatchObject({ ok: false, reason: expect.stringContaining("run the checks") });
    expect(store.data.get(KEYS.versions)).toBeUndefined();
    // Under other rules the same pass is not current either.
    expect(await checkIsCurrent(await governorFor("four-options"), draft, check)).toBe(false);
  });

  it("approving the checked draft records it on this device; v1 stays byte-identical; a reload keeps both approved", async () => {
    const store = memory();
    const governor = await governorFor();
    const loaded = await loadLibrary(store);
    const draft = loaded.library.get("hotel-results", 2)!;
    const check = await checkVersion(governor, draft, null);
    const r = await approveVersion(loaded, governor, "hotel-results", 2, check, store);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.approved).toMatchObject({ version: 2, status: "approved" });
    expect(r.approval.pins.compositionSha256).not.toBe(check.approval!.pins.compositionSha256);
    const reloaded = await loadLibrary(store);
    expect(reloaded.library.entry("hotel-results")!.versions.map((v) => [v.version, v.status])).toEqual([
      [1, "approved"],
      [2, "approved"],
    ]);
    expect(reloaded.origin.get("hotel-results@1")).toBe("packaged");
    expect(reloaded.origin.get("hotel-results@2")).toBe("device");
    expect(JSON.stringify(reloaded.library.get("hotel-results", 1))).toBe(await packagedJson("hotel-results", 1));
    // The stored record is evidence; the version itself re-checks on load like any other.
    const recheckOnLoad = await checkVersion(governor, reloaded.library.get("hotel-results", 2)!, null);
    expect(recheckOnLoad.approval).not.toBeNull();
    // The next draft forks from v2 as v3.
    const next = await createDraft(reloaded, "hotel-results", store);
    expect(next).toMatchObject({ ok: true, version: 3 });
  });

  it("a failed write approves nothing: no version is exposed or stored", async () => {
    const store = memory((k) => k === KEYS.versions);
    const governor = await governorFor();
    const loaded = await loadLibrary(store);
    const draft = loaded.library.get("hotel-results", 2)!;
    const check = await checkVersion(governor, draft, null);
    const r = await approveVersion(loaded, governor, "hotel-results", 2, check, store);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("nothing was approved") });
    expect(store.data.get(KEYS.versions)).toBeUndefined();
    expect(loaded.library.get("hotel-results", 2)!.status).toBe("draft");
    expect((await loadLibrary(store)).library.get("hotel-results", 2)!.status).toBe("draft");
  });

  it("a draft copy left behind by an unfinished cleanup is superseded by the approved version on load", async () => {
    const store = memory((k) => k === KEYS.drafts);
    const governor = await governorFor();
    // Put an edited draft in storage first (writes allowed), then block the drafts record for the approval.
    const open = memory();
    const edited = await editDraft(await loadLibrary(open), "hotel-results", 2, (d) => void (d.summary = "Compares hotels."), open);
    if (!edited.ok) throw new Error(edited.reason);
    for (const [k, v] of open.data) store.data.set(k, v);
    const loaded = await loadLibrary(store);
    const check = await checkVersion(governor, loaded.library.get("hotel-results", 2)!, null);
    const r = await approveVersion(loaded, governor, "hotel-results", 2, check, store);
    expect(r).toMatchObject({ ok: true, warning: expect.stringContaining("will be ignored") });
    const reloaded = await loadLibrary(store);
    expect(reloaded.library.get("hotel-results", 2)).toMatchObject({ status: "approved", summary: "Compares hotels." });
    expect(reloaded.issues).toEqual([]);
  });
});
