/**
 * Parity with the app: the harness's hosted client and the app's own
 * gateway adapter (apps/composer/app/hosted-build.ts) are run over the same
 * Worker replies, with fetch stubbed, and must agree on the failure kind,
 * the HTTP status, the Worker's cause, and every call record. The app's
 * adapter posts to a relative URL, which the stub accepts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { CELL_USD_BOUND, absoluteUsd, worstCaseUsd } from "./cost";
import { cellRequestBound, createHostedProvider, retryableRefusal } from "./providers/hosted";
import { HarnessError, createMeter } from "./providers/types";
import { ARMS } from "./types";
import { callJsonSchema, encodeCall } from "@dspack-studio/composer-core/blocks";

const ARM_COUNT = ARMS.length;
/** A dollar ceiling no test run approaches, for the tests about something else. */
const USD = 1000;

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

  it("the run's cumulative cap holds across resumes: each invocation has a new pacer, and together they never send more than the run's cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-cumulative-"));
    try {
      let posted = 0;
      // The provider is down: every fresh cell is one planning request that fails, so the count is easy to read.
      const fetchImpl = (async () => {
        posted += 1;
        return reply(502, { error: "provider-unavailable", cause: "provider", message: "down", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 1 }] });
      }) as typeof fetch;
      const pre = await preflight({ references: [astryx] });
      // Each invocation is what one CLI process builds: a new provider and a new pacer with its own cap of 300.
      const invocation = (maxTotalRequests?: number) =>
        runEvaluation({
          runId: "cumulative",
          provider: createHostedProvider({ baseUrl: "https://example.test", fetchImpl, pacer: createPacer({ maxRequests: 300, spacingMs: 0, now: () => 0, sleep: async () => undefined }) }),
          references: [astryx],
          corpus,
          preflight: pre,
          allowDrafts: true,
          conditions: ["fresh"],
          outDir: dir,
          resume: existsSync(join(dir, "manifest.json")),
          ...(maxTotalRequests !== undefined ? { maxTotalRequests } : {}),
          maxTotalUsd: USD,
        });
      const first = await invocation(25);
      expect(first.stopped).toMatchObject({ reason: "cap" });
      expect(posted).toBeGreaterThan(0);
      expect(posted).toBeLessThanOrEqual(25);
      const sent = posted;
      // A resume that names no new cap holds to the recorded one, which is spent: nothing more is sent.
      const second = await invocation();
      expect(second.stopped).toMatchObject({ reason: "cap" });
      expect(second.stopped?.message).toMatch(/--max-total-requests/);
      expect(posted).toBe(sent);
      // Raising it is explicit and recorded; the run then continues up to the new cap, never past it.
      await invocation(45);
      expect(posted).toBeGreaterThan(sent);
      expect(posted).toBeLessThanOrEqual(45);
      const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      expect(manifest.limits).toMatchObject({ maxTotalRequests: 45, maxTotalUsd: USD, changes: [{ from: 25, to: 45 }] });
      // Every request was recorded before it was sent, and the summary and the report state the run's total. The
      // provider was down without reporting usage, so every request is held at its absolute worst case.
      const lines = readFileSync(join(dir, "requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { adjust?: number });
      expect(lines.filter((l) => l.adjust === undefined)).toHaveLength(posted);
      const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")).requests;
      expect(summary).toMatchObject({ cap: 45, sent: posted, capUsd: USD });
      expect(summary.usd).toBeCloseTo(posted * absoluteUsd(2), 9);
      expect(readFileSync(join(dir, "REPORT.md"), "utf8")).toContain(`- The run: a cumulative cap of 45 requests and a dollar ceiling of $${USD.toFixed(2)} across every invocation (manifest.json); ${posted} sent, $${summary.usd.toFixed(2)} reserved at their worst case (requests.jsonl).`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("a persisted hosted run refuses to start without a cumulative cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-uncapped-"));
    try {
      let posted = 0;
      const fetchImpl = (async () => {
        posted += 1;
        return okReply(planAnswer);
      }) as typeof fetch;
      const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl, pacer: createPacer({ maxRequests: 300, spacingMs: 0, now: () => 0, sleep: async () => undefined }) });
      const pre = await preflight({ references: [astryx] });
      await expect(runEvaluation({ runId: "uncapped", provider, references: [astryx], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01"], conditions: ["fresh"], outDir: dir })).rejects.toThrow(/cumulative cap/);
      // A request cap alone is not a dollar ceiling: the run needs both.
      await expect(runEvaluation({ runId: "uncapped", provider, references: [astryx], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01"], conditions: ["fresh"], outDir: dir, maxTotalRequests: 100 })).rejects.toThrow(/dollar ceiling.*--max-total-usd/);
      expect(posted).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const down = () => reply(502, { error: "provider-unavailable", cause: "provider", message: "down", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 1 }] });
  const pacer = (maxRequests: number) => createPacer({ maxRequests, spacingMs: 0, now: () => 0, sleep: async () => undefined });

  it("a hosted run in a run directory needs a pacer as well as the cap, to start and to resume: the provider's kind decides, not whether a pacer was passed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-unpaced-"));
    try {
      let posted = 0;
      const fetchImpl = (async () => {
        posted += 1;
        return down();
      }) as typeof fetch;
      const pre = await preflight({ references: [astryx] });
      const run = (provider: ReturnType<typeof createHostedProvider>, resume: boolean) =>
        runEvaluation({ runId: "unpaced", provider, references: [astryx], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01"], conditions: ["fresh"], outDir: dir, resume, maxTotalRequests: 100, maxTotalUsd: USD });
      const unpaced = createHostedProvider({ baseUrl: "https://example.test", fetchImpl });
      await expect(run(unpaced, false)).rejects.toThrow(/pacer/);
      expect(posted).toBe(0);
      // A run a paced invocation started cannot be resumed without a pacer either.
      await run(createHostedProvider({ baseUrl: "https://example.test", fetchImpl, pacer: pacer(20) }), false);
      posted = 0;
      await expect(run(unpaced, true)).rejects.toThrow(/pacer/);
      expect(posted).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts every request the run has sent: the ledger, plus what invocations from before the ledger reported, never one in place of the other", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-ledger-"));
    try {
      let posted = 0;
      const fetchImpl = (async () => {
        posted += 1;
        return down();
      }) as typeof fetch;
      const pre = await preflight({ references: [astryx] });
      const invocation = (extra: { maxTotalRequests?: number; maxTotalUsd?: number; resume?: boolean }) =>
        runEvaluation({ runId: "ledger", provider: createHostedProvider({ baseUrl: "https://example.test", fetchImpl, pacer: pacer(20) }), references: [astryx], corpus, preflight: pre, allowDrafts: true, conditions: ["fresh"], outDir: dir, ...extra });
      await invocation({ maxTotalRequests: 50, maxTotalUsd: USD });
      // The history to add up: an invocation from before the ledger reported 20 requests in pacing.jsonl, and a later
      // one was killed after recording 15 requests in the ledger, reporting nothing.
      writeFileSync(join(dir, "pacing.jsonl"), `${JSON.stringify({ at: "2026-10-01T00:00:00.000Z", telemetry: { pacing: { maxRequests: 300, spacingMs: 3000, backoffMs: [], sent: 20, waits: [] } } })}\n`);
      writeFileSync(join(dir, "requests.jsonl"), `${JSON.stringify({ at: "2026-10-02T00:00:01.000Z", invocation: "2026-10-02T00:00:00.000Z" })}\n`.repeat(15));
      posted = 0;
      // 35 sent: a cell's worst case of 20 no longer fits under 50, so nothing more is sent. A request recorded
      // without a price (from before the dollar ledger) counts at the most any request can cost.
      const resumed = await invocation({ resume: true });
      expect(resumed.stopped).toMatchObject({ reason: "cap" });
      expect(posted).toBe(0);
      expect(resumed.requests).toMatchObject({ cap: 50, sent: 35, capUsd: USD });
      expect(resumed.requests!.usd).toBeCloseTo(35 * absoluteUsd(2), 9);
      // A cut-off last line was never sent, but it may have been a raise: it is settled as one, at the most any request
      // can cost, before anything else is appended, so no later line merges into it and every later resume agrees.
      writeFileSync(join(dir, "requests.jsonl"), `${JSON.stringify({ at: "2026-10-03T00:00:01.000Z", invocation: "2026-10-03T00:00:00.000Z", usd: 0.5 })}\n{"at":"2026-10-03T00:00:02.000Z","adj`);
      writeFileSync(join(dir, "pacing.jsonl"), "");
      posted = 0;
      // A cap of one request admits no cell, so these resumes only read the ledger.
      const torn = await invocation({ resume: true, maxTotalRequests: 1 });
      expect(posted).toBe(0);
      expect(torn.requests).toMatchObject({ cap: 1, sent: 1 });
      expect(torn.requests!.usd).toBeCloseTo(0.5 + absoluteUsd(2), 9);
      const settled = readFileSync(join(dir, "requests.jsonl"), "utf8").split("\n");
      expect(settled).toHaveLength(3);
      expect(settled[2]).toBe("");
      expect(JSON.parse(settled[1]!)).toMatchObject({ adjust: absoluteUsd(2), reason: "a cut-off last line, which may have been a raise" });
      const again = await invocation({ resume: true });
      expect(posted).toBe(0);
      expect(again.requests).toEqual(torn.requests);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs one invocation at a time in a run directory: a concurrent resume refuses before sending anything, and a lock a killed invocation left is taken over", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-lock-"));
    try {
      let posted = 0;
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const fetchImpl = (async () => {
        posted += 1;
        await gate;
        return down();
      }) as typeof fetch;
      const pre = await preflight({ references: [astryx] });
      const invocation = (resume: boolean) =>
        runEvaluation({ runId: "lock", provider: createHostedProvider({ baseUrl: "https://example.test", fetchImpl, pacer: pacer(300) }), references: [astryx], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01"], conditions: ["fresh"], outDir: dir, resume, maxTotalRequests: 100, maxTotalUsd: USD });
      const first = invocation(false);
      while (posted === 0) await new Promise((resolve) => setTimeout(resolve, 5));
      const second = invocation(true);
      setTimeout(release, 100);
      await expect(second).rejects.toThrow(/another invocation/);
      const done = await first;
      expect(done.records).toHaveLength(ARM_COUNT);
      // The first sent one planning request per cell; the refused resume sent none.
      expect(posted).toBe(ARM_COUNT);
      expect(existsSync(join(dir, "run.lock"))).toBe(false);
      // A lock whose process is gone (a killed invocation) is taken over.
      const gone = spawnSync(process.execPath, ["-e", ""]).pid!;
      writeFileSync(join(dir, "run.lock"), `${JSON.stringify({ pid: gone, at: "2026-10-01T00:00:00.000Z" })}\n`);
      await expect(invocation(true)).resolves.toMatchObject({ cells: { reused: ARM_COUNT } });
      expect(existsSync(join(dir, "run.lock"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it("holds the run's dollar ceiling across resumes: each request reserves its own priced worst case before it is sent, a cell is admitted only when its worst case fits, and a resume holds to the recorded ceiling until a new one is named", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-dollars-"));
    try {
      type Body = { system: string; messages: Array<{ role: "user" | "assistant"; content: string }>; jsonSchema: Record<string, unknown>; maxCalls?: 1 | 2 };
      const bodies: Body[] = [];
      const w = workerFetch((kind) => (kind === "plan" ? ok(plan) : kind === "block" ? ok({ block: "records-table", version: 1 }) : ok(exampleFor(astryx, "record-collection"))));
      const fetchImpl = (async (url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Body);
        return w.fetchImpl(url, init);
      }) as typeof fetch;
      const pre = await preflight({ references: [astryx] });
      const invocation = (maxTotalUsd?: number) =>
        runEvaluation({
          runId: "dollars",
          provider: createHostedProvider({ baseUrl: "https://example.test", fetchImpl, pacer: createPacer({ maxRequests: 300, spacingMs: 0, now: () => 0, sleep: async () => undefined }) }),
          references: [astryx],
          corpus,
          preflight: pre,
          allowDrafts: true,
          promptIds: ["rt-01"],
          conditions: ["fresh"],
          outDir: dir,
          resume: existsSync(join(dir, "manifest.json")),
          maxTotalRequests: 1000,
          ...(maxTotalUsd !== undefined ? { maxTotalUsd } : {}),
        });
      const lines = () => readFileSync(join(dir, "requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { usd?: number; adjust?: number });
      // Room for one cell's worst case and a cent: the first cell runs, and the second no longer fits.
      const ceiling = CELL_USD_BOUND + 0.01;
      const first = await invocation(ceiling);
      expect(first.stopped).toMatchObject({ reason: "cap" });
      expect(first.stopped?.message).toMatch(/dollar ceiling.*--max-total-usd/);
      expect(first.records).toHaveLength(1);
      // Each request's line carries its own priced worst case, written before it was sent; every reply verified.
      expect(lines().map((l) => l.usd)).toEqual(bodies.map((b) => worstCaseUsd(b, b.maxCalls ?? 2)));
      expect(lines().filter((l) => l.adjust !== undefined)).toEqual([]);
      const sent = bodies.length;
      // A resume that names no ceiling holds to the recorded one: nothing more is sent.
      const second = await invocation();
      expect(second.stopped?.message).toMatch(/--max-total-usd/);
      expect(bodies).toHaveLength(sent);
      // Raising it is explicit and recorded, and the run continues without its reservations passing the new ceiling.
      const raised = 2 * CELL_USD_BOUND + 0.01;
      const third = await invocation(raised);
      expect(bodies.length).toBeGreaterThan(sent);
      const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      expect(manifest.limits).toMatchObject({ maxTotalRequests: 1000, maxTotalUsd: raised, changes: [{ unit: "usd", from: ceiling, to: raised }] });
      const reserved = lines().reduce((a, l) => a + (l.usd ?? 0) + (l.adjust ?? 0), 0);
      expect(reserved).toBeLessThanOrEqual(raised);
      expect(third.requests?.usd).toBeCloseTo(reserved, 9);
      expect(lines().map((l) => l.usd)).toEqual(bodies.map((b) => worstCaseUsd(b, b.maxCalls ?? 2)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("releases a refusal that reached no model, and raises a reply it cannot verify to the most the request could have cost", async () => {
    const lines: Array<[string, number]> = [];
    const paced = () => {
      const pacer = createPacer({ maxRequests: 100, spacingMs: 0, backoffMs: [0], now: () => 0, sleep: async () => undefined });
      pacer.ledger = {
        cap: 100,
        sent: 0,
        capUsd: USD,
        usd: 0,
        record(usd = 0) {
          lines.push(["request", usd]);
          this.sent += 1;
          this.usd = (this.usd ?? 0) + usd;
        },
        adjust(usd: number, reason: string) {
          lines.push([reason, usd]);
          this.usd = (this.usd ?? 0) + usd;
        },
      };
      return pacer;
    };
    const priced = worstCaseUsd(request, 2);
    const raise = absoluteUsd(2) - priced;
    const served = (outputTokens: number) => reply(200, { json: { a: 1 }, raw: "{}", model: "m", usage: { inputTokens: 10, outputTokens }, calls: [{ inputTokens: 10, outputTokens, outcome: "ok", durationMs: 1 }] });
    let refused = false;
    const cases: Array<[string, () => Response | Promise<Response>, Array<[string, number]>]> = [
      ["a verified reply", () => served(2), [["request", priced]]],
      ["a refusal before any call, then served", () => ((refused = !refused) ? reply(429, { error: "rate-limited", message: "slow down", calls: [] }) : served(2)), [["request", priced], ["refused before any provider call", -priced], ["request", priced]]],
      ["a provider failure without usage", () => reply(502, { error: "provider-unavailable", cause: "provider", message: "down", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 1 }] }), [["request", priced], ["usage not verified", raise]]],
      ["output past the max_tokens the price assumed", () => served(9000), [["request", priced], ["usage not verified", raise]]],
      ["a reply that never arrived", () => Promise.reject(new TypeError("network down")), [["request", priced], ["usage not verified", raise]]],
    ];
    for (const [name, answer, expected] of cases) {
      lines.length = 0;
      const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl: (async () => answer()) as typeof fetch, pacer: paced() });
      await provider.surfaceAdapter({ recorder: createCallRecorder(), meter: createMeter(), refinement: false }).generate(request).catch(() => undefined);
      expect(lines, name).toEqual(expected);
    }
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

