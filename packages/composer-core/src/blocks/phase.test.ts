/**
 * The block phase (Phase 1A, commit 3): one call budget shared by block and
 * surface calls, a bounded block repair, expansion checked before the
 * pipeline, and an immutable trace on every path. Provider-neutral: the
 * adapter, the classifier, the linter and the error factory are injected.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { loadProfile, type Profile } from "@aestheticfunction/dspack-emit";
import {
  blockRepairMessage,
  budgetedInner,
  createBudget,
  expandBlock,
  expansionDigest,
  parseBlocksSidecar,
  preloadedAdapter,
  reconcileBlockTrace,
  runBlockPhase,
  scriptedBlockScript,
  type BlockDefinition,
  type BlocksSidecar,
  type ErrorKind,
  type GenerateContext,
  type StructuralAdapter,
} from "./index";
import type { ModelCallRecord } from "../usage";

type Json = Record<string, any>;
const repo = (rel: string) => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));
const json = (rel: string) => JSON.parse(readFileSync(repo(rel), "utf8")) as Json;

const contract = json("apps/composer/astryx-project/astryx.dspack.json");
const profile = loadProfile(json("apps/composer/astryx-project/astryx.profile.json") as never) as Profile;
const parsed = parseBlocksSidecar(json("apps/composer/experimental/blocks/astryx.blocks.json"));
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
const sidecar: BlocksSidecar = parsed.sidecar;
const authForm = sidecar.blocks.find((b) => b.id === "auth-form")!;
const signUp = authForm.examples[0]!;

/** A typed test error: the classifier reads `kind`; `makeError` mints the same shape. */
class TestAdapterError extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = "TestAdapterError";
  }
}
const deps = {
  classify: (error: unknown): ErrorKind => (error instanceof TestAdapterError ? (error.kind as ErrorKind) : "unknown"),
  makeError: (kind: string, message: string) => new TestAdapterError(kind, message),
  /** A stub linter: S1 fails on a root with no component; S2 on a component the contract lacks; S3 never. */
  lint: (surface: unknown) => {
    const root = (surface as Json)?.root as Json | undefined;
    const components = new Set(Object.keys(contract.components));
    const unknown: string[] = [];
    const walk = (n: Json | undefined) => {
      if (!n) return;
      if (!components.has(String(n.component))) unknown.push(String(n.component));
      for (const c of (n.children ?? []) as Json[]) walk(c);
    };
    walk(root);
    const gates = [
      { gate: "S1", status: root?.component ? "PASS" : "FAIL", errors: root?.component ? [] : ["root has no component"] },
      { gate: "S2", status: unknown.length ? "FAIL" : "PASS", errors: unknown.map((u) => `unknown component '${u}'`) },
      { gate: "S3", status: "PASS", errors: [] },
    ];
    return { pass: gates.every((g) => g.status === "PASS"), gates };
  },
};

/** An adapter that plays a script: each entry is a JSON output, or an error to throw. */
function scripted(entries: Array<Json | Error>, calls: Array<{ request: Json; context?: GenerateContext }> = []): StructuralAdapter {
  let cursor = 0;
  return {
    id: "test:scripted",
    async generate(request, context) {
      calls.push({ request, ...(context ? { context } : {}) });
      const entry = entries[cursor++];
      if (!entry) throw new Error(`script exhausted after ${entries.length}`);
      if (entry instanceof Error) throw entry;
      return { json: entry, raw: JSON.stringify(entry), model: "test-model", usage: { inputTokens: 100, outputTokens: 10 } };
    },
  };
}

/** The phase always runs over a BUDGETED adapter: the wrapper spends, the phase reads. */
const phaseInput = (raw: StructuralAdapter, budget = createBudget(3), extra: Json = {}) => ({
  block: authForm,
  intent: signUp.intent,
  goal: signUp.prompt,
  reference: sidecar.reference,
  contract,
  profile,
  inner: budgetedInner(raw, budget, deps),
  budget,
  deps,
  ...extra,
});

