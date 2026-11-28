/**
 * Local agent-facing discovery: inclusion and exclusion by the one eligibility gate, evaluated at request time;
 * exact-version resolution through the governed host; withdrawal after discovery; nothing sensitive exposed.
 */
import { setLeadsTo, type CompositionDefinition, type Host } from "@dspack-studio/composer-core/compositions";
import { describe, expect, it } from "vitest";
import { approveVersion, createDraft, editDraft, promoteBlockDraft } from "./authoring";
import { memoryAuthority, sharedMemory } from "./authority";
import { discover, resolve, simulatedAgent, type DiscoveryContext } from "./discovery";
import { interactionIssues, applyInputChange } from "./interaction";
import { checkVersion, governorFor, hostFor, loadLibrary, promotableBlocks, type LoadedLibrary, type VersionCheck } from "./runtime";
import type { KeyValueStore } from "./storage";
import { restoreApproval, withdrawApproval } from "./withdrawal";

process.env.NEXT_PUBLIC_COMPOSER_TOOLCHAIN ??= JSON.stringify({ lint: "0.0.0-test", emit: "0.0.0-test", runtime: "test" });

function memory(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** A Library-like context: one host and check per version, approvals bound to generation 0. */
async function contextFor(loaded: LoadedLibrary, shared = sharedMemory()): Promise<DiscoveryContext & { shared: typeof shared }> {
  const governor = await governorFor();
  const hosts = new Map<string, Host>();
  const checks = new Map<string, VersionCheck>();
  for (const e of loaded.library.entries)
    for (const v of e.versions) {
      const check = await checkVersion(governor, v, null);
      checks.set(`${v.id}@${v.version}`, check);
      hosts.set(`${v.id}@${v.version}`, await hostFor(governor, check));
    }
  return { loaded, hosts, checks, governor, authority: memoryAuthority(shared), approvalGen: new Map([...hosts.keys()].map((k) => [k, shared.record.generation])), shared };
}
const refs = (r: { reference: { composition: string; version: number } }[]) => r.map((x) => `${x.reference.composition}@${x.reference.version}`);

describe("discovery", () => {
  it("returns exactly the eligible approved versions; drafts and Hotel search v1 (needs a safety update) are excluded with their reasons; nothing is published", async () => {
    const ctx = await contextFor(await loadLibrary(memory()));
    const d = await discover(ctx);
    expect(d).toMatchObject({ schema: "composer.local-discovery/1", scope: "local-synthetic", published: false });
    expect(refs(d.eligible)).toEqual(["hotel-results@1"]);
    expect(refs(d.excluded)).toEqual(["hotel-results@2", "hotel-search@1"]);
    expect(d.excluded.find((x) => x.reference.composition === "hotel-search")!.reasons).toEqual([{ kind: "safety", text: "Member number is private, but its field shows what is typed." }]);
    expect(d.excluded.find((x) => x.reference.version === 2)!.reasons.map((r) => r.kind)).toContain("status");
  });

  it("exposes the minimum: reference, title, purpose, data declarations, inputs and actions by name (never values), states and intended transitions, compatibility; examples only when asked", async () => {
    const ctx = await contextFor(await loadLibrary(memory()));
    const [entry] = (await discover(ctx)).eligible;
    expect(entry!.reference).toEqual({ composition: "hotel-results", version: 1, definitionSha256: "232a1fe4fced886cf199eef6fca846cde693cda5071be0b8737e39dfbe0ed913" });
    expect(Object.keys(entry!).sort()).toEqual(["actions", "compatibility", "data", "inputs", "purpose", "reference", "states", "title"]);
    expect(entry!.actions.find((a) => a.name === "choose")).toEqual({ name: "choose", sentFrom: ["ready"], sends: ["hotelId"], carriesInputs: [], consequential: false, intendedNext: [] });
    expect(entry!.actions.find((a) => a.name === "reserve")).toMatchObject({ consequential: true, sentFrom: ["confirm"] });
    expect(entry!.states.map((s) => s.id)).toEqual(["confirm", "empty", "ready"]);
    expect(entry!.compatibility.compositionsSidecar).toBe("0.2");
    // No payload values, no examples: nothing of the synthetic hotels' data is present.
    const text = JSON.stringify(entry);
    expect(text).not.toContain("Casa do Rio");
    expect(text).not.toContain("$prop");
    // Examples only on request, synthetic.
    const withExamples = (await discover(ctx, { examples: true })).eligible[0]!;
    expect(withExamples.examples!.map((e) => e.id)).toContain("three");
  });

  it("a private field is described as private, never with a value", async () => {
    const store = memory();
    let loaded = await loadLibrary(store);
    const governor = await governorFor();
    const made = await createDraft(loaded, "hotel-search", store);
    if (!made.ok) throw new Error(made.reason);
    const fixed = await editDraft(made.loaded, "hotel-search", 2, (d) => applyInputChange(d, interactionIssues(d)[0]!.fix), store);
    if (!fixed.ok) throw new Error(fixed.reason);
    const draft = fixed.loaded.library.get("hotel-search", 2)!;
    const approved = await approveVersion(fixed.loaded, governor, "hotel-search", 2, await checkVersion(governor, draft, store), store);
    if (!approved.ok) throw new Error(approved.reason);
    loaded = approved.loaded;
    const ctx = await contextFor(loaded);
    const entry = (await discover(ctx, { examples: true })).eligible.find((e) => e.reference.composition === "hotel-search")!;
    expect(entry.reference.version).toBe(2);
    expect(entry.inputs.find((i) => i.name === "memberNumber")).toEqual({ name: "memberNumber", kind: "text", required: false, private: true });
    expect(JSON.stringify(entry)).not.toMatch(/memberNumber"\s*:\s*"/);
  });

  it("is evaluated at request time: a withdrawal after discovery removes the exact version, and a reference obtained before is refused", async () => {
    const ctx = await contextFor(await loadLibrary(memory()));
    const before = await discover(ctx);
    const ref = before.eligible[0]!.reference;
    const data = ctx.loaded.library.get("hotel-results", 1)!.scenarios.find((s) => s.id === "three")!.data;
    expect(await resolve(ctx, ref, { data })).toMatchObject({ ok: true, state: "ready" });
    await withdrawApproval({ definition: ctx.loaded.library.get("hotel-results", 1)!, host: ctx.hosts.get("hotel-results@1")!, authority: ctx.authority, origin: "packaged" });
    expect(refs((await discover(ctx)).eligible)).toEqual([]);
    expect(await resolve(ctx, ref, { data })).toMatchObject({ ok: false, code: "ineligible", reasons: [{ kind: "withdrawn" }] });
    // Restoring requires its checks now; then the same exact reference resolves again.
    const restored = await restoreApproval({ governor: ctx.governor, definition: ctx.loaded.library.get("hotel-results", 1)!, host: ctx.hosts.get("hotel-results@1")!, authority: ctx.authority });
    expect(restored.ok).toBe(true);
    if (restored.ok) ctx.approvalGen.set("hotel-results@1", restored.approvalGeneration!);
    expect(await resolve(ctx, ref, { data })).toMatchObject({ ok: true });
  });

  it("resolution is exact: an altered hash or an unknown version is refused, never substituted", async () => {
    const ctx = await contextFor(await loadLibrary(memory()));
    const ref = (await discover(ctx)).eligible[0]!.reference;
    const data = ctx.loaded.library.get("hotel-results", 1)!.scenarios[0]!.data;
    expect(await resolve(ctx, { ...ref, definitionSha256: "0".repeat(64) }, { data })).toMatchObject({ ok: false, code: "altered" });
    expect(await resolve(ctx, { ...ref, version: 7 }, { data })).toMatchObject({ ok: false, code: "unknown", reason: expect.stringContaining("no other version is used") });
    // A draft is never resolved, even by its exact reference.
    const draft = ctx.loaded.library.get("hotel-results", 2)!;
    const draftRef = (await discover(ctx)).excluded.find((x) => x.reference.version === 2)!.reference;
    expect(await resolve(ctx, draftRef, { data: draft.scenarios[0]!.data })).toMatchObject({ ok: false, code: "ineligible" });
  });

  it("resolution goes through the governed pipeline: data that breaks a design rule is refused by the rule, not rendered", async () => {
    const ctx = await contextFor(await loadLibrary(memory()));
    const ref = (await discover(ctx)).eligible[0]!.reference;
    const one = ctx.loaded.library.get("hotel-results", 1)!.scenarios.find((s) => s.id === "one")!.data;
    expect(await resolve(ctx, ref, { data: one })).toMatchObject({ ok: false, code: "refused" });
  });

  it("an unresolved promoted composition is excluded; once resolved and approved it is discoverable", async () => {
    const store = memory();
    const governor = await governorFor();
    const block = (await promotableBlocks()).find((b) => b.id === "auth-form")!;
    const p = await promoteBlockDraft(await loadLibrary(store), block, "Astryx", store);
    if (!p.ok) throw new Error(p.reason);
    let ctx = await contextFor(p.loaded);
    const excluded = (await discover(ctx)).excluded.find((x) => x.reference.composition === "auth-form")!;
    expect(excluded.reasons.map((r) => r.kind)).toEqual(expect.arrayContaining(["status", "promotion"]));
    // Resolve it as the promotion walkthrough does, then approve.
    const { removeNode } = await import("@dspack-studio/composer-core/compositions");
    const { applyActionChange } = await import("./interaction");
    const { applyInsert } = await import("./template-editing");
    const keyOf = (t: any, test: (x: any) => boolean): string => {
      const find = (n: any, path: string): string | null => {
        for (const [i, ch] of ((n.children ?? []) as any[]).entries()) {
          const q = path ? `${path}.${i}` : String(i);
          if (test(ch)) return `data-collection@${q}`;
          const deeper = find(ch, q);
          if (deeper) return deeper;
        }
        return null;
      };
      return find(t, "")!;
    };
    let loaded = p.loaded;
    const edit = async (f: (d: CompositionDefinition) => void) => {
      const r = await editDraft(loaded, "auth-form", 1, f, store);
      if (!r.ok) throw new Error(r.reason);
      loaded = r.loaded;
    };
    await edit((d) => applyActionChange(d, { op: "declare", node: "auth-submit" }));
    await edit((d) => void removeNode(d, "data-collection", keyOf(d.states[0]!.template, (x) => x.$if === "recovery")));
    await edit((d) => void removeNode(d, "data-collection", keyOf(d.states[0]!.template, (x) => x.$each === "providers")));
    for (const label of ["Email address", "Password"]) await edit((d) => void applyInsert(d, { stateId: "data-collection", at: { key: "#auth-submit", position: "before" }, component: "text-input", label }));
    await edit((d) => void removeNode(d, "data-collection", keyOf(d.states[0]!.template, (x) => x.$each === "fields")));
    const pw = loaded.library.get("auth-form", 1)!.inputs.find((i) => i.node === "password")!;
    await edit((d) => applyInputChange(d, { op: "update", name: pw.name, patch: { sensitive: true } }));
    const draft = loaded.library.get("auth-form", 1)!;
    const approved = await approveVersion(loaded, governor, "auth-form", 1, await checkVersion(governor, draft, store), store);
    if (!approved.ok) throw new Error(approved.reason);
    ctx = await contextFor(approved.loaded);
    const found = (await discover(ctx)).eligible.find((e) => e.reference.composition === "auth-form")!;
    expect(found.inputs.find((i) => i.name === pw.name)).toMatchObject({ private: true });
  });

  it("intended transitions are exposed as intent; the simulated agent resolves deterministically, with no model", async () => {
    const store = memory();
    const governor = await governorFor();
    let loaded = await loadLibrary(store);
    const e = await editDraft(loaded, "hotel-results", 2, (d) => void setLeadsTo(d, "choose", ["confirm"]), store);
    if (!e.ok) throw new Error(e.reason);
    const draft = e.loaded.library.get("hotel-results", 2)!;
    const a = await approveVersion(e.loaded, governor, "hotel-results", 2, await checkVersion(governor, draft, store), store);
    if (!a.ok) throw new Error(a.reason);
    loaded = a.loaded;
    const ctx = await contextFor(loaded);
    const v2 = (await discover(ctx)).eligible.find((x) => x.reference.version === 2)!;
    expect(v2.actions.find((x) => x.name === "choose")!.intendedNext).toEqual(["confirm"]);
    expect(v2.compatibility.compositionsSidecar).toBe("0.3");
    const run = await simulatedAgent(ctx, { composition: "hotel-results" });
    expect(run.chosen).toMatchObject({ composition: "hotel-results" });
    expect(run.resolution).toMatchObject({ ok: true });
  });
});
