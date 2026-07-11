/**
 * FM-12 receipt semantics, proven on real recorded fixtures: the canonical
 * form reproduces byte-for-byte from the same events, tolerates the two
 * environment-dependent fields, and every tamper is a loud mismatch —
 * never silent acceptance.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFixture } from "./fixture";
import { buildReceipt, canonicalReceiptString, verifyReceipt } from "./receipt";

const load = (name: string) => parseFixture(JSON.parse(readFileSync(join(__dirname, "..", "fixtures", name), "utf8")));
const f001 = load("fixture-001.json");
const f006 = load("fixture-006.json");

describe("audit receipts", () => {
  it("builds from the event stream with report, outcome, and provenance", async () => {
    const r = await buildReceipt(f001, { id: f001.id, name: f001.name, mode: f001.mode, adapterId: f001.adapterId, intent: f001.intent, prompt: f001.prompt, recordedAt: f001.recordedAt });
    expect(r).not.toBeNull();
    expect(r!.outcome).toBe("passed");
    expect((r!.report as any).attempts.length).toBeGreaterThan(1); // the two-repair run
    expect(r!.session.mode).toBe("live");
    expect(r!.canonicalSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("replaying the same events reproduces the same canonical hash", async () => {
    const a = await buildReceipt(f006, { intent: f006.intent, prompt: f006.prompt });
    const b = await buildReceipt(structuredClone(f006), { intent: f006.intent, prompt: f006.prompt });
    expect(a!.canonicalSha256).toBe(b!.canonicalSha256);
    const verdict = await verifyReceipt(f006, a);
    expect(verdict.status).toBe("match");
  });

  it("the canonical boundary excludes exactly createdAt and timings", async () => {
    const r = await buildReceipt(f001, {});
    const drifted = structuredClone(r!);
    (drifted.report as any).createdAt = "2099-01-01T00:00:00.000Z";
    (drifted.report as any).timings = { totalMs: 999999 };
    // Environment-dependent drift alone does not change the canonical form…
    expect(canonicalReceiptString(drifted.intent, drifted.prompt, drifted.report)).toBe(
      canonicalReceiptString(r!.intent, r!.prompt, r!.report),
    );
    expect((await verifyReceipt(f001, drifted)).status).toBe("match");
  });

  it("tampering with governance content is a loud mismatch, and an edited hash is invalid", async () => {
    const r = await buildReceipt(f001, {});
    const tampered = structuredClone(r!);
    (tampered.report as any).outcome = "passed-with-flying-colors";
    // The receipt no longer matches its own hash: invalid, with the reason.
    const inconsistent = await verifyReceipt(f001, tampered);
    expect(inconsistent.status).toBe("invalid");
    // A receipt whose hash was recomputed after tampering is a MISMATCH.
    const { sha256Hex, canonicalReceiptString: canon } = await import("./receipt");
    tampered.canonicalSha256 = await sha256Hex(canon(tampered.intent, tampered.prompt, tampered.report));
    const verdict = await verifyReceipt(f001, tampered);
    expect(verdict.status).toBe("mismatch");
    // A receipt from a DIFFERENT run mismatches too.
    const other = await buildReceipt(f006, { intent: f006.intent, prompt: f006.prompt });
    expect((await verifyReceipt(f001, other)).status).toBe("mismatch");
    // Garbage is named as such.
    expect((await verifyReceipt(f001, { hello: 1 })).status).toBe("invalid");
  });
});
