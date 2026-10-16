/**
 * The experimental block runtime (Phase 1A, commit 5): the one app module
 * that imports block code and the sidecars, reached only through the
 * literal-guarded dynamic import. These tests run it against the real
 * pipeline, linter and emitter with `fetch` stubbed, and count every POST.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCallRecorder, foldBuildEvents, planDeterministic } from "@dspack-studio/composer-core";
import { REFERENCES } from "../app/demo-data";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BlocksBetaSwitch } from "@dspack-studio/composer-core/blocks";
import { blockBinding, blockContext, blockRunFor, chooseBlock, planGoalWithBlocks, readBlocksBeta, runHostedBlockBuild, type BlockContext } from "./blocks-runtime";

type Json = Record<string, any>;

const astryx = REFERENCES.astryx;
const reference = { kind: "reference" as const, referenceId: "astryx" };
const ALL_BLOCKS = ["records-table", "auth-form", "guide-steps"];
/** Every known reference and block on: the switch the existing cases run under, so they test eligibility alone. */
const ON_ALL: BlocksBetaSwitch = { state: "on", references: ["shadcn", "astryx"], blocks: ALL_BLOCKS };
/** The owner's beta switch (Astryx only, every approved block). */
const OWNER: BlocksBetaSwitch = { state: "on", references: ["astryx"], blocks: ALL_BLOCKS };
const contextFor = (overrides: Json = {}) =>
  blockContext({ mode: "demo", source: reference, inBrowser: true, contract: astryx.contract as Json, profile: astryx.profile as Json, disabled: new Set(), beta: ON_ALL, ...overrides });

/** A fetch stub that records every POST body and answers from a script. */
function stubFetch(script: Array<(body: Json, n: number) => Response>) {
  const bodies: Json[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Json;
      bodies.push(body);
      const step = script[Math.min(bodies.length - 1, script.length - 1)]!;
      return step(body, bodies.length - 1);
    }),
  );
  return bodies;
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const okCall = (json: unknown) => reply(200, { json, raw: JSON.stringify(json), model: "m", usage: { inputTokens: 100, outputTokens: 10 }, calls: [{ inputTokens: 100, outputTokens: 10, outcome: "ok", durationMs: 1 }] });
const providerDown = () => reply(502, { error: "provider-unavailable", cause: "provider", message: "down", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 1 }] });

afterEach(() => vi.unstubAllGlobals());

async function run(ctx: BlockContext, runSpec: NonNullable<Awaited<ReturnType<typeof blockRunFor>>>, modelRef: "hosted-ai" | "scripted", extra: Json = {}) {
  const events: Json[] = [];
  const recorder = createCallRecorder();
  await runHostedBlockBuild({
    run: runSpec,
    input: { path: "test", prompt: "a sign-up form", intent: runSpec.intent, modelRef, ...extra },
    intent: runSpec.intent,
    modelRef,
    refinement: !!extra.conversation,
    reference: { contract: ctx.base!.contract, profile: ctx.base!.loadedProfile },
    recorder,
    emit: (e) => events.push(e),
  });
  return { events, recorder, progress: foldBuildEvents(events) };
}

describe("blockContext: eligibility at the real seams", () => {
  it("a reference project on its unedited base, in the browser, is offered every usable block", async () => {
    const ctx = await contextFor();
    expect(ctx.reason).toBeNull();
    expect(ctx.offered.map((b) => b.id)).toEqual(["records-table", "auth-form", "guide-steps"]);
    expect(ctx.referenceId).toBe("astryx");
  });

  it.each([
    ["an imported project", { source: { kind: "imported" } }, "imported-project"],
    ["a repository project", { source: { kind: "agent", path: "/x" } }, "repository-project"],
    ["a local model", { inBrowser: false }, "local-model"],
    ["an edited contract", { contract: { ...(astryx.contract as Json), intents: [...(astryx.contract as Json).intents, { id: "x", description: "y" }] } }, "contract-edited"],
    ["an edited profile", { profile: { ...(astryx.profile as Json), catalogTitle: "Edited" } }, "profile-edited"],
    ["no project", { source: null }, "no-project"],
  ])("%s is offered none", async (_name, overrides, reason) => {
    const ctx = await contextFor(overrides);
    expect(ctx.offered).toEqual([]);
    expect(ctx.reason).toBe(reason);
  });

  it("a block disabled for the session is withheld; accepted examples do not count as an edit", async () => {
    const live = { ...(astryx.contract as Json), examples: [...(astryx.contract as Json).examples, { id: "ex.chat-1", intent: "data-collection", surface: {} }] };
    const ctx = await contextFor({ contract: live, disabled: new Set(["auth-form"]) });
    expect(ctx.offered.map((b) => b.id)).toEqual(["records-table", "guide-steps"]);
  });
});

