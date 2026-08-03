"use client";

import { useState } from "react";
import { useComposer } from "../state";
import type { View } from "../composer";

const STATE_COLOR: Record<string, string> = {
  "tool-owned": "var(--info)",
  "human-owned": "var(--ok)",
  "human-authored": "var(--ok)",
  absent: "var(--fg-faint)",
};

/**
 * The authorship progress model: what remains between "connected" and "a
 * governed catalog", every row derived (never stored) and linked to the
 * view where the work happens. This is awaitingAuthorship turned into a
 * product surface.
 */
function progressRows(state: ReturnType<typeof useComposer>): Array<{ label: string; done: boolean; detail: string; view: View }> {
  const { contract, profile, emit } = state;
  if (!contract) return [];
  const components = Object.entries((contract.components ?? {}) as Record<string, any>);
  const described = components.filter(([, c]) => c.whenToUse).length;
  const bare = components.filter(([, c]) => Object.keys(c.props ?? {}).length === 0).length;
  const plans = new Set(((profile?.components ?? []) as any[]).map((p) => p.dspackId));
  const casualties = new Set(((profile?.casualtyComponents ?? []) as any[]).map((c) => c.dspackId));
  const unmapped = components.filter(([id]) => !plans.has(id) && !casualties.has(id)).length;
  const intents = (contract.intents ?? []).length;
  const rules = (contract.rules ?? []).length;
  const examples = (contract.examples ?? []).length;
  const errors = (emit?.findings ?? []).filter((f) => f.severity === "error").length;
  return [
    { label: "Components described", done: described === components.length, detail: `${described}/${components.length} carry whenToUse`, view: "inventory" },
    { label: "Props enriched", done: bare === 0, detail: bare ? `${bare} component(s) have no props — discovery is variant-centric; add content props` : "every component declares props", view: "inventory" },
    { label: "Mapping decided", done: unmapped === 0, detail: unmapped ? `${unmapped} component(s) neither mapped nor declared casualties` : "every component mapped or a declared casualty", view: "mapper" },
    { label: "Intents authored", done: intents > 0, detail: `${intents} intent(s) — the scoping vocabulary generation runs under`, view: "governance" },
    { label: "Rules authored", done: rules > 0, detail: `${rules} rule(s), each carrying its written rationale`, view: "governance" },
    { label: "Worked examples", done: examples > 0, detail: `${examples} scenario(s) — the few-shot and preview corpus`, view: "scenarios" },
    { label: "Gates green", done: (emit?.ok ?? false) && errors === 0, detail: errors ? `${errors} error finding(s) across the gates` : emit?.ok ? "document, S-gates, and catalog gates pass" : "emit has not run", view: "validate" },
  ];
}

export function ProjectView({ onNavigate }: { onNavigate: (view: View) => void }) {
  const state = useComposer();
  const { mode, agentUp, manifest, ledger, connect, loadDemo, discover, rediscover, busy } = state;
  const [path, setPath] = useState("");
  const rows = progressRows(state);

  return (
    <section style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1fr)" }}>
      <div>
        <h2 style={{ fontFamily: "var(--hl)", fontSize: 15, textTransform: "uppercase", color: "var(--fg)" }}>Connect</h2>
        <p style={{ fontSize: 13, color: "var(--fg-body)" }}>
          A project is files in your repository: a <code>project.json</code>, a dspack contract, a JSON mapping profile, and
          authored surfaces. The local agent reads and writes them; nothing leaves your machine.
        </p>
        <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/absolute/path/to/your/project"
            style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12, background: "var(--bg-1)", border: "1px solid var(--line)", color: "var(--fg)", padding: "6px 8px", borderRadius: 2 }}
            data-testid="project-path"
          />
          <button className="st-btn" disabled={!agentUp || !path || busy !== null} onClick={() => void connect(path)} data-testid="connect">
            Connect
          </button>
        </div>
        {!agentUp && (
          <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
            The agent is not running. Start it with <code>pnpm --filter agent dev</code>, then connect. The demo project stays
            available meanwhile.
          </p>
        )}
        <button className="st-btn st-btn--dashed" onClick={loadDemo} data-testid="load-demo">
          Load demo project
        </button>
        {mode === "agent" && manifest?.exportConfigPath && (
          <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <button className="st-btn" disabled={busy !== null} onClick={() => void rediscover()} data-testid="rediscover">
              Rediscover
            </button>
            <button className="st-btn st-btn--dashed" disabled={busy !== null} onClick={() => void discover()} data-testid="discover">
              First bootstrap
            </button>
            <p style={{ fontSize: 12, color: "var(--fg-dim)", flexBasis: "100%" }}>
              Rediscover merges at the ledger's granularity: tool-owned sections refresh, human-owned sections and
              governance are preserved, newly discovered components are added. First bootstrap keeps the whole-file
              refusal table; refusals are shown verbatim.
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <>
            <h2 style={{ fontFamily: "var(--hl)", fontSize: 15, textTransform: "uppercase", color: "var(--fg)", marginTop: 20 }}>
              What remains
            </h2>
            <ul style={{ listStyle: "none", padding: 0, fontSize: 13 }} data-testid="progress">
              {rows.map((row) => (
                <li key={row.label} style={{ borderTop: "1px solid var(--line-soft)", padding: "7px 0", display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: row.done ? "var(--ok)" : "var(--warn)", width: 14 }}>
                    {row.done ? "✓" : "•"}
                  </span>
                  <button className="st-link" style={{ fontSize: 13 }} onClick={() => onNavigate(row.view)} data-testid={`progress-${row.view}-${row.label.split(" ")[0].toLowerCase()}`}>
                    {row.label}
                  </button>
                  <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>{row.detail}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div>
        <h2 style={{ fontFamily: "var(--hl)", fontSize: 15, textTransform: "uppercase", color: "var(--fg)" }}>Ownership</h2>
        {ledger ? (
          <>
            <table style={{ fontSize: 13, borderCollapse: "collapse" }}>
              <tbody>
                {ledger.sections
                  .filter((s) => s.state !== "absent")
                  .map((s) => (
                    <tr key={s.section}>
                      <td style={{ padding: "3px 12px 3px 0", fontFamily: "var(--mono)", fontSize: 12 }}>{s.section}</td>
                      <td style={{ padding: "3px 0", fontFamily: "var(--mono)", fontSize: 11, color: STATE_COLOR[s.state] }} data-testid={`ledger-${s.section}`}>
                        {s.state}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {ledger.awaitingAuthorship.length > 0 && (
              <>
                <h3 style={{ fontSize: 13, color: "var(--fg)", marginTop: 14 }}>Awaiting authorship</h3>
                <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
                  The tool never writes these; they are yours. Sections you have since authored show above as human-authored.
                </p>
                <ul style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--fg-body)", paddingLeft: 18 }}>
                  {ledger.awaitingAuthorship.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>No contract loaded.</p>
        )}
      </div>
    </section>
  );
}
