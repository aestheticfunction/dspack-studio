import { describe, expect, it } from "vitest";
import { importFixture, MAX_IMPORT_BYTES } from "./import";
import { createRecorder } from "./recorder";

const good = () => {
  const r = createRecorder({ id: "s", name: "S", mode: "live", adapterId: "a", intent: "i", prompt: "p" });
  r.record({ type: "RUN_STARTED" });
  r.record({ type: "RUN_FINISHED" });
  return r.finish();
};

describe("importFixture (session import)", () => {
  it("round-trips a downloaded session (download -> import -> identical events)", () => {
    const fixture = good();
    const result = importFixture(JSON.stringify(fixture));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixture.events).toEqual(fixture.events);
      expect(result.fixture.mode).toBe("live");
      expect(result.imported).toBe(true);
    }
  });

  it("rejects non-JSON, non-fixture, and wrong-version documents with clear errors", () => {
    expect(importFixture("{nope")).toMatchObject({ ok: false, error: "not valid JSON" });
    expect((importFixture('{"a":1}') as any).error).toMatch(/missing the replayFixture version/);
    expect((importFixture(JSON.stringify({ ...good(), replayFixture: "9.9" })) as any).error).toMatch(/unsupported fixture version '9.9'/);
  });

  it("rejects malformed events and unknown modes", () => {
    expect((importFixture(JSON.stringify({ ...good(), events: [{ bad: true }] })) as any).error).toMatch(/event 0 is malformed/);
    expect((importFixture(JSON.stringify({ ...good(), mode: "handwritten" })) as any).error).toMatch(/not "live" or "scripted"/);
  });

  it("rejects oversized files without parsing them", () => {
    const result = importFixture("x", MAX_IMPORT_BYTES + 1);
    expect(result.ok).toBe(false);
    expect((result as any).error).toMatch(/limit 5 MB/);
  });
});
