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
import { canvasScopeProps, useDesignSystem } from "./design-system";
import {
  a2uiMessagesAt,
  findingsAt,
  gateFailed,
  gateStateAt,
  nodeHistoryAt,
  timelineTicks,
  toContractId,
  unforkableReason,
  type FixtureEvent,
  type TimelineTick,
} from "@dspack-studio/replay";
import type { ReceiptMeta } from "@dspack-studio/replay";
import catalogJson from "@dspack-studio/contracts/out/catalog.v0_9_1.json";
import { Inspector } from "./inspector";
import { ReceiptView } from "./receipt-view";
import { PipelineView } from "./pipeline-view";
import { TheWire } from "./the-wire";
import { btnClass, linkClass } from "./ui";

// Non-text timeline ticks on the dark chrome; hierarchy is inverted from the
// light theme (the audit, the run's most consequential moment, is brightest).
const TICK_COLOR: Record<TimelineTick["kind"], string> = {
  lifecycle: "#6a665b",
  step: "#4e4a40",
  "gates-pass": "#7e9652",
  "gates-fail": "#e5484d",
  repair: "#d9a05b",
  emit: "#5ba3c7",
  a2ui: "#8b7ec8",
  audit: "#e7dfd2",
  other: "#2b2b24",
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
  /** FM-12: session provenance stamped onto the audit receipt. */
  meta?: ReceiptMeta;
  /** Deep link: applied once per resetKey (playhead, x-ray, opened panel). */
  initial?: { playhead?: number; xray?: boolean; panel?: "receipt" | "wire" | "pipeline" };
  /** Builds a shareable URL for the current moment (replay pane only). */
  permalink?: (playhead: number, xray: boolean) => string;
  /** Alive by default: auto-play the recording on first render (falls back
   * to jumping to the end under prefers-reduced-motion). */
  autoStart?: boolean;
}

