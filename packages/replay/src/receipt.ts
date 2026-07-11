/**
 * FM-12: the audit receipt. A completed run's evidence, assembled from the
 * SAME event stream everything else folds from: the dspack.audit report
 * verbatim, plus session provenance and the interaction history.
 *
 * Canonical byte-match boundary (receiptVersion 1), defined precisely:
 *   canonical = stable-stringify({ receiptVersion, intent, prompt, report })
 *   where `report` is the audit report MINUS `createdAt` and `timings`.
 * Those two fields are intentionally environment-dependent (wall clock and
 * machine speed); everything else — attempts, findings, repair messages,
 * gate outcomes per A2UI version, emitter warnings, adapter identity,
 * contract digest, generation-schema hash — must reproduce byte-for-byte
 * when the same recorded run is replayed. Session identity (ids, recording
 * time, event counts) is DISPLAYED on the receipt but excluded from the
 * hash: the canonical form answers "what was asked and what did governance
 * do", not "which copy of the recording is this".
 */
import type { EventSource } from "./player";
import type { ForkProvenance } from "./fixture";

export interface ReceiptSession {
  id?: string;
  name?: string;
  mode?: string;
  adapterId?: string;
  recordedAt?: string;
  eventCount: number;
  actionCount: number;
  fork?: ForkProvenance;
}

export interface AuditReceipt {
  receiptVersion: "1";
  intent?: string;
  prompt?: string;
  /** The dspack.audit report, verbatim from the event stream. */
  report: Record<string, unknown>;
  outcome?: string;
  exitCode?: number;
  session: ReceiptSession;
  /** sha256 (hex) of the canonical form — the byte-match anchor. */
  canonicalSha256: string;
}

/** Deterministic JSON: object keys sorted recursively, arrays in order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The exact canonicalized string the hash covers. */
export function canonicalReceiptString(intent: string | undefined, prompt: string | undefined, report: Record<string, unknown>): string {
  const { createdAt: _c, timings: _t, ...stable } = report;
  return stableStringify({ receiptVersion: "1", intent, prompt, report: stable });
}

/** Find the run's audit report in the event stream (null before it lands). */
export function auditReportAt(source: EventSource): { report: Record<string, unknown>; outcome?: string; exitCode?: number } | null {
  for (let i = source.events.length - 1; i >= 0; i--) {
    const ev = source.events[i].event as Record<string, any>;
    if (ev.type === "CUSTOM" && ev.name === "dspack.audit" && ev.value?.report) {
      return { report: ev.value.report, outcome: ev.value.outcome, exitCode: ev.value.exitCode };
    }
  }
  return null;
}

export interface ReceiptMeta {
  id?: string;
  name?: string;
  mode?: string;
  adapterId?: string;
  intent?: string;
  prompt?: string;
  recordedAt?: string;
  fork?: ForkProvenance;
}

/** Assemble the receipt for a run, or null when no audit has landed. */
export async function buildReceipt(source: EventSource, meta: ReceiptMeta = {}): Promise<AuditReceipt | null> {
  const audit = auditReportAt(source);
  if (!audit) return null;
  const report = audit.report;
  const intent = meta.intent ?? (report.request as any)?.intent;
  const prompt = meta.prompt ?? (report.request as any)?.prompt;
  const actionCount = source.events.filter(
    (e) => (e.event as any).type === "CUSTOM" && String((e.event as any).name ?? "").startsWith("studio.action."),
  ).length;
  return {
    receiptVersion: "1",
    intent,
    prompt,
    report,
    outcome: audit.outcome,
    exitCode: audit.exitCode,
    session: {
      id: meta.id,
      name: meta.name,
      mode: meta.mode,
      adapterId: meta.adapterId ?? (report.generation as any)?.adapterId,
      recordedAt: meta.recordedAt,
      eventCount: source.events.length,
      actionCount,
      fork: meta.fork,
    },
    canonicalSha256: await sha256Hex(canonicalReceiptString(intent, prompt, report)),
  };
}

export type ReceiptVerification =
  | { status: "match"; sha256: string }
  | { status: "mismatch"; expected: string; actual: string }
  | { status: "invalid"; reason: string }
  | { status: "no-audit" };

/** Verify a downloaded receipt against THIS run's event stream. */
export async function verifyReceipt(source: EventSource, doc: unknown): Promise<ReceiptVerification> {
  const receipt = doc as AuditReceipt;
  if (receipt?.receiptVersion !== "1" || typeof receipt.canonicalSha256 !== "string") {
    return { status: "invalid", reason: "not a version-1 audit receipt" };
  }
  const audit = auditReportAt(source);
  if (!audit) return { status: "no-audit" };
  // Both sides are canonicalized the same way: the uploaded receipt's hash
  // must be internally consistent AND equal this run's recomputed hash.
  const claimed = await sha256Hex(canonicalReceiptString(receipt.intent, receipt.prompt, receipt.report ?? {}));
  if (claimed !== receipt.canonicalSha256) {
    return { status: "invalid", reason: "the receipt's hash does not match its own contents (edited file?)" };
  }
  const local = await sha256Hex(canonicalReceiptString(receipt.intent, receipt.prompt, audit.report));
  return local === receipt.canonicalSha256
    ? { status: "match", sha256: local }
    : { status: "mismatch", expected: local, actual: receipt.canonicalSha256 };
}
