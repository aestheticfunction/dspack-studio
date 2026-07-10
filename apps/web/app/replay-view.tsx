"use client";

/**
 * FM-2 v1: interface time travel over recorded runs. The fixture is a real
 * recorded run (AG-UI events + original timings). Play streams it back; the
 * scrubber folds the event prefix into the exact historical state — the
 * canvas un-builds as you drag left, the repaired dialog reverts, gate ticks
 * un-light. Every frame is a real state, reconstructed not approximated.
 *
 * Failure runs are first-class: when the audit outcome is not "passed", the
 * failure panel shows the emitter's refusal (or gate errors) verbatim from
 * the audit report — failures ship with receipts too.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { A2uiCanvas } from "@dspack-studio/a2ui-ingest";
import { astryxRegistry } from "@dspack-studio/astryx-renderers";
import {
  a2uiMessagesAt,
  gateFailed,
  gateStateAt,
  parseFixture,
  timelineTicks,
  type ReplayFixture,
  type TimelineTick,
} from "@dspack-studio/replay";
import catalogJson from "@dspack-studio/contracts/out/catalog.v0_9_1.json";

const TICK_COLOR: Record<TimelineTick["kind"], string> = {
  lifecycle: "#64748b",
  step: "#94a3b8",
  "gates-pass": "#16a34a",
  "gates-fail": "#dc2626",
  repair: "#f59e0b",
  emit: "#0ea5e9",
  a2ui: "#8b5cf6",
  audit: "#0f172a",
  other: "#cbd5e1",
};

export function ReplayView({ fixtureJson }: { fixtureJson: unknown }) {
  const fixture: ReplayFixture = useMemo(() => parseFixture(fixtureJson), [fixtureJson]);
  const ticks = useMemo(() => timelineTicks(fixture), [fixture]);
  const last = fixture.events.length - 1;

  const [playhead, setPlayhead] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Reset when the fixture changes.
  useEffect(() => {
    setPlayhead(-1);
    setPlaying(false);
  }, [fixture]);

  // Play = schedule the remaining events at their recorded pacing (gaps capped
  // so long model pauses stay watchable).
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (!playing) return;
    let clock = 0;
    for (let i = playhead + 1; i <= last; i++) {
      const gap = Math.min(fixture.events[i].atMs - (i > 0 ? fixture.events[i - 1].atMs : 0), 2500);
      clock += Math.max(gap, 30);
      const idx = i;
      timers.current.push(
        setTimeout(() => {
          setPlayhead(idx);
          if (idx === last) setPlaying(false);
        }, clock),
      );
    }
    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const messages = useMemo(() => a2uiMessagesAt(fixture, playhead), [fixture, playhead]);
  const gates = useMemo(() => gateStateAt(fixture, playhead), [fixture, playhead]);
  const current = playhead >= 0 ? fixture.events[playhead] : null;

  const failed = gates.audit && gates.audit.outcome !== "passed";
  const refusal = failed ? ((gates.audit?.report as any)?.emitted?.refusal as string | undefined) : undefined;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, fontSize: 13 }}>
        <button
          data-testid="play"
          onClick={() => {
            if (playhead >= last) setPlayhead(-1);
            setPlaying(!playing);
          }}
          style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #cbd5e1", cursor: "pointer", font: "inherit" }}
        >
          {playing ? "pause" : playhead >= last ? "replay" : "play"}
        </button>
        <span style={{ opacity: 0.7 }} data-testid="fixture-meta">
          {fixture.name} — {fixture.mode} run, {fixture.adapterId}, {fixture.events.length} events
        </span>
      </div>

      {/* The timeline: one tick per AG-UI event; drag to any moment. */}
      <div style={{ marginBottom: 4 }}>
        <input
          data-testid="scrubber"
          type="range"
          min={-1}
          max={last}
          value={playhead}
          onChange={(e) => {
            setPlaying(false);
            setPlayhead(Number(e.target.value));
          }}
          style={{ width: "100%" }}
          aria-label="timeline scrubber"
        />
        <div style={{ display: "flex", gap: 2, height: 14 }}>
          {ticks.map((t) => (
            <button
              key={t.index}
              title={`${t.label} @ ${t.atMs}ms`}
              onClick={() => {
                setPlaying(false);
                setPlayhead(t.index);
              }}
              style={{
                flex: 1,
                border: "none",
                cursor: "pointer",
                borderRadius: 2,
                background: TICK_COLOR[t.kind],
                opacity: t.index <= playhead ? 1 : 0.22,
                padding: 0,
              }}
            />
          ))}
        </div>
      </div>

      {/* Gate ticker: S-gates per attempt fold out of the same event prefix. */}
      <div
        data-testid="gate-ticker"
        style={{ display: "flex", gap: 10, fontSize: 12, margin: "8px 0 14px", flexWrap: "wrap", alignItems: "center" }}
      >
        {gates.runStart && <code style={{ opacity: 0.7 }}>{gates.runStart.adapterId}</code>}
        {gates.attempts.map((a) => (
          <span key={a.index} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            attempt {a.index}:
            {a.gates.map((g) => (
              <strong key={String(g.gate)} style={{ color: gateFailed(g) ? "#dc2626" : "#16a34a" }}>
                {String(g.gate)}
                {gateFailed(g) ? "✗" : "✓"}
              </strong>
            ))}
            {a.repairMessage && <span style={{ color: "#f59e0b" }}>→ repair</span>}
          </span>
        ))}
        {gates.audit && (
          <span data-testid="audit-outcome">
            outcome <strong>{gates.audit.outcome}</strong> (exit {gates.audit.exitCode})
          </span>
        )}
      </div>

      {/* Failure panel: the refusal, verbatim from the audit report. */}
      {failed && (
        <section
          data-testid="failure-panel"
          style={{
            border: "1px solid #fca5a5",
            background: "rgba(220,38,38,0.08)",
            borderRadius: 12,
            padding: "14px 18px",
            marginBottom: 14,
            fontSize: 13,
          }}
        >
          <strong>The pipeline refused to ship this surface.</strong>
          <p style={{ margin: "6px 0 0", lineHeight: 1.5 }}>
            {refusal ? (
              <>
                Emitter refusal: <code>{refusal}</code>
              </>
            ) : (
              <>Outcome {gates.audit?.outcome} (exit {gates.audit?.exitCode}) — see the audit event for gate errors.</>
            )}
          </p>
          <p style={{ margin: "6px 0 0", opacity: 0.7 }}>
            Failures are first-class artifacts: this run ends with a complete audit report instead of a rendered
            surface. Nothing is silently dropped.
          </p>
        </section>
      )}

      <section data-canvas style={{ border: "1px dashed #cbd5e1", borderRadius: 12, padding: 24, minHeight: 220 }}>
        {messages.length > 0 ? (
          <A2uiCanvas catalog={catalogJson as any} registry={astryxRegistry} messages={messages} />
        ) : (
          <p style={{ opacity: 0.6, fontSize: 14 }} data-testid="canvas-empty">
            {playhead < 0
              ? "Press play, or drag the timeline: the interface builds (and un-builds) from the recorded event stream."
              : failed
                ? "No surface shipped — the refusal above is this run's ending."
                : gates.attempts.some((a) => a.gates.some(gateFailed))
                  ? "The design system said no — a gate failed here; the repair is on its way."
                  : "Generating…"}
          </p>
        )}
      </section>

      {/* You-are-here: the raw wire event at the playhead. */}
      {current && (
        <details style={{ marginTop: 12, fontSize: 12 }} open={false}>
          <summary style={{ cursor: "pointer" }}>
            event {playhead}/{last} — <code>{String(current.event.type)}</code>
            {"name" in current.event ? (
              <>
                {" "}
                <code>{String((current.event as any).name)}</code>
              </>
            ) : null}{" "}
            @ {current.atMs}ms
          </summary>
          <pre style={{ overflow: "auto", maxHeight: 260, background: "rgba(148,163,184,0.12)", padding: 12, borderRadius: 8 }}>
            {JSON.stringify(current.event, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
