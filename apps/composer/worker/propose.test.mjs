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

  it("sends the provider exactly what it sent before Option B, whatever maxCalls says", async () => {
    // sha256 of env.AI.run's arguments for this request, pinned on the Worker at c154548 (before Option B).
    const PINNED = "e7260328c794adc9fa4cd579df3a376d2e4acced134bb5598f65887736752b82";
    for (const extra of [{}, { maxCalls: 1 }, { maxCalls: 2 }]) {
      const run = vi.fn().mockResolvedValue(servedBy('{"a":1}', HAIKU, 5, 1));
      await worker.handlePropose(postWith(extra), { AI: { run } });
      expect(createHash("sha256").update(JSON.stringify(run.mock.calls)).digest("hex"), JSON.stringify(extra)).toBe(PINNED);
    }
  });
});
