import { describe, expect, it } from "vitest";
import { EventType, type BaseEvent } from "@ag-ui/core";
import { FixtureAgent } from "./fixture-agent";

const fixture = {
  replayFixture: "0.1",
  events: [
    { atMs: 0, event: { type: "RUN_STARTED", threadId: "recorded-t", runId: "recorded-r" } },
    { atMs: 5, event: { type: "CUSTOM", name: "dspack.run.start", value: {} } },
    { atMs: 9000, event: { type: "RUN_FINISHED", threadId: "recorded-t", runId: "recorded-r" } },
  ],
};

describe("FixtureAgent", () => {
  it("replays the stream instantly at speed 0, re-stamped with the caller's run identity, and completes", async () => {
    const agent = new FixtureAgent(fixture, { speed: 0 });
    const events: BaseEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      agent
        .run({ threadId: "live-t", runId: "live-r", messages: [], tools: [], context: [], state: {} } as any)
        .subscribe({ next: (e) => events.push(e), complete: resolve, error: reject });
    });
    expect(events.map((e) => e.type)).toEqual([EventType.RUN_STARTED, EventType.CUSTOM, EventType.RUN_FINISHED]);
    expect((events[0] as any).runId).toBe("live-r");
    expect((events[2] as any).threadId).toBe("live-t");
  });

  it("caps long recorded gaps (the 9s model pause stays watchable)", async () => {
    const agent = new FixtureAgent(fixture, { speed: 1, maxGapMs: 50 });
    const t0 = Date.now();
    await new Promise<void>((resolve, reject) => {
      agent
        .run({ threadId: "t", runId: "r", messages: [], tools: [], context: [], state: {} } as any)
        .subscribe({ complete: resolve, error: reject });
    });
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
