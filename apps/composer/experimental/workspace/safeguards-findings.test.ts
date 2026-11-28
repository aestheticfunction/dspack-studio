/**
 * Regressions for the targeted safeguards findings on PR #141:
 * 1. Migration: an unreadable legacy record is never read as "no withdrawals"; it is kept as it is.
 * 2. Restoration ordering: an approval is bound to the generation under which its checks began.
 * 3. Exact identity: one definition's withdrawal never erases another's under the same composition and version.
 * 4. Commitments: a kept key is never accepted again, an open commitment kept by another host refuses a second
 *    one, and a terminal outcome is never overwritten.
 * Every interleaving here is deterministic: the authorities share one serialized record, as IndexedDB tabs do.
 */
import { compositionPins, createHost, type CompositionDefinition, type Host } from "@dspack-studio/composer-core/compositions";
import { describe, expect, it } from "vitest";
import { approveVersion, editDraft } from "./authoring";
import { approvalStanding, memoryAuthority, migrateV1, restoreChange, sharedMemory, validAuthority, withdrawalFor, withdrawalsFor, withdrawChange, type Authority } from "./authority";
import { commitmentJournal, keptCommitments, type ListableStore } from "./commitments";
import { checkVersion, governorFor, hostFor, loadLibrary } from "./runtime";
import { KEYS, readRecord } from "./storage";
import { applyAuthority, restoreApproval, shaOf, withdrawApproval } from "./withdrawal";

process.env.NEXT_PUBLIC_COMPOSER_TOOLCHAIN ??= JSON.stringify({ lint: "0.0.0-test", emit: "0.0.0-test", runtime: "test" });

function listable(): ListableStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const v1Of = async () => (await loadLibrary(null)).library.get("hotel-results", 1)!;

describe("1. legacy authorization migration", () => {
  it("only a genuinely absent record means no withdrawals; malformed, other-version and unreadable records refuse and are kept as they are", () => {
    expect(migrateV1(listable())).toMatchObject({ ok: true, record: { withdrawn: [], generation: 0 } });
    const malformed = listable();
    malformed.setItem(KEYS.authorization, "{not json");
    expect(migrateV1(malformed)).toMatchObject({ ok: false, reason: expect.stringContaining("not in the expected form") });
    expect(malformed.getItem(KEYS.authorization)).toBe("{not json");
    const otherVersion = listable();
    const later = JSON.stringify({ schema: "composer.experimental.workspace/authorization", version: 9, data: { withdrawn: [] } });
    otherVersion.setItem(KEYS.authorization, later);
    expect(migrateV1(otherVersion)).toMatchObject({ ok: false, reason: expect.stringContaining("of another version") });
    expect(otherVersion.getItem(KEYS.authorization)).toBe(later);
    expect(migrateV1(null)).toMatchObject({ ok: false });
  });

  it("a migrated legacy withdrawal applies to its composition and version whatever the hash: a change in serialization cannot bypass it", async () => {
    const store = listable();
    const v1 = await v1Of();
    // A hash taken from a differently ordered serialization of the same definition (before normalization).
    const reordered = JSON.stringify({ ...v1, scenarios: v1.scenarios.map((s) => ({ ...s })) }, Object.keys(v1).reverse());
    const oldSha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reordered)))).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(oldSha).not.toBe(await shaOf(v1));
    store.setItem(KEYS.authorization, JSON.stringify({ schema: "composer.experimental.workspace/authorization", version: 1, data: { withdrawn: [{ composition: "hotel-results", version: 1, compositionSha256: oldSha, origin: "packaged" }] } }));
    expect(readRecord("authorization", store).status).toBe("ok");
    const m = migrateV1(store);
    if (!m.ok) throw new Error(m.reason);
    expect(validAuthority(m.record)).toEqual(m.record);
    expect(approvalStanding(m.record, v1, await shaOf(v1), m.record.generation)).toBe("withdrawn");
    // Restoring it removes exactly that legacy withdrawal, with fresh checks.
    const shared = sharedMemory();
    shared.record = m.record;
    const governor = await governorFor();
    const host = await hostFor(governor, await checkVersion(governor, v1, null));
    await applyAuthority(shared.record, [{ definition: v1, host, approvalGeneration: shared.record.generation }]);
    expect(host.isWithdrawn("hotel-results")).toBe(true);
    const r = await restoreApproval({ governor, definition: v1, host, authority: memoryAuthority(shared) });
    expect(r.ok).toBe(true);
    expect(withdrawalsFor(shared.record, v1, await shaOf(v1))).toEqual([]);
    expect(shared.record.history[0]).toMatchObject({ legacy: true });
  });
});