describe("createBudget and budgetedInner", () => {
  it("counts every provider call, and refuses to call past the limit with a typed error, never a plain Error", async () => {
    const budget = createBudget(2);
    const inner = budgetedInner(scripted([{ a: 1 }, { a: 2 }, { a: 3 }]), budget, deps);
    await inner.generate({ system: "", messages: [], jsonSchema: {} });
    await inner.generate({ system: "", messages: [], jsonSchema: {} });
    expect(budget.used).toBe(2);
    const error = await inner.generate({ system: "", messages: [], jsonSchema: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TestAdapterError);
    expect((error as TestAdapterError).kind).toBe("budget");
    expect(budget.used).toBe(2);
  });

  it("re-issues an unusable output ONCE when budget remains, marking the re-issue, and counts both calls", async () => {
    const calls: Array<{ request: Json; context?: GenerateContext }> = [];
    const budget = createBudget(3);
    const inner = budgetedInner(scripted([new TestAdapterError("output", "prose"), { ok: true }], calls), budget, deps);
    const out = await inner.generate({ system: "s", messages: [], jsonSchema: {} }, { operation: "block" });
    expect(out.json).toEqual({ ok: true });
    expect(budget.used).toBe(2);
    expect(calls.map((c) => c.context)).toEqual([{ operation: "block" }, { operation: "block", reissue: true }]);
    expect(calls[1]!.request).toBe(calls[0]!.request); // the identical request
  });

  it("a second unusable output is thrown as it is; with no budget left, the first one is", async () => {
    const twice = budgetedInner(scripted([new TestAdapterError("output", "one"), new TestAdapterError("output", "two")]), createBudget(3), deps);
    await expect(twice.generate({ system: "", messages: [], jsonSchema: {} })).rejects.toThrow("two");
    const spent = createBudget(1);
    const once = budgetedInner(scripted([new TestAdapterError("output", "one"), { never: true }]), spent, deps);
    await expect(once.generate({ system: "", messages: [], jsonSchema: {} })).rejects.toThrow("one");
    expect(spent.used).toBe(1);
  });

  it.each(["provider", "policy", "unknown"])("a %s failure is never re-issued", async (kind) => {
    const calls: Array<{ request: Json; context?: GenerateContext }> = [];
    const inner = budgetedInner(scripted([new TestAdapterError(kind, "down"), { never: true }], calls), createBudget(3), deps);
    await expect(inner.generate({ system: "", messages: [], jsonSchema: {} })).rejects.toThrow("down");
    expect(calls).toHaveLength(1);
  });
});

describe("preloadedAdapter", () => {
  it("answers attempt 0 with the expansion and no call; later attempts go to the inner adapter", async () => {
    const expanded = expandBlock(authForm, signUp.call, { reference: sidecar.reference, intent: signUp.intent });
    if (!expanded.ok) throw new Error(expanded.message);
    const calls: Array<{ request: Json; context?: GenerateContext }> = [];
    const adapter = preloadedAdapter(expanded.surface, scripted([{ repaired: true }], calls), { mirror: true });
    const first = await adapter.generate({ system: "", messages: [], jsonSchema: {} });
    expect(first.json).toBe(expanded.surface);
    expect(first.raw).toBe(JSON.stringify(expanded.surface));
    expect(first.meta).toEqual({ blockTrace: { mirror: true } });
    expect(calls).toHaveLength(0);
    const second = await adapter.generate({ system: "", messages: [{ role: "user", content: "fix" }], jsonSchema: {} });
    expect(second.json).toEqual({ repaired: true });
    expect(calls).toHaveLength(1);
  });
});

describe("runBlockPhase", () => {
  it("a valid call expands: one provider call, a trace with the digest, and the expansion attempt index", async () => {
    const calls: Array<{ request: Json; context?: GenerateContext }> = [];
    const budget = createBudget(3);
    const result = await runBlockPhase(phaseInput(scripted([signUp.call], calls), budget));
    expect(result.kind).toBe("expanded");
    if (result.kind !== "expanded") return;
    expect(budget.used).toBe(1);
    expect(result.trace.outcome).toBe("block");
    expect(result.trace.providerCalls).toBe(1);
    expect(result.trace.expansionAttemptIndex).toBe(0);
    expect(result.trace.expansionDigest).toBe(await expansionDigest(result.surface));
    expect(result.trace.attempts).toHaveLength(1);
    expect(result.trace.attempts[0]).toMatchObject({ index: 0, outcome: "ok", b1: [], b2: [], inputTokens: 100, outputTokens: 10 });
    expect(result.trace.attempts[0]!.rawText).toBe(JSON.stringify(signUp.call));
    expect(result.trace.rawIsExpansion).toBe(true);
    expect(result.trace.blockSchemaSha256).toMatch(/^[0-9a-f]{64}$/);
    // The request: the block's schema only, the goal as the user message, a context naming the operation.
    expect(calls[0]!.context).toEqual({ operation: "block" });
    expect(calls[0]!.request.jsonSchema.properties).toHaveProperty("mode");
    expect(calls[0]!.request.jsonSchema).not.toHaveProperty("$defs");
    expect(calls[0]!.request.messages).toEqual([{ role: "user", content: signUp.prompt }]);
    expect(calls[0]!.request.system).toContain(authForm.summary);
  });

  it("an invalid call gets ONE feedback repair naming the issue, then expands", async () => {
    const calls: Array<{ request: Json; context?: GenerateContext }> = [];
    const bad = { ...signUp.call, mode: "sign-ip" };
    const result = await runBlockPhase(phaseInput(scripted([bad, signUp.call], calls)));
    expect(result.kind).toBe("expanded");
    expect(result.trace.providerCalls).toBe(2);
    expect(result.trace.attempts[0]).toMatchObject({ index: 0, outcome: "invalid" });
    expect(result.trace.attempts[0]!.b1[0]!.path).toBe("$.mode");
    expect(result.trace.expansionAttemptIndex).toBe(1);
    expect(calls[1]!.context).toEqual({ operation: "block-repair" });
    const messages = calls[1]!.request.messages as Array<{ role: string; content: string }>;
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[1]!.content).toBe(JSON.stringify(bad));
    expect(messages[2]!.content).toBe(blockRepairMessage(result.trace.attempts[0]!.b1));
    expect(messages[2]!.content).toContain("mode");
  });

  it("a constraint failure is B2, repaired the same way", async () => {
    const bad = { ...signUp.call, mode: "reset", fields: ["password"] };
    const result = await runBlockPhase(phaseInput(scripted([bad, signUp.call])));
    expect(result.kind).toBe("expanded");
    expect(result.trace.attempts[0]!.b1).toEqual([]);
    expect(result.trace.attempts[0]!.b2.length).toBeGreaterThan(0);
  });

  it("two invalid calls fall back, classified invalid-call, with both calls counted", async () => {
    const bad = { ...signUp.call, mode: "sign-ip" };
    const budget = createBudget(3);
    const result = await runBlockPhase(phaseInput(scripted([bad, bad]), budget));
    expect(result.kind).toBe("fallback");
    if (result.kind !== "fallback") return;
    expect(result.classification).toBe("invalid-call");
    expect(result.trace.outcome).toBe("fallback");
    expect(result.trace.fallback).toEqual({ reason: expect.stringMatching(/mode/), classification: "invalid-call" });
    expect(budget.used).toBe(2);
  });

  it("a provider failure ends the phase at once: the error is kept, nothing more is called", async () => {
    const calls: Array<{ request: Json; context?: GenerateContext }> = [];
    const error = new TestAdapterError("provider", "gateway down");
    const budget = createBudget(3);
    const result = await runBlockPhase(phaseInput(scripted([error, signUp.call], calls), budget));
    expect(result.kind).toBe("provider-failure");
    if (result.kind !== "provider-failure") return;
    expect(result.error).toBe(error);
    expect(result.classification).toBe("provider");
    expect(result.trace.outcome).toBe("provider-failure");
    expect(result.trace.attempts[0]).toMatchObject({ index: 0, outcome: "provider-error" });
    expect(calls).toHaveLength(1);
    expect(budget.used).toBe(1);
  });

  it("an unclassifiable error (a plain Error) is treated as a provider failure, never rethrown", async () => {
    const result = await runBlockPhase(phaseInput(scripted([new Error("boom")])));
    expect(result.kind).toBe("provider-failure");
    if (result.kind === "provider-failure") expect(result.classification).toBe("unknown");
  });

  it("a provider failure on the block REPAIR keeps the first attempt's record and classification", async () => {
    const bad = { ...signUp.call, mode: "sign-ip" };
    const result = await runBlockPhase(phaseInput(scripted([bad, new TestAdapterError("policy", "rate limited")])));
    expect(result.kind).toBe("provider-failure");
    if (result.kind !== "provider-failure") return;
    expect(result.classification).toBe("policy");
    expect(result.trace.attempts.map((a) => a.outcome)).toEqual(["invalid", "provider-error"]);
    expect(result.trace.providerCalls).toBe(2);
  });

  it("a refinement: the prior goal, the prior call and the change are the messages; the sentinel falls back visibly", async () => {
    const calls: Array<{ request: Json }> = [];
    const seed = { priorGoal: signUp.prompt, priorCall: signUp.call };
    const result = await runBlockPhase(
      phaseInput(scripted([{ unsupported: true, reason: "a date picker is not in this block" }], calls), createBudget(3), { goal: "add a date of birth picker", seed }),
    );
    expect(result.kind).toBe("fallback");
    if (result.kind !== "fallback") return;
    expect(result.classification).toBe("unsupported-refinement");
    expect(result.reason).toBe("a date picker is not in this block");
    const messages = calls[0]!.request.messages as Array<{ role: string; content: string }>;
    expect(messages).toEqual([
      { role: "user", content: signUp.prompt },
      { role: "assistant", content: JSON.stringify(signUp.call) },
      { role: "user", content: "add a date of birth picker" },
    ]);
    expect(calls[0]!.request.jsonSchema.anyOf).toHaveLength(2);
    expect(result.trace.attempts[0]!.outcome).toBe("unsupported");
    expect(result.trace.refinement).toEqual({ applied: true });
  });

  it("a refinement answered with a revised call expands as usual", async () => {
    const revised = { ...signUp.call, title: "Create your free account" };
    const result = await runBlockPhase(phaseInput(scripted([revised]), createBudget(3), { goal: "make the title warmer", seed: { priorGoal: signUp.prompt, priorCall: signUp.call } }));
    expect(result.kind).toBe("expanded");
    if (result.kind === "expanded") expect((result.surface.root as Json).children[0].text).toBe("Create your free account");
  });

  it("an expansion that fails S2 is an invariant failure: zero further calls, the reasons kept", async () => {
    const defective: BlockDefinition = { ...authForm, template: { component: "card", id: "c", children: [{ component: "not-a-component", id: "x" }] } as never };
    const budget = createBudget(3);
    const result = await runBlockPhase(phaseInput(scripted([signUp.call, signUp.call]), budget, { block: defective }));
    expect(result.kind).toBe("invariant-failure");
    if (result.kind !== "invariant-failure") return;
    expect(result.reasons.join(" ")).toMatch(/S2.*not-a-component/);
    expect(result.trace.outcome).toBe("invariant-failure");
    expect(result.trace.invariant).toEqual(result.reasons);
    expect(budget.used).toBe(1);
  });

  it("an expansion the emitter refuses is an invariant failure", async () => {
    const defective: BlockDefinition = { ...authForm, template: { component: "card", id: "c" } as never };
    const result = await runBlockPhase(phaseInput(scripted([signUp.call]), createBudget(3), { block: defective }));
    expect(result.kind).toBe("invariant-failure");
    if (result.kind === "invariant-failure") expect(result.reasons.join(" ")).toMatch(/emit/i);
  });

  it("an expansion dispatching an undeclared action is an invariant failure (B2 on the expansion)", async () => {
    const defective: BlockDefinition = { ...authForm, actions: authForm.actions.filter((a) => a !== "auth_submit") };
    const result = await runBlockPhase(phaseInput(scripted([signUp.call]), createBudget(3), { block: defective }));
    expect(result.kind).toBe("invariant-failure");
    if (result.kind === "invariant-failure") expect(result.reasons.join(" ")).toMatch(/auth_submit/);
  });

  it("an expansion that fails S3 only is still expanded: that is the pipeline's repair to make", async () => {
    const s3Only = { ...deps, lint: () => ({ pass: false, gates: [{ gate: "S1", status: "PASS", errors: [] }, { gate: "S2", status: "PASS", errors: [] }, { gate: "S3", status: "FAIL", errors: [] }] }) };
    const result = await runBlockPhase(phaseInput(scripted([signUp.call]), createBudget(3), { deps: s3Only }));
    expect(result.kind).toBe("expanded");
  });

  it("the trace is frozen", async () => {
    const result = await runBlockPhase(phaseInput(scripted([signUp.call])));
    expect(Object.isFrozen(result.trace)).toBe(true);
    expect(Object.isFrozen(result.trace.attempts)).toBe(true);
  });
});