describe("choosing and deciding the block run", () => {
  it("scripted: the deterministic selector on the FINAL intent; hosted: the planner's answer re-checked", async () => {
    const ctx = await contextFor();
    const scripted = chooseBlock({ ctx, plan: planDeterministic("a sign-up form with email and password", astryx.contract as Json), intent: "data-collection", modelRef: "scripted", goal: "a sign-up form with email and password" });
    expect(scripted).toMatchObject({ id: "auth-form", source: "deterministic" });
    const hosted = chooseBlock({ ctx, plan: { ...planDeterministic("x", astryx.contract as Json), block: { id: "auth-form", reason: "r", source: "model" } }, intent: "record-collection", modelRef: "hosted-ai", goal: "x" });
    expect(hosted).toMatchObject({ id: null, rejected: "auth-form" });
    const omitted = chooseBlock({ ctx, plan: planDeterministic("x", astryx.contract as Json), intent: "data-collection", modelRef: "hosted-ai", goal: "x" });
    expect(omitted).toMatchObject({ id: null, source: "omitted" });
  });

  it("no block run when the preference is off, when nothing is offered, or when the choice is null", async () => {
    const ctx = await contextFor();
    const choice = { id: "auth-form", reason: "r", source: "model" as const };
    expect(await blockRunFor({ ctx, choice, intent: "data-collection", goal: "g", preferenceOn: false })).toBeNull();
    expect(await blockRunFor({ ctx: await contextFor({ source: { kind: "imported" } }), choice, intent: "data-collection", goal: "g", preferenceOn: true })).toBeNull();
    expect(await blockRunFor({ ctx, choice: { ...choice, id: null }, intent: "data-collection", goal: "g", preferenceOn: true })).toBeNull();
  });

  it("a refinement in a project that is no longer eligible takes today's primitive path, with no trace", async () => {
    const ctx = await contextFor({ source: { kind: "imported" } });
    const prior = { prompt: "p", progress: { block: { outcome: "block" }, surface: {} } };
    expect(await blockRunFor({ ctx, choice: { id: null, reason: "", source: "omitted" }, intent: "data-collection", goal: "g", preferenceOn: true, prior })).toBeNull();
  });

  it("a refinement whose prior turn has no trace takes today's refinement path, even when the plan inherited a block choice", async () => {
    // T1 ran as a block; T2 was a primitive refinement (preference off, or a
    // local model) and so has no trace; T3 refines T2 with the preference on.
    // T3's plan still carries T1's block choice. A fresh block run here would
    // discard T2's surface and report a brand-new expansion as a refinement.
    const ctx = await contextFor();
    const prior = { prompt: "make the title say Welcome", progress: { outcome: "passed", surface: { root: {} } } };
    expect(await blockRunFor({ ctx, choice: { id: "auth-form", reason: "r", source: "model" }, intent: "data-collection", goal: "now make the button say Join", preferenceOn: true, prior })).toBeNull();
  });

  it("a fresh choice gives a fresh run; a prior trace that cannot seed gives a visible switch", async () => {
    const ctx = await contextFor();
    const fresh = await blockRunFor({ ctx, choice: { id: "auth-form", reason: "r", source: "model" }, intent: "data-collection", goal: "g", preferenceOn: true });
    expect(fresh).toMatchObject({ kind: "fresh", intent: "data-collection" });
    const prior = { prompt: "p", progress: { block: { outcome: "fallback", selected: { id: "auth-form", version: 1, intent: "data-collection" } }, surface: {} } };
    const switched = await blockRunFor({ ctx, choice: { id: null, reason: "", source: "omitted" }, intent: "data-collection", goal: "g", preferenceOn: true, prior });
    expect(switched).toMatchObject({ kind: "switch", reason: "no-valid-seed" });
  });
});