describe("2. restoration ordering", () => {
  /** Tab B's authority, which lets tab A act exactly between B's read before its checks and its read after them. */
  function interleaved(shared: ReturnType<typeof sharedMemory>, between: () => Promise<void>): Authority {
    const base = memoryAuthority(shared);
    let reads = 0;
    return {
      ...base,
      async read() {
        reads += 1;
        if (reads === 2) await between();
        return base.read();
      },
    };
  }

  it("restored elsewhere: a withdrawal and restoration in another tab while this tab's checks ran refuses, and needs fresh checks", async () => {
    const shared = sharedMemory();
    const governor = await governorFor();
    const v1 = await v1Of();
    const hostA = await hostFor(governor, await checkVersion(governor, v1, null));
    const hostB = await hostFor(governor, await checkVersion(governor, v1, null));
    const tabA = memoryAuthority(shared);
    // Earlier: A withdrew and restored; B is withdrawn here and must check (restored elsewhere).
    await withdrawApproval({ definition: v1, host: hostA, authority: tabA, origin: "packaged" });
    hostB.withdraw(v1.id);
    await restoreApproval({ governor, definition: v1, host: hostA, authority: tabA });
    // B starts its checks at generation 2; A withdraws and restores again while they run.
    const tabB = interleaved(shared, async () => {
      await withdrawApproval({ definition: v1, host: hostA, authority: tabA, origin: "packaged" });
      await restoreApproval({ governor, definition: v1, host: hostA, authority: tabA });
    });
    const r = await restoreApproval({ governor, definition: v1, host: hostB, authority: tabB });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("withdrawn in another tab while the checks ran") });
    expect(hostB.isWithdrawn(v1.id)).toBe(true);
    // Fresh checks, under the current generation, restore it.
    const again = await restoreApproval({ governor, definition: v1, host: hostB, authority: memoryAuthority(shared) });
    expect(again).toMatchObject({ ok: true, approvalGeneration: shared.record.generation });
  });

  it("the approval is bound to the generation the checks began under, never one observed after them", async () => {
    const shared = sharedMemory();
    const governor = await governorFor();
    const v1 = await v1Of();
    const sha = await shaOf(v1);
    const hostA = await hostFor(governor, await checkVersion(governor, v1, null));
    const hostB = await hostFor(governor, await checkVersion(governor, v1, null));
    const tabA = memoryAuthority(shared);
    await withdrawApproval({ definition: v1, host: hostA, authority: tabA, origin: "packaged" });
    hostB.withdraw(v1.id);
    await restoreApproval({ governor, definition: v1, host: hostA, authority: tabA }); // generation 2
    // While B's checks run, an unrelated change raises the generation: B's approval keeps the earlier one.
    const search = (await loadLibrary(null)).library.get("hotel-search", 1)!;
    const tabB = interleaved(shared, async () => void (await tabA.update(withdrawChange(search, await shaOf(search), "packaged"))));
    const r = await restoreApproval({ governor, definition: v1, host: hostB, authority: tabB });
    expect(r).toMatchObject({ ok: true, approvalGeneration: 2 });
    expect(shared.record.generation).toBe(3);
    expect(approvalStanding(shared.record, v1, sha, 2)).toBe("current");
  });

  it("withdrawn here: a restore compares and sets on exactly the withdrawals its checks began under", async () => {
    const shared = sharedMemory();
    const v1 = await v1Of();
    const sha = await shaOf(v1);
    const a = memoryAuthority(shared);
    await a.update(withdrawChange(v1, sha, "packaged"));
    const seen = withdrawalsFor(shared.record, v1, sha);
    await a.update(restoreChange(v1, sha, seen));
    await a.update(withdrawChange(v1, sha, "packaged"));
    expect(await a.update(restoreChange(v1, sha, seen))).toMatchObject({ ok: true, changed: false });
    expect(withdrawalFor(shared.record, v1, sha)!.generation).toBe(3);
  });
});

