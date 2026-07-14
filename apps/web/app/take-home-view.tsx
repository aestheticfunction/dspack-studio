"use client";

/**
 * FM-11: take it home. Three honest paths from liking the studio to running
 * the ecosystem yourself: the ds-mcp config for your editor, the real
 * validator in this page, and the local agent for live governed generation.
 * Everything here names published versions only; the validator and the
 * contract are the same ones the studio runs. Capabilities that need the
 * local agent say so plainly.
 */
import { useState } from "react";
import type { Finding, GateReport } from "@aestheticfunction/dspack-gen/core";
import {
  CONTRACT_DOWNLOAD_PATH,
  CONTRACT_PATH_PLACEHOLDER,
  DS_MCP_RANGE,
  LOCAL_AGENT_COMMANDS,
  caughtExample,
  mcpConfig,
  validatePasted,
  type ValidateOutcome,
} from "./take-home";
import { btnClass, linkClass } from "./ui";

const sectionStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "14px 16px",
  marginBottom: 14,
};

const preStyle: React.CSSProperties = {
  margin: "8px 0",
  padding: 10,
  background: "var(--bg-2)",
  borderRadius: 3,
  overflow: "auto",
  fontFamily: "var(--mono)",
  fontSize: 12,
  lineHeight: 1.5,
};

function download(filename: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function CopyButton({ text, testid }: { text: string; testid: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      data-testid={testid}
      className={btnClass()}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard unavailable: the text is selectable in the block above */
        }
      }}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

/** One gate line + its findings, the same information the gates tab shows for a run. */
function ReportView({ outcome }: { outcome: ValidateOutcome }) {
  if (outcome.kind === "rejected") {
    return (
      <section
        data-testid="validate-rejected"
        style={{ border: "1px solid var(--err-line)", background: "var(--err-soft)", borderRadius: 6, padding: "12px 16px", fontSize: 13, marginTop: 10 }}
      >
        The validator said no: <code>{outcome.reason}</code>. Nothing was evaluated.
      </section>
    );
  }
  const { report } = outcome;
  return (
    <div data-testid="validate-report" style={{ marginTop: 10 }}>
      <p data-testid="validate-verdict" style={{ fontSize: 13, margin: "0 0 6px", fontWeight: 600 }}>
        {report.pass
          ? "All gates pass. This surface is contract-valid."
          : `Gates failed: ${report.errorCount} error finding${report.errorCount === 1 ? "" : "s"}.`}
      </p>
      <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: "0 0 8px", fontFamily: "var(--mono)" }}>
        {(report.gates as GateReport[]).map((g) => `${g.gate} ${g.status}`).join(" · ")}
      </p>
      {(report.findings as Finding[]).map((f, i) => (
        <div
          key={`${f.ruleId}-${i}`}
          data-testid="validate-finding"
          style={{ border: "1px dashed var(--line)", borderRadius: 4, padding: "8px 10px", marginBottom: 6, fontSize: 12 }}
        >
          <p style={{ margin: 0, fontFamily: "var(--mono)" }}>
            <strong>{f.ruleId}</strong> · {f.level} · at {f.location.path}
          </p>
          <p style={{ margin: "4px 0 0" }}>{f.message}</p>
          <p style={{ margin: "4px 0 0", color: "var(--fg-dim)" }}>{f.rationale}</p>
        </div>
      ))}
      <details style={{ fontSize: 12, marginTop: 6 }}>
        <summary style={{ cursor: "pointer" }}>the report as the linter prints it</summary>
        <pre data-testid="validate-text" tabIndex={0} style={preStyle}>{outcome.text}</pre>
      </details>
    </div>
  );
}

