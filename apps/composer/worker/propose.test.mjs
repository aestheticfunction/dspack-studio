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
