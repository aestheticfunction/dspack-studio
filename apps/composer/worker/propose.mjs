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
const json = (status, body) => new Response(JSON.stringify(body) + "\n", { status, headers: HEADERS });

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
   top-level; Workers AI takes it as a leading system message. */
function guidedSystem(system, jsonSchema) {
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

/** ONE provider call. Rejection here is a provider FAILURE (429/busy/timeout/
    transport) and is classified by the caller — never retried in this Worker. */
async function runModel(env, model, request) {
  let timer;
  try {
    return await Promise.race([
      env.AI.run(model, inputFor(model, request), { gateway: AI_GATEWAY_OPTIONS }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("provider timeout")), PROVIDER_TIMEOUT_MS);
      }),
    ]);
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
  return {
    json: parsed,
    raw: cleaned,
    model: raw?.model ?? model,
    usage: raw?.usage
      ? {
          in: raw.usage.input_tokens ?? raw.usage.prompt_tokens ?? null,
          out: raw.usage.output_tokens ?? raw.usage.completion_tokens ?? null,
        }
      : null,
  };
}

/* Model call + parse, with ONE bounded retry on unusable OUTPUT only.

   MEASURED (2026-08): the provider occasionally returns prose, a fence, or a
   truncated payload; an immediate retry with the same input succeeded 4/4 in
   the field, so a single retry converts a user-facing 502 into a success.
   The bound is strict and deliberate: only a parse failure after a SUCCESSFUL
   call retries — a rejected call (429 rate-limit, gateway 'busy', timeout) or
   the kill-switch path propagates on the FIRST throw, because the shared zone
   limit must not be hammered by this Worker. A second unusable output rides
   the existing 502 provider-unavailable path. Exported for unit tests. */
export async function callModel(env, model, request) {
  const first = await runModel(env, model, request);
  try {
    return parseProposal(first, model);
  } catch {
    const second = await runModel(env, model, request);
    return parseProposal(second, model);
  }
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
    return json(503, { error: "unavailable", message: "Generation is briefly unavailable. Try again in a moment, or use scripted mode." });
  }
  if (allowed) return null;
  return json(429, { error: "rate-limited", message: "You've generated several times in the last minute. Try again shortly, or use scripted mode." });
}

export async function handlePropose(request, env) {
  if (request.method !== "POST") return json(405, { error: "method-not-allowed", message: "This endpoint accepts POST only." });
  if ((env?.HOSTED_AI ?? "on") !== "on" || !env?.AI) {
    return json(503, {
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
    return json(415, { error: "unsupported-media-type", message: "Send application/json." });
  }

  // Size ceiling enforced by a bounded read (Content-Length may be absent).
  let raw;
  try {
    raw = await readBounded(request, MAX_BODY_BYTES);
  } catch {
    return json(413, { error: "payload-too-large", message: "The generation request is larger than this endpoint accepts." });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "malformed-json", message: "The request body is not valid JSON." });
  }
  const { system, messages, jsonSchema } = body ?? {};
  if (typeof system !== "string" || !Array.isArray(messages) || typeof jsonSchema !== "object" || jsonSchema === null) {
    return json(400, { error: "invalid-request", message: "Expected { system, messages, jsonSchema }." });
  }

  try {
    return json(200, await callModel(env, PRIMARY, { system, messages, jsonSchema }));
  } catch (error) {
    // Classified by SHAPE only — never inspected for content, never echoed: a
    // provider error can quote the request that caused it, and the prompt must
    // not reach a log or a response. The zone-wide gateway rate limit fires
    // because SOMEONE ELSE is generating, which is a different, actionable fact.
    const shape = String(error?.message ?? "");
    const busy = /\b429\b|too many requests|rate.?limit|capacity/i.test(shape);
    if (busy) {
      return json(503, {
        error: "busy",
        message: "The shared generation gateway is busy right now. Try again in a moment, or use scripted mode.",
      });
    }
    return json(502, {
      error: "provider-unavailable",
      message: "Hosted generation did not return a usable proposal. Use scripted mode, or connect the local agent.",
    });
  }
}
