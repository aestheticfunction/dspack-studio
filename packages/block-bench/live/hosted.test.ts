/**
 * Parity with the app: the harness's hosted client and the app's own
 * gateway adapter (apps/composer/app/hosted-build.ts) are run over the same
 * Worker replies, with fetch stubbed, and must agree on the failure kind,
 * the HTTP status, the Worker's cause, and every call record. The app's
 * adapter posts to a relative URL, which the stub accepts.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCallRecorder, type ModelCallRecord } from "@dspack-studio/composer-core";
import { GatewayError, gatewayAdapter } from "../../../apps/composer/app/hosted-build";
import { handlePropose } from "../../../apps/composer/worker/propose.mjs";
import { exampleFor, runCell } from "./arms";
import { promptsFor, readCorpus, type Corpus } from "./corpus";
import { selectionStats } from "./metrics";
import { runEvaluation } from "./evaluate";
import { PacingCapReached, createPacer } from "./pacing";
import { preflight } from "./preflight";
import { loadReference, type LoadedReference } from "./references";
import { probeWorker, readBuildId } from "./preflight";
import { cellRequestBound, createHostedProvider, retryableRefusal } from "./providers/hosted";
import { HarnessError, createMeter } from "./providers/types";
import { callJsonSchema, encodeCall } from "@dspack-studio/composer-core/blocks";

const request = { system: "s", messages: [{ role: "user" as const, content: "u" }], jsonSchema: { type: "object" } };
const reply = (status: number, body: unknown, raw = false) => new Response(raw ? String(body) : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const strip = (records: readonly ModelCallRecord[]) => records.map(({ durationMs, ...rest }) => rest);

type Scenario = { name: string; answer: () => Response | Promise<Response> };
const SCENARIOS: Scenario[] = [
  { name: "200 ok with calls", answer: () => reply(200, { json: { a: 1 }, raw: "{\"a\":1}", model: "m", usage: { inputTokens: 10, outputTokens: 2 }, calls: [{ inputTokens: 10, outputTokens: 2, outcome: "ok", durationMs: 5 }] }) },
  { name: "200 ok after the Worker's parse retry (two calls)", answer: () => reply(200, { json: { a: 1 }, raw: "{}", model: "m", usage: { inputTokens: 20, outputTokens: 4 }, calls: [{ inputTokens: 10, outputTokens: 2, outcome: "unusable-output", durationMs: 5 }, { inputTokens: 10, outputTokens: 2, outcome: "ok", durationMs: 5 }] }) },
  { name: "200 non-JSON", answer: () => reply(200, "<html>", true) },
  { name: "429 rate-limited (refused, no calls)", answer: () => reply(429, { error: "rate-limited", message: "slow down", calls: [] }) },
  { name: "502 unusable output", answer: () => reply(502, { error: "provider-unavailable", cause: "unusable-output", message: "no usable output", usage: { inputTokens: 30, outputTokens: 0 }, calls: [{ inputTokens: 15, outputTokens: 0, outcome: "unusable-output", durationMs: 1 }, { inputTokens: 15, outputTokens: 0, outcome: "unusable-output", durationMs: 1 }] }) },
  { name: "502 provider", answer: () => reply(502, { error: "provider-unavailable", cause: "provider", message: "down", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 1 }] }) },
  { name: "503 busy (the Worker's real shape: the rejected call is reported)", answer: () => reply(503, { error: "busy", message: "busy", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 3 }] }) },
  { name: "503 unavailable from a pre-0.5 Worker (no calls list)", answer: () => reply(503, { error: "unavailable", message: "off" }) },
  { name: "fetch throws", answer: () => Promise.reject(new TypeError("network down")) },
];

afterEach(() => vi.unstubAllGlobals());

async function viaApp(answer: Scenario["answer"]) {
  vi.stubGlobal("fetch", vi.fn(async () => answer()));
  const recorder = createCallRecorder();
  try {
    const result = await gatewayAdapter({ recorder }).generate(request);
    return { ok: true as const, json: result.json, usage: result.usage, records: strip(recorder.calls) };
  } catch (error) {
    const e = error as GatewayError;
    return { ok: false as const, kind: e.kind, status: e.status, failure: e.failure, usage: e.usage, records: strip(recorder.calls) };
  }
}

async function viaHarness(answer: Scenario["answer"]) {
  const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl: (async () => answer()) as typeof fetch });
  const recorder = createCallRecorder();
  const meter = createMeter();
  try {
    const result = await provider.surfaceAdapter({ recorder, meter, refinement: false }).generate(request);
    return { ok: true as const, json: result.json, usage: result.usage, records: strip(recorder.calls), meter };
  } catch (error) {
    const e = error as HarnessError;
    return { ok: false as const, kind: e.kind, status: e.status, failure: e.failure, usage: e.usage, records: strip(recorder.calls), meter };
  }
}

describe("the hosted client agrees with the app's gateway adapter on every reply shape", () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      const app = await viaApp(scenario.answer);
      const harness = await viaHarness(scenario.answer);
      const { meter, ...comparable } = harness;
      expect(comparable).toEqual(app);
      expect(meter.requests).toBe(1);
      expect(meter.bytes).toBeGreaterThan(0);
    });
  }

  it("posts the app's exact bytes: maxCalls only when asked, to <base>/api/propose", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const provider = createHostedProvider({
      baseUrl: "https://example.test/",
      fetchImpl: (async (url: string, init: { body: string }) => {
        seen.push({ url, body: init.body });
        return reply(200, { json: {}, calls: [{ inputTokens: 1, outputTokens: 1, outcome: "ok", durationMs: 1 }] });
      }) as typeof fetch,
    });
    const recorder = createCallRecorder();
    await provider.surfaceAdapter({ recorder, meter: createMeter(), refinement: false }).generate(request);
    await provider.surfaceAdapter({ recorder, meter: createMeter(), refinement: false, maxCalls: 1 }).generate(request);
    await provider.plan(request, { recorder, meter: createMeter() });
    expect(seen.map((s) => s.url)).toEqual(["https://example.test/api/propose", "https://example.test/api/propose", "https://example.test/api/propose"]);
    expect(seen[0]!.body).toBe(JSON.stringify(request));
    expect(seen[1]!.body).toBe(JSON.stringify({ ...request, maxCalls: 1 }));
    expect(seen[2]!.body).toBe(JSON.stringify(request));
    expect(recorder.calls.map((c) => c.operation)).toEqual(["generate", "generate", "plan"]);
  });

  it("labels block calls, a re-issue and a preloaded attempt exactly as the app does", async () => {
    const answer = () => reply(200, { json: {}, calls: [{ inputTokens: 1, outputTokens: 1, outcome: "ok", durationMs: 1 }] });
    vi.stubGlobal("fetch", vi.fn(async () => answer()));
    const appRecorder = createCallRecorder();
    const app = gatewayAdapter({ recorder: appRecorder, maxCalls: 1 });
    await app.generate(request, { operation: "block" });
    await app.generate(request, { operation: "block-repair" });
    await app.generate(request, { operation: "block-repair", reissue: true });
    await app.generate(request, { attempt: 1 });
    const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl: (async () => answer()) as typeof fetch });
    const recorder = createCallRecorder();
    const harness = provider.surfaceAdapter({ recorder, meter: createMeter(), refinement: false, maxCalls: 1 });
    await harness.generate(request, { operation: "block" });
    await harness.generate(request, { operation: "block-repair" });
    await harness.generate(request, { operation: "block-repair", reissue: true });
    await harness.generate(request, { attempt: 1 });
    expect(strip(recorder.calls)).toEqual(strip(appRecorder.calls));
    expect(strip(recorder.calls).map((c) => [c.operation, c.attempt, c.reissue ?? false])).toEqual([["block", 0, false], ["block-repair", 1, false], ["block-repair", 1, true], ["repair", 1, false]]);
  });

  it("retries a refusal that reached no model after a backoff, and reports the wait; a refusal after the schedule is a policy failure", async () => {
    let n = 0;
    const answers = [() => reply(503, { error: "busy", message: "busy", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 1 }] }), () => reply(200, { json: { ok: true }, calls: [{ inputTokens: 1, outputTokens: 1, outcome: "ok", durationMs: 1 }] })];
    const pacer = createPacer({ maxRequests: 10, spacingMs: 0, backoffMs: [5], now: () => 0, sleep: async () => undefined });
    const provider = createHostedProvider({ baseUrl: "https://example.test", pacer, fetchImpl: (async () => answers[Math.min(n++, 1)]!()) as typeof fetch });
    const recorder = createCallRecorder();
    const meter = createMeter();
    const result = await provider.surfaceAdapter({ recorder, meter, refinement: false }).generate(request);
    expect(result.json).toEqual({ ok: true });
    expect(meter.requests).toBe(1);
    expect(pacer.sent).toBe(2);
    expect(pacer.waits).toEqual([{ atMs: 0, ms: 5, reason: "503 busy" }]);
    expect(strip(recorder.calls).map((c) => [c.source, c.outcome])).toEqual([["none", "refused"], ["provider", "ok"]]);

    const spent = createPacer({ maxRequests: 10, spacingMs: 0, backoffMs: [], now: () => 0, sleep: async () => undefined });
    const refusing = createHostedProvider({ baseUrl: "https://example.test", pacer: spent, fetchImpl: (async () => reply(429, { error: "rate-limited", message: "slow", calls: [] })) as typeof fetch });
    await expect(refusing.surfaceAdapter({ recorder: createCallRecorder(), meter: createMeter(), refinement: false }).generate(request)).rejects.toMatchObject({ kind: "policy", status: 429 });
    expect(retryableRefusal(502, { calls: [] })).toBe(false);
    expect(retryableRefusal(429, { calls: [{}] })).toBe(false);
    expect(retryableRefusal(503, { calls: [{ inputTokens: 10, outputTokens: null, outcome: "provider-error" }] })).toBe(false);
  });
});

describe("the pacing cap stops the run cleanly, in every arm and at every call", () => {
  let corpus: Corpus;
  let astryx: LoadedReference;
  beforeAll(async () => {
    corpus = readCorpus();
    astryx = await loadReference("astryx");
  }, 60_000);
  const planAnswer = { intent: "record-collection", feasible: true, restated: "A table.", reason: "fits", block: "records-table", blockReason: "it is a table" };
  const okReply = (json: unknown) => reply(200, { json, raw: JSON.stringify(json), model: "m", usage: { inputTokens: 10, outputTokens: 2 }, calls: [{ inputTokens: 10, outputTokens: 2, outcome: "ok", durationMs: 1 }] });
  const prompt = () => promptsFor(corpus, "astryx").find((p) => p.id === "rt-01")!;
  const cell = (provider: ReturnType<typeof createHostedProvider>, arm: "block" | "capped" | "production") => runCell({ reference: astryx, provider, arm, condition: "fresh", prompt: prompt(), corpus });

  it("a cap hit during planning, during a block call and during a surface call each reject the cell with PacingCapReached, never a completed record", async () => {
    let posted = 0;
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      posted += 1;
      const body = JSON.parse(init.body);
      return okReply(body.jsonSchema?.properties?.block ? planAnswer : { block: "records-table", version: 1 });
    }) as typeof fetch;
    for (const [maxRequests, arm] of [[0, "block"], [1, "block"], [1, "production"], [1, "capped"]] as const) {
      posted = 0;
      const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl, pacer: createPacer({ maxRequests, spacingMs: 0, now: () => 0, sleep: async () => undefined }) });
      await expect(cell(provider, arm), `cap ${maxRequests} in the ${arm} arm`).rejects.toBeInstanceOf(PacingCapReached);
      expect(posted, `requests before the cap of ${maxRequests}`).toBeLessThanOrEqual(maxRequests);
    }
  });

  it("a cell is refused before its first request when the cap cannot cover it, and runEvaluation stops with reason cap and logs nothing for it", async () => {
    let posted = 0;
    const fetchImpl = (async () => {
      posted += 1;
      return okReply(planAnswer);
    }) as typeof fetch;
    const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl, pacer: createPacer({ maxRequests: 3, spacingMs: 0, now: () => 0, sleep: async () => undefined }) });
    const pre = await preflight({ references: [astryx] });
    const result = await runEvaluation({ runId: "cap", provider, references: [astryx], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01"], conditions: ["fresh"] });
    expect(result.stopped).toMatchObject({ reason: "cap" });
    expect(result.records).toEqual([]);
    expect(posted).toBe(0);
  });

  it("reports its pacing: the configuration, the requests sent and every wait", async () => {
    const pacer = createPacer({ maxRequests: 10, spacingMs: 1000, backoffMs: [5], now: () => 0, sleep: async () => undefined });
    const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl: (async () => okReply({})) as typeof fetch, pacer });
    await provider.plan(request, { recorder: createCallRecorder(), meter: createMeter() });
    await provider.plan(request, { recorder: createCallRecorder(), meter: createMeter() });
    expect(provider.telemetry?.()).toEqual({ pacing: { maxRequests: 10, spacingMs: 1000, backoffMs: [5], sent: 2, waits: [{ atMs: 0, ms: 1000, reason: "spacing" }] } });
  });
});

describe("the gateway's busy reply and a planning outage, through the real Worker", () => {
  let corpus: Corpus;
  let astryx: LoadedReference;
  beforeAll(async () => {
    corpus = readCorpus();
    astryx = await loadReference("astryx");
  }, 60_000);
  const plan = { intent: "record-collection", feasible: true, restated: "A table.", reason: "fits", block: "records-table", blockReason: "it is a table" };
  const ok = (json: unknown) => ({ content: [{ type: "text", text: JSON.stringify(json) }], usage: { input_tokens: 100, output_tokens: 10 } });
  /** The REAL Worker module; `model` answers each provider call by kind and may throw like the gateway does. */
  const workerFetch = (model: (kind: "plan" | "block" | "surface", n: number) => unknown) => {
    let n = 0;
    const env = {
      HOSTED_AI: "on",
      AI: {
        run: async (_m: string, input: { system: string }) => {
          const kind = input.system.includes("routing step") ? "plan" : input.system.includes("Interface block") || input.system.includes("named call") ? "block" : "surface";
          return model(kind, n++);
        },
      },
    };
    let posted = 0;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      posted += 1;
      return handlePropose(new Request(url, init), env);
    }) as typeof fetch;
    return { fetchImpl, posted: () => posted };
  };
  const prompt = () => promptsFor(corpus, "astryx").find((p) => p.id === "rt-01")!;

  it("a busy gateway (the Worker's real 503, which reports the rejected call) is backed off and retried, the wait is reported, and the request is metered once", async () => {
    let first = true;
    const w = workerFetch(() => {
      if (first) {
        first = false;
        throw new Error("AiError: 429 Too Many Requests");
      }
      return ok({ answer: 1 });
    });
    const pacer = createPacer({ maxRequests: 10, spacingMs: 0, backoffMs: [5], now: () => 0, sleep: async () => undefined });
    const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl: w.fetchImpl, pacer });
    const recorder = createCallRecorder();
    const meter = createMeter();
    const result = await provider.surfaceAdapter({ recorder, meter, refinement: false }).generate(request);
    expect(result.json).toEqual({ answer: 1 });
    expect(w.posted()).toBe(2);
    expect(pacer.waits.map((x) => x.reason)).toEqual(["503 busy"]);
    expect(strip(recorder.calls).map((c) => [c.source, c.outcome])).toEqual([["none", "refused"], ["provider", "ok"]]);
    expect(meter.requests).toBe(1);
    expect(meter.bytes).toBe(new TextEncoder().encode(JSON.stringify(request)).length);
  });

  it("a planning outage ends the cell before any generation, as a provider failure to re-run, never as an arm result or a selection", async () => {
    const w = workerFetch((kind) => {
      if (kind === "plan") throw new Error("provider timeout");
      return ok(exampleFor(astryx, "record-collection"));
    });
    const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl: w.fetchImpl });
    const { record } = await runCell({ reference: astryx, provider, arm: "block", condition: "fresh", prompt: prompt(), corpus });
    expect(w.posted()).toBe(1);
    expect(record).toMatchObject({ status: "completed", outcome: "planning-failure", passed: false, attempts: 0, path: "planning-failure", failure: { kind: "provider", rerunEligible: true } });
    expect(record.plan?.failure).toMatchObject({ kind: "provider" });
    expect(record.selection).toBeUndefined();
    expect(record.calls.map((c) => c.operation)).toEqual(["plan"]);
  });

  it("an unusable planning output falls back as the app does, and its selection is counted as a planning failure, not an explicit null", async () => {
    const w = workerFetch((kind) => (kind === "plan" ? { content: [{ type: "text", text: "Sure! Here is the plan." }], usage: { input_tokens: 100, output_tokens: 10 } } : ok(exampleFor(astryx, "record-collection"))));
    const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl: w.fetchImpl });
    const { record } = await runCell({ reference: astryx, provider, arm: "block", condition: "fresh", prompt: prompt(), corpus });
    expect(record.passed).toBe(true);
    expect(record.failure).toBeUndefined();
    expect(record.plan?.failure).toMatchObject({ kind: "output" });
    expect(record.selection).toMatchObject({ chosen: null, planningFailed: true, correct: false });
    const [s] = selectionStats([record]);
    expect(s).toMatchObject({ n: 1, planningFailed: 1, explicitNull: 0, missedToNull: 0, correct: 0 });
  });

  it("a cell is admitted only when the cap covers its worst case, refused retries included, so the cap never cuts a cell off after it has spent", async () => {
    // Worst case of a production cell: the plan and three generation attempts, each refused once before it is served.
    let refuseNext = true;
    let surfaceCalls = 0;
    const w = workerFetch((kind) => {
      if (refuseNext) {
        refuseNext = false;
        throw new Error("429 rate limit");
      }
      refuseNext = true;
      if (kind === "plan") return ok({ intent: "record-collection", feasible: true, restated: "A table.", reason: "fits" });
      surfaceCalls += 1;
      return ok(surfaceCalls < 3 ? { dspackSurface: "0.1", root: { component: "no-such-component" } } : exampleFor(astryx, "record-collection"));
    });
    const bound = cellRequestBound(1);
    expect(bound).toBe(8);
    const tight = createHostedProvider({ baseUrl: "https://example.test", fetchImpl: w.fetchImpl, pacer: createPacer({ maxRequests: bound - 1, spacingMs: 0, backoffMs: [0], now: () => 0, sleep: async () => undefined }) });
    await expect(runCell({ reference: astryx, provider: tight, arm: "production", condition: "fresh", prompt: prompt(), corpus })).rejects.toBeInstanceOf(PacingCapReached);
    expect(w.posted()).toBe(0);
    const enough = createHostedProvider({ baseUrl: "https://example.test", fetchImpl: w.fetchImpl, pacer: createPacer({ maxRequests: bound, spacingMs: 0, backoffMs: [0], now: () => 0, sleep: async () => undefined }) });
    const { record } = await runCell({ reference: astryx, provider: enough, arm: "production", condition: "fresh", prompt: prompt(), corpus });
    expect(w.posted()).toBe(8);
    expect(record).toMatchObject({ passed: true, attempts: 3 });
  });
});

