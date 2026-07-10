"use client";

/**
 * Run it live: the governed pipeline streaming from apps/agent over AG-UI,
 * into the exact same RunView the replay uses. While streaming, the timeline
 * populates and the surface renders progressively; the moment the run
 * finishes it is scrubbable like any fixture — a live run is a fixture being
 * written in front of you (and downloadable as one).
 *
 * No credentials in the browser: "scripted" is deterministic; ollama:* runs
 * on the visitor's own machine via the local agent.
 */
import { useState } from "react";
import { bookingCapabilities, resolveAction, type Scenario } from "@dspack-studio/scenarios";
import { surfaceComponentsAt } from "@dspack-studio/replay";
import { useLiveRun, type LiveStatus } from "./use-live-run";
import { RunView } from "./run-view";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8787";

const STATUS_LABEL: Record<LiveStatus, string> = {
  idle: "ready",
  checking: "checking agent…",
  streaming: "streaming",
  finished: "finished — scrub the timeline",
  error: "error",
  cancelled: "cancelled",
  offline: "agent offline",
};

const btn = (primary = false): React.CSSProperties => ({
  padding: "6px 14px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: primary ? "#0f172a" : "transparent",
  color: primary ? "#fff" : "inherit",
  cursor: "pointer",
  font: "inherit",
  fontSize: 13,
});

export function LiveView({ scenario }: { scenario: Scenario }) {
  const live = useLiveRun(AGENT_URL);
  const [prompt, setPrompt] = useState(scenario.seedPrompts[0] ?? "");
  const [modelRef, setModelRef] = useState("scripted");
  const [lastRun, setLastRun] = useState<{ prompt: string; modelRef: string } | null>(null);
  const [runSeq, setRunSeq] = useState(0);

  const interactive = scenario.interactive === true;

  const startGenerated = (p: string, m: string) => {
    setRunSeq((n) => n + 1);
    setLastRun({ prompt: p, modelRef: m });
    live.run({ prompt: p, intent: scenario.intent, modelRef: m });
  };

  const start = (p: string, m: string) => {
    setRunSeq((n) => n + 1);
    setLastRun({ prompt: p, modelRef: m });
    live.run({
      prompt: p,
      intent: scenario.intent,
      modelRef: interactive ? "deterministic:authored" : m,
      scenario: interactive ? scenario.id : undefined,
    });
  };

  const download = () => {
    const fixture = live.toFixture({
      id: `session-${Date.now()}`,
      name: `${scenario.name} (saved session)`,
      intent: scenario.intent,
      prompt: lastRun?.prompt ?? prompt,
      modelRef: lastRun?.modelRef ?? modelRef,
    });
    const blob = new Blob([JSON.stringify(fixture, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "session.fixture.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (live.agentOnline === false) {
    return (
      <section
        data-testid="agent-offline"
        style={{ border: "1px dashed #cbd5e1", borderRadius: 12, padding: 24, fontSize: 14, lineHeight: 1.6 }}
      >
        <strong>The local agent is not running.</strong>
        <p style={{ margin: "8px 0 0" }}>
          Live mode streams the governed pipeline from a small local server — your prompts and models never leave your
          machine. Start it and reload:
        </p>
        <pre style={{ background: "rgba(148,163,184,0.12)", padding: 12, borderRadius: 8, marginTop: 8 }}>
          pnpm --filter agent dev
        </pre>
        <p style={{ margin: "8px 0 0", opacity: 0.7 }}>
          Replay mode works without it — every curated example is a recorded real run.
        </p>
      </section>
    );
  }

  const streaming = live.status === "streaming";

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {scenario.seedPrompts.map((p, i) => (
          <button
            key={i}
            style={{ ...btn(p === prompt), fontSize: 12, maxWidth: 340, textAlign: "left" }}
            onClick={() => setPrompt(p)}
            title={p}
          >
            {p.length > 64 ? `${p.slice(0, 64)}…` : p}
          </button>
        ))}
      </div>

      {(
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          data-testid="live-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the interface you want…"
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            font: "inherit",
            fontSize: 13,
            background: "transparent",
            color: "inherit",
          }}
        />
        <select
          data-testid="live-model"
          value={modelRef}
          onChange={(e) => setModelRef(e.target.value)}
          style={{ borderRadius: 8, border: "1px solid #cbd5e1", font: "inherit", fontSize: 13, padding: "0 8px" }}
        >
          {live.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, fontSize: 13 }}>
        {!streaming && (
          <button
            data-testid="live-run"
            style={btn(true)}
            onClick={() => start(prompt, modelRef)}
            disabled={!interactive && !prompt.trim()}
          >
            {interactive
              ? live.events.length > 0
                ? "restart scenario"
                : "start scenario"
              : live.status === "finished" || live.status === "error" || live.status === "cancelled"
                ? "run again"
                : "run it live"}
          </button>
        )}
        {!streaming && interactive && (
          <button
            data-testid="live-generate"
            style={btn()}
            title="Generate this scenario's surface with a model under the contract's scheduling intent (the deterministic start remains the reliable fallback)."
            onClick={() => startGenerated(prompt, modelRef)}
            disabled={!prompt.trim()}
          >
            generate live
          </button>
        )}
        {streaming && (
          <button data-testid="live-cancel" style={btn()} onClick={live.cancel}>
            cancel
          </button>
        )}
        {(live.status === "error" || live.status === "cancelled") && lastRun && (
          <button data-testid="live-retry" style={btn()} onClick={() => start(lastRun.prompt, lastRun.modelRef)}>
            retry
          </button>
        )}
        {live.events.length > 0 && !streaming && (
          <>
            <button data-testid="live-reset" style={btn()} onClick={live.reset}>
              reset
            </button>
            <button data-testid="live-download" style={btn()} onClick={download}>
              download fixture
            </button>
          </>
        )}
        <span data-testid="live-status" style={{ opacity: 0.7 }}>
          {STATUS_LABEL[live.status]}
          {live.error ? ` — ${live.error}` : ""}
        </span>
      </div>

      {live.events.length > 0 && (
        <RunView
          events={live.events}
          streaming={streaming}
          live
          resetKey={`run-${runSeq}`}
          label={`live run — ${lastRun?.modelRef ?? modelRef}, ${live.events.length} events`}
          onAction={
            interactive
              ? (a: any) => {
                  const components = surfaceComponentsAt({ events: live.events }, live.events.length - 1);
                  const resolution = resolveAction(
                    { name: a?.name ?? "unknown", sourceComponentId: a?.sourceComponentId, context: a?.context },
                    components as any,
                    bookingCapabilities,
                  );
                  live.sendAction({
                    scenario: scenario.id,
                    name: a?.name ?? "unknown",
                    capability: resolution.ok ? resolution.capability : undefined,
                    surfaceId: a?.surfaceId,
                    sourceComponentId: a?.sourceComponentId,
                    context: resolution.ok ? resolution.context : a?.context,
                    resolution,
                  } as any);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
