/**
 * The dollar ceiling a hosted run enforces (live/cost.ts) rests on two kinds of fact. What the Worker enforces in code
 * (apps/composer/worker/propose.mjs), pinned here: the model it requests, the max_tokens and the guided system on every
 * provider call (the parse retry included), at most two calls a request, and its refusal of a body over its bound
 * before any call. And what the providers document: Claude Haiku 4.5 at $1 and $5 per million input and output tokens,
 * with a 200K-token context window and 64K output tokens; Cloudflare's Unified Billing adds 5% to the credits spent.
 */
import { describe, expect, it } from "vitest";
import { guidedSystem, handlePropose } from "../../../apps/composer/worker/propose.mjs";
import { CALL_OVERHEAD_TOKENS, CELL_USD_BOUND, MAX_OUTPUT_TOKENS, MODEL_LIMITS, PRICE, PRICED_MODEL, REQUEST_USD_BOUND, absoluteUsd, inputTokenBound, reportedUsd, withinReservation, worstCaseUsd } from "./cost";
import { CELL_REQUESTS } from "./providers/hosted";

const bytes = (text: string) => new TextEncoder().encode(text).length;
const answer = (text: string) => ({ content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 2 } });
const post = (body: string) => new Request("https://example.test/api/propose", { method: "POST", headers: { "content-type": "application/json" }, body });

