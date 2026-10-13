/**
 * Worker propose — bounded retry on unusable provider OUTPUT only.
 *
 * Field measurement: the provider sometimes returns unusable output (prose
 * around the JSON, a fence, truncation); a single retry succeeded 4/4 when it
 * happened. These tests pin the ratified behavior: exactly ONE retry when the
 * model call SUCCEEDED but its output could not be parsed, and NO retry at
 * all for provider failures (429/busy/timeout/kill-switch) — the shared zone
 * limit must never be hammered.
 *
 * Fail-first: written against the one-shot implementation, where the retry
 * assertions (200 after one garbage response; two calls, never three) fail.
 * The 429 test pins existing behavior that must SURVIVE the change.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as worker from "./propose.mjs";

const VALID = { system: "sys", messages: [{ role: "user", content: "a login form" }], jsonSchema: { type: "object" } };
const SURFACE = '{"root":{"component":"Text","id":"t1"}}';

const post = () =>
  new Request("https://composer.test/api/propose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(VALID),
  });

/** Anthropic-shaped provider result carrying `text` as its content. */
const text = (t) => ({ content: [{ type: "text", text: t }] });

describe("hosted propose — bounded retry on unusable output", () => {
  it("retries ONCE when the provider returns prose instead of JSON, then succeeds", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(text("Sure! Here is the surface you asked for:"))
      .mockResolvedValueOnce(text(SURFACE));
    const res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.json).toEqual({ root: { component: "Text", id: "t1" } });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a truncated fenced payload also gets exactly one retry, and fence-stripping still works on the retry", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(text('```json\n{"root": {"component": "Te'))
      .mockResolvedValueOnce(text("```json\n" + SURFACE + "\n```"));
    const res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(200);
    expect((await res.json()).json).toEqual({ root: { component: "Text", id: "t1" } });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("two unusable outputs return the existing 502 provider-unavailable shape — and there is NO third call", async () => {
    const run = vi.fn().mockResolvedValue(text("I cannot help with that."));
    const res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("provider-unavailable");
    expect(body.message).toMatch(/did not return a usable proposal/i);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("provider rate-limiting (429 shape) is NEVER retried — one call, classified busy", async () => {
    const run = vi.fn().mockRejectedValue(new Error("InferenceUpstreamError: 429 Too Many Requests"));
    const res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("busy");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("the model-call+parse helper is exported and retries exactly once (unit, injected fake env.AI)", async () => {
    const run = vi.fn().mockResolvedValueOnce(text("garbage")).mockResolvedValueOnce(text(SURFACE));
    const out = await worker.callModel({ AI: { run } }, "anthropic/claude-haiku-4.5", VALID);
    expect(out.json).toEqual({ root: { component: "Text", id: "t1" } });
    expect(run).toHaveBeenCalledTimes(2);
  });
});

/* ---------------------------------------------------------------------------
 * Phase 0.5 — accounting. Every provider call the Worker makes is reported,
 * in the canonical {inputTokens, outputTokens} shape dspack-gen reads, on
 * success AND on every error reply sent after a provider call. Fail-first:
 * written against the {in, out} single-usage implementation.
 * ------------------------------------------------------------------------- */

/** Anthropic-shaped provider result with provider-reported usage. */
const metered = (t, input, output) => ({ ...text(t), usage: { input_tokens: input, output_tokens: output } });

const postWith = (extra) =>
  new Request("https://composer.test/api/propose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...VALID, ...extra }),
  });

describe("hosted propose — every provider call is accounted", () => {
  it("success reports canonical usage keys, never the legacy {in, out}", async () => {
    const run = vi.fn().mockResolvedValueOnce(metered(SURFACE, 1200, 80));
    const body = await (await worker.handlePropose(post(), { AI: { run } })).json();
    expect(body.usage).toEqual({ inputTokens: 1200, outputTokens: 80 });
    expect(body.calls).toHaveLength(1);
    expect(body.calls[0]).toMatchObject({ inputTokens: 1200, outputTokens: 80, outcome: "ok" });
    expect(typeof body.calls[0].durationMs).toBe("number");
  });

  it("usage is SUMMED across the parse retry, and both calls are listed in order", async () => {
    const run = vi.fn().mockResolvedValueOnce(metered("Sure! Here it is:", 1000, 40)).mockResolvedValueOnce(metered(SURFACE, 1000, 90));
    const res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usage).toEqual({ inputTokens: 2000, outputTokens: 130 });
    expect(body.calls.map((c) => c.outcome)).toEqual(["unusable-output", "ok"]);
    expect(body.calls.map((c) => c.outputTokens)).toEqual([40, 90]);
  });

  it("two unusable outputs: the 502 keeps its error and gains cause, usage and calls", async () => {
    const run = vi.fn().mockResolvedValue(metered("I cannot help with that.", 900, 12));
    const res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("provider-unavailable");
    expect(body.cause).toBe("unusable-output");
    expect(body.usage).toEqual({ inputTokens: 1800, outputTokens: 24 });
    expect(body.calls.map((c) => c.outcome)).toEqual(["unusable-output", "unusable-output"]);
  });

  it("a provider failure (timeout/transport) is a 502 with cause provider and one unmetered call", async () => {
    const run = vi.fn().mockRejectedValue(new Error("provider timeout"));
    const res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("provider-unavailable");
    expect(body.cause).toBe("provider");
    expect(body.usage).toBeNull();
    expect(body.calls).toHaveLength(1);
    expect(body.calls[0]).toMatchObject({ inputTokens: null, outputTokens: null, outcome: "provider-error" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a busy reply after an unusable first output still carries that first call's usage", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(metered("prose", 700, 30))
      .mockRejectedValueOnce(new Error("InferenceUpstreamError: 429 Too Many Requests"));
    const res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("busy");
    expect(body.usage).toEqual({ inputTokens: 700, outputTokens: 30 });
    expect(body.calls.map((c) => c.outcome)).toEqual(["unusable-output", "provider-error"]);
  });

  it("refusals before any provider call say so explicitly: calls is empty and there is no usage", async () => {
    const killed = await (await worker.handlePropose(post(), { HOSTED_AI: "off", AI: { run: vi.fn() } })).json();
    expect(killed.error).toBe("unavailable");
    expect(killed.calls).toEqual([]);
    expect(killed.usage).toBeUndefined();
    const limiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const limited = await worker.handlePropose(post(), { AI: { run: vi.fn() }, PROPOSE_RATE_LIMIT: limiter });
    expect(limited.status).toBe(429);
    expect((await limited.json()).calls).toEqual([]);
  });
});

describe("hosted propose — maxCalls caps the parse retry", () => {
  it("maxCalls 1 makes exactly one provider call and reports the unusable output", async () => {
    const run = vi.fn().mockResolvedValue(metered("prose", 500, 9));
    const res = await worker.handlePropose(postWith({ maxCalls: 1 }), { AI: { run } });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.cause).toBe("unusable-output");
    expect(body.calls).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("maxCalls 2 is today's behavior (one retry)", async () => {
    const run = vi.fn().mockResolvedValueOnce(text("prose")).mockResolvedValueOnce(text(SURFACE));
    const res = await worker.handlePropose(postWith({ maxCalls: 2 }), { AI: { run } });
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([0, 3, "1", 1.5, null])("maxCalls %j is rejected as an invalid request before any provider call", async (maxCalls) => {
    const run = vi.fn();
    const res = await worker.handlePropose(postWith({ maxCalls }), { AI: { run } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid-request");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("hosted propose — a rejection value that cannot be stringified still reports its call", () => {
  it("one provider call that rejected with a null-prototype object is still listed", async () => {
    const run = vi.fn().mockRejectedValue(Object.create(null));
    const res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.cause).toBe("provider");
    expect(body.calls).toHaveLength(1);
    expect(body.calls[0].outcome).toBe("provider-error");
    expect(run).toHaveBeenCalledTimes(1);
  });
});

/* ---------------------------------------------------------------------------
 * Option B: every provider call names the model that served it. The Worker
 * reads the model from the provider's response as soon as it arrives, before
 * parsing, validation, the retry decision or the reply's serialization, and
 * keeps it on that call's entry in calls[] on every reply sent after a call.
 * The reply's top-level model stays as it was, for the app. Every refusal made
 * before a provider call advertises the capability, so a probe that costs no
 * provider call can tell this Worker from an older one. Fail-first: written
 * against the Worker whose calls[] entries name no model.
 * ------------------------------------------------------------------------- */

const HAIKU = "claude-haiku-4-5-20251001";
/** A provider result served by `model`, with full provider-reported usage. */
const servedBy = (t, model, input = 100, output = 10) => ({ ...metered(t, input, output), model });
const ERROR_KEYS = ["calls", "cause", "error", "message", "usage"];

describe("hosted propose — every call names the model that served it (Option B)", () => {
  it("reads the model as soon as the response arrives: a response whose text cannot even be read keeps its model and usage", async () => {
    const unreadable = {
      model: HAIKU,
      usage: { input_tokens: 300, output_tokens: 7 },
      get content() {
        throw new Error("unreadable content");
      },
    };
    const run = vi.fn().mockResolvedValue(unreadable);
    const res = await worker.handlePropose(postWith({ maxCalls: 1 }), { AI: { run } });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.cause).toBe("unusable-output");
    expect(body.calls).toEqual([{ inputTokens: 300, outputTokens: 7, model: HAIKU, outcome: "unusable-output", durationMs: expect.any(Number) }]);
  });

  it("reads the model and usage before the output: reading the text cannot change what the call records", async () => {
    // A response whose text, once read, rewrites its model and usage: only a read made before parsing sees the originals.
    for (const text of [SURFACE, "not json"]) {
      const response = {
        model: HAIKU,
        usage: { input_tokens: 300, output_tokens: 7 },
        get content() {
          this.model = "rewritten-after-parse";
          this.usage = { input_tokens: 1, output_tokens: 1 };
          return [{ type: "text", text }];
        },
      };
      const run = vi.fn().mockResolvedValue(response);
      const body = await (await worker.handlePropose(postWith({ maxCalls: 1 }), { AI: { run } })).json();
      expect(body.calls, text).toEqual([{ inputTokens: 300, outputTokens: 7, model: HAIKU, outcome: text === SURFACE ? "ok" : "unusable-output", durationMs: expect.any(Number) }]);
    }
  });

  it("a response whose model or usage cannot be read still keeps its call, and every earlier one, with what could be read", async () => {
    const throwing = (key, value) => ({
      ...metered(SURFACE, 300, 7),
      model: HAIKU,
      ...value,
      get [key]() {
        throw new Error(`unreadable ${key}`);
      },
    });
    // The model cannot be read: the call keeps its usage and names no model. Its top-level model cannot be read either,
    // so the Worker treats the answer as unusable.
    let run = vi.fn().mockResolvedValue(throwing("model", {}));
    let res = await worker.handlePropose(postWith({ maxCalls: 1 }), { AI: { run } });
    expect(res.status).toBe(502);
    expect((await res.json()).calls).toEqual([{ inputTokens: 300, outputTokens: 7, outcome: "unusable-output", durationMs: expect.any(Number) }]);
    // The usage cannot be read, on the retry of an unusable first call: both calls are kept, the second with no usage.
    run = vi.fn().mockResolvedValueOnce(servedBy("prose", HAIKU, 700, 30)).mockResolvedValueOnce(throwing("usage", {}));
    res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(200);
    expect((await res.json()).calls).toEqual([
      { inputTokens: 700, outputTokens: 30, model: HAIKU, outcome: "unusable-output", durationMs: expect.any(Number) },
      { inputTokens: null, outputTokens: null, model: HAIKU, outcome: "ok", durationMs: expect.any(Number) },
    ]);
  });

  it("an unusable output keeps its call's model and usage on the 502, and the reply carries nothing of the output itself", async () => {
    const run = vi.fn().mockResolvedValue(servedBy("Sure! Here is the form you asked for.", HAIKU, 500, 9));
    const res = await worker.handlePropose(postWith({ maxCalls: 1 }), { AI: { run } });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(ERROR_KEYS);
    expect(body.error).toBe("provider-unavailable");
    expect(body.cause).toBe("unusable-output");
    expect(body.usage).toEqual({ inputTokens: 500, outputTokens: 9 });
    expect(body.calls).toEqual([{ inputTokens: 500, outputTokens: 9, model: HAIKU, outcome: "unusable-output", durationMs: expect.any(Number) }]);
    expect(JSON.stringify(body)).not.toContain("Here is the form");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a parse retry keeps each call's own model, in order, and the top-level model stays the final call's", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(servedBy("prose", "claude-haiku-4-5-20251001", 400, 20))
      .mockResolvedValueOnce(servedBy(SURFACE, "claude-haiku-4-5-20260301", 400, 30));
    const res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.calls).toEqual([
      { inputTokens: 400, outputTokens: 20, model: "claude-haiku-4-5-20251001", outcome: "unusable-output", durationMs: expect.any(Number) },
      { inputTokens: 400, outputTokens: 30, model: "claude-haiku-4-5-20260301", outcome: "ok", durationMs: expect.any(Number) },
    ]);
    expect(body.model).toBe("claude-haiku-4-5-20260301");
    expect(body.usage).toEqual({ inputTokens: 800, outputTokens: 50 });
  });

  it("two unusable outputs: the 502 lists both calls, each with its own model and usage, and makes no third call", async () => {
    const run = vi.fn().mockResolvedValueOnce(servedBy("no", "m-1", 100, 1)).mockResolvedValueOnce(servedBy("still no", "m-2", 100, 2));
    const res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.cause).toBe("unusable-output");
    expect(body.calls.map((c) => [c.model, c.outcome, c.outputTokens])).toEqual([["m-1", "unusable-output", 1], ["m-2", "unusable-output", 2]]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a provider failure after a call keeps the earlier call's model; the failed call, which returned nothing, names none", async () => {
    const run = vi.fn().mockResolvedValueOnce(servedBy("prose", HAIKU, 700, 30)).mockRejectedValueOnce(new Error("provider timeout"));
    const res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.cause).toBe("provider");
    expect(body.usage).toEqual({ inputTokens: 700, outputTokens: 30 });
    expect(body.calls).toEqual([
      { inputTokens: 700, outputTokens: 30, model: HAIKU, outcome: "unusable-output", durationMs: expect.any(Number) },
      { inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: expect.any(Number) },
    ]);
  });

  it("an answer that parses but cannot be serialized still reports its call, with its model and usage, and none of the answer", async () => {
    // JSON.parse reads nesting this deep; JSON.stringify cannot write it back (Maximum call stack size exceeded).
    const deep = "[".repeat(20_000) + "]".repeat(20_000);
    const run = vi.fn().mockResolvedValue(servedBy(deep, HAIKU, 900, 8000));
    const res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(ERROR_KEYS);
    expect(body.error).toBe("provider-unavailable");
    // Unchanged classification: the call itself succeeded, the Worker's reply failed.
    expect(body.cause).toBe("provider");
    expect(body.usage).toEqual({ inputTokens: 900, outputTokens: 8000 });
    expect(body.calls).toEqual([{ inputTokens: 900, outputTokens: 8000, model: HAIKU, outcome: "ok", durationMs: expect.any(Number) }]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a response that names no model leaves its call without one, never the configured id; the top-level model keeps its fallback for the app", async () => {
    for (const named of [undefined, "", 42, null]) {
      const run = vi.fn().mockResolvedValue({ ...metered(SURFACE, 100, 10), ...(named === undefined ? {} : { model: named }) });
      const body = await (await worker.handlePropose(post(), { AI: { run } })).json();
      expect(body.calls, String(named)).toEqual([{ inputTokens: 100, outputTokens: 10, outcome: "ok", durationMs: expect.any(Number) }]);
      expect(body.model, String(named)).toBe(named === "" || named === 42 ? named : "anthropic/claude-haiku-4.5");
    }
  });

  it("the busy gateway's rejected call names no model, so a refusal that reached no model still reads as one", async () => {
    const run = vi.fn().mockRejectedValue(new Error("InferenceUpstreamError: 429 Too Many Requests"));
    const body = await (await worker.handlePropose(post(), { AI: { run } })).json();
    expect(body.error).toBe("busy");
    expect(body.calls).toEqual([{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: expect.any(Number) }]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("every refusal made before a provider call advertises the per-call-model capability, and no model is called", async () => {
    expect(worker.CAPABILITIES).toEqual(["per-call-model"]);
    const run = vi.fn();
    const raw = (init) => new Request("https://composer.test/api/propose", init);
    const json = { method: "POST", headers: { "content-type": "application/json" } };
    const refusals = [
      [405, await worker.handlePropose(raw({ method: "GET" }), { AI: { run } })],
      [503, await worker.handlePropose(post(), { HOSTED_AI: "off", AI: { run } })],
      [429, await worker.handlePropose(post(), { AI: { run }, PROPOSE_RATE_LIMIT: { limit: vi.fn().mockResolvedValue({ success: false }) } })],
      [503, await worker.handlePropose(post(), { AI: { run }, PROPOSE_RATE_LIMIT: { limit: vi.fn().mockRejectedValue(new Error("limiter down")) } })],
      [415, await worker.handlePropose(raw({ method: "POST", headers: { "content-type": "text/plain" }, body: "x" }), { AI: { run } })],
      [413, await worker.handlePropose(raw({ ...json, body: "x".repeat(512 * 1024 + 1) }), { AI: { run } })],
      [400, await worker.handlePropose(raw({ ...json, body: "{" }), { AI: { run } })],
      [400, await worker.handlePropose(raw({ ...json, body: "{}" }), { AI: { run } })],
      [400, await worker.handlePropose(postWith({ maxCalls: 3 }), { AI: { run } })],
    ];
    for (const [status, res] of refusals) {
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body.calls, body.error).toEqual([]);
      expect(body.capabilities, body.error).toEqual(["per-call-model"]);
      expect(body.usage, body.error).toBeUndefined();
      expect(body.model, body.error).toBeUndefined();
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("sends the provider exactly what it sent before Option B, whatever maxCalls says, its parse retry included", async () => {
    // sha256 of env.AI.run's arguments for this request, pinned on the Worker at c154548 (before Option B): one call,
    // and the two calls of a parse retry (an unusable first answer, then a usable one).
    const PINNED = "e7260328c794adc9fa4cd579df3a376d2e4acced134bb5598f65887736752b82";
    const PINNED_RETRY = "44afc307962c3034580839cb49fa1355863853e881b63aacc6bde847dbc29103";
    const hash = (run) => createHash("sha256").update(JSON.stringify(run.mock.calls)).digest("hex");
    for (const extra of [{}, { maxCalls: 1 }, { maxCalls: 2 }]) {
      const run = vi.fn().mockResolvedValue(servedBy('{"a":1}', HAIKU, 5, 1));
      await worker.handlePropose(postWith(extra), { AI: { run } });
      expect(hash(run), JSON.stringify(extra)).toBe(PINNED);
    }
    for (const extra of [{}, { maxCalls: 2 }]) {
      const run = vi.fn().mockResolvedValueOnce(servedBy("prose", HAIKU, 5, 1)).mockResolvedValueOnce(servedBy('{"a":1}', HAIKU, 5, 1));
      await worker.handlePropose(postWith(extra), { AI: { run } });
      expect(run, JSON.stringify(extra)).toHaveBeenCalledTimes(2);
      expect(hash(run), JSON.stringify(extra)).toBe(PINNED_RETRY);
    }
  });

  it("every reply keeps the endpoint's headers: success, an unusable output, an unserializable answer, and a refusal", async () => {
    const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
    const deep = "[".repeat(20_000) + "]".repeat(20_000);
    const replies = [
      await worker.handlePropose(post(), { AI: { run: vi.fn().mockResolvedValue(servedBy(SURFACE, HAIKU)) } }),
      await worker.handlePropose(postWith({ maxCalls: 1 }), { AI: { run: vi.fn().mockResolvedValue(servedBy("prose", HAIKU)) } }),
      await worker.handlePropose(post(), { AI: { run: vi.fn().mockResolvedValue(servedBy(deep, HAIKU)) } }),
      await worker.handlePropose(postWith({ maxCalls: 3 }), { AI: { run: vi.fn() } }),
    ];
    expect(replies.map((r) => r.status)).toEqual([200, 502, 502, 400]);
    for (const res of replies) expect(Object.fromEntries(res.headers), String(res.status)).toEqual(HEADERS);
  });
});

/* ---------------------------------------------------------------------------
 * A gateway 429 read from its status, not only from its message. In the
 * Astryx stage-3 run, request #539 was refused by the gateway with HTTP 429
 * and no usage, but the binding's error named none of the busy words, so the
 * Worker answered 502 provider and the paced run stopped on it. workerd's AI
 * binding (src/cloudflare/internal/ai-api.ts) records the status of the reply
 * it received in `lastRequestHttpStatusCode`, then throws an error carrying
 * only a name and a message. A structured 429 on a call that reached no model
 * is busy; the message stays a fallback; a status that is not 429, a status
 * that may be another call's, and anything showing a model result fail closed.
 * Fail-first: written against the message-only classifier.
 * ------------------------------------------------------------------------- */

/** The binding's own error: a name and a message, nothing else. */
const upstream = (message, extra = {}) => Object.assign(new Error(message), { name: "InferenceUpstreamError" }, extra);
/** workerd's AI binding: run() records the status of the reply it received, then throws. */
const refusingBinding = (status, error = upstream("request refused by the gateway")) => ({
  lastRequestHttpStatusCode: null,
  run: vi.fn(async function () {
    this.lastRequestHttpStatusCode = status;
    throw error;
  }),
});
const REJECTED = { inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: expect.any(Number) };
const BUSY_KEYS = ["calls", "error", "message", "usage"];
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function classify(ai, request = post()) {
  const res = await worker.handlePropose(request, { AI: ai });
  return { status: res.status, body: await res.json() };
}

describe("hosted propose — a gateway 429 is read from its status, not only its message (Astryx #539)", () => {
  it("#539: a 429 the binding recorded, whose message names none of the busy words, is busy: one unspent call, never retried", async () => {
    for (const request of [post(), postWith({ maxCalls: 1 })]) {
      const ai = refusingBinding(429);
      const { status, body } = await classify(ai, request);
      expect(status).toBe(503);
      expect(Object.keys(body).sort()).toEqual(BUSY_KEYS);
      expect(body.error).toBe("busy");
      expect(body.usage).toBeNull();
      expect(body.calls).toEqual([REJECTED]);
      expect(ai.run).toHaveBeenCalledTimes(1);
    }
  });

  it("a numeric 429 status on the rejection itself is busy", async () => {
    const { status, body } = await classify({ run: vi.fn().mockRejectedValue(upstream("request refused", { status: 429 })) });
    expect(status).toBe(503);
    expect(body.error).toBe("busy");
    expect(body.calls).toEqual([REJECTED]);
  });

  it("a 429 on the rejection's response, its cause, or its cause's response is busy", async () => {
    for (const rejection of [
      upstream("request refused", { response: { status: 429 } }),
      new Error("request refused", { cause: { status: 429 } }),
      new Error("request refused", { cause: { response: new Response(null, { status: 429 }) } }),
    ]) {
      const { status, body } = await classify({ run: vi.fn().mockRejectedValue(rejection) });
      expect(status, String(rejection.message)).toBe(503);
      expect(body.error).toBe("busy");
    }
  });

  it("the message alone still classifies as before, as a fallback for a rejection with no status", async () => {
    for (const message of ["InferenceUpstreamError: 429 Too Many Requests", "AiError: Too Many Requests", "rate limited", "Rate-limit exceeded", "3040: Capacity temporarily exceeded"]) {
      const { status, body } = await classify({ run: vi.fn().mockRejectedValue(new Error(message)) });
      expect(status, message).toBe(503);
      expect(body.error, message).toBe("busy");
      expect(body.calls, message).toEqual([REJECTED]);
    }
  });

  it("a failure that is not a 429 stays a provider failure: other statuses, a status that is not a number, and errors that carry none", async () => {
    const cases = [
      ["binding 500", refusingBinding(500)],
      ["binding 502", refusingBinding(502)],
      ["binding 503", refusingBinding(503)],
      ["status 500", { run: vi.fn().mockRejectedValue(upstream("internal error", { status: 500 })) }],
      ["status '429'", { run: vi.fn().mockRejectedValue(upstream("request refused", { status: "429" })) }],
      ["response '429'", { run: vi.fn().mockRejectedValue(upstream("request refused", { response: { status: "429" } })) }],
      ["no status", { run: vi.fn().mockRejectedValue(upstream("request refused")) }],
      ["a string", { run: vi.fn().mockRejectedValue("boom") }],
      ["undefined", { run: vi.fn().mockRejectedValue(undefined) }],
      ["a null-prototype object", { run: vi.fn().mockRejectedValue(Object.create(null)) }],
    ];
    for (const [name, ai] of cases) {
      const { status, body } = await classify(ai);
      expect(status, name).toBe(502);
      expect(body.error, name).toBe("provider-unavailable");
      expect(body.cause, name).toBe("provider");
      expect(body.calls, name).toEqual([REJECTED]);
    }
  });

  it("a 429 that shows a model result, or that another status contradicts, fails closed as a provider failure", async () => {
    const usage = { input_tokens: 10, output_tokens: 2 };
    const cases = [
      ["429 with usage", { run: vi.fn().mockRejectedValue(upstream("request refused", { status: 429, usage })) }],
      ["429 naming a model", { run: vi.fn().mockRejectedValue(upstream("request refused", { status: 429, model: HAIKU })) }],
      ["429 with token counts", { run: vi.fn().mockRejectedValue(upstream("request refused", { status: 429, inputTokens: 10 })) }],
      ["a cause with usage", { run: vi.fn().mockRejectedValue(new Error("request refused", { cause: { status: 429, usage } })) }],
      ["a busy message with usage", { run: vi.fn().mockRejectedValue(upstream("429 Too Many Requests", { usage })) }],
      ["binding 429, error 500", refusingBinding(429, upstream("request refused", { status: 500 }))],
      ["binding 500, error 429", refusingBinding(500, upstream("request refused", { status: 429 }))],
      ["error 429, cause 500", { run: vi.fn().mockRejectedValue(upstream("request refused", { status: 429, cause: { status: 500 } })) }],
    ];
    for (const [name, ai] of cases) {
      const { status, body } = await classify(ai);
      expect(status, name).toBe(502);
      expect(body.cause, name).toBe("provider");
      expect(body.calls, name).toEqual([REJECTED]);
    }
  });

  it("a rejection whose fields cannot be read fails closed, whatever its status or message says", async () => {
    for (const message of ["request refused", "InferenceUpstreamError: 429 Too Many Requests"]) {
      const unreadable = upstream(message, { status: 429 });
      Object.defineProperty(unreadable, "usage", {
        get() {
          throw new Error("unreadable usage");
        },
      });
      const { status, body } = await classify({ run: vi.fn().mockRejectedValue(unreadable) });
      expect(status, message).toBe(502);
      expect(body.cause, message).toBe("provider");
    }
  });

  it("a 429 after an earlier billed call in the same request is never busy by its status: the request has spent", async () => {
    const ai = refusingBinding(429);
    ai.run.mockImplementationOnce(async () => servedBy("prose", HAIKU, 700, 30));
    const { status, body } = await classify(ai);
    expect(status).toBe(502);
    expect(body.cause).toBe("provider");
    expect(body.usage).toEqual({ inputTokens: 700, outputTokens: 30 });
    expect(body.calls).toEqual([{ inputTokens: 700, outputTokens: 30, model: HAIKU, outcome: "unusable-output", durationMs: expect.any(Number) }, REJECTED]);
  });

  it("a status left from an earlier reply is never read: a call that received no reply of its own is a provider failure", async () => {
    const ai = { lastRequestHttpStatusCode: 429, run: vi.fn().mockRejectedValue(upstream("network connection lost")) };
    const { status, body } = await classify(ai);
    expect(status).toBe(502);
    expect(body.cause).toBe("provider");
  });

  it("a status the Worker cannot clear before the call is never read", async () => {
    const ai = {
      get lastRequestHttpStatusCode() {
        return 429;
      },
      run: vi.fn().mockRejectedValue(upstream("request refused")),
    };
    const { status } = await classify(ai);
    expect(status).toBe(502);
  });

  it("the Worker's own timeout is never a refusal, whatever status the binding holds", async () => {
    vi.useFakeTimers();
    try {
      const reply = deferred();
      const ai = {
        lastRequestHttpStatusCode: null,
        run: vi.fn(async function () {
          this.lastRequestHttpStatusCode = 429;
          await reply.promise;
          throw upstream("late");
        }),
      };
      const pending = worker.handlePropose(post(), { AI: ai });
      await vi.waitFor(() => expect(ai.run).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(45_000);
      const res = await pending;
      expect(res.status).toBe(502);
      expect((await res.json()).cause).toBe("provider");
      reply.resolve();
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
  });

  it("two calls that overlap on one binding never read each other's status", async () => {
    const first = deferred();
    const second = deferred();
    const ai = { lastRequestHttpStatusCode: null, run: vi.fn() };
    ai.run
      .mockImplementationOnce(async function () {
        await first.promise;
        this.lastRequestHttpStatusCode = 429;
        throw upstream("request refused");
      })
      .mockImplementationOnce(async function () {
        await second.promise;
        this.lastRequestHttpStatusCode = 500;
        throw upstream("internal error");
      });
    const a = worker.handlePropose(post(), { AI: ai });
    await vi.waitFor(() => expect(ai.run).toHaveBeenCalledTimes(1));
    const b = worker.handlePropose(post(), { AI: ai });
    await vi.waitFor(() => expect(ai.run).toHaveBeenCalledTimes(2));
    second.resolve();
    first.resolve();
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status]).toEqual([502, 502]);
  });

  it("the guards leave nothing behind: after a timeout and an overlap, a lone #539 refusal is busy again", async () => {
    const { status, body } = await classify(refusingBinding(429));
    expect(status).toBe(503);
    expect(body.error).toBe("busy");
  });

  it("a busy reply keeps the endpoint's headers, and a served call still names its model and usage", async () => {
    const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
    const busy = await worker.handlePropose(post(), { AI: refusingBinding(429) });
    expect(busy.status).toBe(503);
    expect(Object.fromEntries(busy.headers)).toEqual(HEADERS);
    const ai = refusingBinding(429);
    ai.run.mockImplementationOnce(async function () {
      this.lastRequestHttpStatusCode = 200;
      return servedBy(SURFACE, HAIKU, 120, 9);
    });
    const ok = await worker.handlePropose(post(), { AI: ai });
    expect(ok.status).toBe(200);
    expect((await ok.json()).calls).toEqual([{ inputTokens: 120, outputTokens: 9, model: HAIKU, outcome: "ok", durationMs: expect.any(Number) }]);
  });
});
