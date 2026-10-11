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
 * checked against both (withinReservation), against the number of calls priced, and against the model these prices
 * are for. A reply that proves it stayed inside them (its calls itemized, at least one provider call and no more than
 * priced, each naming Claude Haiku 4.5) is settled at what its calls reported (reportedUsd), the provider's own count
 * of what is billed. One that does not (usage missing, a figure past its bound, an extra call, no call reported,
 * another model or none named, no reply at all) is charged instead at absoluteUsd, which rests on the model's documented
 * limits alone, or at what its calls can have cost (boundedUsd) if that is more; and no request is sent unless the most any request can cost
 * (absoluteUsd(2)) still fits under the run's ceiling. So the ceiling holds even when an assumption fails, and a run's
 * total is what it spent plus what it cannot yet verify. A reply reporting more than those limits allow (a Worker that
 * broke its own call cap, or a provider past its documented limits) breaks the bound: it is charged what it reported,
 * each call it could not see at the most one call can cost (boundedUsd), and it stops the run, as a reply naming
 * another model does. What no reply can show is outside this bound: a call the gateway retried or billed without the
 * Worker seeing it, or a model other than Claude Haiku 4.5 served under its name.
 */
import type { ModelCallRecord } from "@dspack-studio/composer-core";
import type { GenerateRequest } from "@dspack-studio/composer-core/blocks";
import { guidedSystem } from "../../../apps/composer/worker/propose.mjs";

/** The model the Worker requests (propose.mjs PRIMARY), and the one these prices are for. */
export const PRICED_MODEL = "anthropic/claude-haiku-4.5";
/**
 * Claude Haiku 4.5 by the whole ids this deployment can return: the configured id (PRICED_MODEL, which the Worker also
 * returns when the provider names no model) and that id without its vendor prefix (`claude-haiku-4.5`), Anthropic's
 * alias (`claude-haiku-4-5`) and its dated snapshots (`claude-haiku-4-5-20251001`). A call naming anything else is not
 * priced by these prices.
 */
export const PRICED_FAMILY = /^(?:(?:anthropic\/)?claude-haiku-4\.5|claude-haiku-4-5(?:-\d{8})?)$/;
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

/** A token count a call can be charged by: a whole number, never negative. Anything else is no count. */
const count = (n: unknown): number | undefined => (typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : undefined);
/** What a reported figure shows, whatever its form: a positive finite number, rounded up to whole tokens, or none. */
const shown = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0);

/**
 * The most a reply can have cost on what it shows, counted figure by figure and priced once. Each call that reached the
 * model counts at what it reported, if it reported both counts as such a call can (at least one input token, and one
 * output token for an answer) and stated each once; any other counts at the most one call can read and write, or at what
 * it shows, rounded up to whole tokens, where that is more. The calls are summed, and the reply's total counts instead
 * wherever it shows more of a figure. Each figure stands on its own, so what a reply shows of one is never traded against
 * the other. A call that reached no model counts nothing. A reply that cannot be verified is charged at least this.
 */
export function boundedUsd(calls: ReadonlyArray<ModelCallRecord & { stated?: boolean }>, total?: { inputTokens?: number; outputTokens?: number }): number {
  let input = 0;
  let output = 0;
  for (const c of calls) {
    if (c.source === "none") continue;
    const read = count(c.inputTokens);
    const wrote = count(c.outputTokens);
    // A call that reached the model read at least one token, and an answer wrote at least one: counts saying otherwise,
    // or stated two ways, prove nothing.
    if (c.stated !== false && read !== undefined && wrote !== undefined && read >= 1 && (c.outcome !== "ok" || wrote >= 1)) {
      input += read;
      output += wrote;
    } else {
      input += Math.max(MODEL_LIMITS.contextTokens, shown(c.inputTokens));
      output += Math.max(MODEL_LIMITS.maxOutputTokens, shown(c.outputTokens));
    }
  }
  return usd(1, Math.max(input, shown(total?.inputTokens)), Math.max(output, shown(total?.outputTokens)));
}

/** Whether a reply's total reports past what its calls could reach, each at Claude Haiku 4.5's documented limits. */
export const totalPastModelLimits = (total: { inputTokens?: number; outputTokens?: number } | undefined, calls: number): boolean =>
  total !== undefined && (shown(total.inputTokens) > Math.max(1, calls) * MODEL_LIMITS.contextTokens || shown(total.outputTokens) > Math.max(1, calls) * MODEL_LIMITS.maxOutputTokens);

/** Whether a call reported usage past Claude Haiku 4.5's documented limits, which no price here bounds. */
export const pastModelLimits = (c: ModelCallRecord): boolean =>
  c.source !== "none" && (shown(c.inputTokens) > MODEL_LIMITS.contextTokens || shown(c.outputTokens) > MODEL_LIMITS.maxOutputTokens);

/**
 * Whether a call stayed inside what its request was priced at: a call that reached no model, or one naming Claude
 * Haiku 4.5 (PRICED_FAMILY) that reports both figures as whole numbers within the bounds, at least one input token among
 * them, and at least one output token if it answered. A call that reached a provider without reporting its usage, or
 * the model these prices are for, proves nothing.
 */
export function withinReservation(request: Priced, call: ModelCallRecord): boolean {
  if (call.source === "none") return true;
  return (
    typeof call.model === "string" &&
    PRICED_FAMILY.test(call.model) &&
    typeof call.inputTokens === "number" &&
    typeof call.outputTokens === "number" &&
    Number.isSafeInteger(call.inputTokens) &&
    Number.isSafeInteger(call.outputTokens) &&
    call.inputTokens >= 1 &&
    call.outputTokens >= (call.outcome === "ok" ? 1 : 0) &&
    call.inputTokens <= inputTokenBound(request) &&
    call.outputTokens <= MAX_OUTPUT_TOKENS
  );
}
