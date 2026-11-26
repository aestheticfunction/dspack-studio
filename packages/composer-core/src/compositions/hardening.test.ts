/**
 * Host hardening (R1A-REVIEW Part B): the consequential action lifecycle (M3, decision D3), input retention
 * and sensitive inputs (M4, F1, decision D5), session and instance integrity (L5, L6, E5), pin and approval
 * integrity (L2, L4), the expected refusal rule (L3) and lint exceptions (L1).
 *
 * Each test failed against main at 939cdb5; the failing run is recorded in
 * docs/repositioning/spikes/r1a/evidence/failing-first-part-b.txt.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Governor } from "./governance";
import { createGovernor } from "./governance";
import * as hostModule from "./host";
import { createHost, recheck, type Host } from "./host";
import * as instantiateModule from "./instantiate";
import { instantiate } from "./instantiate";
import { loadCompositions } from "./load";
import type { CompositionDefinition } from "./schema";
import { contract, datasets, governorFor, lint, profileJson, sidecarJson, TOOLCHAIN } from "./spike/fixtures";

const { createSessionId, SESSION_ID_PATTERN, redactEvent, idempotencyKey } = { ...(hostModule as any), ...(instantiateModule as any) };

let g: Governor;
let cs: Record<string, CompositionDefinition>;
let ds: Record<string, any>;

const SECRET = "LOYAL-7731-SECRET";

/** The sidecar with a sensitive loyalty-number field on the search, added if the sidecar does not already have it. */
function withMemberNumber(doc = sidecarJson()) {
  const search = doc.compositions.find((c: any) => c.id === "hotel-search");
  if (!search.inputs.some((i: any) => i.name === "memberNumber")) {
    search.inputs.push({ name: "memberNumber", node: "member-number", kind: "text", maxLength: 20, sensitive: true });
    for (const state of search.states) {
      const kids = state.template.children;
      kids.splice(kids.findIndex((k: any) => k.id === "search"), 0, { component: "text-input", id: "member-number", props: { label: "Loyalty number (optional)", placeholder: "Not kept after this step" } });
    }
    search.actions.find((a: any) => a.name === "search").carries.push("memberNumber");
  }
  return doc;
}

async function load(doc: unknown): Promise<Record<string, CompositionDefinition>> {
  const loaded = await loadCompositions(doc, { baseContract: contract() });
  if (loaded.binding !== "ok" || loaded.disabled.length > 0) throw new Error(JSON.stringify({ issues: loaded.issues, disabled: loaded.disabled }));
  return Object.fromEntries(loaded.usable.map((x) => [x.id, x]));
}

beforeAll(async () => {
  g = await governorFor();
  // Where the loader cannot read the sensitive field at all, the other tests still run against the plain sidecar.
  cs = await load(withMemberNumber()).catch(() => load(sidecarJson()));
  ds = datasets();
});

async function approvedHost(options: { governor?: Governor; compositions?: Record<string, CompositionDefinition>; session?: string } = {}): Promise<Host> {
  const governor = options.governor ?? g;
  const comps = options.compositions ?? cs;
  const host = await createHost({ governor, compositions: Object.values(comps), ...(options.session ? { session: options.session } : {}) });
  for (const c of Object.values(comps)) host.approve(c.id, (await recheck(governor, c)).approval!);
  return host;
}

const shown = async (p: Promise<any>) => {
  const r = await p;
  if (!r.ok) throw new Error(`refused: ${r.refusal.reason}`);
  return r;
};

const press = (instance: any, name: string, k = 0, values: Record<string, unknown> = {}) => {
  const a = instance.actions.filter((x: any) => x.name === name)[k];
  return { name, surfaceId: instance.surfaceId, sourceComponentId: a.componentId, context: { ...a.payload, ...Object.fromEntries(a.carries.map((c: string) => [c, values[c] ?? ""])) } };
};

