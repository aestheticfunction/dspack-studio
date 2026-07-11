"use client";

/**
 * Progressive-disclosure inspector: closed by default, opened deliberately,
 * and synchronized with the timeline by construction — every panel is a pure
 * fold over events[0..playhead], so scrubbing backward shows exactly the
 * state that existed then, never future events. Identical across live,
 * replayed, and imported sessions (same event source, same reducers).
 */
import { useMemo, useState } from "react";
import {
  actionLifecyclesAt,
  dataModelAt,
  eventCategory,
  eventsUpTo,
  gateFailed,
  gateStateAt,
  statePatchesAt,
  surfaceComponentsAt,
  a2uiMessagesAt,
  type EventCategory,
  type EventSource,
} from "@dspack-studio/replay";

import { btnClass, linkClass, mono } from "./ui";

/** Text-safe category palette (>=4.5:1 on the dark panel wells). */
const CATEGORY_COLOR: Record<EventCategory, string> = {
  run: "#8f8a7c",
  step: "#8f8a7c",
  pipeline: "#7dd3fc",
  a2ui: "#a78bfa",
  "user-action": "#97b063",
  "agent-response": "#d9a05b",
  enhancement: "#f0abfc",
  other: "#8f8a7c",
};

const TABS = ["state", "actions", "events", "a2ui", "gates", "components"] as const;
type Tab = (typeof TABS)[number];

const pre: React.CSSProperties = { ...mono, overflow: "auto", maxHeight: 260, background: "var(--bg-2)", border: "1px solid var(--line-soft)", padding: 10, borderRadius: 3, margin: 0 };