export function RunView({ events, label, streaming = false, live = false, resetKey, onAction, onFork, meta, initial, permalink, autoStart = false }: RunViewProps) {
  const designSystem = useDesignSystem();
  const source = useMemo(() => ({ events }), [events]);
  const ticks = useMemo(() => timelineTicks(source), [source]);
  const last = events.length - 1;

  const [playhead, setPlayhead] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const [xray, setXray] = useState(false);
  const [xrayNode, setXrayNode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // New run (fixture switch or a fresh live run): reset. Follow is on for
  // live-originated runs; replayed fixtures start at the beginning.
  useEffect(() => {
    const start = initial?.playhead !== undefined && initial.playhead <= last ? initial.playhead : -1;
    setPlayhead(start);
    setPlaying(false);
    setFollow(live && start === -1);
    if (initial?.xray) setXray(true);
    if (autoStart && start === -1 && last >= 0) {
      // Watching software build itself is the first impression; visitors who
      // prefer reduced motion get the finished surface instead of playback.
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setPlayhead(last);
      else setPlaying(true);
    }
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

  // FM-4 X-ray: pixels-to-protocol provenance as a canvas interaction.
  const history = useMemo(() => (xray ? nodeHistoryAt(source, playhead) : new Map()), [xray, source, playhead]);
  const findings = useMemo(() => (xray ? findingsAt(source, playhead) : []), [xray, source, playhead]);
  // Reverse direction: when the playhead sits ON a delivery, its components
  // light up on the canvas (explicit: read off that event's operations).
  const deliveredNow = useMemo(() => {
    if (!xray || !current || (current.event as any).type !== "TOOL_CALL_RESULT") return [];
    try {
      const ops = JSON.parse(String((current.event as any).content ?? "")).a2ui_operations ?? [];
      return ops.flatMap((op: any) => (op?.updateComponents?.components ?? []).map((c: any) => c.id)).filter(Boolean);
    } catch {
      return [];
    }
  }, [xray, current]);
  const selected = xrayNode ? history.get(xrayNode) : undefined;
  const selectedRules = selected
    ? findings.filter((f) => f.location?.component && f.location.component === toContractId(selected.component))
    : [];

  const failed = gates.audit && gates.audit.outcome !== "passed";
  const refusal = failed ? ((gates.audit?.report as any)?.emitted?.refusal as string | undefined) : undefined;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, fontSize: 13, flexWrap: "wrap" }}>
        {!streaming && (
          <button
            data-testid="play"
            onClick={() => {
              if (playhead >= last) setPlayhead(-1);
              setPlaying(!playing);
            }}
            className={btnClass()}
          >
            {playing ? "pause" : playhead >= last && last >= 0 ? "replay" : "play"}
          </button>
        )}
        {streaming && !follow && (
          <button data-testid="follow" onClick={() => setFollow(true)} className={btnClass()}>
            follow live
          </button>
        )}
        <span style={{ color: "var(--fg-dim)" }} data-testid="fixture-meta">
          {label}
        </span>
        <button
          data-testid="xray-toggle"
          aria-pressed={xray}
          onClick={() => {
            setXray(!xray);
            setXrayNode(null);
          }}
          className={btnClass(xray)}
        >
          x-ray
        </button>
        {permalink && !streaming && (
          <button
            data-testid="copy-link"
            onClick={() => {
              const url = permalink(playhead, xray);
              void navigator.clipboard?.writeText(url).catch(() => {});
              window.history.replaceState(null, "", url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className={btnClass()}
          >
            {copied ? "link copied" : "copy link to this moment"}
          </button>
        )}
        {onFork && !streaming && (() => {
          const reason = unforkableReason(source, playhead);
          return (
            <button
              data-testid="fork"
              disabled={Boolean(reason)}
              title={reason ?? `fork a new run from event ${playhead}: the original stays untouched`}
              onClick={() => onFork(playhead)}
              className={btnClass()}
              style={{ marginLeft: "auto" }}
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
          style={{ width: "100%", colorScheme: "dark" }}
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
        {gates.runStart && <code style={{ color: "var(--fg-dim)" }}>{gates.runStart.adapterId}</code>}
        {gates.attempts.map((a) => (
          <span key={a.index} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            attempt {a.index}:
            {a.gates.map((g) => (
              <strong key={String(g.gate)} style={{ color: gateFailed(g) ? "var(--err)" : "var(--ok)" }}>
                {String(g.gate)}
                {gateFailed(g) ? "✗" : "✓"}
              </strong>
            ))}
            {a.repairMessage && <span style={{ color: "var(--warn)" }}>→ repair</span>}
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
            border: "1px solid var(--err-line)",
            background: "var(--err-soft)",
            borderRadius: 6,
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
              <>Outcome {gates.audit?.outcome} (exit {gates.audit?.exitCode}). See the audit event for gate errors.</>
            )}
          </p>
          <p style={{ margin: "6px 0 0", color: "var(--fg-dim)" }}>
            Failures are first-class artifacts: this run ends with a complete audit report instead of a rendered
            surface. Nothing is silently dropped.
          </p>
        </section>
      )}

      {/* X-ray outlines: hoverable nodes, the selected node, and (reverse
          direction) the components the CURRENT delivery event carried. */}
      {xray && (
        <style>{`
          [data-xray] [data-a2ui-id] { cursor: crosshair; }
          [data-xray] [data-a2ui-id]:hover { outline: 2px dashed #0f172a; outline-offset: 2px; }
          ${xrayNode ? `[data-xray] [data-a2ui-id="${xrayNode}"] { outline: 2px solid #0f172a; outline-offset: 2px; }` : ""}
          ${deliveredNow.map((id: string) => `[data-xray] [data-a2ui-id="${id}"] { outline: 2px solid #8b5cf6; outline-offset: 2px; }`).join("\n")}
        `}</style>
      )}
      <section
        data-canvas
        data-xray={xray || undefined}
        {...canvasScopeProps(designSystem.id)}
        onClickCapture={
          xray
            ? (e) => {
                const el = (e.target as HTMLElement).closest("[data-a2ui-id]");
                if (el) {
                  e.preventDefault();
                  e.stopPropagation();
                  setXrayNode(el.getAttribute("data-a2ui-id"));
                }
              }
            : undefined
        }
        // The artboard: a light surface framed by the dark chrome. colorScheme
        // pins Astryx's light-dark() tokens to the resolution the studio has
        // always shipped, independent of the visitor's OS scheme.
        style={{ border: "1px dashed var(--line)", borderRadius: 6, padding: 24, minHeight: 220, background: "#fff", colorScheme: "light", color: "#0f172a" }}
      >
        {messages.length > 0 ? (
          // Keyed on the delivery count: each new A2UI delivery remounts the
          // canvas with a fresh processor, so bound values are re-resolved
          // (the published renderer memoizes resolved props per surface).
          <A2uiCanvas
            key={`${resetKey}:${designSystem.id}:${messages.length}`}
            catalog={catalogJson as any}
            registry={designSystem.registry}
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
          <p style={{ color: "#475569", fontSize: 14 }} data-testid="canvas-empty" aria-live="polite">
            {streaming
              ? "Generating: the surface streams in the moment it passes the gates…"
              : playhead < 0
                ? "Press play, or drag the timeline: the interface builds (and un-builds) from the recorded event stream."
                : failed
                  ? "No surface shipped: the refusal above is this run's ending."
                  : gates.attempts.some((a) => a.gates.some(gateFailed))
                    ? "The design system said no: a gate failed here, and the repair is on its way."
                    : "Generating…"}
          </p>
        )}
      </section>

      {/* FM-4 provenance card: pixels to protocol for the selected node. */}
      {xray && (
        <section
          data-testid="xray-card"
          aria-live="polite"
          style={{ border: "1px solid var(--line)", background: "var(--bg-1)", borderRadius: 6, padding: "12px 16px", marginTop: 12, fontSize: 12, display: "grid", gap: 6 }}
        >
          {!selected && (
            <p style={{ margin: 0 }}>
              X-ray is on: click any rendered element to trace it to the event, catalog entry, and rules that shaped
              it. A delivery event at the playhead lights its components in violet.
            </p>
          )}
          {selected && (
            <>
              <div>
                <strong>
                  <code>{selected.nodeId}</code>
                </strong>{" "}
                is an A2UI <code>{selected.component}</code> node, admitted by the Astryx catalog (contract component{" "}
                <code>{toContractId(selected.component)}</code>) and rendered by the registered Astryx renderer.
              </div>
              <div data-testid="xray-created">
                created by{" "}
                <button
                  onClick={() => {
                    setPlaying(false);
                    setFollow(false);
                    setPlayhead(selected.createdAt);
                  }}
                  className={linkClass}
                >
                  event {selected.createdAt}
                </button>
                {selected.updatedAt.length > 0 && (
                  <>
                    {" "}
                    · updated by{" "}
                    {selected.updatedAt.map((i: number, n: number) => (
                      <button
                        key={i}
                        onClick={() => {
                          setPlaying(false);
                          setFollow(false);
                          setPlayhead(i);
                        }}
                        className={linkClass}
                        style={{ marginRight: 4 }}
                      >
                        event {i}
                        {n < selected.updatedAt.length - 1 ? "," : ""}
                      </button>
                    ))}
                  </>
                )}{" "}
                <span style={{ color: "var(--fg-dim)" }}>(explicit: read off the A2UI operations)</span>
              </div>
              <div data-testid="xray-rules">
                {selectedRules.length > 0 ? (
                  <>
                    rules concerning <code>{toContractId(selected.component)}</code> in this run:{" "}
                    {selectedRules.map((f, i) => (
                      <span key={i}>
                        <code>{f.ruleId}</code> ("{f.message}"){i < selectedRules.length - 1 ? "; " : ""}
                      </span>
                    ))}{" "}
                    <span style={{ color: "var(--fg-dim)" }}>
                      (inferred by component type: findings cite surface locations, not rendered node ids)
                    </span>
                  </>
                ) : (
                  <span style={{ color: "var(--fg-dim)" }}>no recorded findings reference this component type in this run</span>
                )}
              </div>
            </>
          )}
        </section>
      )}

      <Inspector
        source={source}
        playhead={playhead}
        onTrace={(id) => {
          // Same selection state as clicking the canvas; the provenance card
          // below is aria-live, so the trace is announced.
          setXray(true);
          setXrayNode(id);
        }}
      />

      {/* FM-12: the run's evidence, downloadable and verifiable. */}
      {gates.audit && <ReceiptView source={source} meta={meta} defaultOpen={initial?.panel === "receipt"} />}

      {/* Pipeline view: which layers the playhead event actually touches. */}
      <PipelineView current={current} playhead={playhead} defaultOpen={initial?.panel === "pipeline"} />

      {/* FM-9: the actual protocol session, raw and re-encodable. */}
      <TheWire events={events} playhead={playhead} live={streaming} defaultOpen={initial?.panel === "wire"} />

      {/* You-are-here: the raw wire event at the playhead. */}
      {current && (
        <details style={{ marginTop: 12, fontSize: 12 }} open={false}>
          <summary style={{ cursor: "pointer" }}>
            event {playhead}/{last} · <code>{String(current.event.type)}</code>
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
            style={{ overflow: "auto", maxHeight: 260, background: "var(--bg-2)", padding: 12, borderRadius: 3 }}
          >
            {JSON.stringify(current.event, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
