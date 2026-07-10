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

/**
 * Interaction-layer events (HITL round-trips). Deliberately a separate
 * namespace from dspack.* — pipeline events describe governed generation;
 * studio.action.* describe what the USER did and how the agent answered.
 * Every state carries the same correlation `actionId`, so the timeline shows
 * the full round-trip and replays reconstruct it.
 */
export const STUDIO_EVENT = {
  actionPending: "studio.action.pending",
  actionAccepted: "studio.action.accepted",
  actionRejected: "studio.action.rejected",
  actionCancelled: "studio.action.cancelled",
  actionFailed: "studio.action.failed",
} as const;

export interface StudioActionValue {
  actionId: string;
  /** The A2UI action name (e.g. "select_slot") and its context payload. */
  name: string;
  surfaceId?: string;
  sourceComponentId?: string;
  context?: Record<string, unknown>;
  /** accepted/rejected/failed: human-readable detail (validation errors etc.). */
  detail?: string;
}

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
