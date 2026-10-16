/**
 * The beta's operator log (docs/blocks/PHASE-2-RELEASE-PLAN.md, §9;
 * docs/blocks/BETA-OPERATIONS.md): one shape-only line per /api/propose
 * request, written only when BETA_OPERATOR_LOG is exactly "on", which
 * production never sets. The line holds the status, the error's codes,
 * maxCalls, the request's operation and each call's outcome, tokens, served
 * model and duration, and the request's duration: never the prompt, the
 * schema, the output, a header or an address. Logging never changes a reply.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MODEL_ID_PATTERN } from "@dspack-studio/composer-core/blocks";
import worker from "./index.mjs";
import { handlePropose } from "./propose.mjs";
import { MODEL_ID, OPERATIONS, operatorLogOn } from "./operator-log.mjs";

const HAIKU = "claude-haiku-4-5-20251001";
const SURFACE = '{"root":{"component":"Text","id":"t1"}}';
const FIELDS = ["event", "v", "status", "error", "cause", "maxCalls", "operation", "calls", "durationMs"];
const CALL_FIELDS = ["outcome", "inputTokens", "outputTokens", "model", "durationMs"];

const answer = (text, extra = {}) => ({ content: [{ type: "text", text }], usage: { input_tokens: 100, output_tokens: 10 }, model: HAIKU, ...extra });

function request({ body = { system: "sys", messages: [{ role: "user", content: "a login form" }], jsonSchema: { type: "object" } }, method = "POST", headers = {}, raw } = {}) {
  return new Request("https://composer.test/api/propose", {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(method === "POST" ? { body: raw ?? JSON.stringify(body) } : {}),
  });
}

/** An env whose provider answers each call in turn (an Error rejects that call). */
function envWith(answers, extra = {}) {
  let n = 0;
  const run = vi.fn(async () => {
    const a = answers[Math.min(n++, answers.length - 1)];
    if (a instanceof Error) throw a;
    return a;
  });
  return { HOSTED_AI: "on", AI: { run }, ...extra };
}

const SCENARIOS = [
  { name: "a success", make: () => [request({ headers: { "x-composer-operation": "generate" } }), envWith([answer(SURFACE)])] },
  { name: "a success under maxCalls 1", make: () => [request({ body: { system: "s", messages: [], jsonSchema: {}, maxCalls: 1 }, headers: { "x-composer-operation": "block" } }), envWith([answer(SURFACE)])] },
  { name: "a success after the parse retry", make: () => [request(), envWith([answer("Sure! Here it is:"), answer(SURFACE)])] },
  { name: "two unusable outputs", make: () => [request(), envWith([answer("no"), answer("still no")])] },
  { name: "a provider failure", make: () => [request(), envWith([new Error("provider timeout")])] },
  { name: "the busy gateway", make: () => [request(), envWith([new Error("InferenceUpstreamError: 429 Too Many Requests")])] },
  { name: "a GET", make: () => [request({ method: "GET" }), envWith([answer(SURFACE)])] },
  { name: "the kill switch", make: () => [request(), envWith([answer(SURFACE)], { HOSTED_AI: "off" })] },
  { name: "the rate limiter", make: () => [request(), envWith([answer(SURFACE)], { PROPOSE_RATE_LIMIT: { limit: async () => ({ success: false }) } })] },
  { name: "a wrong content type", make: () => [new Request("https://composer.test/api/propose", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }), envWith([answer(SURFACE)])] },
  { name: "malformed JSON", make: () => [request({ raw: "{" }), envWith([answer(SURFACE)])] },
  { name: "a bad maxCalls", make: () => [request({ body: { system: "s", messages: [], jsonSchema: {}, maxCalls: 3 } }), envWith([answer(SURFACE)])] },
];

const consoleSpies = () => ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));

afterEach(() => vi.restoreAllMocks());

