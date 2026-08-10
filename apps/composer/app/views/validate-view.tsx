"use client";

/**
 * The gate dashboard: one normalized finding shape across every gate.
 * Emit (A-gates + coverage + fidelity) and Validate (document harness +
 * S1/S2/S3) each populate their column; agent-gated rows state their
 * requirement plainly instead of rendering green.
 */
import { useComposer } from "../state";
import { ViewHeader } from "../ui";

const SEV_COLOR = { error: "var(--err)", warn: "var(--warn)", info: "var(--fg-dim)" } as const;

export function ValidateView() {
  const { emit, validate, runEmit, runValidate, busy, mode } = useComposer();
  const findings = [...(validate?.findings ?? []), ...(emit?.findings ?? [])];

  return (
    <section>
      <ViewHeader
        eyebrow="Checks"
        lead="Run the governed checks over the contract and its worked surfaces: structure, approved vocabulary, and your design-system rules."
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <button className="st-btn" disabled={busy !== null} onClick={() => void runValidate()} data-testid="run-validate">
          Validate contract + surfaces
        </button>
        {mode === "agent" ? (
          <button className="st-btn" disabled={busy !== null} onClick={() => void runEmit()} data-testid="run-emit">
            Emit catalog
          </button>
        ) : (
          <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>
            The catalog re-emits automatically in this browser on every change; S1–S3 run right here. Writing the emitted
            files to disk (and the full contract harness) needs the local agent.
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
                <td style={{ padding: "6px 8px", fontFamily: "var(--mono)", fontSize: 11, color: SEV_COLOR[f.severity] }}>
                  {f.severity}
                  {f.acknowledged && (
                    <span
                      data-testid={`acknowledged-${f.target}`}
                      title={`Declared a ${f.acknowledged.class} casualty of ${f.acknowledged.componentId}`}
                      style={{ display: "block", fontSize: 10, textTransform: "uppercase", color: "var(--ok)" }}
                    >
                      acknowledged
                    </span>
                  )}
                </td>
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
