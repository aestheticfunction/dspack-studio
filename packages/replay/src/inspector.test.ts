/**
 * Inspector reducers: state patches, data-model fold, action lifecycles,
 * and the event-category taxonomy — all pure prefix folds, so "no future
 * state at an earlier playhead" holds by construction (asserted anyway).
 */
import { describe, expect, it } from "vitest";
import { actionLifecyclesAt, dataModelAt, eventCategory, statePatchesAt } from "./player";
import type { EventSource } from "./player";

const dmResult = (id: string, ops: unknown[]) => ({
  type: "TOOL_CALL_RESULT",
  toolCallId: id,
  content: JSON.stringify({ a2ui_operations: ops }),
});
const DM = (path: string, value: unknown) => ({ version: "v0.9", updateDataModel: { surfaceId: "s", path, value } });

const source: EventSource = {
  events: [
    { atMs: 0, event: { type: "RUN_STARTED" } },
    { atMs: 5, event: dmResult("start", [DM("/booking", { name: "", slot: "", status: "Pick" })]) as any },
    { atMs: 10, event: { type: "CUSTOM", name: "studio.action.resolved", value: { actionId: "a1", originalName: "slot_1030", capability: "select_slot", method: "semantic:time-labeled-button" } } as any },
    { atMs: 11, event: { type: "CUSTOM", name: "studio.action.pending", value: { actionId: "a1", name: "slot_1030", capability: "select_slot" } } as any },
    { atMs: 40, event: dmResult("action-a1", [DM("/booking/name", "Ada"), DM("/booking/slot", "10:30"), DM("/booking/status", "Holding")]) as any },
    { atMs: 41, event: { type: "CUSTOM", name: "studio.action.accepted", value: { actionId: "a1", name: "slot_1030" } } as any },
    { atMs: 60, event: { type: "CUSTOM", name: "dspack.audit", value: { outcome: "passed", exitCode: 0, report: {} } } as any },
    { atMs: 70, event: { type: "RUN_FINISHED" } },
  ],
};
const last = source.events.length - 1;

describe("inspector reducers", () => {
  it("statePatchesAt orders patches and correlates them to their delivery", () => {
    const patches = statePatchesAt(source, last);
    expect(patches.map((p) => p.path)).toEqual(["/booking", "/booking/name", "/booking/slot", "/booking/status"]);
    expect(patches[1].via).toBe("action-a1");
  });

  it("dataModelAt folds patches; earlier playheads never see future state", () => {
    expect(dataModelAt(source, last)).toEqual({ booking: { name: "Ada", slot: "10:30", status: "Holding" } });
    expect(dataModelAt(source, 1)).toEqual({ booking: { name: "", slot: "", status: "Pick" } });
    expect(dataModelAt(source, 0)).toEqual({});
  });

  it("actionLifecyclesAt groups the full round-trip by correlation id", () => {
    const [lc] = actionLifecyclesAt(source, last);
    expect(lc.actionId).toBe("a1");
    expect(lc.capability).toBe("select_slot");
    expect(lc.states.map((s) => s.state)).toEqual(["resolved", "pending", "accepted"]);
    // At an earlier playhead the acceptance has not happened yet.
    expect(actionLifecyclesAt(source, 3)[0].states.map((s) => s.state)).toEqual(["resolved", "pending"]);
  });

  it("eventCategory separates user actions, agent responses, pipeline, and deliveries", () => {
    expect(eventCategory(source.events[2].event)).toBe("user-action");
    expect(eventCategory(source.events[5].event)).toBe("agent-response");
    expect(eventCategory(source.events[6].event)).toBe("pipeline");
    expect(eventCategory(source.events[1].event)).toBe("a2ui");
    expect(eventCategory(source.events[0].event)).toBe("run");
  });
});