export function TakeHomeView({ agentOnline }: { agentOnline: boolean | null }) {
  const [pasted, setPasted] = useState("");
  const [outcome, setOutcome] = useState<ValidateOutcome | null>(null);
  const config = mcpConfig();

  return (
    <div data-testid="take-home">
      <section style={sectionStyle} aria-label="use the design system from your editor">
        <h2 style={{ fontSize: 14, margin: "0 0 6px" }}>The design system in your editor</h2>
        <p style={{ fontSize: 13, color: "var(--fg-body)", margin: "0 0 4px", maxWidth: 720, lineHeight: 1.55 }}>
          ds-mcp serves a dspack contract to MCP coding agents: components, tokens, patterns, the compiled
          generation context, and the same S1/S2/S3 validator this studio runs. It is read-only, makes no network
          calls, and runs from npm. This config points it at the studio&apos;s Astryx contract; download both, set
          the absolute path, and add the config to your MCP client.
        </p>
        <p data-testid="mcp-version-note" style={{ fontSize: 12, color: "var(--fg-dim)", margin: "0 0 4px" }}>
          Requires ds-mcp {DS_MCP_RANGE}: earlier versions serve a pre-0.1.1 generation schema that constrains
          models differently than this studio&apos;s pipeline.
        </p>
        <pre data-testid="mcp-config" tabIndex={0} aria-label="the MCP client config" style={preStyle}>{config}</pre>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <CopyButton text={config} testid="mcp-config-copy" />
          <button data-testid="mcp-config-download" className={btnClass()} onClick={() => download("mcp-config.json", config)}>
            download the config
          </button>
          <a data-testid="contract-download" className={linkClass} style={{ alignSelf: "center", fontSize: 13 }} href={CONTRACT_DOWNLOAD_PATH} download>
            download the contract (astryx.dspack.json)
          </a>
        </div>
        <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: "8px 0 0" }}>
          The downloaded contract is the byte-synced copy of dspack main this studio validates against. Replace{" "}
          <code>{CONTRACT_PATH_PLACEHOLDER}</code> with where you saved it.
        </p>
      </section>

      <section style={sectionStyle} aria-label="validate a surface in this page">
        <h2 style={{ fontSize: 14, margin: "0 0 6px" }}>The validator, right here</h2>
        <p style={{ fontSize: 13, color: "var(--fg-body)", margin: "0 0 8px", maxWidth: 720, lineHeight: 1.55 }}>
          Paste a dspack surface and the real linter evaluates it against the studio&apos;s contract: S1 surface
          schema, S2 contract vocabulary, S3 governance rules. This runs entirely in this page; nothing you paste
          leaves your browser.
        </p>
        <textarea
          data-testid="validate-input"
          aria-label="a dspack surface document to validate"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder='{ "dspackSurface": "0.1", "system": "Astryx", "intent": "destructive-action", "root": { ... } }'
          style={{ width: "100%", padding: 10, borderRadius: 2, border: "1px solid var(--line)", background: "var(--bg-1)", color: "inherit", fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.5 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button data-testid="validate-run" className={btnClass(true)} onClick={() => setOutcome(validatePasted(pasted))}>
            validate
          </button>
          <button
            data-testid="validate-load-example"
            className={btnClass()}
            onClick={() => {
              setPasted(caughtExample().surfaceJson);
              setOutcome(null);
            }}
          >
            load a caught example
          </button>
        </div>
        <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: "8px 0 0" }}>
          The caught example is fixture-001&apos;s attempt 0, exactly as the recorded live run proposed it before
          the S3 gate failed it. Validating it here reproduces the recorded findings.
        </p>
        {outcome && <ReportView outcome={outcome} />}
      </section>

      <section style={sectionStyle} aria-label="run the pipeline locally">
        <h2 style={{ fontSize: 14, margin: "0 0 6px" }}>The pipeline on your machine</h2>
        <p style={{ fontSize: 13, color: "var(--fg-body)", margin: "0 0 8px", maxWidth: 720, lineHeight: 1.55 }}>
          Live governed generation needs the local agent. It wraps the published dspack-gen pipeline behind an
          AG-UI endpoint; models run through your local Ollama, and no credentials pass through the browser.
        </p>
        <pre data-testid="local-agent-commands" tabIndex={0} aria-label="commands to run the local agent" style={preStyle}>{LOCAL_AGENT_COMMANDS.join("\n")}</pre>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <CopyButton text={LOCAL_AGENT_COMMANDS.join("\n")} testid="local-agent-copy" />
        </div>
        <p data-testid="local-agent-status" style={{ fontSize: 12, color: "var(--fg-dim)", margin: "8px 0 0" }}>
          {agentOnline
            ? "A local agent is answering right now: run it live is active in this studio."
            : "Once it answers on localhost:8787, this studio's run it live and break it modes use it directly."}
        </p>
      </section>
    </div>
  );
}
