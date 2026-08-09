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

/* Anthropic takes `system` as a top-level parameter and structured output via
   output_config.format; Workers AI takes a system message and response_format.
   Sending Anthropic a system message returns error 7003. */
function inputFor(model, { system, messages, jsonSchema }) {
  const base = { max_tokens: MAX_OUTPUT_TOKENS };
  if (model.startsWith("anthropic/")) {
    return { ...base, system, messages, output_config: { format: { type: "json_schema", schema: jsonSchema } } };
  }
  return {
    ...base,
    messages: [{ role: "system", content: system }, ...messages],
    response_format: { type: "json_schema", json_schema: jsonSchema },
  };
}

function extractText(raw) {
  if (!raw) return "";
  if (Array.isArray(raw.content)) return raw.content.filter((c) => c && c.type === "text").map((c) => c.text).join("");
  return raw.choices?.[0]?.message?.content ?? raw.response ?? "";
}

async function callModel(env, model, request) {
  const raw = await Promise.race([
    env.AI.run(model, inputFor(model, request), { gateway: AI_GATEWAY_OPTIONS }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("provider timeout")), PROVIDER_TIMEOUT_MS)),
  ]);
  const text = extractText(raw);
  // Some models wrap JSON in a ```json fence even under a schema; strip it.
  const cleaned = String(text).replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const parsed = JSON.parse(cleaned); // throws → caller reports provider-malformed
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

export async function handlePropose(request, env) {
  if (request.method !== "POST") return json(405, { error: "method-not-allowed", message: "This endpoint accepts POST only." });
  if ((env?.HOSTED_AI ?? "on") !== "on" || !env?.AI) {
    return json(503, {
      error: "unavailable",
      message: "Hosted AI generation is unavailable. Use scripted mode to watch the governed pipeline, or connect the local agent for local models.",
    });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    return json(415, { error: "unsupported-media-type", message: "Send application/json." });
  }
  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json(413, { error: "payload-too-large", message: "The generation request is larger than this endpoint accepts." });
  }

  let body;
  try {
    body = await request.json();
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
