/**
 * Approval withdrawal on this device (decision 34) on the authorization authority (safeguards R1, R2): the
 * record, the host and the definition. Withdrawal is an authorization decision; definitions and recorded check
 * evidence never change. Several "tabs" share one authority, serialized as IndexedDB serializes transactions.
 *
 * The first describe block is the failing-first record of the race: the old localStorage write, reproduced
 * exactly, loses a withdrawal; the same interleaving through the authority keeps both.
 */
import { createHost, type CompositionDefinition } from "@dspack-studio/composer-core/compositions";
import { describe, expect, it } from "vitest";
import { approvalStanding, lastWithdrawalGeneration, memoryAuthority, migrateV1, restoreChange, sharedMemory, unavailableAuthority, validAuthority, withdrawalFor, withdrawChange } from "./authority";
import { checkVersion, governorFor, hostFor, loadLibrary } from "./runtime";
import { KEYS, readRecord, writeRecord, type KeyValueStore } from "./storage";
import { applyAuthority, restoreApproval, shaOf, withdrawApproval } from "./withdrawal";

process.env.NEXT_PUBLIC_COMPOSER_TOOLCHAIN ??= JSON.stringify({ lint: "0.0.0-test", emit: "0.0.0-test", runtime: "test" });

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

async function setup(store: ReturnType<typeof memory> = memory()) {
  const governor = await governorFor();
  const loaded = await loadLibrary(store);
  const v1 = loaded.library.get("hotel-results", 1)!;
  const search = loaded.library.get("hotel-search", 1)!;
  const host = await hostFor(governor, await checkVersion(governor, v1, store));
  const searchHost = await hostFor(governor, await checkVersion(governor, search, store));
  return { governor, loaded, v1, search, host, searchHost, store };
}

