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
