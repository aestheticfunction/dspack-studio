import { beforeAll, describe, expect, it } from "vitest";
import type { Governor } from "./governance";
import { createHost, recheck, type Approval, type Host, type ShowResult } from "./host";
import type { Instance } from "./instantiate";
import type { CompositionDefinition } from "./schema";
import { compositions, contract, datasets, governorFor } from "./spike/fixtures";

let g: Governor;
let cs: Record<string, CompositionDefinition>;
let ds: Record<string, any>;
let approvals: Record<string, Approval>;
beforeAll(async () => {
  g = await governorFor();
  cs = await compositions();
  ds = datasets();
  approvals = {};
  for (const c of Object.values(cs)) {
    const r = await recheck(g, c);
    expect(r.ok, JSON.stringify(r.scenarios)).toBe(true);
    approvals[c.id] = r.approval!;
  }
});

function newHost(session = "s1"): Host {
  const host = createHost({ session, governor: g, compositions: Object.values(cs) });
  for (const [id, a] of Object.entries(approvals)) host.approve(id, a);
  return host;
}

const shown = (r: ShowResult) => {
  if (!r.ok) throw new Error(`refused: ${r.refusal.reason}`);
  return r;
};

/** The event a renderer would send for a bound action, with its context resolved against the input values. */
function press(instance: Instance, name: string, k = 0, values: Record<string, unknown> = {}) {
  const action = instance.actions.filter((a) => a.name === name)[k]!;
  return {
    name,
    surfaceId: instance.surfaceId,
    sourceComponentId: action.componentId,
    context: { ...action.payload, ...Object.fromEntries(action.carries.map((c) => [c, values[c] ?? instance.inputValues[c] ?? ""])) },
  };
}

describe("approval and pins", () => {
  it("every declared scenario behaves as declared, so the compositions are approved", () => {
    expect(approvals["hotel-results"]!.scenarios.map((s) => `${s.id}:${s.outcome}`)).toEqual(["three:ok", "two:ok", "one:refused", "none:ok", "confirm:ok"]);
  });

  it("a change to a rule the composition depends on falls back to needs-recheck: show and act refuse until re-checked", async () => {
    const host = newHost();
    const first = shown(await host.show("hotel-results", { data: ds.three }));
    const edited = contract();
    const rule = edited.rules.find((r: any) => r.id === "rule.review-offers-alternatives");
    rule.requiredSubComponents[0].min = 4;
    const g2 = await governorFor(edited);
    host.setGovernor(g2);
    const refused = await host.show("hotel-results", { data: ds.three });
    expect(refused).toMatchObject({ ok: false, refusal: { stage: "needs-recheck" }, kept: { surfaceId: first.instance.surfaceId } });
    expect(host.act(press(first.instance, "choose", 0))).toMatchObject({ accepted: false, code: "needs-recheck" });
    // The re-check runs the declared scenarios under the new rule: "three" and "two" now fail, so no approval is restored.
    const again = await recheck(g2, cs["hotel-results"]!);
    expect(again.ok).toBe(false);
    expect(again.scenarios.filter((s) => s.expect !== s.outcome).map((s) => s.id)).toEqual(["three", "two"]);
  });

  it("an edit that keeps every scenario passing is restored by its re-check", async () => {
    const host = newHost();
    const edited = contract();
    edited.rules.find((r: any) => r.id === "rule.review-offers-alternatives").rationale += " (edited)";
    const g2 = await governorFor(edited);
    host.setGovernor(g2);
    expect((await host.show("hotel-results", { data: ds.three })).ok).toBe(false);
    const again = await recheck(g2, cs["hotel-results"]!);
    expect(again.ok).toBe(true);
    host.approve("hotel-results", again.approval!);
    expect((await host.show("hotel-results", { data: ds.three })).ok).toBe(true);
  });
});

