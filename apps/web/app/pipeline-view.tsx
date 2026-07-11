"use client";

/**
 * Pipeline View: which layers of the honest pipeline THIS event actually
 * touches, synchronized to the timeline playhead. A pure function of the
 * current event — no parallel telemetry, nothing the timeline doesn't
 * already know. Deliberately dims the stages an event does NOT involve:
 * most events live on one or two layers, and implying that everything
 * traverses everything would be a lie.
 */
import type { FixtureEvent } from "@dspack-studio/replay";

type StageId = "you" | "agent" | "emit" | "agui" | "a2ui" | "registry" | "astryx";

const STAGES: Array<{ id: StageId; label: string; sub: string }> = [
  { id: "you", label: "you", sub: "the user" },
  { id: "agent", label: "agent", sub: "dspack-gen governs" },
  { id: "emit", label: "projection", sub: "dspack-emit compiles" },
  { id: "agui", label: "AG-UI", sub: "transports" },
  { id: "a2ui", label: "A2UI", sub: "describes" },
  { id: "registry", label: "registry", sub: "a2ui-ingest maps" },
  { id: "astryx", label: "Astryx", sub: "renders" },
];

interface WireReading {
  involved: StageId[];
  /** "forward" = agent toward pixels; "back" = user action toward the agent. */
  direction: "forward" | "back" | "none";
  what: string;
  correlations: Array<[string, string]>;
}

function corr(pairs: Array<[string, unknown]>): Array<[string, string]> {
  return pairs.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]);
}

/** Map one AG-UI event onto the pipeline stages it actually involves. */
export function readWire(event: Record<string, any>): WireReading {
  const t = String(event.type);
  const name = String(event.name ?? "");
  const v = event.value ?? {};

  if (t === "RUN_STARTED" || t === "RUN_FINISHED" || t === "RUN_ERROR")
    return {
      involved: ["agent", "agui"],
      direction: "forward",
      what:
        t === "RUN_ERROR"
          ? "The agent reports the run failed; AG-UI carries the error frame."
          : "AG-UI run lifecycle frame from the agent. No surface content here.",
      correlations: corr([["runId", event.runId], ["threadId", event.threadId], ["message", event.message]]),
    };

  if (t === "STEP_STARTED" || t === "STEP_FINISHED")
    return {
      involved: ["agent", "agui"],
      direction: "forward",
      what: "A generation attempt opens/closes inside the agent; AG-UI frames it as a step.",
      correlations: corr([["step", event.stepName]]),
    };

  if (t === "TOOL_CALL_START" || t === "TOOL_CALL_ARGS" || t === "TOOL_CALL_END")
    return {
      involved: ["agent", "agui"],
      direction: "forward",
      what: "The A2UI delivery is framed as an AG-UI tool call; these frames carry no surface yet.",
      correlations: corr([["toolCallId", event.toolCallId], ["tool", event.toolCallName]]),
    };

  if (t === "TOOL_CALL_RESULT") {
    let surfaceId: string | undefined;
    let ops = 0;
    try {
      const envelope = JSON.parse(String(event.content ?? ""));
      const list = envelope.a2ui_operations ?? [];
      ops = list.length;
      surfaceId = list.find((m: any) => m.createSurface)?.createSurface?.surfaceId
        ?? list.find((m: any) => m.updateComponents)?.updateComponents?.surfaceId
        ?? list.find((m: any) => m.updateDataModel)?.updateDataModel?.surfaceId;
    } catch { /* not an ops envelope */ }
    return {
      involved: ["agent", "emit", "agui", "a2ui", "registry", "astryx"],
      direction: "forward",
      what: `The delivery: dspack-emit's A2UI operations (${ops}) ride the tool-call result over AG-UI; the A2UI model applies them; the registry maps catalog names to Astryx components; pixels change.`,
      correlations: corr([["toolCallId", event.toolCallId], ["surfaceId", surfaceId], ["operations", ops]]),
    };
  }

  if (t === "CUSTOM" && name.startsWith("dspack.")) {
    const emitStage = name === "dspack.emit";
    return {
      involved: emitStage ? ["agent", "emit", "agui"] : ["agent", "agui"],
      direction: "forward",
      what:
        name === "dspack.run.start"
          ? "The agent opens a governed run: intent, prompt, and the rules in force."
          : name === "dspack.gates"
            ? "S1/S2/S3 lint verdicts from inside the agent — governance telemetry on the wire, not a rendering step."
            : name === "dspack.repair"
              ? "The exact repair message the pipeline sends itself. Still inside the agent."
              : name === "dspack.emit"
                ? "dspack-emit's projection report: gates per A2UI version, every synthesis warned."
                : "The complete audit report — the run's receipt.",
      correlations: corr([["intent", v.intent], ["attempt", v.attempt ?? v.index], ["outcome", v.outcome]]),
    };
  }

  if (t === "CUSTOM" && name === "studio.surface.enhanced")
    return {
      involved: ["agent", "agui"],
      direction: "forward",
      what: "The scenario's deterministic enhancement grounded unambiguous components (recorded here so the delivery above is auditable).",
      correlations: corr([["scenario", v.scenario], ["notes", Array.isArray(v.notes) ? v.notes.length : undefined]]),
    };

  if (t === "CUSTOM" && (name === "studio.action.resolved" || name === "studio.action.unresolved"))
    return {
      involved: ["you", "astryx", "a2ui"],
      direction: "back",
      what:
        name === "studio.action.resolved"
          ? "Your click on the rendered surface became an A2UI action; the studio client resolved it against the scenario's declared capabilities."
          : "Your click became an A2UI action the scenario does not support — rejected in the client, clearly, before anything was sent.",
      correlations: corr([["actionId", v.actionId], ["action", v.name], ["capability", v.capability]]),
    };

  if (t === "CUSTOM" && (name === "studio.action.pending" || name === "studio.action.cancelled"))
    return {
      involved: ["you", "astryx", "a2ui", "agui", "agent"],
      direction: "back",
      what:
        name === "studio.action.pending"
          ? "The resolved action travels back over the wire; the agent now holds it."
          : "The pending action was cancelled before the agent answered.",
      correlations: corr([["actionId", v.actionId], ["action", v.name]]),
    };

  if (t === "CUSTOM" && name.startsWith("studio.action."))
    return {
      involved: ["agent", "agui"],
      direction: "forward",
      what:
        name === "studio.action.accepted"
          ? "The agent accepted the action — its state and component updates arrive as a normal delivery."
          : name === "studio.action.rejected"
            ? "The agent rejected the action, with the reason on the wire."
            : "The action failed in transit or in the agent; the failure is a first-class event.",
      correlations: corr([["actionId", v.actionId], ["action", v.name], ["detail", v.detail]]),
    };

  return {
    involved: ["agui"],
    direction: "none",
    what: "An AG-UI event outside the studio's typed vocabulary — on the wire, shown verbatim below.",
    correlations: corr([["type", t], ["name", name || undefined]]),
  };
}

