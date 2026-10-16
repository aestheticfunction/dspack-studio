/**
 * The beta's operator log (docs/blocks/BETA-OPERATIONS.md;
 * docs/blocks/PHASE-2-RELEASE-PLAN.md, §9).
 *
 * One line per /api/propose request, written with console.log for Workers
 * Logs, and only when the Worker's BETA_OPERATOR_LOG variable is exactly the
 * Text "on". Production never sets it, so production writes nothing.
 *
 * The line is shape only, built from an allowlist:
 * - the reply's status, and its error and cause codes;
 * - the request's maxCalls, and the operation the beta client named;
 * - each provider call's outcome, token counts, served model and duration;
 * - the request's own duration.
 * It never holds the prompt, the schema, the output, an error's message, a
 * header or an address. Every string in it is a code from a closed list, or
 * a model id that passes MODEL_ID, the receipt's grammar (composer-core
 * MODEL_ID_PATTERN).
 */

export const OPERATOR_LOG_VARIABLE = "BETA_OPERATOR_LOG";

/** A model id as a provider names one: no spaces or markup, at most 100 characters. */
export const MODEL_ID = /^[A-Za-z0-9@][A-Za-z0-9._:/@+-]{0,99}$/;

/** The operations the beta client names in its x-composer-operation header (composer-core CallOperation). */
export const OPERATIONS = Object.freeze(["plan", "flow-plan", "block", "block-repair", "generate", "refine", "repair"]);

/** The error codes this Worker replies with (propose.mjs). */
const ERRORS = Object.freeze([
  "method-not-allowed",
  "unavailable",
  "rate-limited",
  "unsupported-media-type",
  "payload-too-large",
  "malformed-json",
  "invalid-request",
  "busy",
  "provider-unavailable",
]);
const CAUSES = Object.freeze(["unusable-output", "provider"]);
const OUTCOMES = Object.freeze(["ok", "unusable-output", "provider-error"]);
/** A request makes at most two provider calls (maxCalls). */
const MAX_CALLS = 2;

/** Only the exact Text "on" turns the log on; any other value, or none, leaves it off. */
export function operatorLogOn(env) {
  return env?.[OPERATOR_LOG_VARIABLE] === "on";
}

const count = (value) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);
const millis = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null);
const code = (value, allowed) => (allowed.includes(value) ? value : null);
const plainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function modelOf(value) {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" && MODEL_ID.test(value) ? value : "unrecognized";
}

/**
 * The line for one request: its reply's status and body as the Worker sent
 * them, the maxCalls it accepted, the operation the client named and how long
 * it took. Everything else in the body (the proposal, the raw text, the
 * message) is left behind.
 */
export function operatorRecord({ status, body, maxCalls, operation, durationMs }) {
  const reply = plainObject(body) ? body : {};
  const calls = Array.isArray(reply.calls) ? reply.calls.slice(0, MAX_CALLS) : [];
  return {
    event: "composer.propose",
    v: 1,
    status: count(status),
    error: reply.error === undefined ? null : (code(reply.error, ERRORS) ?? "other"),
    cause: code(reply.cause, CAUSES),
    maxCalls: maxCalls === 1 || maxCalls === 2 ? maxCalls : null,
    operation: code(operation, OPERATIONS),
    calls: calls.map((raw) => {
      const call = plainObject(raw) ? raw : {};
      return {
        outcome: code(call.outcome, OUTCOMES) ?? "other",
        inputTokens: count(call.inputTokens),
        outputTokens: count(call.outputTokens),
        model: modelOf(call.model),
        durationMs: millis(call.durationMs),
      };
    }),
    durationMs: millis(durationMs),
  };
}
