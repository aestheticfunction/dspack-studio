/**
 * The normalized finding shape every composer gate reports in.
 *
 * One shape for all of: dspack document validation (dspack-validate), surface
 * lint S1/S2/S3 (dspack-gen/core), emit gates A1/A2/A3 + coverage + fidelity
 * (dspack-emit), profile shape (loadProfile), registry coverage
 * (planRegistry), and ledger integrity. `target` is a JSON path into the
 * contract/profile, a surface node id, or a catalog component name — enough
 * for the UI to deep-link every finding to its fix location.
 */

export type FindingGate =
  | "manifest"
  | "document"
  | "profile"
  | "S1"
  | "S2"
  | "S3"
  | "A1"
  | "A2"
  | "A3"
  | "coverage"
  | "fidelity"
  | "registry"
  | "ledger";

export type FindingSeverity = "error" | "warn" | "info";

export interface ComposerFinding {
  gate: FindingGate;
  code: string;
  severity: FindingSeverity;
  /** JSON path, surface node id, component name, or "" for document-level. */
  target: string;
  message: string;
}

export function finding(
  gate: FindingGate,
  code: string,
  severity: FindingSeverity,
  target: string,
  message: string,
): ComposerFinding {
  return { gate, code, severity, target, message };
}

export function countBySeverity(findings: ComposerFinding[]): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}
