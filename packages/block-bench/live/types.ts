/**
 * Phase 1B live evaluation (docs/BLOCKS.md, ADR-B3 and ADR-B4): the record
 * of one evaluated cell. A cell is one prompt, under one condition, through
 * one arm, on one provider, against one reference. Everything the summary
 * and the decision rule read comes from these records, so a run can be
 * resumed, re-summarized and audited from its JSONL log alone.
 */
import type { ModelCallRecord } from "@dspack-studio/composer-core";
import type { BlockChoice } from "@dspack-studio/composer-core";

/**
 * The three arms ADR-B4 names, and the block arm in the positional encoding (ADR-B2: Phase 1B benchmarks named
 * against positional). The decision rule reads `block`, `capped` and `production` only.
 */
export type Arm = "block" | "block-positional" | "capped" | "production";
export const ARMS: readonly Arm[] = ["block", "block-positional", "capped", "production"];

/**
 * The conditions. `fresh` is a first build. The refinements run on top of
 * the SAME arm's fresh result for the same prompt, so each arm refines what
 * it built. The positional encoding is an arm, not a condition: the
 * block-positional arm runs every condition with the compact call.
 */
export type Condition = "fresh" | "refine-content" | "refine-add" | "refine-remove" | "refine-structural";
export const CONDITIONS: readonly Condition[] = ["fresh", "refine-content", "refine-add", "refine-remove", "refine-structural"];
export const REFINEMENTS = ["refine-content", "refine-add", "refine-remove", "refine-structural"] as const satisfies readonly Condition[];

export type RefinementKind = "content" | "add" | "remove" | "structural";
export const REFINEMENT_KIND: Record<(typeof REFINEMENTS)[number], RefinementKind> = {
  "refine-content": "content",
  "refine-add": "add",
  "refine-remove": "remove",
  "refine-structural": "structural",
};

/** Which code path a run took; stratification keys for ADR-B4 fairness. `planning-failure`: the planning call failed and the cell ended before generation. */
export type Path = "block" | "block-repair" | "fallback" | "primitive" | "switch" | "provider-failure" | "invariant" | "planning-failure";

export type FailureKind = "provider" | "output" | "policy" | "budget" | "unknown";

export interface RunKey {
  reference: string;
  provider: string;
  arm: Arm;
  prompt: string;
  condition: Condition;
}

export const cellId = (key: RunKey): string => `${key.reference}|${key.provider}|${key.arm}|${key.prompt}|${key.condition}`;

/** A cell's latency figures, in milliseconds. */
export interface LatencyFigures {
  planMs?: number;
  blockPhaseMs?: number;
  firstGatedAttemptMs?: number;
  emitMs?: number;
  totalMs: number;
}

/**
 * The figures above are wall-clock time, which includes the harness's own pacing: the spacing and backoff waits the
 * hosted pacer sleeps through between requests. `pacingMs` is that wait inside the cell, measured by the pacer on the
 * cell's clock (0 where nothing paces), and `execution` holds the same figures with it taken out: the cell's own work,
 * the provider's time, and the harness's bookkeeping around each request (its ledger line and lock check).
 */
export interface RunTimings extends LatencyFigures {
  pacingMs?: number;
  execution?: LatencyFigures;
}

/**
 * What a passing add or remove refinement did to the surface's lists (live/operation.ts), each judged on its own: `add`
 * when a list grew and none shrank, `remove` the reverse, `mixed` both ways, `none` when no list changed length. `deltas`
 * holds each list that changed, by where it sits, and by how much.
 */
export interface OperationCheck {
  requested: "add" | "remove";
  observed: "add" | "remove" | "mixed" | "none";
  deltas: Record<string, number>;
}

export interface ParityResult {
  /** Satisfied checks over all checks, 0..1. */
  score: number;
  satisfied: string[];
  missing: string[];
}

export interface RunRecord extends RunKey {
  /** ISO time the cell finished. */
  at: string;
  expected: { intent: string; block: string | null };
  /**
   * Planning: what the arm routed to, and what it cost. A refinement reuses the fresh plan and reports no plan call.
   * `failure` marks a failed planning call. On an unusable output the cell routed deterministically, as the app does;
   * on a provider or policy failure the cell ended there, so it has no intent.
   */
  plan?: { intent?: string; source?: string; block?: BlockChoice; calls: ModelCallRecord[]; bytes: number; durationMs: number; failure?: { kind: FailureKind; message: string } };
  /** Selection accuracy (block arm, fresh): the planner's answer against the corpus label. `planningFailed`: the planner gave no answer. */
  selection?: { chosen: string | null; source: "model" | "deterministic" | "omitted"; rejected?: string; planningFailed?: true; correct: boolean };
  status: "completed" | "skipped";
  skipReason?: string;
  /** The audit outcome (passed, failed-lint-exhausted, failed-gate, failed-adapter), the Composer-side invariant-failure, or the harness's planning-failure. */
  outcome?: string;
  passed: boolean;
  attempts: number;
  path?: Path;
  /** Budget left when a block-mode run fell back to primitive generation. */
  budgetRemainingAtFallback?: number;
  /** The frozen block trace (block arm). */
  trace?: Record<string, unknown>;
  calls: ModelCallRecord[];
  /**
   * Provider-reported figures. `unreportedCalls` counts provider calls missing EITHER figure: a run with one
   * leaves the ADR-B3 token cohort, so a missing figure is never summed as zero.
   */
  tokens: { input: number; output: number; providerCalls: number; unreportedCalls: number; modelFreeCalls: number };
  /** Request bodies sent, in bytes (every call, the planning call included). */
  requestBytes: number;
  timings: RunTimings;
  parity?: ParityResult;
  /** Whether a refinement changed the surface at all (non-vacuity). */
  changed?: boolean;
  /** A passing add or remove refinement: whether its surface changed the way it asked. A measurement, never the pass. */
  operation?: OperationCheck;
  failure?: { kind: FailureKind; message: string; rerunEligible: boolean };
  refinement?: { mode: "compact" | "switch" | "primitive"; retained: boolean; reason?: string };
  surfaceDigest?: string;
  /** The passing surface, kept so a refinement can seed from it and a reader can audit parity. */
  surface?: unknown;
}

export interface PriorResult {
  goal: string;
  record: RunRecord;
  surface: Record<string, unknown>;
  progress: Record<string, unknown>;
  plan: { intent: string; source: string; block?: BlockChoice };
}