describe("planGoalWithBlocks", () => {
  it("posts the block question and keeps the planner's answer; a provider failure gives block null with its reason", async () => {
    const ctx = await contextFor();
    const bodies = stubFetch([() => okCall({ intent: "data-collection", feasible: true, restated: "A sign-up form.", reason: "r", block: "auth-form", blockReason: "it is a sign-up form" })]);
    const { plan } = await planGoalWithBlocks("a sign-up form", astryx.contract as Json, ctx.offered);
    expect(bodies[0]!.jsonSchema.required).toContain("block");
    expect(bodies[0]!.jsonSchema.properties.block.enum).toEqual(["records-table", "auth-form", "guide-steps", null]);
    expect(plan.block).toEqual({ id: "auth-form", reason: "it is a sign-up form", source: "model" });
    vi.unstubAllGlobals();
    stubFetch([() => providerDown()]);
    const failed = await planGoalWithBlocks("a sign-up form", astryx.contract as Json, ctx.offered);
    expect(failed.plan.source).toBe("scripted");
    expect(failed.plan.block).toEqual({ id: null, reason: "planning-provider-failure", source: "deterministic" });
    expect(failed.calls).toHaveLength(1);
  });
});

describe("runHostedBlockBuild, hosted, against the real pipeline", () => {
  const authCall = () => (astryx.contract as Json) && { block: "auth-form", version: 1, mode: "sign-up", title: "Create your account", fields: ["name", "email", "password"], providers: ["github"] };

  it("expanded: one block POST with maxCalls 1, attempt 0 is the expansion, the run passes, the trace rides the thread after RUN_STARTED", async () => {
    const ctx = await contextFor();
    const bodies = stubFetch([() => okCall(authCall())]);
    const runSpec = (await blockRunFor({ ctx, choice: { id: "auth-form", reason: "r", source: "model" }, intent: "data-collection", goal: "a sign-up form", preferenceOn: true }))!;
    const { events, recorder, progress } = await run(ctx, runSpec, "hosted-ai");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.maxCalls).toBe(1);
    expect(progress.outcome).toBe("passed");
    expect(progress.block?.outcome).toBe("block");
    expect(progress.report?.attempts).toHaveLength(1);
    expect(progress.report?.attempts?.[0]?.meta?.blockTrace).toMatchObject({ block: "auth-form", rawIsExpansion: true });
    expect(progress.report?.generation?.maxRepairs).toBe(2);
    const names = events.map((e) => (e.type === "CUSTOM" ? e.name : e.type));
    expect(names.indexOf("RUN_STARTED")).toBeLessThan(names.indexOf("dspack.block"));
    expect(recorder.calls.map((c) => [c.operation, c.source])).toEqual([["block", "provider"]]);
  });

  it("two invalid calls: fallback with the remaining budget, at most 3 POSTs in all", async () => {
    const ctx = await contextFor();
    const bad = { ...authCall(), mode: "sign-ip" };
    const example = (astryx.contract as Json).examples.find((e: Json) => e.intent === "data-collection");
    const bodies = stubFetch([() => okCall(bad), () => okCall(bad), () => okCall(example.surface)]);
    const runSpec = (await blockRunFor({ ctx, choice: { id: "auth-form", reason: "r", source: "model" }, intent: "data-collection", goal: "a sign-up form", preferenceOn: true }))!;
    const { progress, recorder } = await run(ctx, runSpec, "hosted-ai");
    expect(bodies).toHaveLength(3);
    expect(bodies.every((b) => b.maxCalls === 1)).toBe(true);
    expect(bodies[2]!.jsonSchema).toHaveProperty("$defs"); // the fallback is the full-surface request
    expect(progress.block?.outcome).toBe("fallback");
    expect(progress.report?.generation?.maxRepairs).toBe(0);
    expect(progress.outcome).toBe("passed");
    expect(recorder.calls.map((c) => c.operation)).toEqual(["block", "block-repair", "generate"]);
  });

  it("a provider failure on the block repair: failed-adapter shaped as today, the trace says provider, two recorder calls, no further POST", async () => {
    const ctx = await contextFor();
    const bad = { ...authCall(), mode: "sign-ip" };
    const bodies = stubFetch([() => okCall(bad), () => providerDown()]);
    const runSpec = (await blockRunFor({ ctx, choice: { id: "auth-form", reason: "r", source: "model" }, intent: "data-collection", goal: "a sign-up form", preferenceOn: true }))!;
    const { progress, recorder } = await run(ctx, runSpec, "hosted-ai");
    expect(bodies).toHaveLength(2);
    expect(progress.outcome).toBe("failed-adapter");
    expect(progress.block?.outcome).toBe("provider-failure");
    expect(progress.block?.providerError?.classification).toBe("provider");
    expect(progress.report?.attempts).toEqual([{ index: 0, adapterError: expect.stringContaining("down") }]);
    expect(progress.report?.generation?.adapterId).toBe("hosted-ai:claude-haiku-4.5");
    expect(recorder.calls.filter((c) => c.source === "provider")).toHaveLength(2);
  });

  it("an invariant failure: no pipeline, no audit report, a finished turn whose outcome is invariant-failure, no further POST", async () => {
    const ctx = await contextFor();
    const defective = { ...ctx.offered.find((b) => b.id === "auth-form")!, template: { component: "card", id: "c", children: [{ component: "not-a-component", id: "x" }] } };
    const bodies = stubFetch([() => okCall(authCall())]);
    const runSpec = { kind: "fresh" as const, block: defective as never, intent: "data-collection" };
    const { events, progress } = await run(ctx, runSpec, "hosted-ai");
    expect(bodies).toHaveLength(1);
    expect(events.map((e) => (e.type === "CUSTOM" ? e.name : e.type))).toEqual(["RUN_STARTED", "dspack.block", "RUN_FINISHED"]);
    expect(progress.status).toBe("finished");
    expect(progress.outcome).toBe("invariant-failure");
    expect(progress.report).toBeUndefined();
    expect(progress.block?.invariant?.join(" ")).toMatch(/not-a-component/);
  });

  it("a switch runs today's primitive refinement under the budget, with a trace that says so and no block POST", async () => {
    const ctx = await contextFor();
    const example = (astryx.contract as Json).examples.find((e: Json) => e.intent === "data-collection");
    const bodies = stubFetch([() => okCall(example.surface)]);
    const runSpec = { kind: "switch" as const, reason: "digest-mismatch" as const, intent: "data-collection", priorBlock: { id: "auth-form", version: 1, intent: "data-collection" } };
    const { progress } = await run(ctx, runSpec, "hosted-ai", { conversation: [{ role: "user", content: "p" }, { role: "assistant", content: JSON.stringify(example.surface) }] });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.jsonSchema).toHaveProperty("$defs");
    expect(bodies[0]!.maxCalls).toBe(1);
    expect(progress.block).toMatchObject({ outcome: "fallback", fallback: { classification: "switch", reason: "digest-mismatch" }, providerCalls: 0 });
    expect(progress.outcome).toBe("passed");
  });
});