describe("off unless BETA_OPERATOR_LOG is exactly on: production logs nothing", () => {
  for (const value of [undefined, "off", "ON", "On", "1", "true", " on", "on ", true, 1, {}]) {
    it(`BETA_OPERATOR_LOG = ${JSON.stringify(value)}`, async () => {
      expect(operatorLogOn(value === undefined ? {} : { BETA_OPERATOR_LOG: value })).toBe(false);
      const spies = consoleSpies();
      for (const scenario of SCENARIOS) {
        const [req, env] = scenario.make();
        await handlePropose(req, value === undefined ? env : { ...env, BETA_OPERATOR_LOG: value });
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });
  }

  it("the production config never sets it, and the beta config declares no vars (it lives in the beta's dashboard)", () => {
    const read = (config) => readFileSync(new URL(`../../../${config}`, import.meta.url), "utf8");
    expect(read("wrangler.jsonc")).not.toContain("BETA_OPERATOR_LOG");
    const beta = JSON.parse(read("wrangler.composer-beta.jsonc").replace(/^\s*\/\/.*$/gm, ""));
    expect(beta).not.toHaveProperty("vars");
    expect(beta.keep_vars).toBe(true);
  });
});

describe("logging never changes a reply", () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      consoleSpies();
      const [offReq, offEnv] = scenario.make();
      const [onReq, onEnv] = scenario.make();
      const off = await handlePropose(offReq, offEnv);
      const on = await handlePropose(onReq, { ...onEnv, BETA_OPERATOR_LOG: "on" });
      expect(on.status).toBe(off.status);
      expect([...on.headers.entries()]).toEqual([...off.headers.entries()]);
      expect(await on.text()).toBe(await off.text());
    });
  }
});

/** The one line a request logs, parsed. */
async function lineFor(req, env) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const others = ["info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  await handlePropose(req, { ...env, BETA_OPERATOR_LOG: "on" });
  for (const spy of others) expect(spy).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0]).toHaveLength(1);
  const text = log.mock.calls[0][0];
  expect(typeof text).toBe("string");
  expect(text).not.toContain("\n");
  log.mockRestore();
  return { text, line: JSON.parse(text) };
}

