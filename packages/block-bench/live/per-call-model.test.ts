/**
 * Option B, per-call model attribution: the Worker names the model that served every provider call on that call's own
 * entry in calls[], and the harness holds each call to its own model (live/integrity.ts). So a parse retry, an unusable
 * output and an answer the Worker cannot serialize are ordinary results by the same rules as any other call: a call
 * that reports its complete usage and the run's model goes on to the arm, and missing usage, a missing per-call model,
 * another model family or a change of model still stop the run. A reply's top-level model is the app's: it is never
 * given to a call, and it must agree with the calls. The Worker advertises the capability on its zero-cost refusal, and
 * a hosted run refuses to start without it. Fail-first: written against the c154548 harness and Worker, where the
 * reply's top-level model was the only one, so every unusable output stopped the run.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCallRecorder } from "@dspack-studio/composer-core";
import { CAPABILITIES, handlePropose } from "../../../apps/composer/worker/propose.mjs";
import { BUDGET, PRODUCTION_MAX_REPAIRS, exampleFor } from "./arms";
import { readCorpus, type Corpus } from "./corpus";
import { runEvaluation } from "./evaluate";
import { createPacer } from "./pacing";
import { PER_CALL_MODEL, preflight, probeWorker } from "./preflight";
import { CELL_REQUESTS, createHostedProvider } from "./providers/hosted";
import { createMeter } from "./providers/types";
import { loadReference, type LoadedReference } from "./references";
import { main } from "./run";

const HAIKU = "claude-haiku-4-5-20251001";
const LATER = "claude-haiku-4-5-20260301";
const SONNET = "claude-sonnet-4-5-20250929";
const request = { system: "s", messages: [{ role: "user" as const, content: "u" }], jsonSchema: { type: "object" } };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** One calls[] entry as the Option B Worker writes it: both usage figures and the model that served the call. */
const call = (fields: Record<string, unknown> = {}) => ({ inputTokens: 10, outputTokens: 2, model: HAIKU, outcome: "ok", durationMs: 1, ...fields });
const total = (calls: Array<Record<string, unknown>>) => ({
  inputTokens: calls.reduce((a, c) => a + Number(c.inputTokens ?? 0), 0),
  outputTokens: calls.reduce((a, c) => a + Number(c.outputTokens ?? 0), 0),
});
/** The Worker's 200: the proposal, its top-level model (the app's), and its calls. */
const answered = (calls: Array<Record<string, unknown>>, top: Record<string, unknown> = { model: HAIKU }) => reply(200, { json: { a: 1 }, raw: "{}", ...top, usage: total(calls), calls });
/** The Worker's 502 for unusable output: no top-level model, the calls it made. */
const unusable = (calls: Array<Record<string, unknown>>) => reply(502, { error: "provider-unavailable", cause: "unusable-output", message: "no usable output", usage: total(calls), calls });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A pacer bound, as the runner binds it, to a served-model record held in memory; every settlement's reason is kept. */
function bound(id?: string) {
  const pacer = createPacer({ maxRequests: 100, spacingMs: 0, backoffMs: [0], now: () => 0, sleep: async () => undefined });
  const state = { id, recorded: [] as string[] };
  pacer.served = {
    get id() {
      return state.id;
    },
    record(model: string) {
      state.id = model;
      state.recorded.push(model);
    },
  };
  const settlements: string[] = [];
  const adjust = pacer.adjust.bind(pacer);
  pacer.adjust = (usd: number, reason: string) => {
    settlements.push(reason);
    adjust(usd, reason);
  };
  return { pacer, state, settlements };
}

/** One surface request through the hosted client, answered by `answer`. */
function generate(answer: () => Response | Promise<Response>, pacer: ReturnType<typeof createPacer>, maxCalls?: 1 | 2) {
  const recorder = createCallRecorder();
  const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl: (async () => answer()) as typeof fetch, pacer });
  const result = provider.surfaceAdapter({ recorder, meter: createMeter(), refinement: false, ...(maxCalls ? { maxCalls } : {}) }).generate(request);
  return { recorder, result };
}