describe("actions", () => {
  it("a stale action, from an instance that has been replaced, is refused and changes nothing", async () => {
    const host = newHost();
    const a = shown(await host.show("hotel-results", { data: ds.three }));
    const b = shown(await host.show("hotel-results", { data: ds.reordered }));
    expect(b.batch[0]).toEqual({ version: "v0.9", deleteSurface: { surfaceId: a.instance.surfaceId } });
    const r = host.act(press(a.instance, "choose", 0));
    expect(r).toMatchObject({ accepted: false, code: "stale" });
    expect(host.current()?.surfaceId).toBe(b.instance.surfaceId);
  });

  it("after a reorder, the k-th drawn button names the k-th hotel now on screen", async () => {
    const host = newHost();
    shown(await host.show("hotel-results", { data: ds.three }));
    const b = shown(await host.show("hotel-results", { data: ds.reordered }));
    const r = host.act(press(b.instance, "choose", 0));
    expect(r).toMatchObject({ accepted: true, action: { payload: { hotelId: ds.reordered.hotels[0].id } } });
  });

  it("a payload that is not the button's own is refused", async () => {
    const host = newHost();
    const a = shown(await host.show("hotel-results", { data: ds.three }));
    const e = press(a.instance, "choose", 0);
    expect(host.act({ ...e, context: { hotelId: "h-103" } })).toMatchObject({ accepted: false, code: "payload-mismatch" });
    expect(host.act({ ...e, context: { hotelId: "h-101", admin: true } })).toMatchObject({ accepted: false, code: "payload-mismatch" });
  });

  it("an undeclared action, or a declared one from the wrong component, is unauthorized", async () => {
    const host = newHost();
    const a = shown(await host.show("hotel-results", { data: ds.three }));
    expect(host.act({ name: "delete_everything", surfaceId: a.instance.surfaceId, sourceComponentId: "choose", context: {} })).toMatchObject({ accepted: false, code: "unauthorized" });
    expect(host.act({ ...press(a.instance, "choose", 0), sourceComponentId: "new_search" })).toMatchObject({ accepted: false, code: "unauthorized" });
  });

  it("a consequential action is refused without its confirmation step, and refused a second time on the same surface", async () => {
    const host = newHost();
    const ready = shown(await host.show("hotel-results", { data: ds.three }));
    const forged = { name: "reserve", surfaceId: ready.instance.surfaceId, sourceComponentId: "reserve", context: { hotelId: "h-102" } };
    expect(host.act(forged)).toMatchObject({ accepted: false, code: "needs-confirmation" });
    const confirm = shown(await host.show("hotel-results", { data: ds.confirm }));
    expect(host.act(press(confirm.instance, "reserve"))).toMatchObject({ accepted: true });
    expect(host.act(press(confirm.instance, "reserve"))).toMatchObject({ accepted: false, code: "duplicate" });
  });

  it("invalid inputs arrive as an action and are refused with each field's reason", async () => {
    const host = newHost();
    const s = shown(await host.show("hotel-search", { data: {} }));
    const r = host.act(press(s.instance, "search", 0, { destination: "L", checkIn: "2026-02-30", checkOut: "tomorrow", guests: "12" }));
    expect(r).toMatchObject({ accepted: false, code: "invalid-input" });
    if (!r.accepted) {
      expect(Object.keys(r.fields ?? {}).sort()).toEqual(["checkIn", "checkOut", "destination", "guests"]);
      expect(r.fields!.checkIn).toContain("not a real date");
    }
    const ok = host.act(press(s.instance, "search", 0, { destination: "Lisbon", checkIn: "2026-03-10", checkOut: "2026-03-13", guests: "2" }));
    expect(ok).toMatchObject({ accepted: true, values: { destination: "Lisbon", guests: "2" } });
  });

  it("garbage a renderer writes into the input paths changes nothing governed, and the next action is refused for its payload", async () => {
    const host = newHost();
    const s = shown(await host.show("hotel-search", { data: {} }));
    const before = JSON.stringify(s.instance.messages.slice(0, 2));
    // What a renderer sends after writes to /input/destination (an object) and /input itself (replaced by a string).
    const garbage = [{ destination: { path: "/secrets" } }, { destination: 42 }, {}];
    for (const g of garbage) {
      const r = host.act({ name: "search", surfaceId: s.instance.surfaceId, sourceComponentId: "search", context: { checkIn: "2026-03-10", checkOut: "2026-03-13", guests: "2", ...g } });
      expect(r.accepted).toBe(false);
    }
    expect(JSON.stringify(s.instance.messages.slice(0, 2))).toBe(before);
  });
});

