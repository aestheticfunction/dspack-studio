/**
 * Timeline-engine tests, driven through the REAL bridge mapper (devDependency)
 * so the reducers are proven against the exact event shapes the agent emits —
 * not hand-rolled approximations.
 */
import { describe, expect, it } from "vitest";
import { createPipelineEventMapper, type PipelineEvent } from "@dspack-studio/agui-bridge";
import { createRecorder } from "./recorder";
import { a2uiMessagesAt, gateStateAt, timelineTicks } from "./player";
import { parseFixture } from "./fixture";

const RUN: PipelineEvent[] = [
  { type: "start", intent: "destructive-action", prompt: "delete it", adapterId: "fake:scripted", ruleIds: ["rule.x"] },
  { type: "attempt", index: 0, surface: {}, gates: [{ gate: "S3", status: "FAIL" }], findings: [{ ruleId: "rule.x" }] },
  { type: "repair", index: 0, message: "fix rule.x" },
  { type: "attempt", index: 1, surface: {}, gates: [{ gate: "S3", status: "PASS" }], findings: [] },
  { type: "emitted", validations: [], warnings: [] },
  {
    type: "done",
    outcome: "passed",
    exitCode: 0,
    report: {},
    surfaceMessages: {
      messages: [
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "c" } },
        { version: "v0.9", updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Card" }] } },
      ],
    },
  },
];

function recordRun() {
  const map = createPipelineEventMapper({ threadId: "t", runId: "r" });
  let t = 0;
  const recorder = createRecorder({
    id: "fx-test",
    name: "test run",
    mode: "scripted",
    adapterId: "fake:scripted",
    intent: "destructive-action",
    prompt: "delete it",
    now: () => (t += 10),
  });
  for (const e of RUN) for (const agui of map(e)) recorder.record(agui as any);
  return parseFixture(recorder.finish());
}

describe("replay player (FM-2 timeline engine)", () => {
  const fixture = recordRun();
  const last = fixture.events.length - 1;

  it("records a parseable 0.1 fixture with monotonic timings", () => {
    expect(fixture.replayFixture).toBe("0.1");
    const times = fixture.events.map((e) => e.atMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("a2uiMessagesAt is empty before delivery and complete at the end", () => {
    expect(a2uiMessagesAt(fixture, 0)).toHaveLength(0);
    const ops = a2uiMessagesAt(fixture, last);
    expect(ops).toHaveLength(2);
    expect((ops[0] as any).createSurface.surfaceId).toBe("s");
  });

  it("gateStateAt folds attempts, repair, and audit at the playhead", () => {
    const mid = gateStateAt(fixture, Math.floor(last / 2));
    expect(mid.started).toBe(true);
    expect(mid.finished).toBe(false);

    const end = gateStateAt(fixture, last);
    expect(end.finished).toBe(true);
    expect(end.attempts).toHaveLength(2);
    expect(end.attempts[0].repairMessage).toBe("fix rule.x");
    expect(end.attempts[0].gates[0].status).toBe("FAIL");
    expect(end.attempts[1].gates[0].status).toBe("PASS");
    expect(end.audit?.exitCode).toBe(0);
  });

  it("timelineTicks classifies the failing and passing gate events distinctly", () => {
    const ticks = timelineTicks(fixture);
    const kinds = ticks.map((t) => t.kind);
    expect(kinds).toContain("gates-fail");
    expect(kinds).toContain("gates-pass");
    expect(kinds).toContain("repair");
    expect(kinds).toContain("a2ui");
    expect(kinds).toContain("audit");
    expect(kinds[0]).toBe("lifecycle");
    expect(kinds[kinds.length - 1]).toBe("lifecycle");
  });

  it("scrubbing backward reconstructs the pre-repair state (the FM-2 claim)", () => {
    // Find the index of the failing gates event; before the second attempt the
    // fold must show exactly one attempt with its violation, no audit.
    const failIdx = fixture.events.findIndex(
      (e) => (e.event as any).name === "dspack.gates" && (e.event as any).value.index === 0,
    );
    const state = gateStateAt(fixture, failIdx);
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0].findings[0].ruleId).toBe("rule.x");
    expect(state.audit).toBeUndefined();
    expect(a2uiMessagesAt(fixture, failIdx)).toHaveLength(0);
  });
});