describe("reconcileBlockTrace", () => {
  it("merges the trace, the recorder and the report into one accounting", async () => {
    const result = await runBlockPhase(phaseInput(scripted([{ ...signUp.call, mode: "sign-ip" }, signUp.call])));
    const recorded: ModelCallRecord[] = [
      { operation: "block", attempt: 0, source: "provider", inputTokens: 100, outputTokens: 10, outcome: "ok" },
      { operation: "block-repair", attempt: 1, source: "provider", inputTokens: 120, outputTokens: 10, outcome: "ok" },
      { operation: "repair", attempt: 1, subCall: 0, source: "provider", inputTokens: 9000, outputTokens: 30, outcome: "unusable-output" },
      { operation: "repair", attempt: 1, subCall: 1, source: "provider", inputTokens: 9000, outputTokens: 400, outcome: "ok" },
    ];
    const report = { generation: { maxRepairs: 1 }, attempts: [{ index: 0 }, { index: 1, usage: { inputTokens: 18000, outputTokens: 430 } }], outcome: "passed" };
    const merged = reconcileBlockTrace(result.trace, report, recorded);
    expect(merged.calls).toEqual({ block: 2, surface: 2, total: 4, reissues: 1 });
    expect(merged.budgetExceeded).toBe(true);
    expect(merged.consistent).toBe(true);
    expect(merged.pathLabel).toBe("block-repair");
  });

  it("names the path: block, block-repair, fallback", async () => {
    const direct = await runBlockPhase(phaseInput(scripted([signUp.call])));
    expect(reconcileBlockTrace(direct.trace, undefined, []).pathLabel).toBe("block");
    const bad = { ...signUp.call, mode: "sign-ip" };
    const fallen = await runBlockPhase(phaseInput(scripted([bad, bad])));
    expect(reconcileBlockTrace(fallen.trace, undefined, []).pathLabel).toBe("fallback");
  });
});