describe("replacement", () => {
  it("keeps entered values and focus within a composition, and announces the change", async () => {
    const host = newHost();
    const s = shown(await host.show("hotel-search", { data: {} }));
    host.act(press(s.instance, "search", 0, { destination: "Lisbon", checkIn: "2026-03-13", checkOut: "2026-03-10", guests: "2" }));
    const invalid = shown(await host.show("hotel-search", { data: { errors: ["Check-out must be after check-in."] }, focused: "check_out" }));
    expect(invalid.instance.state).toBe("invalid");
    expect(invalid.carried.sort()).toEqual(["checkIn", "checkOut", "destination", "guests"]);
    expect(invalid.instance.messages.at(-1)!.updateDataModel.value).toEqual({ destination: "Lisbon", checkIn: "2026-03-13", checkOut: "2026-03-10", guests: "2" });
    expect(invalid.focus).toEqual({ kind: "component", componentId: "check_out" });
    expect(invalid.announcement).toContain("Updated");
  });

  it("inside a repeat, focus follows the item with the same payload; when it is gone, the heading", async () => {
    const host = newHost();
    const a = shown(await host.show("hotel-results", { data: ds.three }));
    const focusedMiradouro = a.instance.actions.find((x) => x.payload.hotelId === "h-102")!.componentId;
    const b = shown(await host.show("hotel-results", { data: ds.reordered, focused: focusedMiradouro }));
    const target = b.instance.actions.find((x) => x.payload.hotelId === "h-102")!.componentId;
    expect(b.focus).toEqual({ kind: "component", componentId: target });
    const c = shown(await host.show("hotel-results", { data: ds.removed, focused: target }));
    expect(c.focus.kind).toBe("heading");
  });

  it("moving to another composition carries nothing and focuses the new heading", async () => {
    const host = newHost();
    const s = shown(await host.show("hotel-search", { data: {} }));
    host.act(press(s.instance, "search", 0, { destination: "Lisbon", checkIn: "2026-03-10", checkOut: "2026-03-13", guests: "2" }));
    const r = shown(await host.show("hotel-results", { data: ds.none, focused: "search" }));
    expect(r.carried).toEqual([]);
    expect(r.instance.messages.at(-1)!.updateDataModel.value).toEqual({ destination: "" });
    expect(r.focus.kind).toBe("heading");
  });

  it("a refused instance keeps the last valid one on screen", async () => {
    const host = newHost();
    const a = shown(await host.show("hotel-results", { data: ds.three }));
    const r = await host.show("hotel-results", { data: ds.one });
    expect(r).toMatchObject({ ok: false, kept: { surfaceId: a.instance.surfaceId } });
    expect(host.current()?.surfaceId).toBe(a.instance.surfaceId);
  });
});

describe("identity and transcripts", () => {
  it("no two instances share a surface id, within or across sessions", async () => {
    const ids = new Set<string>();
    for (const session of ["s1", "s2", "s3"]) {
      const host = newHost(session);
      for (const name of ["three", "two", "reordered", "removed"]) ids.add(shown(await host.show("hotel-results", { data: ds[name] })).instance.surfaceId);
    }
    expect(ids.size).toBe(12);
  });

  it("a recorded walk never sends updateComponents or updateDataModel to a surface already shown", async () => {
    const host = newHost();
    const transcript: any[] = [];
    const walk: Array<[string, any]> = [
      ["hotel-search", {}],
      ["hotel-search", { errors: ["Check-out must be after check-in."] }],
      ["hotel-results", ds.three],
      ["hotel-results", ds.removed],
      ["hotel-results", ds.reordered],
      ["hotel-results", ds.confirm],
      ["hotel-results", ds.none],
    ];
    for (const [id, data] of walk) transcript.push(...shown(await host.show(id, { data })).batch);
    const created = new Set<string>();
    const live = new Set<string>();
    for (const m of transcript) {
      if (m.createSurface) {
        expect(created.has(m.createSurface.surfaceId)).toBe(false);
        created.add(m.createSurface.surfaceId);
        live.add(m.createSurface.surfaceId);
        continue;
      }
      if (m.deleteSurface) {
        live.delete(m.deleteSurface.surfaceId);
        continue;
      }
      const target = (m.updateComponents ?? m.updateDataModel).surfaceId;
      expect(live.has(target)).toBe(true);
    }
    // Per surface: exactly one updateComponents and at most one updateDataModel, both in its creation batch.
    const per = new Map<string, string[]>();
    for (const m of transcript) {
      const id = (m.createSurface ?? m.updateComponents ?? m.updateDataModel ?? m.deleteSurface).surfaceId;
      per.set(id, [...(per.get(id) ?? []), Object.keys(m).find((k) => k !== "version")!]);
    }
    for (const kinds of per.values()) {
      const creation = kinds.filter((k) => k !== "deleteSurface");
      expect(creation[0]).toBe("createSurface");
      expect(creation.filter((k) => k === "updateComponents")).toHaveLength(1);
      expect(creation.filter((k) => k === "updateDataModel").length).toBeLessThanOrEqual(1);
    }
  });
});
