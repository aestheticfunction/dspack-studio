/**
 * FM-3 fork semantics, driven through a real recorded fixture: a fork copies
 * exactly the prefix, gets its own identity plus parent provenance, never
 * mutates the parent, and moments with no delivered surface are rejected
 * with the reason stated.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forkFixture, unforkableReason } from "./fork";
import { parseFixture } from "./fixture";
import { a2uiMessagesAt } from "./player";

const parent = parseFixture(
  JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "fixture-001.json"), "utf8")),
);
const last = parent.events.length - 1;
// The first index at which a surface exists (the delivery).
const deliveryIndex = parent.events.findIndex((e) => e.event.type === "TOOL_CALL_RESULT");

describe("forkFixture", () => {
  it("copies exactly the prefix and carries parent provenance", () => {
    const result = forkFixture(parent, deliveryIndex);
    if (!result.ok) throw new Error(result.reason);
    const fork = result.fixture;

    expect(fork.events).toHaveLength(deliveryIndex + 1);
    expect(fork.events).toEqual(parent.events.slice(0, deliveryIndex + 1));
    expect(fork.id).not.toBe(parent.id);
    expect(fork.fork).toMatchObject({ parentId: parent.id, forkIndex: deliveryIndex });
    expect(fork.name).toContain(`forked at event ${deliveryIndex}`);
    expect(fork.mode).toBe(parent.mode); // provenance label survives the fork
    // The forked prefix folds to the same surface as the parent at that moment.
    expect(a2uiMessagesAt(fork, deliveryIndex)).toEqual(a2uiMessagesAt(parent, deliveryIndex));
  });

  it("never mutates the parent: appending to the fork leaves the source untouched", () => {
    const before = JSON.stringify(parent);
    const result = forkFixture(parent, last);
    if (!result.ok) throw new Error(result.reason);
    result.fixture.events.push({ atMs: 99999, event: { type: "CUSTOM", name: "diverged" } });
    (result.fixture.events[0].event as any).type = "MUTATED";
    expect(JSON.stringify(parent)).toBe(before);
  });

  it("round-trips through the fixture format (export -> parse keeps provenance)", () => {
    const result = forkFixture(parent, last);
    if (!result.ok) throw new Error(result.reason);
    const reparsed = parseFixture(JSON.parse(JSON.stringify(result.fixture)));
    expect(reparsed.fork?.parentId).toBe(parent.id);
    expect(reparsed.fork?.forkIndex).toBe(last);
  });

  it("rejects moments with no delivered surface, with the reason stated", () => {
    expect(unforkableReason(parent, -1)).toMatch(/nothing has happened/);
    expect(unforkableReason(parent, last + 1)).toMatch(/does not exist/);
    // Every event before the delivery has no surface yet.
    const early = forkFixture(parent, deliveryIndex - 1);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.reason).toMatch(/no surface has been delivered/);
    // And from the delivery onward, forking is allowed.
    expect(unforkableReason(parent, deliveryIndex)).toBeNull();
    expect(unforkableReason(parent, last)).toBeNull();
  });
});