describe("each call is held to its own model", () => {
  it("a parse retry whose calls each name the run's model continues, each call keeping its own model, and settles at what it reported", async () => {
    const { pacer, state, settlements } = bound();
    const { recorder, result } = generate(() => answered([call({ outcome: "unusable-output", outputTokens: 0 }), call()]), pacer);
    await expect(result).resolves.toMatchObject({ json: { a: 1 }, model: HAIKU });
    expect(recorder.calls.map((c) => [c.outcome, c.model])).toEqual([["unusable-output", HAIKU], ["ok", HAIKU]]);
    expect(state.recorded).toEqual([HAIKU]);
    expect(settlements).toEqual(["settled at the reported usage"]);
  });

  it("a parse retry whose two calls name two models stops the run, even within Claude Haiku 4.5", async () => {
    for (const id of [undefined, HAIKU]) {
      const { pacer, state } = bound(id);
      const { result } = generate(() => answered([call({ outcome: "unusable-output" }), call({ model: LATER })], { model: LATER }), pacer);
      await expect(result, String(id)).rejects.toMatchObject({ name: "RunHalted", condition: "model-changed" });
      expect(state.recorded, String(id)).toEqual([]);
    }
  });

  it("an unusable output that reports its usage and the run's model is the arm's to handle: a typed output failure, never a stop", async () => {
    for (const [maxCalls, calls] of [
      [1, [call({ outcome: "unusable-output", outputTokens: 0 })]],
      [2, [call({ outcome: "unusable-output" }), call({ outcome: "unusable-output", outputTokens: 5 })]],
    ] as const) {
      const { pacer, state, settlements } = bound();
      const { recorder, result } = generate(() => unusable([...calls]), pacer, maxCalls);
      await expect(result, `maxCalls ${maxCalls}`).rejects.toMatchObject({ name: "HarnessError", kind: "output", status: 502, failure: "unusable-output" });
      expect(recorder.calls.map((c) => [c.outcome, c.model, c.source])).toEqual(calls.map(() => ["unusable-output", HAIKU, "provider"]));
      expect(state.recorded).toEqual([HAIKU]);
      expect(settlements).toEqual(["settled at the reported usage"]);
    }
  });

  it("a call that names no model of its own stops the run, whatever the reply names at its top", async () => {
    for (const [name, answer] of [
      ["a success whose only model is the reply's", () => answered([call({ model: undefined })])],
      ["a parse retry whose first call names none", () => answered([call({ outcome: "unusable-output", model: undefined }), call()])],
      ["an unusable output that names none", () => unusable([call({ outcome: "unusable-output", model: undefined })])],
      ["an empty model", () => answered([call({ model: "" })], { model: "" })],
      ["a model that is not a string", () => answered([call({ model: 42 })])],
    ] as const) {
      const { pacer, state } = bound();
      await expect(generate(answer, pacer).result, name).rejects.toMatchObject({ name: "RunHalted", condition: "model-missing" });
      expect(state.recorded, name).toEqual([]);
    }
  });

  it("a call missing either usage figure stops the run, whatever model it names", async () => {
    for (const [name, answer] of [
      ["an unusable output with no input count", () => unusable([call({ outcome: "unusable-output", inputTokens: null })])],
      ["a success with no output count", () => answered([call({ outputTokens: null })])],
      ["the second call of a parse retry with no usage", () => answered([call({ outcome: "unusable-output" }), call({ inputTokens: null, outputTokens: null })])],
    ] as const) {
      const { pacer } = bound();
      await expect(generate(answer, pacer).result, name).rejects.toMatchObject({ name: "RunHalted", condition: "usage-missing" });
    }
  });

  it("another model family on any call, or at the reply's top, stops the run", async () => {
    for (const [name, answer] of [
      ["an unusable output served by another family", () => unusable([call({ outcome: "unusable-output", model: SONNET })])],
      ["the first call of a parse retry served by another family", () => answered([call({ outcome: "unusable-output", model: SONNET }), call()])],
      ["a success whose top-level model is another family", () => answered([call()], { model: SONNET })],
    ] as const) {
      const { pacer, state } = bound();
      await expect(generate(answer, pacer).result, name).rejects.toMatchObject({ name: "RunHalted", condition: "model-family" });
      expect(state.recorded, name).toEqual([]);
    }
  });

  it("a model the reply names at its top that is no model id stops the run, and its request is raised, whatever its calls name", async () => {
    for (const top of [42, null, ["claude-opus-4-1-20250805"], { id: HAIKU }, ""]) {
      const { pacer, state, settlements } = bound();
      await expect(generate(() => answered([call()], { model: top }), pacer).result, JSON.stringify(top)).rejects.toMatchObject({ name: "RunHalted", condition: "model-family" });
      expect(state.recorded, JSON.stringify(top)).toEqual([]);
      expect(settlements, JSON.stringify(top)).toEqual(["usage not verified"]);
    }
  });

  it("a reply whose top-level model is not its calls' stops the run, and every later reply is held to the recorded model call by call", async () => {
    const first = bound();
    await expect(generate(() => answered([call()], { model: LATER }), first.pacer).result).rejects.toMatchObject({ name: "RunHalted", condition: "model-changed" });
    expect(first.state.recorded).toEqual([]);
    const resumed = bound(HAIKU);
    await expect(generate(() => unusable([call({ outcome: "unusable-output", model: LATER })]), resumed.pacer).result).rejects.toMatchObject({ name: "RunHalted", condition: "model-changed" });
    await expect(generate(() => answered([call({ outcome: "unusable-output" }), call()]), resumed.pacer).result).resolves.toMatchObject({ model: HAIKU });
    expect(resumed.state.recorded).toEqual([]);
  });
});