const VALID = { destination: "Lisbon", checkIn: "2026-03-10", checkOut: "2026-03-13", guests: "2" };

async function atConfirmation(host: Host) {
  return shown(host.show("hotel-results", { data: ds.confirm }));
}

describe("M3 and D3: the consequential action lifecycle", () => {
  it("accepting a consequential action returns a stable idempotency key and a pending outcome", async () => {
    const host = await approvedHost();
    const c = await atConfirmation(host);
    const r: any = host.act(press(c.instance, "reserve"));
    expect(r.accepted).toBe(true);
    expect(r.commitment).toMatchObject({ status: "pending", surfaceId: c.instance.surfaceId, action: "reserve", payload: { hotelId: ds.confirm.selection.id } });
    expect(r.commitment.key).toBe(idempotencyKey(c.instance.surfaceId, "reserve", "reserve"));
    // A repeated press is refused as a duplicate and names the same key, so a caller can deduplicate.
    const again: any = host.act(press(c.instance, "reserve"));
    expect(again).toMatchObject({ accepted: false, code: "duplicate", key: r.commitment.key });
  });

  it("locks the surface: every other action on it is refused until a governed replacement is shown", async () => {
    const host = await approvedHost();
    const c = await atConfirmation(host);
    host.act(press(c.instance, "reserve"));
    expect(host.act(press(c.instance, "back"))).toMatchObject({ accepted: false, code: "locked" });
  });

  it("refuses navigation while the outcome is pending, and keeps the locked surface", async () => {
    const host = await approvedHost();
    const c = await atConfirmation(host);
    host.act(press(c.instance, "reserve"));
    const r: any = await host.show("hotel-results", { data: ds.three });
    expect(r).toMatchObject({ ok: false, refusal: { stage: "outcome-pending" }, kept: { surfaceId: c.instance.surfaceId } });
    expect(host.current()?.surfaceId).toBe(c.instance.surfaceId);
  });

  it("a succeeded outcome releases navigation; the replacement unlocks; the old surface is stale", async () => {
    const host: any = await approvedHost();
    const c = await atConfirmation(host);
    const { commitment } = host.act(press(c.instance, "reserve"));
    expect(host.settle(commitment.key, "succeeded")).toMatchObject({ ok: true, commitment: { status: "succeeded" } });
    // Settled, but not yet replaced: the surface stays locked.
    expect(host.act(press(c.instance, "back"))).toMatchObject({ accepted: false, code: "locked" });
    const next = await shown(host.show("hotel-search", { data: {} }));
    expect(host.act(press(c.instance, "back"))).toMatchObject({ accepted: false, code: "stale" });
    expect(host.act(press(next.instance, "search", 0, VALID))).toMatchObject({ accepted: true });
    expect(host.commitments().map((x: any) => x.history.map((h: any) => h.status))).toEqual([["pending", "succeeded"]]);
  });

  it("an unknown outcome keeps the lock and blocks navigation; recovery is by reconciling the same key, never a new dispatch", async () => {
    const host: any = await approvedHost();
    const c = await atConfirmation(host);
    const { commitment } = host.act(press(c.instance, "reserve"));
    expect(host.settle(commitment.key, "unknown")).toMatchObject({ ok: true, commitment: { status: "unknown" } });
    expect(await host.show("hotel-results", { data: ds.confirm })).toMatchObject({ ok: false, refusal: { stage: "outcome-pending" } });
    expect(host.act(press(c.instance, "reserve"))).toMatchObject({ accepted: false, code: "duplicate", key: commitment.key });
    expect(host.act(press(c.instance, "back"))).toMatchObject({ accepted: false, code: "locked" });
    // The tool, asked by key, reports it did not go through: only now may a new attempt be made, under a new key.
    expect(host.settle(commitment.key, "failed")).toMatchObject({ ok: true, commitment: { status: "failed" } });
    const retry = await atConfirmation(host);
    const second: any = host.act(press(retry.instance, "reserve"));
    expect(second.accepted).toBe(true);
    expect(second.commitment.key).not.toBe(commitment.key);
  });

  it("outcomes move only forward: succeeded and failed are final, a repeat is idempotent, an unknown key is refused", async () => {
    const host: any = await approvedHost();
    const c = await atConfirmation(host);
    const { commitment } = host.act(press(c.instance, "reserve"));
    expect(host.settle(commitment.key, "pending")).toMatchObject({ ok: false });
    expect(host.settle(commitment.key, "succeeded").ok).toBe(true);
    expect(host.settle(commitment.key, "succeeded")).toMatchObject({ ok: true, commitment: { status: "succeeded" } });
    expect(host.settle(commitment.key, "failed")).toMatchObject({ ok: false, code: "conflict" });
    expect(host.settle(commitment.key, "unknown")).toMatchObject({ ok: false, code: "conflict" });
    expect(host.settle("no-such-key", "failed")).toMatchObject({ ok: false, code: "unknown-key" });
  });

  it("an action that is not consequential neither locks nor opens an outcome", async () => {
    const host: any = await approvedHost();
    const r = await shown(host.show("hotel-results", { data: ds.three }));
    const first: any = host.act(press(r.instance, "choose", 0));
    expect(first.accepted).toBe(true);
    expect(first.commitment).toBeUndefined();
    expect(host.act(press(r.instance, "choose", 1))).toMatchObject({ accepted: true });
    expect(host.commitments()).toEqual([]);
  });

  it("the log records the key and each outcome, and nothing the person typed", async () => {
    const host: any = await approvedHost();
    const c = await atConfirmation(host);
    const { commitment } = host.act(press(c.instance, "reserve"));
    host.settle(commitment.key, "unknown");
    host.settle(commitment.key, "succeeded");
    const entries = host.log().filter((e: any) => e.key === commitment.key);
    expect(entries.map((e: any) => [e.kind, e.code ?? null])).toEqual([
      ["accepted", null],
      ["settled", "unknown"],
      ["settled", "succeeded"],
    ]);
  });
});

