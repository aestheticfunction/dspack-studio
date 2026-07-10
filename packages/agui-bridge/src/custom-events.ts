/**
 * The studio's typed CUSTOM event vocabulary: gate telemetry rides AG-UI
 * CUSTOM events with these names. Defined once here — the agent server, the
 * replay player, the inspector, and Playwright all consume identical shapes.
 */
import type { FindingLike, GateReportLike } from "./pipeline-types";

export const DSPACK_EVENT = {
  runStart: "dspack.run.start",
  gates: "dspack.gates",
  repair: "dspack.repair",
  emit: "dspack.emit",
  audit: "dspack.audit",
} as const;

export type DspackEventName = (typeof DSPACK_EVENT)[keyof typeof DSPACK_EVENT];

export interface DspackRunStartValue {
  intent: string;
  prompt: string;
  adapterId: string;
  ruleIds: string[];
}

export interface DspackGatesValue {
  index: number;
  model?: string;
  surface: unknown;
  gates: GateReportLike[];
  findings: FindingLike[];
}

export interface DspackRepairValue {
  index: number;
  message: string;
}

export interface DspackEmitValue {
  validations: unknown[];
  warnings: Array<{ code: string; message: string }>;
}

export interface DspackAuditValue {
  outcome: string;
  exitCode: number;
  report: unknown;
}
