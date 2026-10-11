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
