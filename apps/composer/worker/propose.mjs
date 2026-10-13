/**
 * Composer hosted generation — the thin /api/propose endpoint.
 *
 * THE ONE nondeterministic step, and nothing more. The browser runs the whole
 * deterministic pipeline (S1/S2/S3 → bounded repair → emit → audit); Cloudflare
 * Workers ban runtime `new Function` (AJV compiles validators that way), so the
 * pipeline CANNOT run here and this Worker deliberately does not try. It receives
 * the generation request the browser's pipeline built ({system, messages,
 * jsonSchema}), forwards it to Claude Haiku through the governed ds-ai-gateway,
 * and returns the raw structured proposal. The browser decides whether it
 * survives — server-side there is no S1/S2/S3, no emit, no second validator.
 *
 * Reuses the EXACT posture proven by af-site's theme generator on the SAME
 * Cloudflare account: gateway id ds-ai-gateway with collectLog:false, and an
 * Anthropic model over Unified Billing — no provider API key, no BYOK credential,
 * no gateway secret. A request through the AI binding is pre-authenticated by the
 * account that owns the Worker.
 */

/* SINGLE AUTHORITY for the gateway + its mandatory privacy posture. Gateway log
   collection is ON by default and would retain the visitor's prompt; every call
   sets collectLog:false explicitly so retention is suppressed regardless of the
   dashboard setting. */
const AI_GATEWAY_OPTIONS = Object.freeze({ id: "ds-ai-gateway", collectLog: false });
const PRIMARY = "anthropic/claude-haiku-4.5"; // Anthropic, Unified Billing
const MAX_OUTPUT_TOKENS = 8192; // a surface is much larger than a theme direction
const PROVIDER_TIMEOUT_MS = 45000;
const MAX_BODY_BYTES = 512 * 1024; // system prompt + surface schema + conversation

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
const reply = (status, text) => new Response(text + "\n", { status, headers: HEADERS });
const json = (status, body) => reply(status, JSON.stringify(body));
/* What this Worker reports beyond its Phase 0.5 shape, advertised on every
   refusal made before a provider call, so a probe that costs no model call
   (an empty body, refused 400) can tell it from an older Worker.
   "per-call-model": every calls[] entry for a call whose response arrived
   names the model the provider said served it (callModel). */
export const CAPABILITIES = Object.freeze(["per-call-model"]);
/* A /api/propose reply sent BEFORE any provider call. `calls: []` says so
   explicitly, so the browser can tell "no model was reached" from an older
   Worker that reported nothing. */
const refuse = (status, body) => json(status, { ...body, calls: [], capabilities: CAPABILITIES });

/** hosted-ai is offered only when the account binding is present AND not killed. */
export function hostedModelsFor(env) {
  const on = (env?.HOSTED_AI ?? "on") === "on" && !!env?.AI;
  return on ? ["scripted", "hosted-ai"] : ["scripted"];
}

export function handleModels(env) {
  return json(200, { models: hostedModelsFor(env) });
}

/* The generation schema goes to the model as PROMPT GUIDANCE, not as a
   structured-output constraint. The A2UI surface schema is large and RECURSIVE
   (~230 KB, `$defs`/`$ref`), which the providers' constrained-decoding formats
   reject (Anthropic: 7003 User Input Error). This matches dspack-gen's own
   honesty note — "constrained decoding cannot be assumed; conformance is judged
   by the surface gates S1/S2/S3 over the artifact." So the Worker asks for a
   bare JSON object and the BROWSER's gates are the authoritative validator;
   callModel strips any ```json fence and parses. Anthropic takes `system`
   top-level; Workers AI takes it as a leading system message. Exported so the
   block bench measures the exact text the model receives (no behavior change). */
export function guidedSystem(system, jsonSchema) {
  return (
    `${system}\n\n` +
    "Return ONE JSON object and nothing else — no prose, no explanation, no markdown code fences. " +
    "The object MUST validate against this JSON Schema:\n" +
    JSON.stringify(jsonSchema)
  );
}

function inputFor(model, { system, messages, jsonSchema }) {
  const base = { max_tokens: MAX_OUTPUT_TOKENS };
  const guided = guidedSystem(system, jsonSchema);
  if (model.startsWith("anthropic/")) {
    return { ...base, system: guided, messages };
  }
  return { ...base, messages: [{ role: "system", content: guided }, ...messages] };
}

