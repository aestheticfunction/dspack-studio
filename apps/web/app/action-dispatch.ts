"use client";

/**
 * The one HITL round-trip implementation: record the user's action
 * (resolution + studio.action.pending), POST it to the agent, append the
 * agent's response events. Used by the live view's run hook and by FM-3
 * fork continuation — same wire shapes, same correlation ids, so replays
 * reconstruct either path identically.
 */
export interface DispatchableAction {
  scenario: string;
  name: string;
  capability?: string;
  surfaceId?: string;
  sourceComponentId?: string;
  context?: Record<string, unknown>;
  resolution?: {
    ok: boolean;
    originalName?: string;
    capability?: string;
    method?: string;
    reason?: string;
    detail?: string;
  };
}

export async function dispatchAction(
  agentUrl: string,
  action: DispatchableAction,
  append: (event: Record<string, unknown>) => void,
): Promise<void> {
  const actionId = crypto.randomUUID();
  const { resolution, ...rest } = action;
  if (resolution) {
    append({
      type: "CUSTOM",
      name: resolution.ok ? "studio.action.resolved" : "studio.action.unresolved",
      value: { actionId, originalName: resolution.originalName, capability: resolution.capability, method: resolution.method, reason: resolution.reason, detail: resolution.detail },
    });
    if (!resolution.ok) return;
  }
  append({ type: "CUSTOM", name: "studio.action.pending", value: { actionId, ...rest } });

  try {
    const r = await fetch(`${agentUrl}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionId, ...rest }),
    });
    const body = (await r.json()) as { events?: Array<Record<string, unknown>>; error?: string };
    if (!r.ok) throw new Error(body.error ?? `agent responded ${r.status}`);
    for (const e of body.events ?? []) append(e);
  } catch (err: unknown) {
    append({
      type: "CUSTOM",
      name: "studio.action.failed",
      value: { actionId, ...rest, detail: err instanceof Error ? err.message : String(err) },
    });
  }
}
