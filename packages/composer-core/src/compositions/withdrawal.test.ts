/**
 * Approval withdrawal (decision 34): a person withdraws a composition's approval on a host. The definition is
 * untouched; nothing new is shown from it and nothing on a surface already shown runs; only a check issued after
 * the withdrawal, given explicitly through restore, authorizes it again. No other version stands in for it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Governor } from "./governance";
import { createHost, recheck, type Approval } from "./host";
import type { CompositionDefinition } from "./schema";
import { compositions, contract, datasets, governorFor } from "./spike/fixtures";

let g: Governor;
let cs: Record<string, CompositionDefinition>;
let ds: Record<string, any>;
beforeAll(async () => {
  g = await governorFor();
  cs = await compositions();
  ds = datasets();
});

const fresh = async (c: CompositionDefinition): Promise<Approval> => {
  const r = await recheck(g, c);
  expect(r.ok).toBe(true);
  return r.approval!;
};

describe("withdrawal on a host", () => {
  it("withdrawn: nothing new is shown, nothing on the current surface runs, and the definition is not touched", async () => {
    const results = cs["hotel-results"]!;
    const before = JSON.stringify(results);
    const host = await createHost({ governor: g, compositions: [results] });
    expect(host.approve(results.id, await fresh(results))).toEqual({ approved: true });
    const shown = await host.show(results.id, { data: ds.three });
    expect(shown.ok).toBe(true);
    if (!shown.ok) return;
    const choose = shown.instance.actions.find((a) => a.name === "choose")!;
    expect(host.withdraw(results.id)).toEqual({ withdrawn: true });
    expect(host.isWithdrawn(results.id)).toBe(true);
    // The surface already on screen: its actions are refused.
    expect(host.act({ name: "choose", surfaceId: shown.instance.surfaceId, sourceComponentId: choose.componentId, context: { ...choose.payload } })).toMatchObject({ accepted: false, code: "withdrawn" });
    // Nothing new is shown; the last surface is kept (the workspace draws it as not interactive).
    const again = await host.show(results.id, { data: ds.two });
    expect(again).toMatchObject({ ok: false, refusal: { stage: "withdrawn" }, kept: { surfaceId: shown.instance.surfaceId } });
    expect(JSON.stringify(results)).toBe(before);
    expect(host.log().map((e) => e.kind)).toEqual(["approved", "show", "withdrawn", "refused", "refused-show"]);
  });

  it("restoring needs an explicit restore with a check issued after the withdrawal: approve, a stale check, another composition's or other rules' check are refused", async () => {
    const results = cs["hotel-results"]!;
    const host = await createHost({ governor: g, compositions: [results] });
    const old = await fresh(results);
    host.approve(results.id, old);
    host.withdraw(results.id);
    expect(host.approve(results.id, await fresh(results))).toMatchObject({ approved: false, reason: expect.stringContaining("withdrawn") });
    expect(host.restore(results.id, old)).toEqual({ approved: false, reason: "this check was issued before the withdrawal; restoring needs a new check" });
    expect(host.restore(results.id, await fresh(cs["hotel-search"]!))).toMatchObject({ approved: false, reason: expect.stringContaining("not 'hotel-results'") });
    const stricter = await governorFor({ ...contract(), rules: [...((contract() as any).rules ?? [])] });
    host.setGovernor(stricter);
    // Same rules here, but a check made before the governor changed is still a check from before the withdrawal.
    expect(host.restore(results.id, old).approved).toBe(false);
    host.setGovernor(g);
    const now = await fresh(results);
    expect(host.restore(results.id, now)).toEqual({ approved: true });
    expect(host.isWithdrawn(results.id)).toBe(false);
    expect((await host.show(results.id, { data: ds.three })).ok).toBe(true);
    // Restoring twice is refused: it is not withdrawn any more.
    expect(host.restore(results.id, await fresh(results))).toMatchObject({ approved: false, reason: expect.stringContaining("is not withdrawn") });
  });

  it("no substitute: withdrawing one version authorizes no other, and another version's host is unaffected", async () => {
    const v1 = cs["hotel-results"]!;
    const v2 = { ...structuredClone(v1), version: 2, status: "draft" } as CompositionDefinition;
    const hostV1 = await createHost({ governor: g, compositions: [v1] });
    const hostV2 = await createHost({ governor: g, compositions: [v2] });
    hostV1.approve(v1.id, await fresh(v1));
    hostV2.approve(v2.id, await fresh(v2));
    hostV2.withdraw(v2.id);
    expect((await hostV2.show(v2.id, { data: ds.three })).ok).toBe(false);
    expect((await hostV1.show(v1.id, { data: ds.three })).ok).toBe(true);
    expect(hostV1.isWithdrawn(v1.id)).toBe(false);
    expect(hostV2.withdraw("nothing")).toEqual({ withdrawn: false, reason: "unknown composition 'nothing'" });
  });
});
