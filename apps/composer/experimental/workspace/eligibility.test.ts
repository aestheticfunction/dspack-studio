/**
 * Agent eligibility (safeguards R4): one gate, evaluated when asked, never stored. A historical approval never
 * exempts a version from the current sensitive-data rules; a withdrawal, a stale approval, a rule change, an
 * unavailable authority, an unresolved promotion or an unreached intended state each makes a version ineligible.
 */
import { compositionPins, setLeadsTo } from "@dspack-studio/composer-core/compositions";
import { describe, expect, it } from "vitest";
import { approveVersion, editDraft } from "./authoring";
import { memoryAuthority, sharedMemory, unavailableAuthority } from "./authority";
import { agentEligibility } from "./eligibility";
import { applyInputChange, interactionIssues } from "./interaction";
import { checkVersion, governorFor, hostFor, loadLibrary } from "./runtime";
import type { KeyValueStore } from "./storage";
import { restoreApproval, withdrawApproval } from "./withdrawal";

process.env.NEXT_PUBLIC_COMPOSER_TOOLCHAIN ??= JSON.stringify({ lint: "0.0.0-test", emit: "0.0.0-test", runtime: "test" });

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

async function context(id: string, version: number) {
  const store = memory();
  const governor = await governorFor();
  const loaded = await loadLibrary(store);
  const definition = loaded.library.get(id, version)!;
  const check = await checkVersion(governor, definition, store);
  const host = await hostFor(governor, check);
  const shared = sharedMemory();
  const authority = memoryAuthority(shared);
  const ask = async (over: Partial<Parameters<typeof agentEligibility>[0]> = {}) =>
    agentEligibility({ definition, host, check, governor, authority, record: shared.record, approvalGeneration: 0, promotionBlockers: [], ...over });
  return { store, governor, loaded, definition, check, host, shared, authority, ask };
}

describe("agent eligibility", () => {
  it("Hotel results v1: approved, checked under the current rules, nothing withdrawn: eligible, and that is not publication", async () => {
    const { ask } = await context("hotel-results", 1);
    const e = await ask();
    expect(e).toMatchObject({ eligible: true, reasons: [] });
    expect(e.headline).toContain("Not published");
  });

  it("Hotel search v1 stays byte-identical and usable in preview, but needs a safety update before agents can use it", async () => {
    const { ask, definition, host } = await context("hotel-search", 1);
    expect((await compositionPins(definition)).compositionSha256).toBe("856b491b237bb451b422ff33d04af2cdd04b71f9de08b4f16b27ecd3c130e4f8");
    const e = await ask();
    expect(e.eligible).toBe(false);
    expect(e.headline).toBe("Needs a safety update before agents can use it.");
    expect(e.reasons).toEqual([{ kind: "safety", text: "Member number is private, but its field shows what is typed." }]);
    // Still previewed in the Library.
    expect((await host.show("hotel-search", { data: definition.scenarios[0]!.data })).ok).toBe(true);
  });

  it("is never stored: a withdrawal makes it ineligible at once, a restoration elsewhere leaves this tab stale until it checks", async () => {
    const { ask, definition, host, governor, authority, shared } = await context("hotel-results", 1);
    await withdrawApproval({ definition, host, authority, origin: "packaged" });
    expect((await ask({ record: shared.record })).reasons.map((r) => r.kind)).toEqual(["withdrawn"]);
    // Another tab restores it: this tab's approval (generation 0) is older than the withdrawal.
    const other = await hostFor(governor, await checkVersion(governor, definition, null));
    other.withdraw(definition.id);
    const restored = await restoreApproval({ governor, definition, host: other, authority });
    expect(restored.ok).toBe(true);
    // This tab's host is still withdrawn.
    expect((await ask({ record: shared.record })).reasons.map((r) => r.kind)).toEqual(["stale"]);
    expect((await ask({ record: shared.record, host: undefined })).reasons.map((r) => r.kind)).toEqual(["stale"]);
    expect(await ask({ record: shared.record, host: other, approvalGeneration: restored.ok ? restored.approvalGeneration : -1 })).toMatchObject({ eligible: true });
  });

  it("a rule change, an unavailable authority, a draft, an unresolved promotion or an unreached intended state each make it ineligible", async () => {
    const { ask, definition, loaded } = await context("hotel-results", 1);
    const stricter = await governorFor("four-options");
    expect((await ask({ governor: stricter })).reasons.map((r) => r.kind)).toEqual(["checks"]);
    expect((await ask({ authority: unavailableAuthority("no IndexedDB") })).reasons.map((r) => r.kind)).toEqual(["authority"]);
    expect((await ask({ promotionBlockers: ["The block's “x” action is not mapped."] })).reasons.map((r) => r.kind)).toEqual(["promotion"]);
    const intent = structuredClone(definition);
    setLeadsTo(intent, "choose", ["confirm"]);
    intent.scenarios = intent.scenarios.filter((s) => s.id !== "confirm");
    expect((await ask({ definition: intent, check: undefined })).reasons.map((r) => r.kind)).toEqual(["checks", "intent"]);
    const draft = loaded.library.get("hotel-results", 2)!;
    expect((await ask({ definition: draft, check: undefined })).reasons.map((r) => r.kind)).toEqual(["status"]);
  });
});

describe("sensitive-data rules (R4)", () => {
  it("a field drawn as a password but not private blocks a new approval until corrected", async () => {
    const store = memory();
    const governor = await governorFor();
    let loaded = await loadLibrary(store);
    // Draw Hotel results v2's destination field as a password, without making it private.
    let r = await editDraft(loaded, "hotel-results", 2, (d) => {
      const visit = (n: any) => {
        if (n?.id === "new-destination") n.props = { ...n.props, type: "password" };
        for (const c of n?.children ?? []) visit(c);
      };
      d.states.forEach((s) => visit(s.template));
    }, store);
    if (!r.ok) throw new Error(r.reason);
    loaded = r.loaded;
    let draft = loaded.library.get("hotel-results", 2)!;
    expect(interactionIssues(draft)).toEqual([expect.objectContaining({ node: "new-destination", fixLabel: "Make it private", text: expect.stringContaining("drawn as a password but is not private") })]);
    let check = await checkVersion(governor, draft, store);
    expect(check.approval).not.toBeNull();
    expect(await approveVersion(loaded, governor, "hotel-results", 2, check, store)).toMatchObject({ ok: false, reason: expect.stringContaining("drawn as a password") });
    // Corrected through its own fix: private, and still masked. Then it can be approved.
    r = await editDraft(loaded, "hotel-results", 2, (d) => applyInputChange(d, interactionIssues(draft)[0]!.fix), store);
    if (!r.ok) throw new Error(r.reason);
    loaded = r.loaded;
    draft = loaded.library.get("hotel-results", 2)!;
    expect(interactionIssues(draft)).toEqual([]);
    check = await checkVersion(governor, draft, store);
    expect((await approveVersion(loaded, governor, "hotel-results", 2, check, store)).ok).toBe(true);
  });

  it("a private value is redacted from anything recorded", async () => {
    const { host } = await context("hotel-search", 1);
    const event = { name: "search", surfaceId: "s", sourceComponentId: "search", context: { memberNumber: "1234-5678", destination: "Lisbon" } };
    expect(host.redact(event).context).toEqual({ memberNumber: "[sensitive]", destination: "Lisbon" });
  });
});
