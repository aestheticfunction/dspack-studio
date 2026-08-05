/**
 * Thin client for the local agent's /project routes. Degradation is honest:
 * every helper resolves to a typed error the UI states plainly ("requires the
 * local agent") instead of simulating results.
 */
import { HttpAgent, type BaseEvent } from "@dspack-studio/agui-bridge";
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

/**
 * A refusal keeps its STRUCTURED evidence: routes that answer 4xx with a
 * findings array (the fail-closed accept gate) must not be flattened to
 * "agent replied 422" — the gate reasons are the whole point (#41).
 */
export type AgentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; findings?: ComposerFinding[]; status?: number };

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
    if (!res.ok) {
      const findings = Array.isArray(payload?.findings) ? (payload.findings as ComposerFinding[]) : undefined;
      return {
        ok: false,
        status: res.status,
        ...(findings ? { findings } : {}),
        error: String(payload?.error ?? (findings?.length ? findings.map((f) => f.message).join("; ") : `agent replied ${res.status}`)),
      };
    }
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
    restoredTopLevel: Array<{ id: string; parent?: string }>;
  };
}

export const agentConnect = (path: string) => post<ConnectPayload>("/project/connect", { path });
export const agentDiscover = (path: string) => post<{ ok: boolean; log: string; contract: Record<string, unknown>; ledger: LedgerStatus }>("/project/discover", { path });
export const agentRediscover = (path: string, restoreTopLevel?: string[]) =>
  post<{ ok: boolean; contract: Record<string, unknown>; ledger: LedgerStatus; report: RediscoverReport }>(
    "/project/rediscover",
    restoreTopLevel ? { path, restoreTopLevel } : { path },
  );
export const agentEmit = (path: string) => post<EmitPayload>("/project/emit", { path });
export const agentValidate = (path: string) => post<ValidatePayload>("/project/validate", { path });
export const agentSave = (path: string, kind: "contract" | "profile", document: unknown) =>
  post<{ ok: boolean; findings: Array<{ path?: string; target?: string; message: string }>; ledger?: LedgerStatus }>("/project/save", { path, kind, document });

/** Model refs the local agent can run right now ("scripted" + local Ollama tags). */
export async function agentModels(): Promise<string[]> {
  try {
    const res = await fetch(`${agentUrl()}/models`, { signal: AbortSignal.timeout(3000) });
    const body = (await res.json()) as { models?: string[] };
    return Array.isArray(body.models) && body.models.length ? body.models : ["scripted"];
  } catch {
    return ["scripted"];
  }
}

export interface BuildRunInput {
  path: string;
  prompt: string;
  intent: string;
  modelRef: string;
  /** Refinement seed: the prior turn's ask + generated surface, verbatim. */
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * Stream a project-scoped generation run (AG-UI SSE over /project/run).
 * Events arrive as plain mapper-shaped JSON for composer-core's fold; the
 * returned handle cancels the subscription.
 */
export function streamProjectRun(
  input: BuildRunInput,
  handlers: { onEvent(event: Record<string, unknown>): void; onError(message: string): void; onComplete(): void },
): { cancel(): void } {
  const agent = new HttpAgent({ url: `${agentUrl()}/project/run` });
  const observable = agent.run({
    threadId: `build-${input.path}`,
    runId: `build-${Date.now()}`,
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: input,
  } as never);
  const subscription = (observable as { subscribe(o: object): { unsubscribe(): void } }).subscribe({
    next: (event: BaseEvent) => handlers.onEvent(event as unknown as Record<string, unknown>),
    error: (err: unknown) => handlers.onError(err instanceof Error ? err.message : String(err)),
    complete: () => handlers.onComplete(),
  });
  return { cancel: () => subscription.unsubscribe() };
}

export interface AcceptedExample {
  /** Omit to let the agent mint a collision-free id from the contract (#42). */
  id?: string;
  intent: string;
  name?: string;
  prompt: string;
  description?: string;
  surface: Record<string, unknown>;
}

/** Server-side fail-closed acceptance of a build result as a worked example. */
export const agentSaveExample = (path: string, example: AcceptedExample) =>
  post<{ ok: boolean; findings: ComposerFinding[]; example?: AcceptedExample; ledger?: LedgerStatus }>("/project/save-example", { path, example });