describe("usage a provider leaves out is recorded as missing, never as zero", () => {
  it("a call that reports input but not output makes the run unmetered, so it never enters the token cohort", async () => {
    const corpus = readCorpus();
    const astryx = await loadReference("astryx");
    const prompt = promptsFor(corpus, "astryx").find((p) => p.id === "rt-01")!;
    const surface = exampleFor(astryx, "record-collection");
    const plan = { intent: "record-collection", feasible: true, restated: "A table.", reason: "fits" };
    // The REAL Worker, with a model binding that reports only the input figure for the generation call.
    const env = {
      HOSTED_AI: "on",
      AI: {
        run: async (_model: string, input: { system: string }) =>
          input.system.includes("routing step")
            ? { content: [{ type: "text", text: JSON.stringify(plan) }], usage: { input_tokens: 900, output_tokens: 40 } }
            : { content: [{ type: "text", text: JSON.stringify(surface) }], usage: { input_tokens: 15_000 } },
      },
    };
    const fetchImpl = (async (url: string, init: RequestInit) => handlePropose(new Request(url, init), env)) as typeof fetch;
    const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl });
    const { record } = await runCell({ reference: astryx, provider, arm: "production", condition: "fresh", prompt, corpus });
    expect(record.passed).toBe(true);
    expect(record.calls.find((c) => c.operation === "generate")).toMatchObject({ inputTokens: 15_000 });
    expect(record.calls.find((c) => c.operation === "generate")!.outputTokens).toBeUndefined();
    expect(record.tokens.unreportedCalls).toBe(1);
  });
});

