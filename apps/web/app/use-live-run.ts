"use client";

/**
 * Live execution over AG-UI: HttpAgent (via the bridge) streams the governed
 * pipeline from apps/agent; incoming events accumulate — with timings — into
 * the same { events } shape the replay reducers fold, so a live run IS a
 * fixture being written in front of you: progressively rendered while
 * streaming, scrubbable the moment it completes, downloadable as a fixture.
 *
 * No credentials pass through the browser: modelRef selects "scripted" or a
 * local Ollama model; hosted-model keys live only in the agent's environment.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { HttpAgent, type BaseEvent } from "@dspack-studio/agui-bridge";
import type { FixtureEvent } from "@dspack-studio/replay";
import { dispatchAction } from "./action-dispatch";

export type LiveStatus = "idle" | "checking" | "streaming" | "finished" | "error" | "cancelled" | "offline";

export interface LiveRunState {
  status: LiveStatus;
  events: FixtureEvent[];
  error?: string;
  /** Agent reachability + available model refs (health-checked on mount). */
  agentOnline: boolean | null;
  models: string[];
}

export interface LiveRunControls {
  run(input: { prompt: string; intent: string; modelRef: string; scenario?: string }): void;
  cancel(): void;
  reset(): void;
  /**
   * HITL round-trip: record the user's action (studio.action.pending),
   * POST it to the agent, and append the agent's response events. Duplicate
   * in-flight actions are ignored client-side (and idempotent server-side);
   * network failures append studio.action.failed and can be retried by
   * calling sendAction again with the same payload.
   */
  sendAction(action: { scenario: string; name: string; capability?: string; surfaceId?: string; sourceComponentId?: string; context?: Record<string, unknown>; resolution?: unknown }): void;
  /** The accumulated run as a downloadable fixture document. */
  toFixture(meta: { id: string; name: string; intent: string; prompt: string; modelRef: string }): unknown;
}

export function useLiveRun(agentUrl: string): LiveRunState & LiveRunControls {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [events, setEvents] = useState<FixtureEvent[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);
  const [models, setModels] = useState<string[]>(["scripted"]);
  const subscription = useRef<{ unsubscribe(): void } | null>(null);
  const t0 = useRef(0);

  // Health + model discovery (connection status, model status).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const health = await fetch(agentUrl, { signal: AbortSignal.timeout(2000) });
        if (!alive) return;
        setAgentOnline(health.ok);
        const m = await fetch(`${agentUrl}/models`, { signal: AbortSignal.timeout(3000) });
        const body = (await m.json()) as { models?: string[] };
        if (alive && Array.isArray(body.models) && body.models.length) setModels(body.models);
      } catch {
        if (alive) setAgentOnline(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [agentUrl]);

  const cancel = useCallback(() => {
    subscription.current?.unsubscribe();
    subscription.current = null;
    setStatus((s) => (s === "streaming" ? "cancelled" : s));
  }, []);

  const reset = useCallback(() => {
    subscription.current?.unsubscribe();
    subscription.current = null;
    setEvents([]);
    setError(undefined);
    setStatus("idle");
  }, []);

  const pendingActions = useRef(new Set<string>());

  const appendEvent = useCallback((event: Record<string, unknown>) => {
    setEvents((prev) => [...prev, { atMs: Date.now() - t0.current, event: event as any }]);
  }, []);

  const sendAction = useCallback(
    (action: { scenario: string; name: string; surfaceId?: string; sourceComponentId?: string; context?: Record<string, unknown> }) => {
      // Duplicate protection: one in-flight round-trip per (name, source).
      const dedupeKey = `${action.name}:${action.sourceComponentId ?? ""}`;
      if (pendingActions.current.has(dedupeKey)) return;
      pendingActions.current.add(dedupeKey);
      void dispatchAction(agentUrl, action as any, appendEvent).finally(() => pendingActions.current.delete(dedupeKey));
    },
    [agentUrl, appendEvent],
  );

  const run = useCallback(
    (input: { prompt: string; intent: string; modelRef: string; scenario?: string }) => {
      subscription.current?.unsubscribe();
      setEvents([]);
      setError(undefined);
      setStatus("streaming");
      t0.current = Date.now();

      const agent = new HttpAgent({ url: agentUrl });
      const runId = `live-${Date.now()}`;
      const observable = agent.run({
        threadId: "studio",
        runId,
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: input,
      } as any);

      subscription.current = observable.subscribe({
        next: (event: BaseEvent) => {
          setEvents((prev) => [...prev, { atMs: Date.now() - t0.current, event: event as any }]);
        },
        error: (err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("error");
        },
        complete: () => setStatus("finished"),
      });
    },
    [agentUrl],
  );

  const toFixture = useCallback(
    (meta: { id: string; name: string; intent: string; prompt: string; modelRef: string }) => ({
      replayFixture: "0.1",
      id: meta.id,
      name: meta.name,
      recordedAt: new Date().toISOString(),
      mode: meta.modelRef === "scripted" ? "scripted" : "live",
      adapterId: meta.modelRef,
      intent: meta.intent,
      prompt: meta.prompt,
      events,
    }),
    [events],
  );

  return { status, events, error, agentOnline, models, run, cancel, reset, sendAction, toFixture };
}
