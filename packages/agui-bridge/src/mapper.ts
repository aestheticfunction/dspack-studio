/**
 * The protocol translation, implemented once: dspack-gen PipelineEvent ->
 * AG-UI events.
 *
 *   start     -> RUN_STARTED + CUSTOM dspack.run.start
 *   attempt n -> STEP_STARTED("attempt-n") + CUSTOM dspack.gates + STEP_FINISHED
 *   repair    -> CUSTOM dspack.repair (the exact repair message, verbatim)
 *   emitted   -> CUSTOM dspack.emit (A-gate validations + all warnings)
 *   done      -> [surface messages as a generate_a2ui tool call whose RESULT
 *                 carries the a2ui-toolkit operations envelope]
 *                + CUSTOM dspack.audit + RUN_FINISHED
 *
 * A pipeline failure (non-zero exit) is a completed run with a failing audit
 * — RUN_ERROR is reserved for thrown exceptions (transport/internal errors),
 * mirroring dspack-gen's own "failures are first-class artifacts" discipline.
 *
 * The A2UI delivery uses @ag-ui/a2ui-toolkit's standard envelope
 * (A2UI_OPERATIONS_KEY inside a tool result for GENERATE_A2UI_TOOL_NAME), so
 * the stream stays legible to dojo-style consumers and CopilotKit's A2UI
 * middleware.
 */
import { EventType, type BaseEvent } from "@ag-ui/core";
import { GENERATE_A2UI_TOOL_NAME, wrapAsOperationsEnvelope } from "@ag-ui/a2ui-toolkit";
import type { PipelineEvent } from "./pipeline-types";
import { DSPACK_EVENT } from "./custom-events";

export interface MapperIds {
  threadId: string;
  runId: string;
}

const custom = (name: string, value: unknown): BaseEvent =>
  ({ type: EventType.CUSTOM, name, value }) as BaseEvent;

/**
 * Create a stateful mapper for one run. Stateful only for deterministic
 * tool-call/message id generation within the run.
 */
export function createPipelineEventMapper(ids: MapperIds) {
  let toolCalls = 0;

  return function mapPipelineEvent(event: PipelineEvent): BaseEvent[] {
    switch (event.type) {
      case "start":
        return [
          { type: EventType.RUN_STARTED, threadId: ids.threadId, runId: ids.runId } as BaseEvent,
          custom(DSPACK_EVENT.runStart, {
            intent: event.intent,
            prompt: event.prompt,
            adapterId: event.adapterId,
            ruleIds: event.ruleIds,
          }),
        ];

      case "attempt": {
        const stepName = `attempt-${event.index}`;
        return [
          { type: EventType.STEP_STARTED, stepName } as BaseEvent,
          custom(DSPACK_EVENT.gates, {
            index: event.index,
            model: event.model,
            surface: event.surface,
            gates: event.gates,
            findings: event.findings,
          }),
          { type: EventType.STEP_FINISHED, stepName } as BaseEvent,
        ];
      }

      case "repair":
        return [custom(DSPACK_EVENT.repair, { index: event.index, message: event.message })];

      case "emitted":
        return [custom(DSPACK_EVENT.emit, { validations: event.validations, warnings: event.warnings })];

      case "done": {
        const events: BaseEvent[] = [];
        const messages = (event.surfaceMessages as { messages?: unknown[] } | undefined)?.messages;
        if (Array.isArray(messages) && messages.length > 0) {
          const toolCallId = `${ids.runId}-a2ui-${toolCalls++}`;
          const args = JSON.stringify({
            surfaceId:
              (messages[0] as any)?.createSurface?.surfaceId ??
              (messages[0] as any)?.updateComponents?.surfaceId ??
              "surface",
          });
          events.push(
            { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: GENERATE_A2UI_TOOL_NAME } as BaseEvent,
            { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: args } as BaseEvent,
            { type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent,
            {
              type: EventType.TOOL_CALL_RESULT,
              messageId: `${toolCallId}-result`,
              toolCallId,
              content: wrapAsOperationsEnvelope(messages as Array<Record<string, unknown>>),
            } as BaseEvent,
          );
        }
        events.push(
          custom(DSPACK_EVENT.audit, { outcome: event.outcome, exitCode: event.exitCode, report: event.report }),
          { type: EventType.RUN_FINISHED, threadId: ids.threadId, runId: ids.runId } as BaseEvent,
        );
        return events;
      }
    }
  };
}

/**
 * The A2UI delivery quartet for an arbitrary op list — used by the mapper's
 * `done` branch and by interaction responses (scenario starts, HITL action
 * results), so every A2UI delivery in the stream has the identical shape.
 */
export function a2uiDeliveryEvents(ops: Array<Record<string, unknown>>, toolCallId: string): BaseEvent[] {
  const surfaceId =
    (ops[0] as any)?.createSurface?.surfaceId ??
    (ops[0] as any)?.updateComponents?.surfaceId ??
    (ops[0] as any)?.updateDataModel?.surfaceId ??
    "surface";
  return [
    { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: GENERATE_A2UI_TOOL_NAME } as BaseEvent,
    { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify({ surfaceId }) } as BaseEvent,
    { type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent,
    {
      type: EventType.TOOL_CALL_RESULT,
      messageId: `${toolCallId}-result`,
      toolCallId,
      content: wrapAsOperationsEnvelope(ops),
    } as BaseEvent,
  ];
}

/** RUN_ERROR for thrown exceptions (never for pipeline outcomes). */
export function runErrorEvent(message: string, code?: string): BaseEvent {
  return { type: EventType.RUN_ERROR, message, ...(code ? { code } : {}) } as BaseEvent;
}
