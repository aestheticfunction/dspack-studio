"use client";

import { useState } from "react";
import { useComposer } from "../state";

const STATE_COLOR: Record<string, string> = {
  "tool-owned": "var(--info)",
  "human-owned": "var(--ok)",
  "human-authored": "var(--ok)",
  absent: "var(--fg-faint)",
};

export function ProjectView() {
  const { mode, agentUp, manifest, ledger, connect, loadDemo, discover, busy } = useComposer();
  const [path, setPath] = useState("");

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
          <div style={{ marginTop: 14 }}>
            <button className="st-btn" disabled={busy !== null} onClick={() => void discover()} data-testid="discover">
              Re-run discovery
            </button>
            <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
              Discovery (dspack-export) refuses rather than touch human-owned sections; its refusal is shown verbatim.
            </p>
          </div>
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
