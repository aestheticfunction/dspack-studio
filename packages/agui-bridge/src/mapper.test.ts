import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import { A2UI_OPERATIONS_KEY, GENERATE_A2UI_TOOL_NAME } from "@ag-ui/a2ui-toolkit";
import { createPipelineEventMapper } from "./mapper";
import { DSPACK_EVENT } from "./custom-events";
import type { PipelineEvent } from "./pipeline-types";

const IDS = { threadId: "t1", runId: "r1" };

/** A representative pipeline run: violation -> repair -> clean -> emitted -> done. */
const RUN: PipelineEvent[] = [
  { type: "start", intent: "destructive-action", prompt: "delete it", adapterId: "fake:scripted", ruleIds: ["rule.destructive-requires-alertdialog"] },
  { type: "attempt", index: 0, model: "fake-model", surface: { root: {} }, gates: [{ gate: "S3", status: "FAIL" }], findings: [{ ruleId: "rule.destructive-requires-alertdialog", message: "violation" }] },
  { type: "repair", index: 0, message: "Your surface violated rule.destructive-requires-alertdialog…" },
  { type: "attempt", index: 1, model: "fake-model", surface: { root: {} }, gates: [{ gate: "S3", status: "PASS" }], findings: [] },
  { type: "emitted", validations: [{ a2uiVersion: "0.9.1", gates: [] }], warnings: [{ code: "surface-synthesized-action", message: "synthesized" }] },
  {
    type: "done",
    outcome: "passed",
    exitCode: 0,
    report: { reportVersion: 1 },
    surfaceMessages: {
      messages: [
        { version: "v0.9", createSurface: { surfaceId: "destructive_action", catalogId: "https://x/catalog.json" } },
        { version: "v0.9", updateComponents: { surfaceId: "destructive_action", components: [{ id: "root", component: "Card" }] } },
      ],
    },
  },
];

describe("createPipelineEventMapper", () => {
  it("maps the full run onto the documented AG-UI event sequence", () => {
    const map = createPipelineEventMapper(IDS);
    const events = RUN.flatMap((e) => map(e));
    const types = events.map((e) => e.type);

    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
    // Two attempts -> two STEP pairs.
    expect(types.filter((t) => t === EventType.STEP_STARTED)).toHaveLength(2);
    expect(types.filter((t) => t === EventType.STEP_FINISHED)).toHaveLength(2);
    // The tool-call quartet is present, in order.
    const quartet = [EventType.TOOL_CALL_START, EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_END, EventType.TOOL_CALL_RESULT];
    const start = types.indexOf(EventType.TOOL_CALL_START);
    expect(types.slice(start, start + 4)).toEqual(quartet);

    const names = events.filter((e) => e.type === EventType.CUSTOM).map((e: any) => e.name);
    expect(names).toEqual([
      DSPACK_EVENT.runStart,
      DSPACK_EVENT.gates,
      DSPACK_EVENT.repair,
      DSPACK_EVENT.gates,
      DSPACK_EVENT.emit,
      DSPACK_EVENT.audit,
    ]);
  });

  it("carries the verbatim repair message and rationale-bearing findings", () => {
    const map = createPipelineEventMapper(IDS);
    const events = RUN.flatMap((e) => map(e));
    const repair: any = events.find((e: any) => e.name === DSPACK_EVENT.repair);
    expect(repair.value.message).toMatch(/rule.destructive-requires-alertdialog/);
    const gates: any = events.find((e: any) => e.name === DSPACK_EVENT.gates);
    expect(gates.value.findings[0].ruleId).toBe("rule.destructive-requires-alertdialog");
  });

  it("delivers surface messages as the a2ui-toolkit operations envelope on a generate_a2ui tool result", () => {
    const map = createPipelineEventMapper(IDS);
    const events = RUN.flatMap((e) => map(e));
    const startEvt: any = events.find((e) => e.type === EventType.TOOL_CALL_START);
    expect(startEvt.toolCallName).toBe(GENERATE_A2UI_TOOL_NAME);
    const result: any = events.find((e) => e.type === EventType.TOOL_CALL_RESULT);
    const envelope = JSON.parse(result.content);
    expect(Array.isArray(envelope[A2UI_OPERATIONS_KEY])).toBe(true);
    expect(envelope[A2UI_OPERATIONS_KEY]).toHaveLength(2);
    expect(envelope[A2UI_OPERATIONS_KEY][0].createSurface.surfaceId).toBe("destructive_action");
  });

  it("a failed run is a completed run (RUN_FINISHED with failing audit), not RUN_ERROR", () => {
    const map = createPipelineEventMapper(IDS);
    const events = map({ type: "done", outcome: "failed-lint-exhausted", exitCode: 2, report: {} });
    expect(events.map((e) => e.type)).toEqual([EventType.CUSTOM, EventType.RUN_FINISHED]);
    expect((events[0] as any).value.exitCode).toBe(2);
  });
});