export function PipelineView({ current, playhead, defaultOpen }: { current: FixtureEvent | null; playhead: number; defaultOpen?: boolean }) {
  if (!current) return null;
  const reading = readWire(current.event as Record<string, any>);
  const involved = new Set(reading.involved);

  return (
    <details data-testid="pipeline-view" ref={(el) => { if (el && defaultOpen && !el.dataset.autoOpened) { el.open = true; el.dataset.autoOpened = "1"; } }} style={{ marginTop: 12, fontSize: 12 }}>
      <summary style={{ cursor: "pointer" }}>
        pipeline view — the layers <em>this</em> event touches
      </summary>
      <div
        style={{
          border: "1px solid #cbd5e1",
          borderRadius: 12,
          padding: "12px 14px",
          marginTop: 8,
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "stretch", gap: 4, flexWrap: "wrap" }} role="list" aria-label="pipeline stages">
          {STAGES.map((s, i) => {
            const on = involved.has(s.id);
            return (
              <div key={s.id} role="listitem" style={{ display: "flex", alignItems: "center", gap: 4, flex: "1 1 auto" }}>
                {i > 0 && (
                  <span aria-hidden style={{ opacity: 0.35 }}>
                    {reading.direction === "back" ? "←" : "→"}
                  </span>
                )}
                <div
                  data-stage={s.id}
                  data-involved={on || undefined}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    borderRadius: 8,
                    padding: "6px 8px",
                    border: on ? "1px solid #0f172a" : "1px dashed #cbd5e1",
                    background: on ? "rgba(15,23,42,0.08)" : "transparent",
                    color: on ? "inherit" : "#475569",
                  }}
                >
                  <strong style={{ display: "block" }}>{s.label}</strong>
                  <span style={{ fontSize: 10, color: on ? "#334155" : "#475569" }}>{s.sub}</span>
                </div>
              </div>
            );
          })}
        </div>
        <p style={{ margin: 0, lineHeight: 1.5 }} data-testid="pipeline-what">
          {reading.what}
        </p>
        {reading.correlations.length > 0 && (
          <p style={{ margin: 0, display: "flex", gap: 8, flexWrap: "wrap" }} data-testid="pipeline-correlations">
            {reading.correlations.map(([k, val]) => (
              <code key={k} style={{ background: "rgba(148,163,184,0.15)", borderRadius: 6, padding: "2px 6px" }}>
                {k}: {val}
              </code>
            ))}
          </p>
        )}
        <p style={{ margin: 0, opacity: 0.6 }}>
          Dimmed layers are not part of event {playhead} — most events live on one or two layers; only a delivery
          crosses them all.
        </p>
      </div>
    </details>
  );
}
