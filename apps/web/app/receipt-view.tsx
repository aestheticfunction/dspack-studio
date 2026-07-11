"use client";

/**
 * FM-12: the audit receipt panel. Everything on it is assembled from the
 * run's own event stream (the dspack.audit report verbatim plus session
 * provenance). The canonical sha256 covers the request and every
 * governance outcome; wall-clock and timing fields are excluded by design
 * and the boundary is stated on the receipt itself. A downloaded receipt
 * can be verified against any replay of the run; a failed check is loud.
 */
import { useEffect, useState } from "react";
import {
  buildReceipt,
  gateFailed,
  verifyReceipt,
  type AuditReceipt,
  type EventSource,
  type ReceiptMeta,
  type ReceiptVerification,
} from "@dspack-studio/replay";

const row: React.CSSProperties = { display: "flex", gap: 8, alignItems: "baseline" };
const k: React.CSSProperties = { minWidth: 150, opacity: 0.65 };
const code: React.CSSProperties = { background: "rgba(148,163,184,0.15)", borderRadius: 4, padding: "1px 5px", wordBreak: "break-all" };

export function ReceiptView({ source, meta, defaultOpen }: { source: EventSource; meta?: ReceiptMeta; defaultOpen?: boolean }) {
  const [receipt, setReceipt] = useState<AuditReceipt | null>(null);
  const [verdict, setVerdict] = useState<ReceiptVerification | null>(null);

  useEffect(() => {
    let alive = true;
    setVerdict(null);
    void buildReceipt(source, meta).then((r) => alive && setReceipt(r));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  if (!receipt) return null;
  const report = receipt.report as any;
  const attempts: any[] = report.attempts ?? [];
  const repairs: string[] = report.repairMessages ?? [];
  const validations: any[] = report.emitted?.validations ?? [];
  const warnings: any[] = report.emitted?.warnings ?? [];

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt-${receipt.session.id ?? "run"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const verifyFile = async (file: File) => {
    try {
      setVerdict(await verifyReceipt(source, JSON.parse(await file.text())));
    } catch {
      setVerdict({ status: "invalid", reason: "not JSON" });
    }
  };

  return (
    <details data-testid="receipt" ref={(el) => { if (el && defaultOpen && !el.dataset.autoOpened) { el.open = true; el.dataset.autoOpened = "1"; } }} style={{ marginTop: 12, fontSize: 12 }}>
      <summary style={{ cursor: "pointer" }} data-testid="receipt-summary">
        audit receipt: <strong>{receipt.outcome}</strong> (exit {receipt.exitCode}) <span aria-hidden>🧾</span>
      </summary>
      <div style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "12px 14px", marginTop: 8, display: "grid", gap: 6 }}>
        <p style={{ margin: 0 }}>
          Interfaces with receipts: this run carries its complete evidence trail, reproducible from the recording.
        </p>

        <div style={row}><span style={k}>intent / prompt</span><span><code style={code}>{receipt.intent}</code> "{receipt.prompt}"</span></div>
        <div style={row}><span style={k}>adapter</span><code style={code}>{receipt.session.adapterId}</code></div>
        <div style={row}><span style={k}>session</span><span>{receipt.session.mode} run{receipt.session.name ? ` "${receipt.session.name}"` : ""}, {receipt.session.eventCount} events, {receipt.session.actionCount} interaction events{receipt.session.recordedAt ? `, recorded ${receipt.session.recordedAt}` : ""}</span></div>
        {receipt.session.fork && (
          <div style={row}><span style={k}>fork of</span><span><code style={code}>{receipt.session.fork.parentId}</code> at event {receipt.session.fork.forkIndex}</span></div>
        )}
        <div style={row}><span style={k}>contract</span><span>{report.request?.contract?.name} (dspack {report.request?.contract?.dspack}) <code style={code}>{String(report.request?.contract?.sha256 ?? "").slice(0, 16)}</code></span></div>
        <div style={row}><span style={k}>generation schema</span><code style={code}>{String(report.generation?.schemaSha256 ?? "").slice(0, 16)}</code></div>
        <div style={row}><span style={k}>report version</span><span>{String(report.reportVersion)} (receipt v{receipt.receiptVersion})</span></div>

        <div style={row} data-testid="receipt-attempts">
          <span style={k}>attempts</span>
          <span>
            {attempts.map((a: any, i: number) => (
              <span key={i} style={{ marginRight: 10 }}>
                #{i}: {(a.gates ?? []).map((g: any) => `${g.gate}${gateFailed(g) ? "✗" : "✓"}`).join(" ") || (a.adapterError ? "adapter error" : "n/a")}
              </span>
            ))}
          </span>
        </div>
        {(attempts.some((a: any) => (a.findings ?? []).length > 0)) && (
          <div style={row}><span style={k}>findings</span><span>{attempts.flatMap((a: any) => a.findings ?? []).map((f: any) => f.ruleId ?? f.code).join(", ")}</span></div>
        )}
        {repairs.length > 0 && (
          <details><summary style={{ cursor: "pointer" }}>repair messages ({repairs.length})</summary>
            {repairs.map((m, i) => (<pre key={i} tabIndex={0} aria-label={`repair message ${i + 1}`} style={{ ...code, display: "block", whiteSpace: "pre-wrap", padding: 8 }}>{m}</pre>))}
          </details>
        )}
        <div style={row} data-testid="receipt-gates">
          <span style={k}>A2UI gates</span>
          <span>
            {validations.map((v: any, i: number) => (
              <span key={i} style={{ marginRight: 10 }}>
                {String(v.a2uiVersion ?? v.version ?? `catalog ${i + 1}`)}: {(v.gates ?? []).map((g: any) => `${g.gate ?? g.name}${gateFailed(g) ? "✗" : "✓"}`).join(" ")}
              </span>
            ))}
            {validations.length === 0 && <em>no emission (the run ended before the emitter)</em>}
          </span>
        </div>
        {warnings.length > 0 && (
          <details><summary style={{ cursor: "pointer" }}>emitter warnings ({warnings.length}), nothing silent</summary>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{warnings.map((w: any, i: number) => (<li key={i}><code>{w.code}</code> {w.message}</li>))}</ul>
          </details>
        )}

        <div style={row}><span style={k}>canonical sha256</span><code style={code} data-testid="receipt-hash">{receipt.canonicalSha256}</code></div>
        <p style={{ margin: 0, opacity: 0.65 }}>
          The hash covers the request and every governance outcome. Wall-clock and timing fields are excluded by
          design: replaying this recording reproduces the hash byte for byte; a re-executed run reproduces it only if
          governance behaved identically.
        </p>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button data-testid="receipt-download" onClick={download} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #cbd5e1", cursor: "pointer", font: "inherit" }}>
            download receipt
          </button>
          <label style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #cbd5e1", cursor: "pointer" }}>
            verify a receipt file against this run
            <input
              data-testid="receipt-verify-input"
              type="file"
              accept=".json,application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void verifyFile(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {verdict && (
          <p
            data-testid="receipt-verdict"
            role="status"
            style={{
              margin: 0,
              fontWeight: 600,
              color: verdict.status === "match" ? "#15803d" : "#b91c1c",
            }}
          >
            {verdict.status === "match" && `verified: the receipt matches this run (sha256 ${verdict.sha256.slice(0, 16)}…)`}
            {verdict.status === "mismatch" && "MISMATCH: that receipt does not describe this run. Nothing here is accepted silently."}
            {verdict.status === "invalid" && `invalid receipt: ${(verdict as any).reason}`}
            {verdict.status === "no-audit" && "this run has no audit yet"}
          </p>
        )}
      </div>
    </details>
  );
}