describe("runHostedBlockBuild, scripted", () => {
  it("the scripted block script expands with no fetch at all, and every call is recorded as reaching no model", async () => {
    const ctx = await contextFor();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const runSpec = (await blockRunFor({ ctx, choice: { id: "auth-form", reason: "r", source: "deterministic" }, intent: "data-collection", goal: "a sign-up form", preferenceOn: true }))!;
    const { progress, recorder } = await run(ctx, runSpec, "scripted");
    expect(fetch).not.toHaveBeenCalled();
    expect(progress.outcome).toBe("passed");
    expect(progress.block?.outcome).toBe("block");
    expect(recorder.calls.map((c) => [c.operation, c.source])).toEqual([["block", "none"]]);
  });
});

describe("blockContext under the beta switch (Phase 2 plan, §6, layer 4)", () => {
  const shadcn = REFERENCES.shadcn;
  const shadcnContext = (beta: BlocksBetaSwitch) =>
    blockContext({ mode: "demo", source: { kind: "reference", referenceId: "shadcn" }, inBrowser: true, contract: shadcn.contract as Json, profile: shadcn.profile as Json, disabled: new Set(), beta });

  it("the owner's switch offers an Astryx project every approved block", async () => {
    const ctx = await contextFor({ beta: OWNER });
    expect(ctx.reason).toBeNull();
    expect(ctx.offered.map((b) => b.id)).toEqual(ALL_BLOCKS);
  });

  it("a shadcn/ui v3 project under the owner's switch is offered none, the note says why, and its sidecar binding is kept", async () => {
    const ctx = await shadcnContext(OWNER);
    expect(ctx.offered).toEqual([]);
    expect(ctx.reason).toBe("reference-not-in-beta");
    expect(ctx.detail).toMatch(/shadcn\/ui v3 blocks are withheld from this beta: their evaluation remains inconclusive/);
    expect(ctx.base?.sidecar.status).toBe("approved");
  });

  it("a switch that lists shadcn offers it: the Worker's allowlist, not the client, decides which references the beta reports", async () => {
    const ctx = await shadcnContext(ON_ALL);
    expect(ctx.reason).toBeNull();
    expect(ctx.offered.map((b) => b.id)).toEqual(ALL_BLOCKS);
  });

  it.each(["missing", "unreadable", "malformed", "disabled"] as const)("a switch that is %s offers nothing, and the reason says which", async (reason) => {
    const ctx = await contextFor({ beta: { state: "off", reason } });
    expect(ctx.offered).toEqual([]);
    expect(ctx.reason).toBe(`beta-switch-${reason}`);
    expect(ctx.base?.sidecar.status).toBe("approved");
  });

  it("a block the switch does not list is withheld; the rest keep sidecar order", async () => {
    const ctx = await contextFor({ beta: { state: "on", references: ["astryx"], blocks: ["guide-steps", "records-table"] } });
    expect(ctx.reason).toBeNull();
    expect(ctx.offered.map((b) => b.id)).toEqual(["records-table", "guide-steps"]);
  });

  it("a switch that lists none of the blocks left offers nothing", async () => {
    const ctx = await contextFor({ beta: { state: "on", references: ["astryx"], blocks: ["auth-form"] }, disabled: new Set(["auth-form"]) });
    expect(ctx.offered).toEqual([]);
    expect(ctx.reason).toBe("no-blocks-in-beta");
  });

  it("a refinement after the switch goes off takes today's refinement path, with no block call", async () => {
    const off = await contextFor({ beta: { state: "off", reason: "disabled" } });
    const prior = { prompt: "a sign-up form", progress: { block: { outcome: "block", selected: { id: "auth-form", version: 1, intent: "data-collection" } }, outcome: "passed", surface: { root: {} } } };
    expect(await blockRunFor({ ctx: off, choice: { id: null, reason: "", source: "omitted" }, intent: "data-collection", goal: "make the title say Welcome", preferenceOn: true, prior })).toBeNull();
  });

  it("eligibility answers first: an imported, local-model or edited project keeps its own reason under any switch", async () => {
    const edited = { ...(astryx.contract as Json), intents: [...(astryx.contract as Json).intents, { id: "x", description: "y" }] };
    for (const beta of [OWNER, { state: "off", reason: "disabled" } as const]) {
      expect((await contextFor({ source: { kind: "imported" }, beta })).reason).toBe("imported-project");
      expect((await contextFor({ source: { kind: "agent", path: "/x" }, beta })).reason).toBe("repository-project");
      expect((await contextFor({ inBrowser: false, beta })).reason).toBe("local-model");
      expect((await contextFor({ contract: edited, beta })).reason).toBe("contract-edited");
    }
  });
});

