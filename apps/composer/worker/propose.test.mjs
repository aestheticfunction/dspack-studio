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

  it("a 429 after an unusable first output is a provider failure, not busy, and still carries that first call's usage", async () => {
    // Busy means the gateway turned away the request's only call; this request has spent, so it fails closed.
    const run = vi
      .fn()
      .mockResolvedValueOnce(metered("prose", 700, 30))
      .mockRejectedValueOnce(new Error("InferenceUpstreamError: 429 Too Many Requests"));
    const res = await worker.handlePropose(post(), { AI: { run } });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("provider-unavailable");
    expect(body.cause).toBe("provider");
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
    // Read from plain data, as a structured error carries it; a real Response, whose body cannot be read, fails closed.
    for (const rejection of [
      upstream("request refused", { response: { status: 429 } }),
      new Error("request refused", { cause: { status: 429 } }),
      new Error("request refused", { cause: { response: { status: 429, statusText: "Too Many Requests" } } }),
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

  it("a status, once known, decides alone: a busy word in the message never overrides one that is not a numeric 429", async () => {
    const busyWorded = () => upstream("InferenceUpstreamError: 429 Too Many Requests");
    const cases = [
      ["binding 500", refusingBinding(500, busyWorded())],
      ["binding 503", refusingBinding(503, busyWorded())],
      ["binding 200", refusingBinding(200, busyWorded())],
      ["binding '429'", refusingBinding("429", busyWorded())],
      ["binding 429, error 500", refusingBinding(429, upstream("InferenceUpstreamError: 429 Too Many Requests", { status: 500 }))],
      ["error 500", { run: vi.fn().mockRejectedValue(upstream("rate limited", { status: 500 })) }],
      ["error '429'", { run: vi.fn().mockRejectedValue(upstream("429 Too Many Requests", { status: "429" })) }],
      ["response 503", { run: vi.fn().mockRejectedValue(upstream("capacity exceeded", { response: { status: 503 } })) }],
    ];
    for (const [name, ai] of cases) {
      const { status, body } = await classify(ai);
      expect(status, name).toBe(502);
      expect(body.cause, name).toBe("provider");
      expect(body.calls, name).toEqual([REJECTED]);
    }
  });

  it("with no status known, the message decides as before: no status recorded, a null status, or two overlapping calls", async () => {
    const busyWorded = () => upstream("InferenceUpstreamError: 429 Too Many Requests");
    for (const ai of [refusingBinding(null, busyWorded()), { run: vi.fn().mockRejectedValue(upstream("rate limited", { status: null })) }]) {
      const { status, body } = await classify(ai);
      expect(status).toBe(503);
      expect(body.error).toBe("busy");
    }
    const first = deferred();
    const second = deferred();
    const ai = { lastRequestHttpStatusCode: null, run: vi.fn() };
    const refuse = (gate, recorded) =>
      async function () {
        await gate.promise;
        this.lastRequestHttpStatusCode = recorded;
        throw busyWorded();
      };
    ai.run.mockImplementationOnce(refuse(first, 500)).mockImplementationOnce(refuse(second, 500));
    const a = worker.handlePropose(post(), { AI: ai });
    await vi.waitFor(() => expect(ai.run).toHaveBeenCalledTimes(1));
    const b = worker.handlePropose(post(), { AI: ai });
    await vi.waitFor(() => expect(ai.run).toHaveBeenCalledTimes(2));
    first.resolve();
    second.resolve();
    const replies = await Promise.all([a, b]);
    expect(replies.map((r) => r.status)).toEqual([503, 503]);
  });

  it("a 429 the binding recorded on a request that has already spent fails closed, whatever its message says", async () => {
    const ai = refusingBinding(429, upstream("InferenceUpstreamError: 429 Too Many Requests"));
    ai.run.mockImplementationOnce(async () => servedBy("prose", HAIKU, 700, 30));
    const { status, body } = await classify(ai);
    expect(status).toBe(502);
    expect(body.cause).toBe("provider");
    expect(body.usage).toEqual({ inputTokens: 700, outputTokens: 30 });
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

  it("a call the binding never settles blocks the status only while its request could still be running", async () => {
    // workerd never settles the I/O of a request it canceled (a client gone, the Worker's own timeout), so a hung call
    // may stay unsettled for the isolate's life. It stops counting once its request can no longer be running.
    vi.useFakeTimers();
    const hung = deferred();
    try {
      const ai = refusingBinding(429);
      let began;
      ai.run.mockImplementationOnce(async function () {
        began = Date.now();
        await hung.promise;
      });
      const first = worker.handlePropose(post(), { AI: ai });
      await vi.waitFor(() => expect(ai.run).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(45_000);
      expect((await first).status).toBe(502);
      expect((await classify(ai)).status).toBe(502);
      // To the last millisecond of its 5 minutes the hung call still counts; at 5 minutes it is let go.
      await vi.advanceTimersByTimeAsync(began + 5 * 60_000 - 1 - Date.now());
      expect((await classify(ai)).status).toBe(502);
      await vi.advanceTimersByTimeAsync(1);
      const { status, body } = await classify(ai);
      expect(status).toBe(503);
      expect(body.error).toBe("busy");
    } finally {
      hung.resolve();
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it("a binding that throws before returning a promise is never read: whatever it recorded, the call sent nothing of its own", async () => {
    const ai = {
      lastRequestHttpStatusCode: null,
      run: vi.fn(function () {
        this.lastRequestHttpStatusCode = 429;
        throw upstream("request refused");
      }),
    };
    const { status, body } = await classify(ai);
    expect(status).toBe(502);
    expect(body.cause).toBe("provider");
  });

  it("a model result anywhere in the rejection fails closed: in its data, body, error, errors, or its response's data", async () => {
    const usage = { input_tokens: 10, output_tokens: 2 };
    for (const extra of [{ data: { usage } }, { body: { usage } }, { error: { usage } }, { errors: [{ usage }] }, { response: { status: 429, data: { usage } } }, { data: { model: HAIKU } }]) {
      const { status, body } = await classify({ run: vi.fn().mockRejectedValue(upstream("request refused", { status: 429, ...extra })) });
      expect(status, JSON.stringify(extra)).toBe(502);
      expect(body.cause, JSON.stringify(extra)).toBe("provider");
    }
  });

  it("busy means the gateway turned away the request's only call: a busy-worded 429 after a billed call fails closed when an overlap hides its status", async () => {
    const gateA = deferred();
    const gateB = deferred();
    const refuse = (gate) =>
      async function () {
        await gate.promise;
        this.lastRequestHttpStatusCode = 429;
        throw upstream("InferenceUpstreamError: 429 Too Many Requests");
      };
    const ai = { lastRequestHttpStatusCode: null, run: vi.fn() };
    ai.run
      .mockImplementationOnce(async () => servedBy("prose", HAIKU, 700, 30))
      .mockImplementationOnce(refuse(gateA))
      .mockImplementationOnce(refuse(gateB));
    const a = worker.handlePropose(post(), { AI: ai });
    await vi.waitFor(() => expect(ai.run).toHaveBeenCalledTimes(2));
    const b = worker.handlePropose(post(), { AI: ai });
    await vi.waitFor(() => expect(ai.run).toHaveBeenCalledTimes(3));
    gateA.resolve();
    gateB.resolve();
    const [ra, rb] = await Promise.all([a, b]);
    const spent = await ra.json();
    expect(ra.status).toBe(502);
    expect(spent.cause).toBe("provider");
    expect(spent.usage).toEqual({ inputTokens: 700, outputTokens: 30 });
    expect(spent.calls.map((c) => c.outcome)).toEqual(["unusable-output", "provider-error"]);
    // The other request's only call was refused; the overlap hides its status too, so its message decides, as before.
    expect(rb.status).toBe(503);
    expect((await rb.json()).error).toBe("busy");
  });

  it("a model result in the rejection's message fails closed: the binding makes a reply's whole body the message when it names no error code", async () => {
    // workerd's _parseError: a body with neither internalCode nor errors[] becomes the error's message as it came.
    const cases = [
      ["usage", refusingBinding(429, upstream('{"type":"error","usage":{"input_tokens":700,"output_tokens":30}}'))],
      ["token keys", refusingBinding(429, upstream('{"input_tokens": 5, "output_tokens": 1}'))],
      ["nested usage", refusingBinding(429, upstream('{"result":{"usage":{"prompt_tokens":5,"completion_tokens":1}}}'))],
      ["camelCase", refusingBinding(429, upstream('{"inputTokens":5,"outputTokens":1}'))],
      ["a thrown string", refusingBinding(429, '{"usage":{"input_tokens":1}}')],
      ["no status, a busy word", { run: vi.fn().mockRejectedValue(upstream('{"type":"error","error":{"type":"rate_limit_error"},"usage":{"input_tokens":1}}')) }],
    ];
    for (const [name, ai] of cases) {
      const { status, body } = await classify(ai);
      expect(status, name).toBe(502);
      expect(body.cause, name).toBe("provider");
      expect(body.calls, name).toEqual([REJECTED]);
    }
  });

  it("a refusal whose body names tokens in words, or the model it refused, is still busy", async () => {
    for (const message of [
      "Number of request tokens has exceeded your per-minute rate limit",
      '{"type":"error","error":{"type":"rate_limit_error","message":"rate limited"}}',
      '{"error":"request refused","model":"anthropic/claude-haiku-4.5"}',
    ]) {
      const { status, body } = await classify(refusingBinding(429, upstream(message)));
      expect(status, message).toBe(503);
      expect(body.error, message).toBe("busy");
    }
  });

  it("a model result is found wherever the rejection holds it: under a non-enumerable or symbol key, in an AggregateError's errors, or in a string", async () => {
    const usage = { input_tokens: 10, output_tokens: 2 };
    const cases = [
      ["non-enumerable", Object.defineProperty(upstream("request refused", { status: 429 }), "data", { value: { usage }, enumerable: false })],
      ["symbol key", Object.assign(upstream("request refused", { status: 429 }), { [Symbol("body")]: { usage } })],
      ["AggregateError", Object.assign(new AggregateError([Object.assign(new Error("inner"), { usage })], "request refused"), { status: 429 })],
      ["a string", upstream("request refused", { status: 429, body: '{"usage":{"input_tokens":10}}' })],
    ];
    for (const [name, error] of cases) {
      const { status, body } = await classify({ run: vi.fn().mockRejectedValue(error) });
      expect(status, name).toBe(502);
      expect(body.cause, name).toBe("provider");
    }
  });

  it("a rejection holding what cannot be read in full fails closed, whatever its status says: a Response, a stream, a Map, a buffer or a function", async () => {
    // A Response's body, a stream, a map's entries or a function's properties are no plain data, so nothing shows they hold
    // no model result.
    const body = '{"usage":{"input_tokens":10}}';
    const cases = [
      ["a Response", upstream("request refused", { status: 429, response: new Response(null, { status: 429 }) })],
      ["a stream", upstream("request refused", { status: 429, body: new Blob([body]).stream() })],
      ["a Map", upstream("request refused", { status: 429, data: new Map([["usage", { input_tokens: 10 }]]) })],
      ["a buffer", upstream("request refused", { status: 429, body: new TextEncoder().encode(body) })],
      ["a function carrying usage", upstream("request refused", { status: 429, data: Object.assign(() => {}, { usage: { input_tokens: 10 } }) })],
      ["a function", upstream("request refused", { status: 429, data: () => {} })],
    ];
    for (const [name, error] of cases) {
      const { status, body: reply } = await classify({ run: vi.fn().mockRejectedValue(error) });
      expect(status, name).toBe(502);
      expect(reply.cause, name).toBe("provider");
    }
    // Plain data, as a structured error carries it, is read in full: its response's status still decides.
    const plain = await classify({ run: vi.fn().mockRejectedValue(upstream("request refused", { response: { status: 429, headers: { "retry-after": "30" } } })) });
    expect(plain.status).toBe(503);
  });

  it("every status down the rejection's response and cause chain is read, as deep as the search for a model result", async () => {
    // The sixth cause down, at the deepest level the search reads.
    const deep = (status) => ({ cause: { cause: { cause: { cause: { cause: { cause: { status } } } } } } });
    const contradicted = await classify({ run: vi.fn().mockRejectedValue(upstream("request refused", { status: 429, ...deep(500) })) });
    expect(contradicted.status).toBe(502);
    expect(contradicted.body.cause).toBe("provider");
    const agreeing = await classify({ run: vi.fn().mockRejectedValue(upstream("request refused", { status: 429, ...deep(429) })) });
    expect(agreeing.status).toBe(503);
    expect(agreeing.body.error).toBe("busy");
  });

  it("a rejection too deep or too large to read in full fails closed, whatever its status says", async () => {
    const wrapped = (levels) => {
      let nested = {};
      for (let i = 0; i < levels; i++) nested = { data: nested };
      return nested;
    };
    const cases = [
      ["one level deeper than the search reads", upstream("request refused", { status: 429, data: wrapped(6) })],
      ["more objects than the search reads", upstream("request refused", { status: 429, data: Array.from({ length: 300 }, () => ({})) })],
      ["more values than the search reads", upstream("request refused", { status: 429, data: new Array(5000).fill(0) })],
      ["a million values, refused unread", upstream("request refused", { status: 429, data: new Array(1_000_000).fill(0) })],
    ];
    for (const [name, error] of cases) {
      const { status, body } = await classify({ run: vi.fn().mockRejectedValue(error) });
      expect(status, name).toBe(502);
      expect(body.cause, name).toBe("provider");
    }
    // The deepest level the search reads is still read, and plain data there shows nothing.
    const { status } = await classify({ run: vi.fn().mockRejectedValue(upstream("request refused", { status: 429, data: wrapped(5) })) });
    expect(status).toBe(503);
  });

  it("each usage, token or model key alone shows a model result, as a field, and each usage or token key quoted in the message", async () => {
    const keys = ["usage", "model", "inputTokens", "outputTokens", "input_tokens", "output_tokens", "prompt_tokens", "completion_tokens"];
    for (const key of keys) {
      const { status } = await classify({ run: vi.fn().mockRejectedValue(upstream("request refused", { status: 429, [key]: 1 })) });
      expect(status, `field ${key}`).toBe(502);
    }
    const empty = await classify({ run: vi.fn().mockRejectedValue(upstream("request refused", { status: 429, usage: {} })) });
    expect(empty.status, "usage: {}").toBe(502);
    for (const key of keys.filter((k) => k !== "model")) {
      const { status } = await classify(refusingBinding(429, upstream(`{"${key}":1}`)));
      expect(status, `quoted ${key}`).toBe(502);
    }
  });

  it("a usage key in the message is found however it is written: spaced, escaped inside a JSON string, or capitalized", async () => {
    for (const message of ['{"usage" : {"input_tokens": 5}}', '{"message":"{\\"usage\\":{\\"input_tokens\\":5}}"}', '{"Usage":{"Input_Tokens":5}}']) {
      const { status } = await classify(refusingBinding(429, upstream(message)));
      expect(status, message).toBe(502);
    }
  });

  it("plain data that shows no model result is read through and stays busy: an array, a null-prototype object, null keys, a quoted word, a longer key", async () => {
    const cases = [
      ["an array", upstream("request refused", { status: 429, errors: [{ code: 2003, message: "Rate limited" }] })],
      ["a null-prototype object", upstream("request refused", { status: 429, data: Object.assign(Object.create(null), { reason: "rate limited" }) })],
      ["null result keys", upstream("request refused", { status: 429, usage: null, model: null })],
      ["a quoted word", upstream('request refused: the "usage" budget is spent', { status: 429 })],
      ["a longer key", upstream('{"error":"spend limit reached","daily_usage":"$10.00"}', { status: 429 })],
    ];
    for (const [name, error] of cases) {
      const { status, body } = await classify({ run: vi.fn().mockRejectedValue(error) });
      expect(status, name).toBe(503);
      expect(body.error, name).toBe("busy");
    }
  });

  it("a status the binding will not clear, because it ignores the write, is never read", async () => {
    const ai = {
      get lastRequestHttpStatusCode() {
        return 429;
      },
      set lastRequestHttpStatusCode(value) {},
      run: vi.fn().mockRejectedValue(upstream("request refused")),
    };
    const { status, body } = await classify(ai);
    expect(status).toBe(502);
    expect(body.cause).toBe("provider");
  });

  it("the message fallback keeps each busy word: a bare 429 is busy, a number that merely contains 429 is not", async () => {
    expect((await classify({ run: vi.fn().mockRejectedValue(upstream("upstream answered 429")) })).status).toBe(503);
    expect((await classify({ run: vi.fn().mockRejectedValue(upstream("upstream error 14290")) })).status).toBe(502);
  });

  it("a status the binding recorded that cannot be read back fails closed, whatever the message says", async () => {
    let recorded = null;
    let readable = true;
    const ai = {
      get lastRequestHttpStatusCode() {
        if (!readable) throw new Error("unreadable");
        return recorded;
      },
      set lastRequestHttpStatusCode(value) {
        recorded = value;
      },
      run: vi.fn(async () => {
        readable = false;
        throw upstream("InferenceUpstreamError: 429 Too Many Requests");
      }),
    };
    const { status, body } = await classify(ai);
    expect(status).toBe(502);
    expect(body.cause).toBe("provider");
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
