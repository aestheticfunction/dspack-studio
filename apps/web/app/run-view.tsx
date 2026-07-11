"use client";

/**
 * RunView: the one experience for every event source. A run — recorded
 * fixture, live AG-UI stream, or a future saved session — is an ordered list
 * of { atMs, event }; everything here (timeline, scrubbing, playback, gate
 * ticker, failure panel, canvas, raw-event card) folds off that list through
 * the same reducers. Replay and live are the same pixels because they are
 * the same data shape.
 *
 * streaming=true (a live run in flight): the playhead follows the newest
 * event (progressive rendering); scrubbing detaches the follow, the follow
 * button re-attaches it. streaming=false: play schedules the remaining
 * events at their recorded pacing.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { A2uiCanvas } from "@dspack-studio/a2ui-ingest";
import { astryxRegistry } from "@dspack-studio/astryx-renderers";
import {
  a2uiMessagesAt,
  gateFailed,
  gateStateAt,
  timelineTicks,
  unforkableReason,
  type FixtureEvent,
  type TimelineTick,
} from "@dspack-studio/replay";
import catalogJson from "@dspack-studio/contracts/out/catalog.v0_9_1.json";
import { Inspector } from "./inspector";
import { WireView } from "./wire-view";

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

export interface RunViewProps {
  events: FixtureEvent[];
  /** e.g. "The interface argues back — live run, ollama:gemma4:e4b, 20 events" */
  label: string;
  /** True while a live run is still streaming. */
  streaming?: boolean;
  /** True for live-originated runs: the playhead follows the newest event
   * until the user scrubs, regardless of how fast the stream completed. */
  live?: boolean;
  /** Changes exactly when the underlying RUN changes (fixture key / run id) —
   * resets the playhead. Must NOT change when only the label/status does. */
  resetKey: string;
  /** Interactive runs: rendered A2UI actions dispatch here (HITL). */
  onAction?: (action: any) => void;
  /** FM-3: fork the run at the current playhead (host creates the new run). */
  onFork?: (playhead: number) => void;
}

export function RunView({ events, label, streaming = false, live = false, resetKey, onAction, onFork }: RunViewProps) {
  const source = useMemo(() => ({ events }), [events]);
  const ticks = useMemo(() => timelineTicks(source), [source]);
  const last = events.length - 1;

  const [playhead, setPlayhead] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // New run (fixture switch or a fresh live run): reset. Follow is on for
  // live-originated runs; replayed fixtures start at the beginning.
  useEffect(() => {
    setPlayhead(-1);
    setPlaying(false);
    setFollow(live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Becoming live mid-session (FM-3: a fork's continuation starts) re-arms
  // the follow — the user just asked to act on NOW.
  useEffect(() => {
    if (live) setFollow(true);
  }, [live]);

  // Live follow: pin the playhead to the newest event (including action
  // round-trips after the initial stream) until the user scrubs away.
  useEffect(() => {
    if (live && follow && last >= 0) setPlayhead(last);
  }, [live, follow, last]);

  // Recorded playback: schedule the remaining events at recorded pacing.
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (!playing || streaming) return;
    let clock = 0;
    for (let i = playhead + 1; i <= last; i++) {
      const gap = Math.min(events[i].atMs - (i > 0 ? events[i - 1].atMs : 0), 2500);
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

  const messages = useMemo(() => a2uiMessagesAt(source, playhead), [source, playhead]);
  const gates = useMemo(() => gateStateAt(source, playhead), [source, playhead]);
  const current = playhead >= 0 && playhead <= last ? events[playhead] : null;

  const failed = gates.audit && gates.audit.outcome !== "passed";
  const refusal = failed ? ((gates.audit?.report as any)?.emitted?.refusal as string | undefined) : undefined;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, fontSize: 13 }}>
        {!streaming && (
          <button
            data-testid="play"
            onClick={() => {
              if (playhead >= last) setPlayhead(-1);
              setPlaying(!playing);
            }}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #cbd5e1", cursor: "pointer", font: "inherit" }}
          >
            {playing ? "pause" : playhead >= last && last >= 0 ? "replay" : "play"}
          </button>
        )}
        {streaming && !follow && (
          <button
            data-testid="follow"
            onClick={() => setFollow(true)}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #cbd5e1", cursor: "pointer", font: "inherit" }}
          >
            follow live
          </button>
        )}
        <span style={{ opacity: 0.7 }} data-testid="fixture-meta">
          {label}
        </span>
        {onFork && !streaming && (() => {
          const reason = unforkableReason(source, playhead);
          return (
            <button
              data-testid="fork"
              disabled={Boolean(reason)}
              title={reason ?? `fork a new run from event ${playhead} — the original stays untouched`}
              onClick={() => onFork(playhead)}
              style={{
                marginLeft: "auto",
                padding: "6px 14px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                cursor: reason ? "not-allowed" : "pointer",
                opacity: reason ? 0.5 : 1,
                font: "inherit",
              }}
            >
              fork this moment
            </button>
          );
        })()}
      </div>

      {/* The timeline: one tick per AG-UI event; drag to any moment. */}
      <div style={{ marginBottom: 4 }}>
        <input
          data-testid="scrubber"
          type="range"
          min={-1}
          max={Math.max(last, 0)}
          value={playhead}
          onChange={(e) => {
            setPlaying(false);
            setFollow(false);
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
              aria-label={`jump to event ${t.index}: ${t.label}`}
              onClick={() => {
                setPlaying(false);
                setFollow(false);
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
              <strong key={String(g.gate)} style={{ color: gateFailed(g) ? "#b91c1c" : "#15803d" }}>
                {String(g.gate)}
                {gateFailed(g) ? "✗" : "✓"}
              </strong>
            ))}
            {a.repairMessage && <span style={{ color: "#92400e" }}>→ repair</span>}
          </span>
        ))}
        {gates.audit && (
          <span data-testid="audit-outcome" aria-live="polite">
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
          // Keyed on the delivery count: each new A2UI delivery remounts the
          // canvas with a fresh processor, so bound values are re-resolved
          // (the published renderer memoizes resolved props per surface).
          <A2uiCanvas
            key={`${resetKey}:${messages.length}`}
            catalog={catalogJson as any}
            registry={astryxRegistry}
            messages={messages}
            onAction={
              onAction
                ? (a) => {
                    // Acting on the surface re-attaches the live follow: the
                    // user is interacting with NOW, so show them the response.
                    setFollow(true);
                    onAction(a);
                  }
                : undefined
            }
          />
        ) : (
          <p style={{ opacity: 0.6, fontSize: 14 }} data-testid="canvas-empty" aria-live="polite">
            {streaming
              ? "Generating — the surface streams in the moment it passes the gates…"
              : playhead < 0
                ? "Press play, or drag the timeline: the interface builds (and un-builds) from the recorded event stream."
                : failed
                  ? "No surface shipped — the refusal above is this run's ending."
                  : gates.attempts.some((a) => a.gates.some(gateFailed))
                    ? "The design system said no — a gate failed here; the repair is on its way."
                    : "Generating…"}
          </p>
        )}
      </section>

      <Inspector source={source} playhead={playhead} />

      {/* FM-9: which pipeline layers the playhead event actually touches. */}
      <WireView current={current} playhead={playhead} />

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
          <pre
            tabIndex={0}
            aria-label="raw event JSON"
            style={{ overflow: "auto", maxHeight: 260, background: "rgba(148,163,184,0.12)", padding: 12, borderRadius: 8 }}
          >
            {JSON.stringify(current.event, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
