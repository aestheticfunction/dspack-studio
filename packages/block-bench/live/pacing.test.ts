import { describe, expect, it } from "vitest";
import { PacingCapReached, createPacer } from "./pacing";

describe("pacing for the shared gateway", () => {
  it("spaces requests, counts them, and stops cleanly at the cap", async () => {
    let clock = 0;
    const slept: number[] = [];
    const pacer = createPacer({ maxRequests: 3, spacingMs: 1000, now: () => clock, sleep: async (ms) => void (slept.push(ms), (clock += ms)) });
    await pacer.before();
    clock += 200;
    await pacer.before();
    expect(slept).toEqual([800]);
    await pacer.before();
    await expect(pacer.before()).rejects.toBeInstanceOf(PacingCapReached);
    expect(pacer.sent).toBe(3);
    expect(pacer.waits.map((w) => w.reason)).toEqual(["spacing", "spacing"]);
  });

  it("holds the run's cumulative cap across invocations: each request is recorded before it is sent, and a resumed invocation starts from the run's count", async () => {
    const recorded: string[] = [];
    const events: string[] = [];
    const ledger = (sent: number) => ({
      cap: 30,
      sent,
      record() {
        recorded.push("request");
        events.push("recorded");
        this.sent += 1;
      },
    });
    const invocation = () => createPacer({ maxRequests: 300, spacingMs: 0, now: () => 0, sleep: async () => undefined });
    const first = invocation();
    first.ledger = ledger(0);
    first.reserve(20);
    for (let i = 0; i < 20; i++) {
      await first.before();
      events.push("sent");
    }
    expect(events.slice(0, 2)).toEqual(["recorded", "sent"]);
    // Well inside this invocation's own cap of 300, but 20 more would pass the run's 30.
    expect(() => first.reserve(20)).toThrow(PacingCapReached);
    for (let i = 0; i < 10; i++) await first.before();
    await expect(first.before()).rejects.toMatchObject({ cap: 30, scope: "run" });
    expect(recorded).toHaveLength(30);
    // A resume is a new process with a new pacer: its own count starts at zero, the run's does not.
    const resumed = invocation();
    resumed.ledger = ledger(recorded.length);
    expect(resumed.sent).toBe(0);
    expect(() => resumed.reserve(1)).toThrow(PacingCapReached);
    await expect(resumed.before()).rejects.toMatchObject({ scope: "run" });
    expect(recorded).toHaveLength(30);
  });

  it("backs off on a refusal along the schedule, reports every wait, and gives up when the schedule is spent", async () => {
    const slept: number[] = [];
    const pacer = createPacer({ maxRequests: 10, spacingMs: 0, backoffMs: [10, 20], now: () => 0, sleep: async (ms) => void slept.push(ms) });
    expect(await pacer.backoff(0, "503 busy")).toBe(true);
    expect(await pacer.backoff(1, "503 busy")).toBe(true);
    expect(await pacer.backoff(2, "503 busy")).toBe(false);
    expect(slept).toEqual([10, 20]);
    expect(pacer.waits.map((w) => w.ms)).toEqual([10, 20]);
  });
});