describe("preflight probes cost no provider call", () => {
  it("recognizes the Phase 0.5 Worker by calls: [] on the 400 refusal, and a pre-0.5 Worker by its absence", async () => {
    const posts: string[] = [];
    const current = (async (_url: string, init?: { body?: string }) => {
      posts.push(String(init?.body));
      return reply(400, { error: "invalid-request", message: "Expected { system, messages, jsonSchema }.", calls: [] });
    }) as typeof fetch;
    expect(await probeWorker("https://example.test", current)).toMatchObject({ shape: "phase-0.5", status: 400 });
    expect(posts).toEqual(["{}"]);
    const old = (async () => reply(400, { error: "invalid-request", message: "Expected { system, messages, jsonSchema }." })) as typeof fetch;
    expect(await probeWorker("https://example.test", old)).toMatchObject({ shape: "pre-0.5" });
    const down = (async () => Promise.reject(new TypeError("refused"))) as typeof fetch;
    expect(await probeWorker("https://example.test", down)).toMatchObject({ shape: "unreachable" });
    const html = (async () => new Response('<script src="/_next/static/abc123_XYZ/_buildManifest.js"></script>', { status: 200 })) as typeof fetch;
    expect(await readBuildId("https://example.test", html)).toBe("abc123_XYZ");
  });
});