describe("the dollar bound rests on what the Worker enforces", () => {
  it("requests the priced model, and every provider call, the parse retry included, carries the bound's max_tokens and the guided system it measures", async () => {
    const seen: Array<{ model: string; max_tokens: number; system: string }> = [];
    const env = { HOSTED_AI: "on", AI: { run: async (model: string, input: { max_tokens: number; system: string }) => (seen.push({ model, ...input }), answer("not json")) } };
    const reply = await handlePropose(post(JSON.stringify({ system: "s", messages: [{ role: "user", content: "u" }], jsonSchema: { type: "object" } })), env);
    expect(reply.status).toBe(502);
    expect(seen).toHaveLength(2);
    for (const call of seen) {
      expect(call.model).toBe(PRICED_MODEL);
      expect(call.max_tokens).toBe(MAX_OUTPUT_TOKENS);
      expect(call.system).toBe(guidedSystem("s", { type: "object" }));
    }
  });

  it("refuses a body over its bound, and a request for more than two calls, before any provider call", async () => {
    let calls = 0;
    const env = { HOSTED_AI: "on", AI: { run: async () => (calls++, answer("{}")) } };
    const large = await handlePropose(post(JSON.stringify({ system: "x".repeat(512 * 1024), messages: [], jsonSchema: {} })), env);
    expect(large.status).toBe(413);
    expect((await large.json()).calls).toEqual([]);
    const three = await handlePropose(post(JSON.stringify({ system: "s", messages: [], jsonSchema: {}, maxCalls: 3 })), env);
    expect(three.status).toBe(400);
    expect((await three.json()).calls).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("a request's worst case", () => {
  it("is priced from its own bytes: every call at the output cap, at most one token per input byte plus framing, the credit fee included", () => {
    const request = { system: "é".repeat(10), messages: [{ role: "user" as const, content: "hello" }], jsonSchema: { type: "object" } };
    const text = bytes(guidedSystem(request.system, request.jsonSchema)) + bytes("hello");
    expect(inputTokenBound(request)).toBe(text + CALL_OVERHEAD_TOKENS);
    expect(worstCaseUsd(request, 2)).toBeCloseTo(2 * ((text + CALL_OVERHEAD_TOKENS) * 1e-6 + MAX_OUTPUT_TOKENS * 5e-6) * 1.05, 12);
    expect(worstCaseUsd(request, 1)).toBeCloseTo(worstCaseUsd(request, 2) / 2, 12);
    expect(PRICE).toEqual({ inputPerToken: 1e-6, outputPerToken: 5e-6, creditFee: 1.05 });
  });

  it("never prices more input than the model's context window accepts", () => {
    const large = { system: "x".repeat(400_000), messages: [], jsonSchema: {} };
    expect(inputTokenBound(large)).toBe(MODEL_LIMITS.contextTokens);
    expect(worstCaseUsd(large, 1)).toBeCloseTo((MODEL_LIMITS.contextTokens * 1e-6 + MAX_OUTPUT_TOKENS * 5e-6) * 1.05, 12);
  });

  it("falls back to the model's documented limits alone for a reply it cannot verify, and that bounds every request and cell", () => {
    // 200K and 64K read at their larger, binary value, so neither reading of the documentation is exceeded.
    expect(MODEL_LIMITS).toEqual({ contextTokens: 204_800, maxOutputTokens: 65_536 });
    expect(absoluteUsd(2)).toBeCloseTo(2 * (204_800 * 1e-6 + 65_536 * 5e-6) * 1.05, 12);
    expect(absoluteUsd(1)).toBeCloseTo(absoluteUsd(2) / 2, 12);
    const largest = { system: "x".repeat(512 * 1024), messages: [], jsonSchema: {} };
    expect(worstCaseUsd(largest, 2)).toBeLessThanOrEqual(absoluteUsd(2));
    expect(REQUEST_USD_BOUND).toBe(absoluteUsd(2));
    expect(CELL_USD_BOUND).toBeCloseTo(CELL_REQUESTS * REQUEST_USD_BOUND, 12);
  });

  it("holds only for a call whose reported usage is within what it was priced at: a refused call, or one naming Claude Haiku 4.5 that reports both figures inside the bounds", () => {
    const request = { system: "s", messages: [{ role: "user" as const, content: "u" }], jsonSchema: {} };
    const bound = inputTokenBound(request);
    const call = (fields: Record<string, unknown>) => ({ operation: "generate" as const, durationMs: 1, outcome: "ok" as const, source: "provider" as const, model: "claude-haiku-4-5-20251001", ...fields });
    expect(withinReservation(request, call({ inputTokens: bound, outputTokens: MAX_OUTPUT_TOKENS }))).toBe(true);
    expect(withinReservation(request, call({ inputTokens: 1, outputTokens: 0, model: PRICED_MODEL }))).toBe(true);
    expect(withinReservation(request, call({ inputTokens: 1, outputTokens: 0, model: "claude-haiku-4-5" }))).toBe(true);
    expect(withinReservation(request, call({ source: "none", outcome: "refused", model: undefined }))).toBe(true);
    expect(withinReservation(request, call({ inputTokens: bound + 1, outputTokens: 1 }))).toBe(false);
    expect(withinReservation(request, call({ inputTokens: 1, outputTokens: MAX_OUTPUT_TOKENS + 1 }))).toBe(false);
    expect(withinReservation(request, call({ inputTokens: 1 }))).toBe(false);
    expect(withinReservation(request, call({ outcome: "provider-error" }))).toBe(false);
    // A call that reached the model read at least one token, and these prices are Claude Haiku 4.5's, by its whole id.
    expect(withinReservation(request, call({ inputTokens: 0, outputTokens: 0 }))).toBe(false);
    for (const model of [undefined, "claude-opus-4-1-20250805", "claude-sonnet-4-5-20250929", "claude-haiku-5-5", "evil/claude-haiku-4-5/other", "claude-haiku-4-5-sonnet", "anthropic/claude-haiku-4-5", "ANTHROPIC/CLAUDE-HAIKU-4.5"]) {
      expect(withinReservation(request, call({ inputTokens: 10, outputTokens: 2, model })), String(model)).toBe(false);
    }
  });

  it("settles a verified reply at what it reported: each call's usage at the prices, the credit fee included, and a call that reached no model at nothing", () => {
    const call = (fields: Record<string, unknown>) => ({ operation: "generate" as const, durationMs: 1, outcome: "ok" as const, source: "provider" as const, ...fields });
    const calls = [call({ inputTokens: 1000, outputTokens: 100 }), call({ inputTokens: 2000, outputTokens: 50, outcome: "unusable-output" }), call({ source: "none", outcome: "refused" })];
    expect(reportedUsd(calls)).toBeCloseTo((3000 * 1e-6 + 150 * 5e-6) * 1.05, 12);
  });
});
