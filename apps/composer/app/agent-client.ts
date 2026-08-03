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
  surfaces: string[];
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

export const agentConnect = (path: string) => post<ConnectPayload>("/project/connect", { path });
export const agentDiscover = (path: string) => post<{ ok: boolean; log: string; contract: Record<string, unknown>; ledger: LedgerStatus }>("/project/discover", { path });
export const agentEmit = (path: string) => post<EmitPayload>("/project/emit", { path });
export const agentValidate = (path: string) => post<ValidatePayload>("/project/validate", { path });
export const agentSave = (path: string, kind: "contract" | "profile", document: unknown) =>
  post<{ ok: boolean; findings: Array<{ path?: string; target?: string; message: string }>; ledger?: LedgerStatus }>("/project/save", { path, kind, document });