describe("readBlocksBeta: the switch, read fresh before every build", () => {
  const owner = { enabled: true, references: ["astryx"], blocks: ALL_BLOCKS };
  const MODELS = ["scripted", "hosted-ai"];
  function stubGet(answer: (n: number) => Response | Promise<Response>) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return answer(calls.length - 1);
      }),
    );
    return calls;
  }

  it("reads the composer's own /api/models, uncached and with a timeout, and returns the owner's switch", async () => {
    const calls = stubGet(() => reply(200, { models: MODELS, blocks: owner }));
    expect(await readBlocksBeta()).toEqual({ state: "on", references: ["astryx"], blocks: ALL_BLOCKS });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/models");
    expect(calls[0]!.init?.method ?? "GET").toBe("GET");
    expect(calls[0]!.init?.cache).toBe("no-store");
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("production's reply carries no switch: missing", async () => {
    stubGet(() => reply(200, { models: MODELS }));
    expect(await readBlocksBeta()).toEqual({ state: "off", reason: "missing" });
  });

  it("the Worker's off forms keep their reason", async () => {
    stubGet(() => reply(200, { models: MODELS, blocks: { enabled: false, reason: "disabled" } }));
    expect(await readBlocksBeta()).toEqual({ state: "off", reason: "disabled" });
    vi.unstubAllGlobals();
    stubGet(() => reply(200, { models: MODELS, blocks: { enabled: false, reason: "malformed" } }));
    expect(await readBlocksBeta()).toEqual({ state: "off", reason: "malformed" });
  });

  it("a reply that names an unknown reference or block is malformed", async () => {
    stubGet(() => reply(200, { models: MODELS, blocks: { ...owner, references: ["material"] } }));
    expect(await readBlocksBeta()).toEqual({ state: "off", reason: "malformed" });
    vi.unstubAllGlobals();
    stubGet(() => reply(200, { models: MODELS, blocks: { ...owner, blocks: ["data-grid"] } }));
    expect(await readBlocksBeta()).toEqual({ state: "off", reason: "malformed" });
  });

  it.each<[string, () => Response | Promise<Response>]>([
    ["a 404", () => reply(404, { error: "not-found" })],
    ["a 500", () => reply(500, { models: MODELS, blocks: owner })],
    ["the static host's HTML page", () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a timeout", () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"))],
  ])("%s cannot be read, so it offers no blocks", async (_name, answer) => {
    stubGet(answer);
    expect(await readBlocksBeta()).toEqual({ state: "off", reason: "unreadable" });
  });

  it("never cached: each build reads again, so a switch turned off applies to the next build", async () => {
    const calls = stubGet((n) => reply(200, n === 0 ? { models: MODELS, blocks: owner } : { models: MODELS, blocks: { enabled: false, reason: "disabled" } }));
    expect((await readBlocksBeta()).state).toBe("on");
    expect(await readBlocksBeta()).toEqual({ state: "off", reason: "disabled" });
    expect(calls).toHaveLength(2);
  });
});