export function Inspector({ source, playhead }: { source: EventSource; playhead: number }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("state");

  const model = useMemo(() => dataModelAt(source, playhead), [source, playhead]);
  const patches = useMemo(() => statePatchesAt(source, playhead), [source, playhead]);
  const lifecycles = useMemo(() => actionLifecyclesAt(source, playhead), [source, playhead]);
  const events = useMemo(() => eventsUpTo(source, playhead), [source, playhead]);
  const gates = useMemo(() => gateStateAt(source, playhead), [source, playhead]);
  const ops = useMemo(() => a2uiMessagesAt(source, playhead), [source, playhead]);
  const components = useMemo(() => surfaceComponentsAt(source, playhead), [source, playhead]);

  if (!open) {
    return (
      <button
        data-testid="inspector-open"
        onClick={() => setOpen(true)}
        className={btnClass(false, true)}
        style={{ marginTop: 14 }}
      >
        inspect this run — state, actions, events, gates
      </button>
    );
  }

  return (
    <section data-testid="inspector" style={{ marginTop: 14, border: "1px solid var(--line)", borderRadius: 6, padding: 14, fontSize: 13 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <div role="tablist" aria-label="run inspector panels" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={t === tab}
              data-testid={`inspector-tab-${t}`}
              onClick={() => setTab(t)}
              className={btnClass(t === tab)}
            >
              {t}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", color: "var(--fg-dim)", ...mono }} data-testid="inspector-position">
          at event {Math.max(playhead, -1)} / {source.events.length - 1}
        </span>
        <button onClick={() => setOpen(false)} className={linkClass}>
          close
        </button>
      </div>

      {tab === "state" && (
        <div data-testid="inspector-state">
          <p style={{ margin: "0 0 6px", color: "var(--fg-dim)" }}>Shared data model at this playhead ({patches.length} patches applied):</p>
          <pre style={pre} tabIndex={0} aria-label="shared data model JSON" data-testid="inspector-state-json">{JSON.stringify(model, null, 2)}</pre>
          <p style={{ margin: "10px 0 6px", color: "var(--fg-dim)" }}>Ordered patch log:</p>
          <div style={{ ...pre, maxHeight: 180 }} tabIndex={0} role="group" aria-label="state patches" data-testid="inspector-patches">
            {patches.length === 0 && <em>no patches yet</em>}
            {patches.map((p, i) => (
              <div key={i}>
                #{p.index} @{p.atMs}ms <strong>{p.path}</strong> ← {JSON.stringify(p.value)}{p.via ? ` (via ${p.via})` : ""}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "actions" && (
        <div data-testid="inspector-actions">
          {lifecycles.length === 0 && <em style={{ color: "var(--fg-dim)" }}>no user actions yet</em>}
          {lifecycles.map((lc) => (
            <div key={lc.actionId} style={{ marginBottom: 10 }}>
              <div style={mono}>
                <strong>{lc.name}</strong>
                {lc.capability && lc.capability !== lc.name ? <> → <strong>{lc.capability}</strong></> : null}{" "}
                <span style={{ color: "var(--fg-dim)" }}>({lc.actionId.slice(0, 8)}…)</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {lc.states.map((s, i) => (
                  <span key={i} style={{ ...mono, padding: "2px 8px", borderRadius: 3, background: "var(--bg-2)", border: "1px solid var(--line-soft)" }} title={s.detail ?? s.method ?? ""}>
                    {s.state}
                    {s.method ? ` · ${s.method}` : ""}
                    {s.detail ? ` — ${s.detail}` : ""}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "events" && (
        <div style={{ ...pre, maxHeight: 300 }} tabIndex={0} role="group" aria-label="raw events" data-testid="inspector-events">
          {events.map(({ atMs, event }, i) => {
            const cat = eventCategory(event as any);
            return (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ color: CATEGORY_COLOR[cat], minWidth: 104 }}>{cat}</span>
                <span style={{ color: "var(--fg-dim)", minWidth: 64 }}>@{atMs}ms</span>
                <span>
                  {String(event.type)}
                  {"name" in event ? ` ${String((event as any).name)}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {tab === "a2ui" && (
        <pre style={{ ...pre, maxHeight: 300 }} tabIndex={0} aria-label="A2UI operations JSON" data-testid="inspector-a2ui">
          {JSON.stringify(ops, null, 2)}
        </pre>
      )}

      {tab === "gates" && (
        <div data-testid="inspector-gates">
          {gates.attempts.length === 0 && <em style={{ color: "var(--fg-dim)" }}>no gate results yet</em>}
          {gates.attempts.map((a) => (
            <div key={a.index} style={{ marginBottom: 8 }}>
              <strong>attempt {a.index}</strong>{" "}
              {a.gates.map((g) => (
                <span key={String(g.gate)} style={{ color: gateFailed(g) ? "var(--err)" : "var(--ok)", marginRight: 6 }}>
                  {String(g.gate)} {gateFailed(g) ? "FAIL" : "PASS"}
                </span>
              ))}
              {a.findings.length > 0 && (
                <div style={{ ...mono, color: "var(--fg-dim)" }}>
                  {a.findings.map((f: any, i: number) => (
                    <div key={i}>· {f.ruleId ?? f.rule}: {f.message}</div>
                  ))}
                </div>
              )}
              {a.repairMessage && <details style={mono}><summary>repair message</summary><pre style={pre} tabIndex={0} aria-label="repair message">{a.repairMessage}</pre></details>}
            </div>
          ))}
          {gates.audit && (
            <div style={mono}>
              audit: <strong>{gates.audit.outcome}</strong> (exit {gates.audit.exitCode})
              {(gates.audit.report as any)?.emitted?.refusal && <div>refusal: {(gates.audit.report as any).emitted.refusal}</div>}
            </div>
          )}
        </div>
      )}

      {tab === "components" && (
        <div style={{ ...pre, maxHeight: 300 }} tabIndex={0} role="group" aria-label="surface components" data-testid="inspector-components">
          {components.length === 0 && <em>no components yet</em>}
          {components.map((c: any) => (
            <div key={c.id}>
              <strong>{c.component}</strong> #{c.id}
              {typeof c.label === "string" ? ` — "${c.label}"` : ""}
              {c.action?.event?.name ? ` → ${c.action.event.name}` : ""}
              {c.value?.path ? ` ⇄ ${c.value.path}` : ""}
              {c.text?.path ? ` ⇐ ${c.text.path}` : ""}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