describe("M4 and F1: values kept where they are meaningful", () => {
  it("an invalid-input refusal keeps what was typed, so the invalid state shows it again", async () => {
    const host = await approvedHost();
    const s = await shown(host.show("hotel-search", { data: {} }));
    const typed = { destination: "Lisbon", checkIn: "2026-02-30", checkOut: "2026-03-13", guests: "2" };
    expect(host.act(press(s.instance, "search", 0, typed))).toMatchObject({ accepted: false, code: "invalid-input" });
    const invalid = await shown(host.show("hotel-search", { data: { errors: ["Check-in is not a real date."] } }));
    expect(invalid.carried.sort()).toEqual(["checkIn", "checkOut", "destination", "guests"]);
    expect(invalid.instance.messages.at(-1).updateDataModel.value).toMatchObject(typed);
  });

  it("a value longer than its field allows is not kept", async () => {
    const host = await approvedHost();
    const s = await shown(host.show("hotel-search", { data: {} }));
    host.act(press(s.instance, "search", 0, { ...VALID, destination: "x".repeat(81) }));
    const invalid = await shown(host.show("hotel-search", { data: { errors: ["Too long."] } }));
    expect(invalid.instance.messages.at(-1).updateDataModel.value.destination).toBe("");
  });
});

describe("D5: sensitive inputs", () => {
  it("a sensitive input is declared on the input and read by the loader", async () => {
    expect(cs["hotel-search"]!.inputs.find((i) => i.name === "memberNumber")).toMatchObject({ sensitive: true });
  });

  it("the person's sensitive value reaches the caller once, for this action, and is never carried into a replacement", async () => {
    const host = await approvedHost();
    const s = await shown(host.show("hotel-search", { data: {} }));
    const r = host.act(press(s.instance, "search", 0, { ...VALID, checkOut: "2026-03-09", memberNumber: SECRET }));
    expect(r).toMatchObject({ accepted: true, values: { memberNumber: SECRET } });
    const invalid: any = await shown(host.show("hotel-search", { data: { errors: ["Check-out must be after check-in."] } }));
    expect(invalid.carried).not.toContain("memberNumber");
    expect(invalid.dropped).toContainEqual({ name: "memberNumber", reason: "sensitive: never carried" });
    expect(invalid.instance.messages.at(-1).updateDataModel.value.memberNumber).toBe("");
    expect(JSON.stringify(invalid.batch)).not.toContain(SECRET);
  });

  it("is kept out of the host's log, its current instance, refusal reasons and the commitment record", async () => {
    const host: any = await approvedHost();
    const s = await shown(host.show("hotel-search", { data: {} }));
    const refused = host.act(press(s.instance, "search", 0, { ...VALID, checkIn: "bad", memberNumber: SECRET }));
    const accepted = host.act(press(s.instance, "search", 0, { ...VALID, memberNumber: SECRET }));
    expect(accepted.accepted).toBe(true);
    const recorded = JSON.stringify({ log: host.log(), current: host.current(), refused, commitments: host.commitments() });
    expect(recorded).not.toContain(SECRET);
  });

  it("an invalid-input refusal does not keep a sensitive value either", async () => {
    const host = await approvedHost();
    const s = await shown(host.show("hotel-search", { data: {} }));
    host.act(press(s.instance, "search", 0, { ...VALID, guests: "99", memberNumber: SECRET }));
    const invalid = await shown(host.show("hotel-search", { data: { errors: ["Too many guests."] } }));
    expect(JSON.stringify(invalid.batch)).not.toContain(SECRET);
    expect(invalid.instance.messages.at(-1).updateDataModel.value).toMatchObject({ destination: "Lisbon", guests: "99", memberNumber: "" });
  });

  it("redactEvent gives the recordable form of an action: sensitive values replaced, everything else as sent", async () => {
    const host = await approvedHost();
    const s = await shown(host.show("hotel-search", { data: {} }));
    const event = press(s.instance, "search", 0, { ...VALID, memberNumber: SECRET });
    const recordable = redactEvent(event, s.instance);
    expect(recordable.context).toEqual({ ...VALID, memberNumber: "[sensitive]" });
    expect(event.context.memberNumber).toBe(SECRET);
  });

  it("instantiate refuses to write a sensitive value into a creation batch", async () => {
    const r = await instantiate(g, cs["hotel-search"]!, { surfaceId: "hotel-search-" + "a".repeat(26) + "-1", data: {}, inputValues: { memberNumber: SECRET } });
    expect(r).toMatchObject({ ok: false, stage: "data" });
    if (!r.ok) expect(r.reason).not.toContain(SECRET);
  });

  it("a consequential action may not carry any input, sensitive or not (M6 still holds)", async () => {
    const doc = withMemberNumber();
    const results = doc.compositions.find((c: any) => c.id === "hotel-results");
    results.inputs.push({ name: "card", node: "card-number", kind: "text", maxLength: 19, sensitive: true });
    results.actions.find((a: any) => a.name === "reserve").carries = ["card"];
    const loaded = await loadCompositions(doc, { baseContract: contract() });
    expect(loaded.usable.map((c) => c.id)).not.toContain("hotel-results");
  });
});