function extractText(raw) {
  if (!raw) return "";
  if (Array.isArray(raw.content)) return raw.content.filter((c) => c && c.type === "text").map((c) => c.text).join("");
  return raw.choices?.[0]?.message?.content ?? raw.response ?? "";
}

/* The status of the reply the binding refused a call on. workerd's AI binding
   (src/cloudflare/internal/ai-api.ts) records the HTTP status of every reply
   it receives in `lastRequestHttpStatusCode`, then throws on one that is not
   OK, with an error that carries only a name and a message. That status is
   how a gateway 429 whose message names none of the busy words is told from a
   provider failure (Astryx stage 3, request #539). One binding object may
   serve several requests in an isolate, so the status is read as this call's
   only when the Worker cleared it before the call, no other model call was in
   flight when the call began or began while it ran, and the binding itself
   rejected the call, never this Worker's timeout. Otherwise it is unknown.
   A call stays in flight until the binding settles it. workerd never settles
   the I/O of a request it canceled (a client gone, or this Worker's timeout
   with nothing kept waiting), so a call stops counting STALE_CALL_MS after it
   began, when its request can no longer be running: a request makes at most
   two calls of at most PROVIDER_TIMEOUT_MS each, then replies. */
const modelCallsInFlight = new Map();
let modelCallsStarted = 0;
const STALE_CALL_MS = 5 * 60_000;

/** Whether another model call may still be running in this isolate; calls past STALE_CALL_MS are let go. */
function othersInFlight(now) {
  for (const [id, began] of modelCallsInFlight) {
    if (now - began >= STALE_CALL_MS) modelCallsInFlight.delete(id);
  }
  return modelCallsInFlight.size > 0;
}

function clearReplyStatus(ai) {
  try {
    ai.lastRequestHttpStatusCode = null;
    return ai.lastRequestHttpStatusCode === null;
  } catch {
    return false;
  }
}

/** The status the binding recorded, as it recorded it; none when it recorded none. One that cannot be read is stated
    as unreadable, which is no 429, so it fails closed. */
function replyStatus(ai) {
  try {
    return ai.lastRequestHttpStatusCode ?? undefined;
  } catch {
    return "unreadable";
  }
}

/** A provider call that did not return: what rejected it, and the status of
    the reply the binding refused it on, when that is known to be this call's. */
class Rejected extends Error {
  constructor(error, status) {
    super(describe(error));
    this.error = error;
    this.replyStatus = status;
  }
}

/** ONE provider call. Rejection here is a provider FAILURE (429/busy/timeout/
    transport) and is classified by the caller — never retried in this Worker. */
