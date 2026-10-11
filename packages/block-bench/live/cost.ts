/**
 * The dollar ceiling of a hosted run. A request count alone is not one, so every request is priced at its worst
 * case before it is sent, from two kinds of fact:
 *
 * - What the Worker enforces in code (apps/composer/worker/propose.mjs, pinned by cost.test.ts): it requests
 *   PRICED_MODEL, sets max_tokens to MAX_OUTPUT_TOKENS on every provider call (its parse retry included), makes at
 *   most `maxCalls` calls (1 or 2, default 2) for a request, and refuses an oversized body before any call.
 * - What the providers document: Claude Haiku 4.5 costs $1 per million input tokens and $5 per million output
 *   tokens, with a 200K-token context window and 64K output tokens (platform.claude.com, models/haiku-4-5); Cloudflare
 *   passes provider prices through and adds 5% to the Unified Billing credits they are paid from.
 *
 * A request's priced worst case (worstCaseUsd) also assumes at most one token per UTF-8 byte of the text the model
 * reads, plus CALL_OVERHEAD_TOKENS of framing per call, and that the gateway honours max_tokens. Every reply is
 * checked against both (withinReservation), and against the number of calls priced. A reply that proves it stayed
 * inside them (at least one provider call, no more than priced) is settled at what its calls reported (reportedUsd),
 * the provider's own count of what is billed. One that does not (usage missing, a figure past its bound, an extra
 * call, no call reported, no reply at all) is charged instead at absoluteUsd, which rests on the model's documented
 * limits alone, or at what it reported if that is more; and no request is sent unless its absolute worst case still
 * fits under the run's ceiling. So the ceiling holds even when an assumption fails, and a run's total is what it
 * spent plus what it cannot yet verify. Only a Worker that broke its own call cap could push the total past the
 * ceiling: the ledger would record what was reported, and refuse the next request.
 */
import type { ModelCallRecord } from "@dspack-studio/composer-core";
import type { GenerateRequest } from "@dspack-studio/composer-core/blocks";
import { guidedSystem } from "../../../apps/composer/worker/propose.mjs";

/** The model the Worker requests (propose.mjs PRIMARY), and the one these prices are for. */
export const PRICED_MODEL = "anthropic/claude-haiku-4.5";
/** Claude Haiku 4.5's prices per token, and Cloudflare's 5% on the credits they are paid from. */
export const PRICE: Readonly<{ inputPerToken: number; outputPerToken: number; creditFee: number }> = Object.freeze({ inputPerToken: 1e-6, outputPerToken: 5e-6, creditFee: 1.05 });
/** The max_tokens the Worker sets on every provider call (propose.mjs MAX_OUTPUT_TOKENS). */
export const MAX_OUTPUT_TOKENS = 8192;
/** Per-call framing allowed on top of the text itself (roles, message boundaries); the Worker sends no tools. */
export const CALL_OVERHEAD_TOKENS = 1000;
/** Claude Haiku 4.5's documented 200K-token context window and 64K output tokens, each read at its larger, binary value. */
export const MODEL_LIMITS: Readonly<{ contextTokens: number; maxOutputTokens: number }> = Object.freeze({ contextTokens: 204_800, maxOutputTokens: 65_536 });

type Priced = Pick<GenerateRequest, "system" | "messages" | "jsonSchema">;
const bytes = (text: string) => new TextEncoder().encode(text).length;
const usd = (calls: number, input: number, output: number) => calls * (input * PRICE.inputPerToken + output * PRICE.outputPerToken) * PRICE.creditFee;

/** The input tokens one call of this request can be charged for: one per byte the model reads plus framing, and never past the context window. */
export function inputTokenBound(request: Priced): number {
  const text = bytes(guidedSystem(request.system, request.jsonSchema)) + request.messages.reduce((a, m) => a + bytes(m.content), 0);
  return Math.min(text + CALL_OVERHEAD_TOKENS, MODEL_LIMITS.contextTokens);
}

/** What a request is priced at before it is sent: every call it may make, at its input bound and the output cap. */
export function worstCaseUsd(request: Priced, maxCalls: 1 | 2): number {
  return usd(maxCalls, inputTokenBound(request), MAX_OUTPUT_TOKENS);
}

/** The most a request of `maxCalls` calls can cost, from the model's documented limits alone. */
export function absoluteUsd(maxCalls: 1 | 2): number {
  return usd(maxCalls, MODEL_LIMITS.contextTokens, MODEL_LIMITS.maxOutputTokens);
}

/**
 * Dollars as whole nanodollars, the unit the run's ledger counts in. Every price here is a whole number of them (1,050 an
 * input token and 5,250 an output token, the credit fee included), so the ledger's sums and its comparisons with the
 * ceiling are exact: no rounding can admit a request past the ceiling, or refuse one inside a cell it admitted.
 */
export const toNanos = (usd: number): number => Math.round(usd * 1e9);

/** The most requests one cell makes: the planning call and at most three generation requests, in every arm (ADR-B4). */
export const CELL_REQUESTS = 4;
/** The most any request can cost (two calls). */
export const REQUEST_USD_BOUND = absoluteUsd(2);
/** The most any cell can cost: the planning request and three generation requests, each at its absolute worst case. */
export const CELL_USD_BOUND = CELL_REQUESTS * REQUEST_USD_BOUND;

/** What a verified reply cost: each call's reported usage at the prices, the credit fee included; a call that reached no model costs nothing. */
export function reportedUsd(calls: readonly ModelCallRecord[]): number {
  return calls.reduce((a, c) => (c.source === "none" ? a : a + usd(1, c.inputTokens ?? 0, c.outputTokens ?? 0)), 0);
}

/**
 * Whether a call stayed inside what its request was priced at: a call that reached no model, or one that reports
 * both figures within the bounds. A call that reached a provider without reporting its usage proves nothing.
 */
export function withinReservation(request: Priced, call: ModelCallRecord): boolean {
  if (call.source === "none") return true;
  return typeof call.inputTokens === "number" && typeof call.outputTokens === "number" && call.inputTokens <= inputTokenBound(request) && call.outputTokens <= MAX_OUTPUT_TOKENS;
}
