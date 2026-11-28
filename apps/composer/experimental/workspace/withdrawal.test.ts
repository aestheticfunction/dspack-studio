/**
 * Approval withdrawal on this device (decision 34), at the workspace's level: the record, the host and the
 * definition. Withdrawal is an authorization decision; definitions and recorded check evidence never change.
 */
import { createHost, type CompositionDefinition } from "@dspack-studio/composer-core/compositions";
import { describe, expect, it } from "vitest";
import { checkVersion, governorFor, hostFor, loadLibrary } from "./runtime";
import { readRecord, type KeyValueStore, type StoredAuthorization } from "./storage";
import { applyWithdrawals, restoreApproval, shaOf, withdrawApproval } from "./withdrawal";

process.env.NEXT_PUBLIC_COMPOSER_TOOLCHAIN ??= JSON.stringify({ lint: "0.0.0-test", emit: "0.0.0-test", runtime: "test" });

function memory(fail: (key: string) => boolean = () => false) {
  const data = new Map<string, string>();
  const store: KeyValueStore & { data: Map<string, string>; fail: (key: string) => boolean } = {
    data,
    fail,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (store.fail(k)) throw new DOMException("quota", "QuotaExceededError");
      data.set(k, v);
    },
  };
  return store;
}

async function setup(store: KeyValueStore) {
  const governor = await governorFor();
  const loaded = await loadLibrary(store);
  const v1 = loaded.library.get("hotel-results", 1)!;
  const check = await checkVersion(governor, v1, store);
  const host = await hostFor(governor, check);
  return { governor, loaded, v1, host };
}
const none: StoredAuthorization = { withdrawn: [] };

describe("withdraw", () => {
  it("records the exact definition, then withdraws its host; the definition and its check evidence do not change; a reload withdraws it again", async () => {
    const store = memory();
    const { governor, v1, host } = await setup(store);
    const definitionBefore = JSON.stringify(v1);
    const evidenceBefore = store.data.get("composer.experimental.workspace.approvals");
    const r = await withdrawApproval({ definition: v1, host, record: none, origin: "packaged", store });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record.withdrawn).toEqual([{ composition: "hotel-results", version: 1, compositionSha256: await shaOf(v1), origin: "packaged" }]);
    expect(host.isWithdrawn("hotel-results")).toBe(true);
    expect((await host.show("hotel-results", { data: v1.scenarios[0]!.data })).ok).toBe(false);
    expect(JSON.stringify(v1)).toBe(definitionBefore);
    expect(store.data.get("composer.experimental.workspace.approvals")).toBe(evidenceBefore);
    expect(store.data.has("composer.experimental.workspace.versions")).toBe(false); // the packaged definition is not copied or changed
    // Reload: a new host for the same version is withdrawn from the record before anything is shown.
    const reloaded = await loadLibrary(store);
    const again = reloaded.library.get("hotel-results", 1)!;
    const fresh = await hostFor(governor, await checkVersion(governor, again, null));
    expect(await applyWithdrawals(readRecord("authorization", store).value, [{ definition: again, host: fresh }])).toEqual(["hotel-results@1"]);
    expect((await fresh.show("hotel-results", { data: again.scenarios[0]!.data })).ok).toBe(false);
    // Withdrawing twice is refused.
    expect(await withdrawApproval({ definition: v1, host, record: r.record, origin: "packaged", store })).toMatchObject({ ok: false, reason: expect.stringContaining("already withdrawn") });
  });

  it("if the withdrawal cannot be recorded, nothing is withdrawn: the record and the host stay in step", async () => {
    const store = memory((k) => k.endsWith("authorization"));
    const { v1, host } = await setup(store);
    const r = await withdrawApproval({ definition: v1, host, record: none, origin: "packaged", store });
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("could not be recorded on this device, so nothing was withdrawn") });
    expect(host.isWithdrawn("hotel-results")).toBe(false);
    expect(store.data.has("composer.experimental.workspace.authorization")).toBe(false);
  });

  it("applies only to the exact definition it names: another definition with the same id and version is not withdrawn", async () => {
    const store = memory();
    const { governor, v1, host } = await setup(store);
    const r = await withdrawApproval({ definition: v1, host, record: none, origin: "packaged", store });
    if (!r.ok) throw new Error(r.reason);
    const other = { ...structuredClone(v1), summary: "A different definition under the same key." } as CompositionDefinition;
    const otherHost = await createHost({ governor, compositions: [other] });
    expect(await applyWithdrawals(r.record, [{ definition: other, host: otherHost }])).toEqual([]);
    expect(otherHost.isWithdrawn(other.id)).toBe(false);
  });

  it("only an approved version can be withdrawn", async () => {
    const store = memory();
    const { governor, loaded } = await setup(store);
    const draft = loaded.library.get("hotel-results", 2)!;
    const host = await hostFor(governor, await checkVersion(governor, draft, null));
    expect(await withdrawApproval({ definition: draft, host, record: none, origin: "packaged", store })).toMatchObject({ ok: false, reason: expect.stringContaining("only an approved version") });
  });
});

describe("restore", () => {
  it("needs a check that passes now; it removes the record and authorizes the host again; a reload keeps it authorized", async () => {
    const store = memory();
    const { governor, v1, host } = await setup(store);
    const w = await withdrawApproval({ definition: v1, host, record: none, origin: "packaged", store });
    if (!w.ok) throw new Error(w.reason);
    const r = await restoreApproval({ governor, definition: v1, host, record: w.record, store });
    expect(r).toMatchObject({ ok: true, record: { withdrawn: [] } });
    expect(host.isWithdrawn("hotel-results")).toBe(false);
    expect((await host.show("hotel-results", { data: v1.scenarios[0]!.data })).ok).toBe(true);
    expect(readRecord("authorization", store).value).toEqual({ withdrawn: [] });
  });

  it("a failing check restores nothing; a restoration that cannot be recorded restores nothing", async () => {
    const store = memory();
    const { governor, v1, host } = await setup(store);
    const w = await withdrawApproval({ definition: v1, host, record: none, origin: "packaged", store });
    if (!w.ok) throw new Error(w.reason);
    const stricter = await governorFor("four-options");
    host.setGovernor(stricter);
    const failing = await restoreApproval({ governor: stricter, definition: v1, host, record: w.record, store });
    expect(failing).toMatchObject({ ok: false, reason: expect.stringContaining("checks do not pass now") });
    expect(host.isWithdrawn("hotel-results")).toBe(true);
    host.setGovernor(governor);
    store.fail = (k) => k.endsWith("authorization");
    const unrecorded = await restoreApproval({ governor, definition: v1, host, record: w.record, store });
    expect(unrecorded).toMatchObject({ ok: false, reason: expect.stringContaining("could not be recorded on this device, so it stays withdrawn") });
    expect(host.isWithdrawn("hotel-results")).toBe(true);
    expect(readRecord("authorization", store).value).toEqual(w.record);
  });
});