async function runModel(env, model, request) {
  const ai = env.AI;
  const began = Date.now();
  const alone = !othersInFlight(began);
  const id = ++modelCallsStarted;
  const cleared = clearReplyStatus(ai);
  let call;
  try {
    call = Promise.resolve(ai.run(model, inputFor(model, request), { gateway: AI_GATEWAY_OPTIONS }));
  } catch (error) {
    throw new Rejected(error, undefined);
  }
  modelCallsInFlight.set(id, began);
  const settled = () => {
    modelCallsInFlight.delete(id);
  };
  call.then(settled, settled);
  let timer;
  let timedOut = false;
  try {
    return await Promise.race([
      call,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error("provider timeout"));
        }, PROVIDER_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    const own = cleared && alone && !timedOut && modelCallsStarted === id;
    throw new Rejected(error, own ? replyStatus(ai) : undefined);
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a SUCCESSFUL provider result into the proposal envelope. A throw here
    means the call worked but the OUTPUT was unusable (prose/fence/truncation). */
function parseProposal(raw, model) {
  const text = extractText(raw);
  // Some models wrap JSON in a ```json fence even under a schema; strip it.
  const cleaned = String(text).replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const parsed = JSON.parse(cleaned); // throws → unusable output
  return { json: parsed, raw: cleaned, model: raw?.model ?? model };
}

/* The model the provider says served ONE call, as `{ model }`, or nothing
   when it names none: never the configured id, never guessed. Never throws, so
   a response whose model cannot be read still keeps its call record. */
function servedModel(raw) {
  try {
    const model = raw?.model;
    return typeof model === "string" && model.length > 0 ? { model } : {};
  } catch {
    return {};
  }
}

/* Provider-reported token counts for ONE call, in the canonical shape
   dspack-gen's audit report reads ({inputTokens, outputTokens}). null means
   the provider did not report it; it is never guessed. */
const tokenCount = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
/* Never throws, like servedModel: a response whose usage cannot be read keeps
   its call record, with no usage. */
function usageOf(raw) {
  try {
    const u = raw?.usage ?? {};
    return {
      inputTokens: tokenCount(u.input_tokens ?? u.prompt_tokens),
      outputTokens: tokenCount(u.output_tokens ?? u.completion_tokens),
    };
  } catch {
    return { inputTokens: null, outputTokens: null };
  }
}

/** The request's total: each key summed over the calls that reported it;
    null when no call reported anything. */
function sumUsage(calls) {
  const sum = (key) => {
    const reported = calls.map((c) => c[key]).filter((n) => n !== null);
    return reported.length > 0 ? reported.reduce((a, b) => a + b, 0) : null;
  };
  const usage = { inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens") };
  return usage.inputTokens === null && usage.outputTokens === null ? null : usage;
}

/** The shape the busy classifier reads. Never throws: a rejection value
    String() cannot convert must not cost the request its call records. */
function describe(error) {
  try {
    return String(error?.message ?? error ?? "");
  } catch {
    return "";
  }
}

/** A failed request, carrying every provider call it made. `failure` is
    "provider" (a call was rejected, or its answer could not be serialized)
    or "unusable-output". */
class CallFailure extends Error {
  constructor(error, calls, failure) {
    super(describe(error));
    this.calls = calls;
    this.failure = failure;
    this.rejection = error instanceof Rejected ? error : undefined;
  }
}

/* Model call + parse, with ONE bounded retry on unusable OUTPUT only.

   MEASURED (2026-08): the provider occasionally returns prose, a fence, or a
   truncated payload; an immediate retry with the same input succeeded 4/4 in
   the field, so a single retry converts a user-facing 502 into a success.
   The bound is strict and deliberate: only a parse failure after a SUCCESSFUL
   call retries — a rejected call (429 rate-limit, gateway 'busy', timeout) or
   the kill-switch path propagates on the FIRST throw, because the shared zone
   limit must not be hammered by this Worker. A second unusable output rides
   the existing 502 provider-unavailable path.

   Every call is recorded ({inputTokens, outputTokens, model, outcome,
   durationMs}) whether it succeeded, was rejected, or returned unusable
   output, so the browser accounts for all of them. A call's usage and the
   model that served it are read the moment its response arrives, before the
   output is parsed or a retry is decided, so every reply sent after the call
   carries them; a rejected call returned no response and names no model.
   `maxCalls` (1 or 2) caps the calls this request may make; 1 disables the
   retry. Exported for unit tests. */
export async function callModel(env, model, request, maxCalls = 2) {
  const calls = [];
  let unusable;
  for (let i = 0; i < maxCalls; i++) {
    const started = Date.now();
    let raw;
    try {
      raw = await runModel(env, model, request);
    } catch (error) {
      calls.push({ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: Date.now() - started });
      throw new CallFailure(error, calls, "provider");
    }
    const durationMs = Date.now() - started;
    const served = { ...usageOf(raw), ...servedModel(raw) };
    try {
      const proposal = parseProposal(raw, model);
      calls.push({ ...served, outcome: "ok", durationMs });
      return { ...proposal, usage: sumUsage(calls), calls };
    } catch (error) {
      calls.push({ ...served, outcome: "unusable-output", durationMs });
      unusable = error;
    }
  }
  throw new CallFailure(unusable, calls, "unusable-output");
}

/* Reads at most `limit` bytes and rejects if the body exceeds it — enforced even
   when Content-Length is absent, so a chunked body cannot stream past the cap.
   Fails CLOSED (throws) rather than buffering an unbounded request. */
async function readBounded(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("body too large");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    merged.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/* Per-client rate limit — defense-in-depth for FAIRNESS (one client should not
   consume the whole allowance). Returns a Response to refuse, or null to proceed.

   MEASURED (2026-08-09): the native Cloudflare rate-limiting binding is present
   and callable on production but does NOT currently enforce on this account —
   .limit() returns success for every call (verified: 20+ rapid requests all
   passed). That is an account-side limitation, not a bug here; the binding is
   kept so it starts working if the account enables it. The ENFORCED cost cap is
   the ds-ai-gateway's own zone rate limit (verified: a concurrent burst is
   rate-limited to 503 'busy' below), plus the HOSTED_AI kill switch and the
   per-call token + body-size caps. A limiter ERROR still denies (fail closed);
   a limiter that reports success is trusted (the gateway is the real gate). */
async function rateLimited(env, request) {
  if (!env.PROPOSE_RATE_LIMIT) return null;
  const key = request.headers.get("cf-connecting-ip") ?? "anonymous";
  let allowed;
  try {
    ({ success: allowed } = await env.PROPOSE_RATE_LIMIT.limit({ key }));
  } catch {
    return refuse(503, { error: "unavailable", message: "Generation is briefly unavailable. Try again in a moment, or use scripted mode." });
  }
  if (allowed) return null;
  return refuse(429, { error: "rate-limited", message: "You've generated several times in the last minute. Try again shortly, or use scripted mode." });
}

export async function handlePropose(request, env) {
  if (request.method !== "POST") return refuse(405, { error: "method-not-allowed", message: "This endpoint accepts POST only." });
  if ((env?.HOSTED_AI ?? "on") !== "on" || !env?.AI) {
    return refuse(503, {
      error: "unavailable",
      message: "Hosted AI generation is unavailable. Use scripted mode to watch the governed pipeline, or connect the local agent for local models.",
    });
  }

  // Rate-limit EARLY — before reading the body — so a spammer is bounded
  // regardless of payload, and well before the paid model call.
  const limited = await rateLimited(env, request);
  if (limited) return limited;

  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    return refuse(415, { error: "unsupported-media-type", message: "Send application/json." });
  }

  // Size ceiling enforced by a bounded read (Content-Length may be absent).
  let raw;
  try {
    raw = await readBounded(request, MAX_BODY_BYTES);
  } catch {
    return refuse(413, { error: "payload-too-large", message: "The generation request is larger than this endpoint accepts." });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse(400, { error: "malformed-json", message: "The request body is not valid JSON." });
  }
  const { system, messages, jsonSchema, maxCalls = 2 } = body ?? {};
  if (typeof system !== "string" || !Array.isArray(messages) || typeof jsonSchema !== "object" || jsonSchema === null) {
    return refuse(400, { error: "invalid-request", message: "Expected { system, messages, jsonSchema }." });
  }
  // Optional cap on this request's provider calls; absent means today's
  // behavior (one parse retry). Anything but 1 or 2 is refused, never clamped.
  if (maxCalls !== 1 && maxCalls !== 2) {
    return refuse(400, { error: "invalid-request", message: "maxCalls must be 1 or 2." });
  }

  let result;
  try {
    result = await callModel(env, PRIMARY, { system, messages, jsonSchema }, maxCalls);
  } catch (error) {
    return failed(error);
  }
  // Serialized here rather than inside json(): an answer that parsed but
  // cannot be written back (nesting past the serializer's depth) still reports
  // the call it cost, its usage and its model, as a provider failure.
  let text;
  try {
    text = JSON.stringify(result);
  } catch (error) {
    return failed(new CallFailure(error, result.calls, "provider"));
  }
  return reply(200, text);
}

/** Every key a provider reports usage or a served model under: on a rejection, any of them shows a model result. */
const RESULT_KEYS = ["usage", "model", "inputTokens", "outputTokens", "input_tokens", "output_tokens", "prompt_tokens", "completion_tokens"];
/** The same evidence written as text: a quoted usage or token key, in any case, its quotes escaped or not (a body
    quoted inside another). The binding makes a reply's whole body its error's message when the body names no error
    code. A model's name alone does not count here, since a refusal's body may name the model it refused. */
const RESULT_IN_TEXT = /\\?"(usage|inputTokens|outputTokens|input_tokens|output_tokens|prompt_tokens|completion_tokens)\\?"\s*:/i;
/** How deep a rejection is read, its statuses and its search alike; anything deeper fails closed. */
const EVIDENCE_DEPTH = 6;
/** How many values the search reads in all; a rejection holding more fails closed, unread. */
const EVIDENCE_VALUES = 4096;
/** What the search reads in full: plain objects, arrays and errors. Anything else (a Response, a stream, a Map, a
    buffer, a function) may hold what it cannot read, such as a body, so it fails closed. */
const plainData = (value) => Array.isArray(value) || value instanceof Error || [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** What a rejection carries as structured data: every status it states, itself or down its response and cause, and
    whether anything it holds shows a model result: a result key, or a string quoting one, under any own key,
    enumerable or not. One that cannot be read in full shows one, so it fails closed. */
function evidenceOf(rejection) {
  const statuses = [];
  const chain = (value, depth) => {
    if (!value || typeof value !== "object" || depth > EVIDENCE_DEPTH) return;
    if (value.status != null) statuses.push(value.status);
    chain(value.response, depth + 1);
    chain(value.cause, depth + 1);
  };
  const seen = new Set();
  let result = false;
  let values = 0;
  const search = (value, depth) => {
    if (result) return;
    if (typeof value === "string") {
      if (RESULT_IN_TEXT.test(value)) result = true;
      return;
    }
    if (!value || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) return;
    if (depth > EVIDENCE_DEPTH || seen.size >= 256 || !plainData(value) || (Array.isArray(value) && value.length > EVIDENCE_VALUES)) {
      result = true;
      return;
    }
    seen.add(value);
    const keys = Reflect.ownKeys(value);
    values += keys.length;
    if (values > EVIDENCE_VALUES) {
      result = true;
      return;
    }
    for (const key of RESULT_KEYS) if (value[key] != null) result = true;
    for (const next of [value.response, value.cause, ...keys.map((key) => value[key])]) search(next, depth + 1);
  };
  try {
    chain(rejection, 0);
    search(rejection, 0);
    return { statuses, result };
  } catch {
    return { statuses: [], result: true };
  }
}

/** A call the gateway turned away: it returned nothing, so it reports no usage and names no model. */
const unspent = (call) => call?.outcome === "provider-error" && call.inputTokens === null && call.outputTokens === null && call.model === undefined;

/* Busy: the gateway turned away the request's only call before any model
   ran, which the browser and the bench may retry at no cost. So a request
   that made any other call (an unusable output first), or whose rejection
   shows a model result in its fields or its message, is never busy: it may
   have spent, and stays a provider failure. Then a status, once known,
   decides alone: the one the binding recorded for this call's reply and any
   the rejection itself carries must all be a numeric 429; anything else is a
   provider failure, whatever the message says. Only when no status is known
   does the message decide, as before: the compatibility fallback. */
function isBusy(error, calls) {
  if (error?.failure === "unusable-output") return false;
  if (calls.length !== 1 || !unspent(calls[0])) return false;
  const message = String(error?.message ?? "");
  const rejection = error?.rejection;
  const { statuses, result } = rejection ? evidenceOf(rejection.error) : { statuses: [], result: false };
  if (result || RESULT_IN_TEXT.test(message)) return false;
  const stated = rejection?.replyStatus === undefined ? statuses : [rejection.replyStatus, ...statuses];
  if (stated.length > 0) return stated.every((status) => status === 429);
  return /\b429\b|too many requests|rate.?limit|capacity/i.test(message);
}

/** The error reply for a request that made provider calls, carrying them. */
function failed(error) {
  // Every provider call this request made is reported, on every reply, so
  // a failed request is never free in the browser's accounting.
  const calls = Array.isArray(error?.calls) ? error.calls : [];
  const accounted = { usage: sumUsage(calls), calls };
  // Classified by SHAPE only — never inspected for content, never echoed: a
  // provider error can quote the request that caused it, and the prompt must
  // not reach a log or a response. The zone-wide gateway rate limit fires
  // because SOMEONE ELSE is generating, which is a different, actionable fact.
  const busy = isBusy(error, calls);
  if (busy) {
    return json(503, {
      error: "busy",
      message: "The shared generation gateway is busy right now. Try again in a moment, or use scripted mode.",
      ...accounted,
    });
  }
  return json(502, {
    error: "provider-unavailable",
    // "unusable-output": the model answered but not with a usable proposal;
    // "provider": the call itself failed (timeout, transport, provider error),
    // or its answer could not be written into the reply.
    cause: error?.failure === "unusable-output" ? "unusable-output" : "provider",
    message: "Hosted generation did not return a usable proposal. Use scripted mode, or connect the local agent.",
    ...accounted,
  });
}
