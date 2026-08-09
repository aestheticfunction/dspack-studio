/**
 * Runtime provider configuration — the local agent as the secure bridge to a
 * user's own models. The browser sends WHICH provider and WHERE (an endpoint,
 * an optional credential, a model); the agent holds the endpoint communication
 * and any secret and does the talking. Configuration is per-operation and
 * never persisted here, mirroring the agent's BYO trust model: local process,
 * local endpoints, nothing durable.
 *
 * Two local providers cover the field: Ollama (its own /api) and anything
 * OpenAI-compatible (LM Studio, llama.cpp server, vLLM, LocalAI, …) behind one
 * configurable base URL. Environment variables (OLLAMA_URL) remain a fallback
 * default, no longer the only way in.
 */
import { OllamaAdapter, type GenerationAdapter } from "@aestheticfunction/dspack-gen";
import { OpenAICompatAdapter, type ProviderConfig } from "./adapters/openai-compat.js";

/** Ollama context window (mirrors pipeline.ts) — its 4096 default is marginal
 *  for the governed request; every other adapter behavior is untouched. */
const OLLAMA_OPTIONS = { num_ctx: 16384, num_predict: 4096 };

export const DEFAULT_OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const DEFAULT_OPENAI = "http://localhost:1234/v1";

/** Build a generation adapter from a runtime provider config. */
export function adapterForProvider(provider: ProviderConfig): GenerationAdapter {
  if (provider.kind === "ollama") {
    return new OllamaAdapter({
      model: provider.model,
      host: (provider.baseUrl || DEFAULT_OLLAMA).replace(/\/+$/, ""),
      fetch: ((url: unknown, init: { body: string }) => {
        const body = JSON.parse(init.body);
        body.options = { ...body.options, ...OLLAMA_OPTIONS };
        return fetch(url as string, { ...init, body: JSON.stringify(body) });
      }) as typeof fetch,
    });
  }
  return new OpenAICompatAdapter({
    model: provider.model,
    baseUrl: provider.baseUrl || DEFAULT_OPENAI,
    apiKey: provider.apiKey,
  });
}

export interface ProviderTestResult {
  ok: boolean;
  models: string[];
  error?: string;
}

/**
 * Probe a local provider endpoint and discover its models. `ok: true` with an
 * empty list means "reachable, but the server doesn't enumerate models" — the
 * UI then falls back to manual model entry rather than treating it as a
 * failure. A credential, if given, is used for the probe and never echoed.
 */
export async function testProvider(input: { kind: string; baseUrl?: string; apiKey?: string }): Promise<ProviderTestResult> {
  const signal = AbortSignal.timeout(5000);
  try {
    if (input.kind === "ollama") {
      const host = (input.baseUrl || DEFAULT_OLLAMA).replace(/\/+$/, "");
      const r = await fetch(`${host}/api/tags`, { signal });
      if (!r.ok) return { ok: false, models: [], error: `Ollama replied ${r.status} ${r.statusText}` };
      const tags = (await r.json()) as { models?: Array<{ name: string }> };
      const models = (tags.models ?? []).map((m) => m.name).filter((n) => !!n && !n.includes("embedding") && !n.includes("flux"));
      return { ok: true, models };
    }
    if (input.kind === "openai") {
      const base = (input.baseUrl || DEFAULT_OPENAI).replace(/\/+$/, "");
      const headers: Record<string, string> = {};
      if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;
      const r = await fetch(`${base}/models`, { headers, signal });
      // Some servers don't implement /models; reachable-but-unlistable is not a
      // failure — the caller enters a model id by hand.
      if (r.status === 404) return { ok: true, models: [] };
      if (!r.ok) return { ok: false, models: [], error: `Endpoint replied ${r.status} ${r.statusText}` };
      const body = (await r.json()) as { data?: Array<{ id?: string }> };
      const models = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string" && id.length > 0);
      return { ok: true, models };
    }
    return { ok: false, models: [], error: `unknown provider kind '${input.kind}'` };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    const msg = e instanceof Error ? e.message : String(e);
    const unreachable = name === "TimeoutError" || msg.includes("timeout") || msg.includes("aborted") || msg.includes("fetch failed") || msg.includes("ECONNREFUSED");
    return { ok: false, models: [], error: unreachable ? "the endpoint didn’t respond — is the server running at that address?" : msg };
  }
}