/** The REAL Worker module, its provider answering each call in turn: a result, or a rejection. */
function realWorker(answers: Array<Record<string, unknown> | Error>) {
  let n = 0;
  const env = {
    HOSTED_AI: "on",
    AI: {
      run: async () => {
        const answer = answers[Math.min(n++, answers.length - 1)]!;
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
  return { fetchImpl: (async (url: string, init: RequestInit) => handlePropose(new Request(url, init), env)) as typeof fetch, calls: () => n };
}
const servedBy = (text: string, model: string | undefined, input = 100, output = 10) => ({ content: [{ type: "text", text }], usage: { input_tokens: input, output_tokens: output }, ...(model ? { model } : {}) });

describe("through the real Worker", () => {
  const through = (answers: Array<Record<string, unknown> | Error>, pacer: ReturnType<typeof createPacer>, maxCalls?: 1 | 2) => {
    const w = realWorker(answers);
    const recorder = createCallRecorder();
    const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl: w.fetchImpl, pacer });
    return { recorder, result: provider.surfaceAdapter({ recorder, meter: createMeter(), refinement: false, ...(maxCalls ? { maxCalls } : {}) }).generate(request) };
  };

  it("a parse retry served by one model continues, and an unusable output is an output failure, not a stop", async () => {
    const retry = bound();
    await expect(through([servedBy("Sure! Here it is:", HAIKU), servedBy('{"a":1}', HAIKU)], retry.pacer).result).resolves.toMatchObject({ json: { a: 1 }, model: HAIKU });
    expect(retry.settlements).toEqual(["settled at the reported usage"]);
    const failed = bound();
    const { recorder, result } = through([servedBy("Sure! Here it is:", HAIKU)], failed.pacer, 1);
    await expect(result).rejects.toMatchObject({ name: "HarnessError", kind: "output" });
    expect(recorder.calls).toMatchObject([{ outcome: "unusable-output", model: HAIKU, inputTokens: 100, outputTokens: 10 }]);
    expect(failed.settlements).toEqual(["settled at the reported usage"]);
  });

  it("a provider failure after a call stops the run: the failed call reports no usage", async () => {
    const { pacer, settlements } = bound();
    await expect(through([servedBy("prose", HAIKU), new Error("provider timeout")], pacer).result).rejects.toMatchObject({ name: "RunHalted", condition: "usage-missing" });
    expect(settlements).toEqual(["usage not verified"]);
  });

  it("an answer the Worker cannot serialize is a provider failure with its call metered, never a stop", async () => {
    const deep = "[".repeat(20_000) + "]".repeat(20_000);
    const { pacer, state, settlements } = bound();
    const { recorder, result } = through([servedBy(deep, HAIKU, 900, 8000)], pacer, 1);
    await expect(result).rejects.toMatchObject({ name: "HarnessError", kind: "provider", status: 502, failure: "provider" });
    expect(recorder.calls).toMatchObject([{ source: "provider", outcome: "ok", model: HAIKU, inputTokens: 900, outputTokens: 8000 }]);
    expect(state.recorded).toEqual([HAIKU]);
    expect(settlements).toEqual(["settled at the reported usage"]);
  });

  it("a provider that names no model stops the run: the reply's top-level echo of the configured id is no call's model", async () => {
    const { pacer, state } = bound();
    await expect(through([servedBy('{"a":1}', undefined)], pacer).result).rejects.toMatchObject({ name: "RunHalted", condition: "model-missing" });
    expect(state.recorded).toEqual([]);
  });
});

describe("the deployed Worker says whether it names each call's model, at no model cost", () => {
  it("the capability the harness requires is the one the Worker advertises", () => {
    expect(PER_CALL_MODEL).toBe("per-call-model");
    expect(CAPABILITIES).toContain(PER_CALL_MODEL);
  });

  it("probes the real Worker as per-call-model with one refusal, and calls no model", async () => {
    const posts: string[] = [];
    let modelCalls = 0;
    const env = { HOSTED_AI: "on", AI: { run: async () => (modelCalls++, servedBy("{}", HAIKU)) } };
    const fetchImpl = (async (url: string, init: RequestInit) => (posts.push(String(init.body)), handlePropose(new Request(url, init), env))) as typeof fetch;
    expect(await probeWorker("https://example.test", fetchImpl)).toEqual({ shape: "per-call-model", status: 400, error: "invalid-request", calls: [], capabilities: ["per-call-model"] });
    expect(posts).toEqual(["{}"]);
    expect(modelCalls).toBe(0);
  });

  it("an older Worker fails closed: its refusal never reads as per-call-model", async () => {
    const refusal = (extra: Record<string, unknown>) => (async () => reply(400, { error: "invalid-request", message: "Expected { system, messages, jsonSchema }.", calls: [], ...extra })) as typeof fetch;
    expect(await probeWorker("https://example.test", refusal({}))).toMatchObject({ shape: "phase-0.5" });
    expect(await probeWorker("https://example.test", refusal({ capabilities: ["something-else"] }))).toMatchObject({ shape: "phase-0.5" });
    expect(await probeWorker("https://example.test", refusal({ capabilities: "per-call-model" }))).toMatchObject({ shape: "phase-0.5" });
    const noCalls = (async () => reply(400, { error: "invalid-request", message: "x", capabilities: ["per-call-model"] })) as typeof fetch;
    expect(await probeWorker("https://example.test", noCalls)).toMatchObject({ shape: "pre-0.5" });
  });

  it("a hosted run refuses to start against a Worker that does not name each call's model, before any generation request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-per-call-"));
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const body = typeof init?.body === "string" ? init.body : "";
        seen.push(`${init?.method ?? "GET"} ${url.pathname}${body === "{}" ? " {}" : body ? " generation" : ""}`);
        // The c154548 Worker: calls [] on every refusal, no capability.
        if (url.pathname === "/api/propose") return reply(400, { error: "invalid-request", message: "Expected { system, messages, jsonSchema }.", calls: [] });
        if (url.pathname === "/") return new Response('<script src="/_next/static/OLDBUILD/_buildManifest.js"></script>', { status: 200 });
        if (url.pathname === "/_next/static/OLDBUILD/_buildManifest.js") return new Response("self.__BUILD_MANIFEST={};", { status: 200 });
        if (url.pathname === "/api/models") return reply(200, { models: ["scripted", "hosted-ai"] });
        return new Response("not found", { status: 404 });
      }),
    );
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args.join(" ")));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const code = await main(["--provider", "hosted", "--base-url", "https://old.example", "--prompts", "rt-01", "--conditions", "fresh", "--max-total-usd", "7", "--max-total-requests", "160", "--max-requests", "160", "--spacing-ms", "0", "--out", dir]);
      expect(code).toBe(1);
      expect(errors.join("\n")).toMatch(/per-call-model/);
      expect(seen.filter((s) => s.endsWith(" generation"))).toEqual([]);
      expect(seen).toEqual(["POST /api/propose {}", "GET /", "GET /_next/static/OLDBUILD/_buildManifest.js", "GET /api/models"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("the experiment's budgets do not move", () => {
  it("the call budgets are the ones the experiment was frozen with", () => {
    expect(BUDGET).toBe(3);
    expect(PRODUCTION_MAX_REPAIRS).toBe(2);
    expect(CELL_REQUESTS).toBe(4);
  });
});

describe("the positional auth-form cell that stopped the c154548 smoke", () => {
  let corpus: Corpus;
  let shadcn: LoadedReference;
  beforeAll(async () => {
    corpus = readCorpus();
    shadcn = await loadReference("shadcn-v3");
  }, 60_000);

  const PLAN = { intent: "structured-input", feasible: true, restated: "A sign-in form.", reason: "fits", block: "auth-form", blockReason: "an account form" };
  /** The real Worker, whose provider answers every compact positional block call with prose, as the smoke saw twice. */
  function smokeWorker() {
    let positional = 0;
    const env = {
      HOSTED_AI: "on",
      AI: {
        run: async (_model: string, input: { system: string }) => {
          if (input.system.includes("routing step")) return servedBy(JSON.stringify(PLAN), HAIKU);
          if (input.system.includes("compact positional form")) return (positional++, servedBy("Sure! Here is the sign-in form you asked for.", HAIKU));
          return servedBy(JSON.stringify(exampleFor(shadcn, "structured-input")), HAIKU);
        },
      },
    };
    return { fetchImpl: (async (url: string, init: RequestInit) => handlePropose(new Request(url, init), env)) as typeof fetch, positional: () => positional };
  }
  const run = async (dir: string, fetchImpl: typeof fetch) =>
    runEvaluation({
      runId: "per-call-model",
      provider: createHostedProvider({ baseUrl: "https://example.test", fetchImpl, pacer: createPacer({ maxRequests: 300, spacingMs: 0, backoffMs: [0], now: () => 0, sleep: async () => undefined }) }),
      references: [shadcn],
      corpus,
      preflight: await preflight({ references: [shadcn] }),
      allowDrafts: true,
      promptIds: ["af-01"],
      conditions: ["fresh"],
      arms: ["block-positional", "capped"],
      outDir: dir,
      resume: false,
      maxTotalRequests: 1000,
      maxTotalUsd: 1000,
    });

  it("is an arm result through the Option B Worker: logged as an output failure, and the run goes on to the next cell", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-per-call-"));
    try {
      const w = smokeWorker();
      const result = await run(dir, w.fetchImpl);
      expect(result.stopped).toBeUndefined();
      const records = readFileSync(join(dir, "runs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(records.map((r) => [r.arm, r.prompt, r.status])).toEqual([["block-positional", "af-01", "completed"], ["capped", "af-01", "completed"]]);
      const [positional] = records;
      expect(positional).toMatchObject({ passed: false, outcome: "failed-adapter", path: "provider-failure", failure: { kind: "output", rerunEligible: false } });
      // The block call and its one re-issue (the budget's unusable-output rule), each metered and attributed.
      expect(w.positional()).toBe(2);
      expect(positional.calls.map((c: { operation: string; outcome: string; model?: string; reissue?: boolean }) => [c.operation, c.outcome, c.model, c.reissue ?? false])).toEqual([
        ["plan", "ok", HAIKU, false],
        ["block", "unusable-output", HAIKU, false],
        ["block", "unusable-output", HAIKU, true],
      ]);
      expect(positional.tokens).toMatchObject({ providerCalls: 3, unreportedCalls: 0 });
      expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).servedModel).toMatchObject({ id: HAIKU });
      // Every request was settled at what it reported: nothing was raised to a bound.
      const ledger = readFileSync(join(dir, "requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { reason?: string });
      expect([...new Set(ledger.map((l) => l.reason).filter(Boolean))]).toEqual(["settled at the reported usage"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("the same run against a Worker whose calls name no model still fails closed, at its first call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-per-call-"));
    try {
      const w = smokeWorker();
      // The c154548 reply shape: the per-call models stripped from every reply.
      const old = (async (url: string, init: RequestInit) => {
        const res = await w.fetchImpl(url, init);
        const body = (await res.json()) as { calls?: Array<Record<string, unknown>> };
        if (Array.isArray(body.calls)) body.calls = body.calls.map(({ model: _model, ...rest }) => rest);
        return reply(res.status, body);
      }) as typeof fetch;
      const result = await run(dir, old);
      expect(result.stopped).toMatchObject({ reason: "integrity" });
      expect(result.stopped?.message).toMatch(/^model-missing: a plan call/);
      expect(result.records).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