describe("the block-positional arm through the real Worker", () => {
  it("posts the compact block request with maxCalls 1, and the Worker's compact answer is decoded to the named call", async () => {
    const corpus = readCorpus();
    const astryx = await loadReference("astryx");
    const records = astryx.blocks.find((b) => b.id === "records-table")!;
    const example = records.examples[0]!;
    const ok = (json: unknown) => ({ content: [{ type: "text", text: JSON.stringify(json) }], usage: { input_tokens: 100, output_tokens: 10 } });
    const plan = { intent: "record-collection", feasible: true, restated: "A table.", reason: "fits", block: "records-table", blockReason: "it is a table" };
    const env = {
      HOSTED_AI: "on",
      AI: {
        run: async (_model: string, input: { system: string }) => {
          if (input.system.includes("routing step")) return ok(plan);
          if (input.system.includes("filling an interface block")) return ok(encodeCall(records, example.call));
          return ok(exampleFor(astryx, "record-collection"));
        },
      },
    };
    const posted: Array<Record<string, any>> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      posted.push(JSON.parse(String(init.body)));
      return handlePropose(new Request(url, init), env);
    }) as typeof fetch;
    const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl });
    const prompt = promptsFor(corpus, "astryx").find((p) => p.id === "rt-01")!;
    const { record } = await runCell({ reference: astryx, provider, arm: "block-positional", condition: "fresh", prompt, corpus });
    expect(record).toMatchObject({ passed: true, path: "block", selection: { chosen: "records-table" } });
    expect(posted).toHaveLength(2);
    expect(posted[1]).toMatchObject({ maxCalls: 1, jsonSchema: callJsonSchema(records, "positional") });
    expect((record.trace as { encoding: string; attempts: Array<{ call: unknown }> }).encoding).toBe("positional");
    expect((record.trace as { attempts: Array<{ call: unknown }> }).attempts[0]!.call).toEqual(example.call);
    expect(record.tokens).toMatchObject({ providerCalls: 2, unreportedCalls: 0 });
  });
});

