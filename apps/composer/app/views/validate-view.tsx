"use client";

/**
 * The gate dashboard: one normalized finding shape across every gate.
 * Emit (A-gates + coverage + fidelity) and Validate (document harness +
 * S1/S2/S3) each populate their column; agent-gated rows state their
 * requirement plainly instead of rendering green.
 *
 * Layering (project-first, noise last): error findings, then warnings, then
 * infos — and the fidelity notes (how the contract PROJECTS onto A2UI, not
 * unresolved work) live behind a collapsed disclosure so the view opens on
 * what is actionable. A finding whose message was capped carries its
 * COMPLETE raw gate output on `evidence`, one expander away.
 */
import type { ComposerFinding } from "@dspack-studio/composer-core";
import { useComposer } from "../state";
import { ViewHeader } from "../ui";

const SEV_COLOR = { error: "var(--err)", warn: "var(--warn)", info: "var(--fg-dim)" } as const;
const SEV_RANK = { error: 0, warn: 1, info: 2 } as const;

function FindingRow({ f }: { f: ComposerFinding }) {
  return (
    <tr style={{ borderTop: "1px solid var(--line-soft)" }} data-testid={`finding-${f.gate}-${f.code}`}>
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
      <td style={{ padding: "6px 8px", color: "var(--fg-body)" }}>
        {f.message}
        {f.evidence && f.evidence.length > 0 && (
          <details style={{ marginTop: 4 }}>
            <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--fg-dim)" }}>
              full gate output ({f.evidence.length} error{f.evidence.length === 1 ? "" : "s"})
            </summary>
            <pre
              data-testid={`finding-evidence-${f.gate}-${f.code}`}
              style={{ fontFamily: "var(--mono)", fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto", color: "var(--fg-dim)", margin: "4px 0 0" }}
            >
              {f.evidence.join("\n")}
            </pre>
          </details>
        )}
      </td>
    </tr>
  );
}

function FindingsTable({ rows }: { rows: ComposerFinding[] }) {
  return (
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
        {rows.map((f, i) => (
          <FindingRow key={i} f={f} />
        ))}
      </tbody>
    </table>
  );
}

export function ValidateView() {
  const { emit, validate, runEmit, runValidate, busy, mode } = useComposer();
  const findings = [...(validate?.findings ?? []), ...(emit?.findings ?? [])];
  // Fidelity notes describe the projection, not unfinished work: collapsed.
  const fidelity = findings.filter((f) => f.gate === "fidelity");
  // Everything else, errors first (the sort is stable, so gate order holds
  // within a severity).
  const actionable = findings.filter((f) => f.gate !== "fidelity").sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);

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
        <>
          {actionable.length > 0 ? (
            <FindingsTable rows={actionable} />
          ) : (
            <p style={{ fontSize: 13, color: "var(--fg-dim)" }} data-testid="findings-clear">
              No error or warning findings — only fidelity notes below.
            </p>
          )}
          {fidelity.length > 0 && (
            <details data-testid="fidelity-notes" style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--fg-dim)" }}>
                {fidelity.length} fidelity note{fidelity.length === 1 ? "" : "s"} — how this contract projects onto A2UI
              </summary>
              <FindingsTable rows={fidelity} />
            </details>
          )}
        </>
      )}
    </section>
  );
}
