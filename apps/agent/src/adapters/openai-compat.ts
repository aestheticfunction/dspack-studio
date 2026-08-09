/**
 * An OpenAI-compatible generation adapter (ADR-9 GenerationAdapter), living in
 * the agent because it is BYO-inference plumbing, not a pipeline change. It
 * speaks the OpenAI Chat Completions API, which LM Studio, llama.cpp's server,
 * vLLM, LocalAI, and others expose — so one adapter serves the whole family
 * behind a configurable base URL.
 *
 * Structured output degrades gracefully: it prefers `response_format:
 * json_schema` (LM Studio, vLLM, recent llama.cpp), falls back to
 * `json_object`, then to a plain request, because local servers vary in what
 * they honor. Per ADR-9's honesty note the adapter guarantees only that the
 * result PARSES as JSON (AdapterOutputError otherwise); the surface gates
 * S1/S2/S3 judge schema, vocabulary, and governance over the artifact.
 *
 * The API key, if any, is held here in the agent and sent only to the
 * configured endpoint — never logged, never returned to the browser.
 */
import {
  AdapterOutputError,
  parseJsonOutput,
  type GenerateRequest,
  type GenerateResult,
  type GenerationAdapter,
} from "@aestheticfunction/dspack-gen";

export interface OpenAICompatAdapterOptions {
  /** Required — the model id the server serves (e.g. "qwen2.5-coder:7b"). */
  model: string;
  /** The OpenAI-compatible base URL, e.g. http://localhost:1234/v1. */
  baseUrl: string;
  /** Optional bearer credential; most local servers need none. */
  apiKey?: string;
  fetch?: typeof fetch;
}

export class OpenAICompatAdapter implements GenerationAdapter {
  readonly id: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatAdapterOptions) {
    if (!options.model) throw new Error("OpenAICompatAdapter requires a model id");
    if (!options.baseUrl) throw new Error("OpenAICompatAdapter requires a base URL");
    this.model = options.model;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.id = `openai:${options.model}`;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const url = `${this.baseUrl}/chat/completions`;
    const messages = [
      { role: "system", content: request.system },
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const base = {
      model: this.model,
      messages,
      temperature: request.params?.temperature ?? 0,
      ...(request.params?.maxTokens ? { max_tokens: request.params.maxTokens } : {}),
    };
    // Ordered from most to least capable structured-output support.
    const attempts: Array<Record<string, unknown>> = [
      { ...base, response_format: { type: "json_schema", json_schema: { name: "surface", schema: request.jsonSchema, strict: false } } },
      { ...base, response_format: { type: "json_object" } },
      base,
    ];
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    let lastError = "no response";
    for (const body of attempts) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
      } catch (e) {
        throw new AdapterOutputError(this.id, `could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        lastError = `${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 200)}` : ""}`;
        // A rejected response_format shape reads as 400/422 — try a simpler one.
        if (res.status === 400 || res.status === 422) continue;
        throw new AdapterOutputError(this.id, `provider error: ${lastError}`);
      }
      const payload = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const raw = payload.choices?.[0]?.message?.content ?? "";
      if (!raw.trim()) {
        lastError = "the server returned an empty completion";
        continue;
      }
      return {
        json: parseJsonOutput(this.id, raw), // AdapterOutputError on non-JSON
        raw,
        model: payload.model ?? this.model,
        usage: payload.usage
          ? { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens }
          : undefined,
      };
    }
    throw new AdapterOutputError(this.id, `no usable completion (${lastError})`);
  }
}

/** Provider-config shape sent from the browser through the bridge for a run. */
export interface ProviderConfig {
  kind: "ollama" | "openai";
  /** Endpoint base: Ollama host (…:11434) or OpenAI-compatible base (…/v1). */
  baseUrl?: string;
  /** Optional credential for OpenAI-compatible servers; stays in the agent. */
  apiKey?: string;
  /** The model to run (without the provider prefix). */
  model: string;
}

export function parseProviderConfig(raw: unknown): ProviderConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "ollama" && r.kind !== "openai") return undefined;
  if (typeof r.model !== "string" || !r.model) return undefined;
  return {
    kind: r.kind,
    model: r.model,
    ...(typeof r.baseUrl === "string" && r.baseUrl ? { baseUrl: r.baseUrl } : {}),
    ...(typeof r.apiKey === "string" && r.apiKey ? { apiKey: r.apiKey } : {}),
  };
}