describe("L5 and E5: session ids", () => {
  it("are generated in core from a cryptographic source, in a restricted charset", () => {
    const ids = new Set<string>();
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      for (let i = 0; i < 5000; i++) ids.add(createSessionId());
    } finally {
      spy.mockRestore();
    }
    expect(ids.size).toBe(5000);
    for (const id of ids) expect(id).toMatch(/^[a-z2-7]{26}$/);
    for (const id of ids) expect(id).toMatch(SESSION_ID_PATTERN);
  });

  it("a host without a session id gets a generated one, and surface ids never repeat across hosts", async () => {
    const all = new Set<string>();
    const sessions = new Set<string>();
    for (let n = 0; n < 4; n++) {
      const host = await approvedHost();
      expect(host.session).toMatch(SESSION_ID_PATTERN);
      sessions.add(host.session);
      for (const name of ["three", "two", "reordered"]) all.add((await shown(host.show("hotel-results", { data: ds[name] }))).instance.surfaceId);
    }
    expect(sessions.size).toBe(4);
    expect(all.size).toBe(12);
    for (const id of all) expect(id).toMatch(/^hotel-results-[a-z2-7]{26}-\d+$/);
  });

  it("an externally supplied session id is validated", async () => {
    for (const bad of ["", "s1", "has space", "UPPERCASE0000000", "with-hyphen-000000", "../../etc/passwd", "x".repeat(65)]) {
      await expect(Promise.resolve().then(() => createHost({ session: bad, governor: g, compositions: Object.values(cs) })), bad).rejects.toThrow(/session id/);
    }
    const ok = await createHost({ session: "evidencewalk0001", governor: g, compositions: Object.values(cs) });
    expect(ok.session).toBe("evidencewalk0001");
  });
});

