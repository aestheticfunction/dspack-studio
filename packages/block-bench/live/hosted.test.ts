/**
 * Parity with the app: the harness's hosted client and the app's own
 * gateway adapter (apps/composer/app/hosted-build.ts) are run over the same
 * Worker replies, with fetch stubbed, and must agree on the failure kind,
 * the HTTP status, the Worker's cause, and every call record. The app's
 * adapter posts to a relative URL, which the stub accepts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCallRecorder, type ModelCallRecord } from "@dspack-studio/composer-core";
import { GatewayError, gatewayAdapter } from "../../../apps/composer/app/hosted-build";
import { createPacer } from "./pacing";
import { probeWorker, readBuildId } from "./preflight";
import { createHostedProvider, refusedBeforeProvider } from "./providers/hosted";
import { HarnessError, createMeter } from "./providers/types";

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
  { name: "503 busy before any call", answer: () => reply(503, { error: "busy", message: "busy", calls: [] }) },
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
    const answers = [() => reply(503, { error: "busy", message: "busy", calls: [] }), () => reply(200, { json: { ok: true }, calls: [{ inputTokens: 1, outputTokens: 1, outcome: "ok", durationMs: 1 }] })];
    const pacer = createPacer({ maxRequests: 10, spacingMs: 0, backoffMs: [5], now: () => 0, sleep: async () => undefined });
    const provider = createHostedProvider({ baseUrl: "https://example.test", pacer, fetchImpl: (async () => answers[Math.min(n++, 1)]!()) as typeof fetch });
    const recorder = createCallRecorder();
    const meter = createMeter();
    const result = await provider.surfaceAdapter({ recorder, meter, refinement: false }).generate(request);
    expect(result.json).toEqual({ ok: true });
    expect(meter.requests).toBe(2);
    expect(pacer.waits).toEqual([{ atMs: 0, ms: 5, reason: "503 busy" }]);
    expect(recorder.calls).toHaveLength(1);

    const spent = createPacer({ maxRequests: 10, spacingMs: 0, backoffMs: [], now: () => 0, sleep: async () => undefined });
    const refusing = createHostedProvider({ baseUrl: "https://example.test", pacer: spent, fetchImpl: (async () => reply(429, { error: "rate-limited", message: "slow", calls: [] })) as typeof fetch });
    await expect(refusing.surfaceAdapter({ recorder: createCallRecorder(), meter: createMeter(), refinement: false }).generate(request)).rejects.toMatchObject({ kind: "policy", status: 429 });
    expect(refusedBeforeProvider(502, { calls: [] })).toBe(false);
    expect(refusedBeforeProvider(429, { calls: [{}] })).toBe(false);
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
