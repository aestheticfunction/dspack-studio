"use client";

/**
 * The gate dashboard: one normalized finding shape across every gate.
 * Emit (A-gates + coverage + fidelity) and Validate (document harness +
 * S1/S2/S3) each populate their column; agent-gated rows state their
 * requirement plainly instead of rendering green.
 */
import { useComposer } from "../state";

const SEV_COLOR = { error: "var(--err)", warn: "var(--warn)", info: "var(--fg-dim)" } as const;

export function ValidateView() {
  const { emit, validate, runEmit, runValidate, busy, mode } = useComposer();
  const findings = [...(validate?.findings ?? []), ...(emit?.findings ?? [])];

  return (
    <section>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <button className="st-btn" disabled={busy !== null} onClick={() => void runValidate()} data-testid="run-validate">
          Validate contract + surfaces
        </button>
        <button className="st-btn" disabled={busy !== null || mode !== "agent"} onClick={() => void runEmit()} data-testid="run-emit">
          Emit catalog
        </button>
        {mode === "demo" && (
          <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>
            Demo: S1–S3 run in this browser (dspack-gen/core); emit shows the build-time result; the contract harness needs the local agent.
          </span>
        )}
      </div>

      {emit && (
        <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: emit.ok ? "var(--ok)" : "var(--err)" }} data-testid="emit-status">
          catalog gates (A1/A2/A3, both A2UI versions): {emit.ok ? "PASS" : "FAIL"}
        </p>
      )}
      {validate && (
        <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: validate.ok ? "var(--ok)" : "var(--err)" }} data-testid="validate-status">
          contract + surface gates: {validate.ok ? "PASS" : "FAIL"}
        </p>
      )}

      {findings.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>No findings yet — run the gates.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color: "var(--fg-dim)" }}>
              <th style={{ padding: "4px 8px" }}>gate</th>
              <th style={{ padding: "4px 8px" }}>severity</th>
              <th style={{ padding: "4px 8px" }}>target</th>
              <th style={{ padding: "4px 8px" }}>finding</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--line-soft)" }} data-testid={`finding-${f.gate}-${f.code}`}>
                <td style={{ padding: "6px 8px", fontFamily: "var(--mono)", fontSize: 12 }}>
                  {f.gate}
                  <span style={{ color: "var(--fg-faint)" }}> {f.code}</span>
                </td>
                <td style={{ padding: "6px 8px", fontFamily: "var(--mono)", fontSize: 11, color: SEV_COLOR[f.severity] }}>{f.severity}</td>
                <td style={{ padding: "6px 8px", fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-body)" }}>{f.target || "—"}</td>
                <td style={{ padding: "6px 8px", color: "var(--fg-body)" }}>{f.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
