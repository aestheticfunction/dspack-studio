/**
 * The timeline engine (FM-2): pure reducers over an event prefix. Because the
 * UI is an ordered event stream applied to a declarative model, the state at
 * any playhead is a fold over events[0..playhead] — every scrubber frame is a
 * real, coherent application state, reconstructed rather than approximated.
 *
 * Pure data in, pure data out: no @ag-ui, no @a2ui imports. The A2UI message
 * prefix goes to A2uiCanvas for rendering; the gate state goes to the ticker
 * and the inspector.
 */
import type { FixtureEvent, ReplayFixture } from "./fixture";

/**
 * Any ordered event source: a parsed fixture, or a live run accumulating
 * events into the same shape (which makes live runs scrubbable for free).
 */
export type EventSource = Pick<ReplayFixture, "events">;

/** AG-UI wire type strings this package understands (kept minimal). */
const T = {
  runStarted: "RUN_STARTED",
  runFinished: "RUN_FINISHED",
  runError: "RUN_ERROR",
  stepStarted: "STEP_STARTED",
  stepFinished: "STEP_FINISHED",
  toolCallStart: "TOOL_CALL_START",
  toolCallResult: "TOOL_CALL_RESULT",
  custom: "CUSTOM",
} as const;

const DSPACK = {
  runStart: "dspack.run.start",
  gates: "dspack.gates",
  repair: "dspack.repair",
  emit: "dspack.emit",
  audit: "dspack.audit",
} as const;

const A2UI_OPERATIONS_KEY = "a2ui_operations";

/** Events at or before the playhead (inclusive index into fixture.events). */
export function eventsUpTo(fixture: EventSource, playhead: number): FixtureEvent[] {
  return fixture.events.slice(0, Math.max(0, Math.min(playhead + 1, fixture.events.length)));
}

/**
 * The A2UI message prefix at a playhead: every operation delivered in
 * generate_a2ui tool results so far, in order. Feed directly to A2uiCanvas.
 */
export function a2uiMessagesAt(fixture: EventSource, playhead: number): unknown[] {
  const ops: unknown[] = [];
  for (const { event } of eventsUpTo(fixture, playhead)) {
    if (event.type !== T.toolCallResult) continue;
    const content = (event as any).content;
    if (typeof content !== "string") continue;
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed?.[A2UI_OPERATIONS_KEY])) ops.push(...parsed[A2UI_OPERATIONS_KEY]);
    } catch {
      // Non-JSON tool results are not A2UI deliveries; skip.
    }
  }
  return ops;
}

export interface GateLike {
  gate: string;
  /** S-gates: "PASS" | "FAIL" | "SKIPPED". */
  status?: string;
  /** A-gates: boolean. */
  pass?: boolean;
  [k: string]: unknown;
}

/** True when a gate report (either dspack-gen shape) records a failure. */
export function gateFailed(gate: GateLike): boolean {
  return gate.status === "FAIL" || gate.pass === false;
}

export interface AttemptState {
  index: number;
  model?: string;
  surface: unknown;
  gates: GateLike[];
  findings: Array<Record<string, unknown>>;
  repairMessage?: string;
}

export interface GateState {
  started: boolean;
  finished: boolean;
  errored: boolean;
  runStart?: { intent: string; prompt: string; adapterId: string; ruleIds: string[] };
  attempts: AttemptState[];
  emit?: { validations: unknown[]; warnings: Array<{ code: string; message: string }> };
  audit?: { outcome: string; exitCode: number; report: unknown };
}

/** Fold the CUSTOM/lifecycle events up to the playhead into inspector state. */
export function gateStateAt(fixture: EventSource, playhead: number): GateState {
  const state: GateState = { started: false, finished: false, errored: false, attempts: [] };
  for (const { event } of eventsUpTo(fixture, playhead)) {
    switch (event.type) {
      case T.runStarted:
        state.started = true;
        break;
      case T.runFinished:
        state.finished = true;
        break;
      case T.runError:
        state.errored = true;
        break;
      case T.custom: {
        const name = (event as any).name;
        const value = (event as any).value;
        if (name === DSPACK.runStart) state.runStart = value;
        else if (name === DSPACK.gates) state.attempts.push({ ...value });
        else if (name === DSPACK.repair) {
          const attempt = state.attempts.find((a) => a.index === value.index);
          if (attempt) attempt.repairMessage = value.message;
        } else if (name === DSPACK.emit) state.emit = value;
        else if (name === DSPACK.audit) state.audit = value;
        break;
      }
    }
  }
  return state;
}

export type TickKind =
  | "lifecycle"
  | "step"
  | "gates-pass"
  | "gates-fail"
  | "repair"
  | "emit"
  | "a2ui"
  | "audit"
  | "other";

export interface TimelineTick {
  index: number;
  atMs: number;
  kind: TickKind;
  label: string;
}

/** One tick per event, classified for the scrubber's coloring. */
export function timelineTicks(fixture: EventSource): TimelineTick[] {
  return fixture.events.map(({ atMs, event }, index) => {
    let kind: TickKind = "other";
    let label = String(event.type);
    if (event.type === T.runStarted || event.type === T.runFinished || event.type === T.runError) {
      kind = "lifecycle";
    } else if (event.type === T.stepStarted || event.type === T.stepFinished) {
      kind = "step";
      label = `${event.type} ${(event as any).stepName ?? ""}`.trim();
    } else if (event.type === T.toolCallStart || event.type === T.toolCallResult) {
      kind = "a2ui";
      label = `${event.type} ${(event as any).toolCallName ?? ""}`.trim();
    } else if (event.type === T.custom) {
      const name = (event as any).name as string;
      label = name;
      if (name === DSPACK.gates) {
        const gates = (event as any).value?.gates as GateLike[] | undefined;
        kind = gates?.some(gateFailed) ? "gates-fail" : "gates-pass";
      } else if (name === DSPACK.repair) kind = "repair";
      else if (name === DSPACK.emit) kind = "emit";
      else if (name === DSPACK.audit) kind = "audit";
    }
    return { index, atMs, kind, label };
  });
}