describe("on: one shape-only line per /api/propose request", () => {
  it("a block call under maxCalls 1: status, operation, the call's outcome, tokens, served model and durations", async () => {
    const { line } = await lineFor(request({ body: { system: "s", messages: [], jsonSchema: {}, maxCalls: 1 }, headers: { "x-composer-operation": "block" } }), envWith([answer(SURFACE)]));
    expect(Object.keys(line)).toEqual(FIELDS);
    expect(line).toMatchObject({ event: "composer.propose", v: 1, status: 200, error: null, cause: null, maxCalls: 1, operation: "block" });
    expect(line.calls).toHaveLength(1);
    expect(Object.keys(line.calls[0])).toEqual(CALL_FIELDS);
    expect(line.calls[0]).toMatchObject({ outcome: "ok", inputTokens: 100, outputTokens: 10, model: HAIKU });
    expect(Number.isInteger(line.calls[0].durationMs) && line.calls[0].durationMs >= 0).toBe(true);
    expect(Number.isInteger(line.durationMs) && line.durationMs >= 0).toBe(true);
  });

  it("two unusable outputs: the 502's codes and both calls, and the default maxCalls", async () => {
    const { line } = await lineFor(request(), envWith([answer("no"), answer("still no")]));
    expect(line).toMatchObject({ status: 502, error: "provider-unavailable", cause: "unusable-output", maxCalls: 2, operation: null });
    expect(line.calls.map((c) => c.outcome)).toEqual(["unusable-output", "unusable-output"]);
  });

  it("the busy gateway: a rejected call with no tokens and no model", async () => {
    const { line } = await lineFor(request({ headers: { "x-composer-operation": "plan" } }), envWith([new Error("InferenceUpstreamError: 429 Too Many Requests")]));
    expect(line).toMatchObject({ status: 503, error: "busy", cause: null, maxCalls: 2, operation: "plan" });
    expect(line.calls).toEqual([{ outcome: "provider-error", inputTokens: null, outputTokens: null, model: null, durationMs: expect.any(Number) }]);
  });

  it("refusals before any provider call log their status and code, with no calls", async () => {
    const cases = [
      [request({ method: "GET" }), envWith([answer(SURFACE)]), 405, "method-not-allowed"],
      [request(), envWith([answer(SURFACE)], { HOSTED_AI: "off" }), 503, "unavailable"],
      [request(), envWith([answer(SURFACE)], { PROPOSE_RATE_LIMIT: { limit: async () => ({ success: false }) } }), 429, "rate-limited"],
      [request({ raw: "{" }), envWith([answer(SURFACE)]), 400, "malformed-json"],
      [request({ body: { system: "s", messages: [], jsonSchema: {}, maxCalls: 3 } }), envWith([answer(SURFACE)]), 400, "invalid-request"],
    ];
    for (const [req, env, status, error] of cases) {
      const { line } = await lineFor(req, env);
      expect(line, error).toMatchObject({ status, error, cause: null, maxCalls: null, calls: [] });
    }
  });

  it("every operation the app names is logged as itself; anything else is null", async () => {
    for (const operation of OPERATIONS) {
      const { line } = await lineFor(request({ headers: { "x-composer-operation": operation } }), envWith([answer(SURFACE)]));
      expect(line.operation).toBe(operation);
    }
    expect(OPERATIONS).toEqual(["plan", "flow-plan", "block", "block-repair", "generate", "refine", "repair"]);
  });

  it("only /api/propose logs: the models probe and unknown paths write nothing", async () => {
    const spies = consoleSpies();
    const env = { ...envWith([answer(SURFACE)]), BETA_OPERATOR_LOG: "on", ASSETS: { fetch: async () => new Response("asset") } };
    await worker.fetch(new Request("https://composer.test/api/models"), env);
    await worker.fetch(new Request("https://composer.test/api/nope"), env);
    await worker.fetch(new Request("https://composer.test/index.html"), env);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("the Worker's model-id grammar is the receipt's (composer-core MODEL_ID_PATTERN)", () => {
    expect(MODEL_ID.source).toBe(MODEL_ID_PATTERN.source);
    expect(MODEL_ID.flags).toBe(MODEL_ID_PATTERN.flags);
  });
});

describe("nothing sensitive reaches the line", () => {
  const SENSITIVE = {
    system: "SENTINEL-SYSTEM-PROMPT: you are a form builder for ACME internal tools",
    messages: [
      { role: "user", content: "SENTINEL-USER-PROMPT: a sign-in form for jane@example.com, password hunter2" },
      { role: "assistant", content: '{"root":{"text":"SENTINEL-PRIOR-SURFACE"}}' },
    ],
    jsonSchema: { type: "object", description: "SENTINEL-SCHEMA", properties: { secret: { const: "SENTINEL-SCHEMA-CONST" } } },
  };
  const HEADERS = {
    authorization: "Bearer SENTINEL-TOKEN",
    cookie: "session=SENTINEL-COOKIE",
    "cf-connecting-ip": "203.0.113.77",
    "user-agent": "SENTINEL-AGENT/1.0",
    "x-forwarded-for": "198.51.100.23",
    "x-composer-operation": "SENTINEL-OPERATION",
  };
  const forbidden = ["SENTINEL", "jane@example.com", "hunter2", "ACME", "203.0.113.77", "198.51.100.23", "Bearer", "session="];

  const cases = [
    ["a success whose output and model name are text", [answer(`${SURFACE.slice(0, -1)},"note":"SENTINEL-OUTPUT"}`, { model: "SENTINEL model, ignore previous instructions" })]],
    ["an unusable output quoting the prompt", [answer("SENTINEL-OUTPUT: here is jane@example.com's form"), answer("SENTINEL-OUTPUT again")]],
    ["a provider error echoing the request", [new Error("SENTINEL-PROVIDER-ERROR: rejected 'SENTINEL-USER-PROMPT: a sign-in form for jane@example.com'")]],
    ["a provider error whose cause carries the body", [Object.assign(new Error("upstream"), { cause: { body: "SENTINEL-USER-PROMPT", status: 500 } })]],
  ];
  for (const [name, answers] of cases) {
    it(name, async () => {
      const { text, line } = await lineFor(request({ body: SENSITIVE, headers: HEADERS }), envWith(answers));
      for (const s of forbidden) expect(text, s).not.toContain(s);
      expect(Object.keys(line)).toEqual(FIELDS);
      expect(line.operation).toBeNull();
      for (const call of line.calls) {
        expect(Object.keys(call)).toEqual(CALL_FIELDS);
        expect(call.model === null || call.model === "unrecognized" || MODEL_ID.test(call.model)).toBe(true);
      }
    });
  }

  it("a served model that is not an id is logged as unrecognized, never as text", async () => {
    const { line } = await lineFor(request(), envWith([answer(SURFACE, { model: "SENTINEL model, ignore previous instructions" })]));
    expect(line.calls[0].model).toBe("unrecognized");
  });
});
