/**
 * Thin client for the local agent's /project routes. Degradation is honest:
 * every helper resolves to a typed error the UI states plainly ("requires the
 * local agent") instead of simulating results.
 */
import type { ComposerFinding, LedgerStatus, ProjectManifest } from "@dspack-studio/composer-core";

export interface EmitPayload {
  ok: boolean;
  catalog?: Record<string, any>;
  report?: unknown;
  surfaces?: Array<{ name: string; messages?: unknown[]; warnings: Array<{ code: string; message: string }>; error?: string }>;
  findings: ComposerFinding[];
}

export interface ValidatePayload {
  ok: boolean;
  findings: ComposerFinding[];
}

export interface ConnectPayload {
  manifest: ProjectManifest;
  contract: Record<string, unknown> | null;
  ledger: LedgerStatus | null;
  profile: Record<string, unknown> | null;
  profileIssue: string | null;
  extraSurfaces: Array<{ name: string; surface: unknown }>;
}

export type AgentResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DEFAULT_AGENT = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8787";

export function agentUrl(): string {
  return DEFAULT_AGENT;
}

async function post<T>(route: string, body: unknown): Promise<AgentResult<T>> {
  try {
    const res = await fetch(`${agentUrl()}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await res.json();
    if (!res.ok) return { ok: false, error: String(payload.error ?? `agent replied ${res.status}`) };
    return { ok: true, value: payload as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function probeAgent(): Promise<boolean> {
  try {
    const res = await fetch(agentUrl(), { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

/**
 * dspack-export 0.5.0's RegenerateReport (shape owned there). The entry-
 * level classes are the ratified regeneration-state table; every one is
 * rendered, none is acted on without an explicit human decision.
 */
export interface RediscoverReport {
  refreshed: string[];
  preservedHumanOwned: string[];
  keptMissingInFresh: string[];
  migration?: "tool-owned" | "human-owned";
  components: {
    added: string[];
    refreshed: string[];
    unchanged: string[];
    readopted: string[];
    preservedEnriched: Array<{ id: string; freshDelta: Array<{ path: string; fresh: unknown }> }>;
    removedWithSource: string[];
    keptMissingInFresh: string[];
    deletedAwaitingDecision: string[];
    suppressed: string[];
    suppressedButPresent: string[];
    restoredConflict: Array<{ id: string; parent: string }>;
    entryHashRetired: string[];
  };
}

export const agentConnect = (path: string) => post<ConnectPayload>("/project/connect", { path });
export const agentDiscover = (path: string) => post<{ ok: boolean; log: string; contract: Record<string, unknown>; ledger: LedgerStatus }>("/project/discover", { path });
export const agentRediscover = (path: string) =>
  post<{ ok: boolean; contract: Record<string, unknown>; ledger: LedgerStatus; report: RediscoverReport }>("/project/rediscover", { path });
export const agentEmit = (path: string) => post<EmitPayload>("/project/emit", { path });
export const agentValidate = (path: string) => post<ValidatePayload>("/project/validate", { path });
export const agentSave = (path: string, kind: "contract" | "profile", document: unknown) =>
  post<{ ok: boolean; findings: Array<{ path?: string; target?: string; message: string }>; ledger?: LedgerStatus }>("/project/save", { path, kind, document });