describe("scriptedBlockScript (the deterministic twin for block mode)", () => {
  it("a fresh run plays the block's example call for the intent", async () => {
    const adapter = scriptedBlockScript(authForm, signUp.intent, "a sign-up form");
    const out = await adapter.generate({ system: "", messages: [], jsonSchema: {} });
    expect(out.json).toEqual(signUp.call);
    expect(adapter.id).toBe("fake:scripted");
    expect(out.meta).toEqual({ provider: "fake" });
  });

  it("a content-only refinement mutates one string slot monotonically", async () => {
    const once = await scriptedBlockScript(authForm, signUp.intent, "make the title clearer", { priorGoal: "x", priorCall: signUp.call }).generate({ system: "", messages: [], jsonSchema: {} });
    expect((once.json as Json).title).toBe(`${signUp.call.title} (refined)`);
    const twice = await scriptedBlockScript(authForm, signUp.intent, "make it clearer", { priorGoal: "x", priorCall: once.json as Json }).generate({ system: "", messages: [], jsonSchema: {} });
    expect((twice.json as Json).title).toBe(`${signUp.call.title} (refined 2)`);
  });

  it("a structural change answers with the unsupported sentinel", async () => {
    const out = await scriptedBlockScript(authForm, signUp.intent, "add a phone number field", { priorGoal: "x", priorCall: signUp.call }).generate({ system: "", messages: [], jsonSchema: {} });
    expect(out.json).toMatchObject({ unsupported: true });
  });
});