describe("L6: instances are immutable", () => {
  it("a shown instance is deeply frozen and stays the same object after an accepted action", async () => {
    const host = await approvedHost();
    const s = await shown(host.show("hotel-search", { data: {} }));
    expect(Object.isFrozen(s.instance)).toBe(true);
    expect(Object.isFrozen(s.instance.messages[1].updateComponents.components[0])).toBe(true);
    expect(Object.isFrozen(s.instance.inputValues)).toBe(true);
    expect(Object.isFrozen(s.instance.pins)).toBe(true);
    host.act(press(s.instance, "search", 0, VALID));
    expect(host.current()).toBe(s.instance);
    expect(s.instance.inputValues.destination).toBe("");
  });

  it("the host governs its own snapshot of each composition: a later edit by the caller changes nothing", async () => {
    const mine = await load(withMemberNumber());
    const host = await approvedHost({ compositions: mine });
    (mine["hotel-results"]!.actions.find((a) => a.name === "choose")!.payload as any).hotelId = { $prop: "hotel.name" };
    const r = await shown(host.show("hotel-results", { data: ds.three }));
    expect(r.instance.actions.find((a: any) => a.name === "choose").payload).toEqual({ hotelId: ds.three.hotels[0].id });
  });
});

describe("L4: approval integrity, checked synchronously", () => {
  it("an approval not issued by recheck is refused, even with the right pins", async () => {
    const host: any = await createHost({ governor: g, compositions: Object.values(cs) });
    const real = (await recheck(g, cs["hotel-results"]!)).approval!;
    const forged = JSON.parse(JSON.stringify(real));
    expect(host.approve("hotel-results", forged)).toMatchObject({ approved: false });
    expect(await host.show("hotel-results", { data: ds.three })).toMatchObject({ ok: false, refusal: { stage: "needs-recheck" } });
  });

  it("an approval for one composition cannot approve another, and approvals cannot be edited", async () => {
    const host: any = await createHost({ governor: g, compositions: Object.values(cs) });
    const results = (await recheck(g, cs["hotel-results"]!)).approval!;
    expect(host.approve("hotel-search", results)).toMatchObject({ approved: false });
    expect(Object.isFrozen(results)).toBe(true);
    expect(Object.isFrozen(results.pins)).toBe(true);
  });

  it("an action right after approval is judged on current pins, with no window of stale state", async () => {
    const host = await approvedHost();
    const r = await shown(host.show("hotel-results", { data: ds.three }));
    host.setGovernor(await governorFor());
    // The same rules under a new governor object: the pins are the same, so the action is accepted at once.
    expect(host.act(press(r.instance, "choose", 0))).toMatchObject({ accepted: true });
    const edited = contract();
    edited.rules.find((x: any) => x.id === "rule.review-offers-alternatives").rationale += " (edited)";
    const g2 = await governorFor(edited);
    host.setGovernor(g2);
    expect(host.act(press(r.instance, "choose", 0))).toMatchObject({ accepted: false, code: "needs-recheck" });
    host.approve("hotel-results", (await recheck(g2, cs["hotel-results"]!)).approval!);
    const fresh = await shown(host.show("hotel-results", { data: ds.three }));
    expect(host.act(press(fresh.instance, "choose", 0))).toMatchObject({ accepted: true });
  });
});