describe("3. exact definition identity", () => {
  it("two definitions under one composition and version: withdrawing one never erases the other's withdrawal; restoring one leaves the other withdrawn", async () => {
    const shared = sharedMemory();
    const a = memoryAuthority(shared);
    const x = await v1Of();
    const y = { ...structuredClone(x), summary: "Another definition under the same composition and version." } as CompositionDefinition;
    const sx = await shaOf(x);
    const sy = await shaOf(y);
    await a.update(withdrawChange(x, sx, "device"));
    await a.update(withdrawChange(y, sy, "device"));
    expect(shared.record.withdrawn.map((w) => w.compositionSha256)).toEqual([sx, sy]);
    expect(validAuthority(shared.record)).toEqual(shared.record);
    expect(await a.update(restoreChange(x, sx, withdrawalsFor(shared.record, x, sx)))).toMatchObject({ ok: true, changed: true });
    expect(approvalStanding(shared.record, y, sy, shared.record.generation)).toBe("withdrawn");
    expect(approvalStanding(shared.record, x, sx, shared.record.generation)).toBe("current");
  });

  it("two tabs approving different definitions as the same version: the second is refused, not written over the first", async () => {
    const store = listable();
    const governor = await governorFor();
    const tabA = await loadLibrary(store);
    const tabB = await loadLibrary(store);
    const approve = async (loaded: Awaited<ReturnType<typeof loadLibrary>>, title: string) => {
      const e = await editDraft(loaded, "hotel-results", 2, (d) => void (d.scenarios[0]!.title = title), store);
      if (!e.ok) throw new Error(e.reason);
      const draft = e.loaded.library.get("hotel-results", 2)!;
      return approveVersion(e.loaded, governor, "hotel-results", 2, await checkVersion(governor, draft, store), store);
    };
    const first = await approve(tabA, "Approved in tab A");
    expect(first.ok).toBe(true);
    const second = await approve(tabB, "Approved in tab B");
    expect(second).toEqual({ ok: false, reason: expect.stringContaining("another tab approved a different v2") });
    const reloaded = await loadLibrary(store);
    expect(reloaded.library.get("hotel-results", 2)!.scenarios[0]!.title).toBe("Approved in tab A");
    // And a withdrawal of tab A's definition applies to it after a reload (one identity, decision 81).
    const shared = sharedMemory();
    const host = await hostFor(governor, await checkVersion(governor, reloaded.library.get("hotel-results", 2)!, null));
    expect((await withdrawApproval({ definition: reloaded.library.get("hotel-results", 2)!, host, authority: memoryAuthority(shared), origin: "device" })).ok).toBe(true);
    const again = (await loadLibrary(store)).library.get("hotel-results", 2)!;
    expect((await compositionPins(again)).compositionSha256).toBe(shared.record.withdrawn[0]!.compositionSha256);
  });
});

describe("4. commitments across hosts", () => {
  async function tab(store: ListableStore, definition: CompositionDefinition): Promise<Host> {
    const governor = await governorFor();
    const host = await createHost({ governor, compositions: [definition], journal: commitmentJournal(store, () => 0) });
    host.approve(definition.id, (await checkVersion(governor, definition, null)).approval!);
    return host;
  }
  async function reserve(host: Host, definition: CompositionDefinition) {
    const shown = await host.show(definition.id, { data: definition.scenarios.find((s) => s.id === "confirm")!.data });
    if (!shown.ok) throw new Error("not shown");
    const a = shown.instance.actions.find((x) => x.name === "reserve")!;
    return host.act({ name: a.name, surfaceId: shown.instance.surfaceId, sourceComponentId: a.componentId, context: { ...a.payload } });
  }

  it("two independently created hosts (two tabs): an open commitment kept by one refuses a second in the other", async () => {
    const store = listable();
    const v1 = await v1Of();
    const a = await tab(store, v1);
    const b = await tab(store, v1);
    const first = await reserve(a, v1);
    expect(first.accepted).toBe(true);
    const second = await reserve(b, v1);
    expect(second).toMatchObject({ accepted: false, code: "duplicate", key: first.accepted ? first.commitment!.key : "" });
    expect(keptCommitments(store)).toHaveLength(1);
  });

  it("a kept key is never accepted again, and a terminal outcome is never overwritten by another host", async () => {
    const store = listable();
    const v1 = await v1Of();
    const a = await tab(store, v1);
    const first = await reserve(a, v1);
    const key = first.accepted ? first.commitment!.key : "";
    const journal = commitmentJournal(store, () => 0);
    expect(journal.accept(first.accepted ? first.commitment! : (null as never))).toEqual({ duplicate: key });
    expect(a.settle(key, "succeeded")).toMatchObject({ ok: true });
    // Another tab re-attached it while it was still pending, then reports a different outcome.
    const governor = await governorFor();
    const b = await createHost({ governor, compositions: [v1], journal, pending: [{ key, composition: v1.id, version: 1, compositionSha256: await shaOf(v1), action: "reserve", componentId: "x", status: "pending" }] });
    expect(b.settle(key, "failed")).toMatchObject({ ok: false, code: "conflict" });
    expect(keptCommitments(store)[0]!.status).toBe("succeeded");
  });
});
