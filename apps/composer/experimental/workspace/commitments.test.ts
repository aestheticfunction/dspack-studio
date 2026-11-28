/**
 * Pending commitments (safeguards R3): kept before acceptance, re-attached settle-only after a reload, never
 * dispatched again, refused as duplicates while pending, settled after a withdrawal, and said to be accepted
 * before it. Only metadata is kept. Synthetic and local: nothing is executed.
 */
import { createHost, type CompositionDefinition, type Host } from "@dspack-studio/composer-core/compositions";
import { describe, expect, it } from "vitest";
import { memoryAuthority, sharedMemory } from "./authority";
import { acceptedBeforeWithdrawal, commitmentJournal, keptCommitments, pendingFor, type ListableStore } from "./commitments";
import { checkVersion, governorFor, loadLibrary } from "./runtime";
import { withdrawApproval } from "./withdrawal";

process.env.NEXT_PUBLIC_COMPOSER_TOOLCHAIN ??= JSON.stringify({ lint: "0.0.0-test", emit: "0.0.0-test", runtime: "test" });

function listable(): ListableStore & { data: Map<string, string>; fail: boolean } {
  const data = new Map<string, string>();
  const s = {
    data,
    fail: false,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (s.fail && k.includes(".commitment.")) throw new DOMException("quota", "QuotaExceededError");
      data.set(k, v);
    },
  };
  return s;
}

async function hostWith(store: ListableStore, definition: CompositionDefinition, generation = 0): Promise<Host> {
  const governor = await governorFor();
  const host = await createHost({ governor, compositions: [definition], journal: commitmentJournal(store, () => generation), pending: pendingFor(keptCommitments(store), definition.id, definition.version) });
  const check = await checkVersion(governor, definition, null);
  host.approve(definition.id, check.approval!);
  return host;
}

/** Show the confirmation step and press Reserve: the consequential action. */
async function reserve(host: Host, definition: CompositionDefinition) {
  const shown = await host.show(definition.id, { data: definition.scenarios.find((s) => s.id === "confirm")!.data });
  if (!shown.ok) throw new Error("not shown");
  const a = shown.instance.actions.find((x) => x.name === "reserve")!;
  return host.act({ name: a.name, surfaceId: shown.instance.surfaceId, sourceComponentId: a.componentId, context: { ...a.payload } });
}

describe("pending commitments", () => {
  it("are kept before acceptance, with metadata only, bound to the exact version, definition and authorization generation", async () => {
    const store = listable();
    const v1 = (await loadLibrary(null)).library.get("hotel-results", 1)!;
    const host = await hostWith(store, v1, 7);
    const r = await reserve(host, v1);
    expect(r).toMatchObject({ accepted: true, commitment: { status: "pending", version: 1 } });
    const kept = keptCommitments(store);
    expect(kept).toEqual([expect.objectContaining({ composition: "hotel-results", version: 1, action: "reserve", status: "pending", approvalGeneration: 7 })]);
    expect(kept[0]!.compositionSha256).toBe(r.accepted ? r.commitment!.compositionSha256 : "");
    // No payload, no typed value: the hotel's id the action carried is not in what is kept.
    const payload = r.accepted ? Object.values(r.commitment!.payload).map(String) : [];
    expect(payload.length).toBeGreaterThan(0);
    for (const v of payload) expect([...store.data.values()].join("\n")).not.toContain(`"${v}"`);
  });

  it("after a reload, a pending commitment is re-attached settle-only: a second Reserve is refused as a duplicate, nothing is dispatched again", async () => {
    const store = listable();
    const v1 = (await loadLibrary(null)).library.get("hotel-results", 1)!;
    const first = await reserve(await hostWith(store, v1), v1);
    const key = first.accepted ? first.commitment!.key : "";
    // Reload: a new host, a new surface.
    const host = await hostWith(store, v1);
    expect(host.commitments()).toEqual([expect.objectContaining({ key, status: "pending", reattached: true })]);
    const again = await reserve(host, v1);
    expect(again).toMatchObject({ accepted: false, code: "duplicate", key });
    expect(keptCommitments(store)).toHaveLength(1);
    // Settled by its key, it is final; then a new attempt is a new commitment.
    expect(host.settle(key, "failed")).toMatchObject({ ok: true });
    expect(keptCommitments(store)[0]).toMatchObject({ status: "failed", history: [expect.objectContaining({ status: "pending" }), expect.objectContaining({ status: "failed" })] });
    expect(await reserve(host, v1)).toMatchObject({ accepted: true });
  });

  it("after a withdrawal: no new consequential action; the earlier one can still be settled by its key; it is said to be accepted before the withdrawal; restoring re-dispatches nothing", async () => {
    const store = listable();
    const governor = await governorFor();
    const v1 = (await loadLibrary(null)).library.get("hotel-results", 1)!;
    const shared = sharedMemory();
    const authority = memoryAuthority(shared);
    const host = await hostWith(store, v1, shared.record.generation);
    const first = await reserve(host, v1);
    const key = first.accepted ? first.commitment!.key : "";
    await withdrawApproval({ definition: v1, host, authority, origin: "packaged" });
    // Reload under the withdrawal.
    const reloaded = await hostWith(store, v1, shared.record.generation);
    reloaded.withdraw(v1.id);
    expect(acceptedBeforeWithdrawal(keptCommitments(store)[0]!, shared.record)).toBe(true);
    expect(reloaded.commitments().map((c) => c.key)).toEqual([key]);
    expect(reloaded.settle(key, "unknown")).toMatchObject({ ok: true });
    expect(reloaded.settle(key, "succeeded")).toMatchObject({ ok: true });
    expect(keptCommitments(store)[0]!.status).toBe("succeeded");
    // Restored with a fresh check: the settled commitment is not dispatched again, and nothing new was kept.
    const check = await checkVersion(governor, v1, null);
    expect(reloaded.restore(v1.id, check.approval!)).toEqual({ approved: true });
    expect(keptCommitments(store)).toHaveLength(1);
    expect(reloaded.commitments()).toHaveLength(1);
  });

  it("if a commitment cannot be kept it is not accepted; if an outcome cannot be kept it is not reported as settled", async () => {
    const store = listable();
    const v1 = (await loadLibrary(null)).library.get("hotel-results", 1)!;
    const host = await hostWith(store, v1);
    store.fail = true;
    const r = await reserve(host, v1);
    expect(r).toMatchObject({ accepted: false, code: "unrecorded" });
    expect(host.commitment()).toBeNull();
    expect(keptCommitments(store)).toEqual([]);
    store.fail = false;
    const ok = await reserve(host, v1);
    const key = ok.accepted ? ok.commitment!.key : "";
    store.fail = true;
    expect(host.settle(key, "succeeded")).toMatchObject({ ok: false, code: "unrecorded" });
    expect(host.commitments()[0]!.status).toBe("pending");
    expect(keptCommitments(store)[0]!.status).toBe("pending");
  });

  it("a kept entry for another definition under the same key is not re-attached", async () => {
    const store = listable();
    const v1 = (await loadLibrary(null)).library.get("hotel-results", 1)!;
    await reserve(await hostWith(store, v1), v1);
    const other = { ...structuredClone(v1), summary: "Another definition under the same key." } as CompositionDefinition;
    const host = await hostWith(store, other);
    expect(host.commitments()).toEqual([]);
  });
});