describe("L2: the toolchain is part of the pins", () => {
  it("an approval made under one emitter or lint version needs a re-check under another", async () => {
    const host = await approvedHost();
    expect((await host.show("hotel-results", { data: ds.three })).ok).toBe(true);
    const upgraded = await createGovernor({ contract: contract(), profileJson: profileJson(), lintSurface: lint, toolchain: { ...TOOLCHAIN, emit: "99.0.0" } } as any);
    expect(upgraded.contractSha256).toBe(g.contractSha256);
    host.setGovernor(upgraded);
    expect(await host.show("hotel-results", { data: ds.three })).toMatchObject({ ok: false, refusal: { stage: "needs-recheck" } });
    const again = await recheck(upgraded, cs["hotel-results"]!);
    expect(again.ok).toBe(true);
    expect(again.approval!.pins.toolchainSha256).not.toBe((await recheck(g, cs["hotel-results"]!)).approval!.pins.toolchainSha256);
  });

  it("a governor needs the versions of the lint and the emitter it runs", async () => {
    await expect(createGovernor({ contract: contract(), profileJson: profileJson(), lintSurface: lint } as any)).rejects.toThrow(/toolchain/);
    await expect(createGovernor({ contract: contract(), profileJson: profileJson(), lintSurface: lint, toolchain: { lint: "0.5.0" } } as any)).rejects.toThrow(/toolchain/);
  });
});

describe("L3: a refused scenario names the rule that must refuse it", () => {
  it("the re-check passes only when that rule is what refused it", async () => {
    const doc = withMemberNumber();
    const one = doc.compositions.find((c: any) => c.id === "hotel-results").scenarios.find((s: any) => s.id === "one");
    one.refusedBy = "rule.option-carries-label";
    const wrong = await load(doc);
    const r = await recheck(g, wrong["hotel-results"]!);
    expect(r.ok).toBe(false);
    expect(r.scenarios.find((s) => s.id === "one")).toMatchObject({ expect: "refused", outcome: "refused", refusedBy: "rule.option-carries-label" });
    expect((await recheck(g, cs["hotel-results"]!)).scenarios.find((s) => s.id === "one")).toMatchObject({ refusedBy: "rule.review-offers-alternatives", matches: true });
  });

  it("a refused scenario without a rule is a load issue", async () => {
    const doc = withMemberNumber();
    delete doc.compositions.find((c: any) => c.id === "hotel-results").scenarios.find((s: any) => s.id === "one").refusedBy;
    const loaded = await loadCompositions(doc, { baseContract: contract() });
    expect(loaded.binding).toBe("invalid");
    expect(loaded.issues.join(" ")).toMatch(/refusedBy/);
  });
});

describe("L1: an exception inside a gate is a refusal, not a rejection", () => {
  it("a lint that throws refuses the instance with its stage", async () => {
    const throwing = await createGovernor({ contract: contract(), profileJson: profileJson(), toolchain: TOOLCHAIN, lintSurface: () => { throw new Error("unknown rule type 'frobnicate'"); } } as any);
    const r = await instantiate(throwing, cs["hotel-results"]!, { surfaceId: "hotel-results-" + "b".repeat(26) + "-1", data: ds.three });
    expect(r).toMatchObject({ ok: false, stage: "lint" });
    if (!r.ok) expect(r.reason).toContain("frobnicate");
  });
});
