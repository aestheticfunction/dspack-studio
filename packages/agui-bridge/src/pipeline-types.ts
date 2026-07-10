/**
 * Structural mirror of dspack-gen's PipelineEvent union (dist/run/orchestrator.d.ts).
 * dspack-gen 0.1.0 does not re-export PipelineEvent from its package root
 * (follow-up filed to export it upstream); this mirror keeps the bridge free
 * of a deep import while staying assignable to the real events. The mirror is
 * intentionally loose (unknown payload members) — the bridge forwards payloads
 * verbatim into CUSTOM events and never depends on their internals beyond
 * what is typed here.
 */

export interface GateReportLike {
  gate: string;
  /** S-gates (dspack-gen lint): "PASS" | "FAIL" | "SKIPPED". */
  status?: string;
  /** A-gates (dspack-gen audit / dspack-emit validations): boolean. */
  pass?: boolean;
  errors?: string[];
  [k: string]: unknown;
}

/** True when a gate report (either shape) records a failure. */
export function gateFailed(gate: GateReportLike): boolean {
  return gate.status === "FAIL" || gate.pass === false;
}

/** True when a gate report (either shape) records an explicit pass. */
export function gatePassed(gate: GateReportLike): boolean {
  return gate.status === "PASS" || gate.pass === true;
}

export interface FindingLike {
  ruleId?: string;
  message?: string;
  rationale?: string;
  [k: string]: unknown;
}

export type PipelineEvent =
  | { type: "start"; intent: string; prompt: string; adapterId: string; ruleIds: string[] }
  | { type: "attempt"; index: number; model?: string; surface: unknown; gates: GateReportLike[]; findings: FindingLike[] }
  | { type: "repair"; index: number; message: string }
  | { type: "emitted"; validations: unknown[]; warnings: Array<{ code: string; message: string }> }
  | { type: "done"; outcome: string; exitCode: number; report: unknown; surfaceMessages?: unknown };
