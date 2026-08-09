/**
 * Provider configuration — client side.
 *
 * The browser is only a client. It remembers WHICH local provider you
 * configured, its endpoint, and the model — but a credential is held in memory
 * for the session and NEVER written to localStorage. The agent owns the
 * endpoint communication and any secret; these settings only tell it what to
 * reach for. The conceptual model is deliberately small: Hosted AI, or Local
 * AI as Ollama / OpenAI-compatible (LM Studio, llama.cpp, vLLM, LocalAI, …).
 */

export type LocalKind = "ollama" | "openai";

/** The run-time provider config sent to the agent (mirrors the agent side). */
export interface ProviderConfig {
  kind: LocalKind;
  baseUrl?: string;
  /** In-memory only, for OpenAI-compatible servers that require a key. */
  apiKey?: string;
  model: string;
}

export const OLLAMA_DEFAULT_URL = "http://localhost:11434";
export const OPENAI_DEFAULT_URL = "http://localhost:1234/v1";

/** A remembered (non-secret) endpoint + chosen model for one local provider. */
export interface RememberedProvider {
  baseUrl: string;
  model: string;
}

export interface StoredProviders {
  ollama: RememberedProvider | null;
  openai: RememberedProvider | null;
  /** The active model ref: "hosted-ai" | "scripted" | "ollama:<m>" | "openai:<m>". */
  active: string | null;
}

const KEY = "composer.providers.v1";

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadStoredProviders(): StoredProviders {
  const empty: StoredProviders = { ollama: null, openai: null, active: null };
  const s = storage();
  if (!s) return empty;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<StoredProviders>;
    return {
      ollama: validRemembered(parsed.ollama),
      openai: validRemembered(parsed.openai),
      active: typeof parsed.active === "string" ? parsed.active : null,
    };
  } catch {
    return empty;
  }
}

function validRemembered(v: unknown): RememberedProvider | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.baseUrl !== "string" || typeof r.model !== "string" || !r.model) return null;
  return { baseUrl: r.baseUrl, model: r.model };
}

export function saveStoredProviders(next: StoredProviders): void {
  const s = storage();
  if (!s) return;
  try {
    // A credential must never reach storage — the shape above already excludes
    // it, and this is the single writer, so nothing secret can leak here.
    s.setItem(KEY, JSON.stringify(next));
  } catch {
    /* persistence is a convenience */
  }
}

/** The model ref a build runs under, derived from a provider selection. */
export function modelRefFor(kind: "hosted" | "scripted" | LocalKind, model?: string): string {
  if (kind === "hosted") return "hosted-ai";
  if (kind === "scripted") return "scripted";
  return `${kind}:${model ?? ""}`;
}

/** True for a model ref that runs on a LOCAL provider through the agent. */
export function isLocalRef(ref: string): boolean {
  return ref.startsWith("ollama:") || ref.startsWith("openai:");
}

export function localKindOf(ref: string): LocalKind | null {
  if (ref.startsWith("ollama:")) return "ollama";
  if (ref.startsWith("openai:")) return "openai";
  return null;
}

export function modelOf(ref: string): string {
  const at = ref.indexOf(":");
  return at >= 0 ? ref.slice(at + 1) : ref;
}