describe("the race, failing-first", () => {
  it("the old write lost a withdrawal: two tabs each wrote the localStorage record from their own copy", async () => {
    const store = memory();
    const { v1, search } = await setup(store);
    // Exactly what each tab held and wrote before R1: its in-memory copy plus its own entry.
    const tabA = { withdrawn: [] as Array<{ composition: string; version: number; compositionSha256: string; origin: "packaged" | "device" }> };
    const tabB = { withdrawn: [] as typeof tabA.withdrawn };
    writeRecord("authorization", { withdrawn: [...tabB.withdrawn, { composition: v1.id, version: 1, compositionSha256: await shaOf(v1), origin: "packaged" }] }, store);
    writeRecord("authorization", { withdrawn: [...tabA.withdrawn, { composition: search.id, version: 1, compositionSha256: await shaOf(search), origin: "packaged" }] }, store);
    // Tab B's withdrawal is gone: after a reload, Hotel results v1 would be authorized again.
    expect(readRecord("authorization", store).value.withdrawn.map((w) => w.composition)).toEqual(["hotel-search"]);
  });

  it("through the authority, the same interleaving keeps both, and concurrent withdrawals never overwrite each other", async () => {
    const shared = sharedMemory();
    const tabA = memoryAuthority(shared);
    const tabB = memoryAuthority(shared);
    const { v1, search, host, searchHost } = await setup();
    const [a, b] = await Promise.all([
      withdrawApproval({ definition: search, host: searchHost, authority: tabA, origin: "packaged" }),
      withdrawApproval({ definition: v1, host, authority: tabB, origin: "packaged" }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(shared.record.withdrawn.map((w) => `${w.composition}@${w.generation}`).sort()).toEqual(["hotel-results@2", "hotel-search@1"]);
    expect(shared.record.generation).toBe(2);
  });
});

describe("withdraw", () => {
  it("records the exact definition, then withdraws its host; the definition and its check evidence do not change; a reload withdraws it again", async () => {
    const shared = sharedMemory();
    const authority = memoryAuthority(shared);
    const { governor, v1, host, store } = await setup();
    const definitionBefore = JSON.stringify(v1);
    const evidenceBefore = store.data.get("composer.experimental.workspace.approvals");
    const r = await withdrawApproval({ definition: v1, host, authority, origin: "packaged" });
    expect(r.ok).toBe(true);
    expect(shared.record.withdrawn).toEqual([expect.objectContaining({ composition: "hotel-results", version: 1, compositionSha256: await shaOf(v1), origin: "packaged", generation: 1 })]);
    expect(host.isWithdrawn("hotel-results")).toBe(true);
    expect((await host.show("hotel-results", { data: v1.scenarios[0]!.data })).ok).toBe(false);
    expect(JSON.stringify(v1)).toBe(definitionBefore);
    expect(store.data.get("composer.experimental.workspace.approvals")).toBe(evidenceBefore);
    // Reload: a new host for the same version is withdrawn from the record before anything is shown.
    const reloaded = (await loadLibrary(store)).library.get("hotel-results", 1)!;
    const fresh = await hostFor(governor, await checkVersion(governor, reloaded, null));
    expect(await applyAuthority(shared.record, [{ definition: reloaded, host: fresh, approvalGeneration: shared.record.generation }])).toEqual({ withdrawn: ["hotel-results@1"], restoredElsewhere: [] });
    expect((await fresh.show("hotel-results", { data: reloaded.scenarios[0]!.data })).ok).toBe(false);
    // Withdrawing twice is refused.
    expect(await withdrawApproval({ definition: v1, host, authority, origin: "packaged" })).toMatchObject({ ok: false, reason: expect.stringContaining("already withdrawn") });
  });

  it("if the withdrawal cannot be recorded, nothing is withdrawn: the record and the host stay in step", async () => {
    const shared = sharedMemory();
    shared.failNext = true;
    const { v1, host } = await setup();
    const r = await withdrawApproval({ definition: v1, host, authority: memoryAuthority(shared), origin: "packaged" });
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("could not be recorded on this device, so nothing was withdrawn") });
    expect(host.isWithdrawn("hotel-results")).toBe(false);
    expect(shared.record.withdrawn).toEqual([]);
  });

  it("where the authority is unavailable it fails closed: withdrawn in this tab only, said so; nothing can be restored", async () => {
    const { governor, v1, host } = await setup();
    const authority = unavailableAuthority("no IndexedDB here");
    const r = await withdrawApproval({ definition: v1, host, authority, origin: "packaged" });
    expect(r).toMatchObject({ ok: true, warning: expect.stringContaining("in this tab only") });
    expect(host.isWithdrawn("hotel-results")).toBe(true);
    expect(await restoreApproval({ governor, definition: v1, host, authority })).toMatchObject({ ok: false, reason: expect.stringContaining("nothing can be restored here") });
  });

  it("applies only to the exact definition it names: another definition with the same id and version is not withdrawn", async () => {
    const shared = sharedMemory();
    const { governor, v1, host } = await setup();
    await withdrawApproval({ definition: v1, host, authority: memoryAuthority(shared), origin: "packaged" });
    const other = { ...structuredClone(v1), summary: "A different definition under the same key." } as CompositionDefinition;
    const otherHost = await createHost({ governor, compositions: [other] });
    expect((await applyAuthority(shared.record, [{ definition: other, host: otherHost, approvalGeneration: 0 }])).withdrawn).toEqual([]);
    expect(otherHost.isWithdrawn(other.id)).toBe(false);
  });

  it("only an approved version can be withdrawn", async () => {
    const { governor, loaded } = await setup();
    const draft = loaded.library.get("hotel-results", 2)!;
    const host = await hostFor(governor, await checkVersion(governor, draft, null));
    expect(await withdrawApproval({ definition: draft, host, authority: memoryAuthority(sharedMemory()), origin: "packaged" })).toMatchObject({ ok: false, reason: expect.stringContaining("only an approved version") });
  });
});

describe("restore", () => {
  it("needs a check that passes now; it removes exactly that withdrawal, keeps it in history, and authorizes the host again", async () => {
    const shared = sharedMemory();
    const authority = memoryAuthority(shared);
    const { governor, v1, host } = await setup();
    await withdrawApproval({ definition: v1, host, authority, origin: "packaged" });
    const r = await restoreApproval({ governor, definition: v1, host, authority });
    // Bound to the generation the checks began under (1), not the restoration's own (2).
    expect(r).toMatchObject({ ok: true, approvalGeneration: 1 });
    expect(shared.record.withdrawn).toEqual([]);
    expect(shared.record.history).toEqual([{ composition: "hotel-results", version: 1, compositionSha256: await shaOf(v1), withdrawnGeneration: 1, restoredGeneration: 2 }]);
    expect(host.isWithdrawn("hotel-results")).toBe(false);
    expect((await host.show("hotel-results", { data: v1.scenarios[0]!.data })).ok).toBe(true);
  });

  it("a failing check restores nothing; a restoration that cannot be recorded restores nothing", async () => {
    const shared = sharedMemory();
    const authority = memoryAuthority(shared);
    const { governor, v1, host } = await setup();
    await withdrawApproval({ definition: v1, host, authority, origin: "packaged" });
    const stricter = await governorFor("four-options");
    host.setGovernor(stricter);
    expect(await restoreApproval({ governor: stricter, definition: v1, host, authority })).toMatchObject({ ok: false, reason: expect.stringContaining("checks do not pass now") });
    expect(host.isWithdrawn("hotel-results")).toBe(true);
    host.setGovernor(governor);
    shared.failNext = true;
    expect(await restoreApproval({ governor, definition: v1, host, authority })).toMatchObject({ ok: false, reason: expect.stringContaining("could not be recorded on this device, so it stays withdrawn") });
    expect(host.isWithdrawn("hotel-results")).toBe(true);
    expect(shared.record.withdrawn).toHaveLength(1);
  });

  it("a restoration never removes a newer withdrawal: compare and set on the withdrawal it saw", async () => {
    const shared = sharedMemory();
    const authority = memoryAuthority(shared);
    const { v1 } = await setup();
    const sha = await shaOf(v1);
    await authority.update(withdrawChange(v1, sha, "packaged"));
    const seen = [withdrawalFor(shared.record, v1, sha)!];
    // Another tab restores it and withdraws it again while this tab's checks run.
    await authority.update(restoreChange(v1, sha, seen));
    await authority.update(withdrawChange(v1, sha, "packaged"));
    const late = await authority.update(restoreChange(v1, sha, seen));
    expect(late).toMatchObject({ ok: true, changed: false });
    expect(withdrawalFor(shared.record, v1, sha)!.generation).toBe(3);
  });

  it("a restoration in another tab does not authorize this tab: its approval predates the withdrawal, so it is stale until it checks here", async () => {
    const shared = sharedMemory();
    const { governor, v1, host } = await setup();
    const tabA = memoryAuthority(shared);
    const tabB = memoryAuthority(shared);
    // Tab B loaded at generation 0 and holds an approval from then; it never saw the withdrawal message.
    const hostB = await hostFor(governor, await checkVersion(governor, v1, null));
    const genB = 0;
    await withdrawApproval({ definition: v1, host, authority: tabA, origin: "packaged" });
    await restoreApproval({ governor, definition: v1, host, authority: tabA });
    // Not withdrawn now, but tab B's approval is older than the latest withdrawal: stale.
    const sha = await shaOf(v1);
    expect(approvalStanding(shared.record, v1, sha, genB)).toBe("stale");
    expect(lastWithdrawalGeneration(shared.record, v1, sha)).toBe(1);
    expect(await applyAuthority(shared.record, [{ definition: v1, host: hostB, approvalGeneration: genB }])).toEqual({ withdrawn: ["hotel-results@1"], restoredElsewhere: ["hotel-results@1"] });
    expect((await hostB.show("hotel-results", { data: v1.scenarios[0]!.data })).ok).toBe(false);
    // Its own checks, here, authorize it again.
    const r = await restoreApproval({ governor, definition: v1, host: hostB, authority: tabB });
    expect(r).toMatchObject({ ok: true });
    expect(approvalStanding(shared.record, v1, sha, r.ok ? r.approvalGeneration! : -1)).toBe("current");
    expect((await hostB.show("hotel-results", { data: v1.scenarios[0]!.data })).ok).toBe(true);
  });
});

describe("the record", () => {
  it("a version-1 record migrates conservatively: every entry stays withdrawn, ordered by generation", async () => {
    const store = memory();
    const { v1, search } = await setup(store);
    writeRecord("authorization", { withdrawn: [{ composition: v1.id, version: 1, compositionSha256: await shaOf(v1), origin: "packaged" }, { composition: search.id, version: 1, compositionSha256: await shaOf(search), origin: "packaged" }] }, store);
    const m = migrateV1(store);
    if (!m.ok) throw new Error(m.reason);
    const r = m.record;
    expect(r).toMatchObject({ version: 2, generation: 2, history: [] });
    expect(r.withdrawn.map((w) => `${w.composition}@${w.generation}${w.legacy ? " legacy" : ""}`)).toEqual(["hotel-results@1 legacy", "hotel-search@2 legacy"]);
    expect(validAuthority(r)).toEqual(r);
    // An approval from before the migration (generation 0) is stale against both.
    expect(approvalStanding(r, v1, await shaOf(v1), 0)).toBe("withdrawn");
    // Genuinely absent: an empty record.
    expect(migrateV1(memory())).toMatchObject({ ok: true, record: { generation: 0, withdrawn: [] } });
    // The version-1 record is left in place as evidence.
    expect(readRecord("authorization", store).status).toBe("ok");
    void KEYS;
  });

  it("a stored record that is not exactly the version-2 shape is refused, so nothing is authorized from it", () => {
    expect(validAuthority({ version: 2, generation: 1, withdrawn: [{ composition: "x", version: 1, compositionSha256: "0".repeat(64), origin: "packaged", generation: 5, withdrawnAt: "t" }], history: [] })).toBeNull();
    expect(validAuthority({ version: 1, withdrawn: [] })).toBeNull();
    expect(validAuthority({ version: 2, generation: 2, withdrawn: [], history: [{ composition: "x", version: 1, compositionSha256: "0".repeat(64), withdrawnGeneration: 2, restoredGeneration: 1 }] })).toBeNull();
  });
});