describe("blockBinding: what an accepted block surface's provenance binds to, whatever the switch says now", () => {
  it("a packaged reference gives its sidecar binding; any other source gives none", async () => {
    const bound = await blockBinding(reference);
    expect(bound?.sidecar.reference).toEqual({ name: "Astryx", dspack: "0.4", version: "0.1.4" });
    expect(bound?.sidecar.status).toBe("approved");
    expect(bound?.contract).toBe(astryx.contract);
    expect((await blockBinding({ kind: "reference", referenceId: "shadcn" }))?.sidecar.reference.name).toBe("shadcn/ui");
    expect(await blockBinding({ kind: "reference", referenceId: "material" })).toBeNull();
    expect(await blockBinding({ kind: "imported" })).toBeNull();
    expect(await blockBinding({ kind: "agent" })).toBeNull();
    expect(await blockBinding(null)).toBeNull();
  });
});

describe("named calls only (Phase 2 plan, §5)", () => {
  it("a hosted block call asks for the named call, and its trace says named", async () => {
    const ctx = await contextFor({ beta: OWNER });
    const call = { block: "auth-form", version: 1, mode: "sign-up", title: "Create your account", fields: ["name", "email", "password"], providers: ["github"] };
    const bodies = stubFetch([() => okCall(call)]);
    const runSpec = (await blockRunFor({ ctx, choice: { id: "auth-form", reason: "r", source: "model" }, intent: "data-collection", goal: "a sign-up form", preferenceOn: true }))!;
    const { progress } = await run(ctx, runSpec, "hosted-ai");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.jsonSchema.properties.block.const).toBe("auth-form");
    expect(bodies[0]!.jsonSchema.properties).not.toHaveProperty("b");
    expect(bodies[0]!.jsonSchema.properties).not.toHaveProperty("p");
    expect(progress.block?.encoding).toBe("named");
  });

  it("a scripted block run is named too", async () => {
    const ctx = await contextFor({ beta: OWNER });
    vi.stubGlobal("fetch", vi.fn());
    const runSpec = (await blockRunFor({ ctx, choice: { id: "auth-form", reason: "r", source: "deterministic" }, intent: "data-collection", goal: "a sign-up form", preferenceOn: true }))!;
    const { progress } = await run(ctx, runSpec, "scripted");
    expect(progress.block?.encoding).toBe("named");
  });

  it("the runtime asks the block phase for the named encoding explicitly and never names the positional one", () => {
    const source = readFileSync(fileURLToPath(new URL("./blocks-runtime.ts", import.meta.url)), "utf8");
    const start = source.indexOf("await runBlockPhase({");
    expect(start).toBeGreaterThan(-1);
    const call = source.slice(start, source.indexOf("\n  });", start));
    expect(call).toContain('encoding: "named"');
    expect(source).not.toMatch(/positional/i);
  });
});
