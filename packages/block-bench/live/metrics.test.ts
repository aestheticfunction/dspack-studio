import { describe, expect, it } from "vitest";
import { armStats, decide, median, selectionStats, summarize } from "./metrics";
import type { Arm, Condition, RunRecord } from "./types";

type Partial = { arm: Arm; passed: boolean; tokens?: [number, number]; unreported?: number; attempts?: number; failure?: RunRecord["failure"]; selection?: RunRecord["selection"]; expectedBlock?: string | null; condition?: Condition; path?: RunRecord["path"]; refinement?: RunRecord["refinement"]; changed?: boolean; status?: RunRecord["status"] };

let seq = 0;
function record(p: Partial): RunRecord {
  const [input, output] = p.tokens ?? [0, 0];
  const providerCalls = p.tokens ? 1 : 0;
  return {
    reference: "astryx",
    provider: "hosted-ai",
    arm: p.arm,
    prompt: `p-${seq++}`,
    condition: p.condition ?? "fresh",
    at: "t",
    expected: { intent: "record-collection", block: p.expectedBlock === undefined ? "records-table" : p.expectedBlock },
    ...(p.selection ? { selection: p.selection } : {}),
    status: p.status ?? "completed",
    outcome: p.passed ? "passed" : p.failure ? "failed-adapter" : "failed-lint-exhausted",
    passed: p.passed,
    attempts: p.attempts ?? 1,
    path: p.path ?? "primitive",
    calls: [],
    tokens: { input, output, providerCalls, unreportedCalls: p.unreported ?? 0, modelFreeCalls: 0 },
    requestBytes: 100,
    timings: { totalMs: 10 },
    ...(p.failure ? { failure: p.failure } : {}),
    ...(p.refinement ? { refinement: p.refinement } : {}),
    ...(p.changed !== undefined ? { changed: p.changed } : {}),
    plan: { intent: "record-collection", source: "model", calls: [], bytes: 0, durationMs: 0 },
  };
}
const many = (n: number, p: Partial) => Array.from({ length: n }, () => record(p));

describe("the summary", () => {
  it("counts pass rates over evaluated runs (provider and policy failures reported separately), tokens over metered successes only", () => {
    const records = [
      ...many(8, { arm: "block", passed: true, tokens: [100, 10] }),
      ...many(1, { arm: "block", passed: true, tokens: [100, 10], unreported: 1 }),
      ...many(1, { arm: "block", passed: false }),
      ...many(2, { arm: "block", passed: false, failure: { kind: "provider", message: "down", rerunEligible: true } }),
      ...many(1, { arm: "block", passed: false, failure: { kind: "budget", message: "spent", rerunEligible: false } }),
    ];
    const [stats] = armStats(records);
    expect(stats).toMatchObject({ n: 13, completed: 13, rerunEligible: 2, rerunByKind: { provider: 2 }, evaluated: 11, passed: 9, meteredSuccesses: 8, unmeteredSuccesses: 1, tokensPerSuccess: 110, budgetExhausted: 1 });
    expect(stats!.passRate).toBeCloseTo(9 / 11);
  });

  it("stratifies the block arm by path and classification, and measures refinement retention and change", () => {
    const records = [
      record({ arm: "block", passed: true, path: "block" }),
      record({ arm: "block", passed: true, path: "block-repair" }),
      record({ arm: "block", passed: false, path: "fallback" }),
      record({ arm: "block", passed: true, condition: "refine-content", refinement: { mode: "compact", retained: true }, changed: true }),
      record({ arm: "block", passed: true, condition: "refine-content", refinement: { mode: "switch", retained: false, reason: "no-valid-seed" }, changed: false }),
      record({ arm: "block", passed: false, condition: "refine-content", status: "skipped" }),
    ];
    const fresh = armStats(records).find((s) => s.condition === "fresh")!;
    expect(fresh.paths).toEqual({ block: { n: 1, passed: 1 }, "block-repair": { n: 1, passed: 1 }, fallback: { n: 1, passed: 0 } });
    const refine = armStats(records).find((s) => s.condition === "refine-content")!;
    expect(refine).toMatchObject({ n: 3, skipped: 1, completed: 2, retention: 0.5, changedRate: 0.5 });
  });

  it("selection accuracy counts explicit null, omitted and rejected answers separately", () => {
    const records = [
      record({ arm: "block", passed: true, expectedBlock: "records-table", selection: { chosen: "records-table", source: "model", correct: true } }),
      record({ arm: "block", passed: true, expectedBlock: "records-table", selection: { chosen: null, source: "model", correct: false } }),
      record({ arm: "block", passed: true, expectedBlock: "records-table", selection: { chosen: "auth-form", source: "model", correct: false } }),
      record({ arm: "block", passed: true, expectedBlock: null, selection: { chosen: null, source: "omitted", correct: true } }),
      record({ arm: "block", passed: true, expectedBlock: null, selection: { chosen: null, source: "model", rejected: "guide-steps", correct: true } }),
      record({ arm: "block", passed: true, expectedBlock: null, selection: { chosen: "guide-steps", source: "model", correct: false } }),
      record({ arm: "capped", passed: true }),
    ];
    const [s] = selectionStats(records);
    expect(s).toMatchObject({ n: 6, correct: 3, hit: 1, missedToNull: 1, wrongBlock: 1, nullCorrect: 2, falseBlock: 1, explicitNull: 2, omitted: 1, rejected: 1, accuracy: 0.5, intentAccuracy: 1 });
  });

  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("the decision rule (ADR-B3)", () => {
  const arms = (block: Partial, capped: Partial, production: Partial, n = 20) => [...many(n, block), ...many(n, capped), ...many(n, production)];
  it("passes when tokens per success fall by 30% against production and the pass rate is within 5 points of both arms", () => {
    const records = arms({ arm: "block", passed: true, tokens: [600, 50] }, { arm: "capped", passed: true, tokens: [900, 60] }, { arm: "production", passed: true, tokens: [1000, 80] });
    const [d] = decide(armStats(records));
    expect(d!.verdict).toBe("pass");
    expect(d!.tokens.reductionVsProduction).toBeCloseTo(1 - 650 / 1080);
  });

  it("fails on tokens, fails on the pass-rate guardrail against either arm, and is insufficient below the minimum or without metered successes", () => {
    const tokens = arms({ arm: "block", passed: true, tokens: [800, 50] }, { arm: "capped", passed: true, tokens: [900, 60] }, { arm: "production", passed: true, tokens: [1000, 80] });
    expect(decide(armStats(tokens))[0]!.verdict).toBe("fail");
    const guard = [
      ...many(17, { arm: "block", passed: true, tokens: [500, 50] }),
      ...many(3, { arm: "block", passed: false }),
      ...many(20, { arm: "capped", passed: true, tokens: [900, 60] }),
      ...many(17, { arm: "production", passed: true, tokens: [1000, 80] }),
      ...many(3, { arm: "production", passed: false }),
    ];
    const g = decide(armStats(guard))[0]!;
    expect(g.verdict).toBe("fail");
    expect(g.reasons.some((r) => /below capped/.test(r))).toBe(true);
    expect(g.reasons.some((r) => /within 5 points of production/.test(r))).toBe(true);
    const few = arms({ arm: "block", passed: true, tokens: [1, 1] }, { arm: "capped", passed: true, tokens: [1, 1] }, { arm: "production", passed: true, tokens: [1, 1] }, 5);
    expect(decide(armStats(few))[0]!.verdict).toBe("insufficient");
    const scripted = arms({ arm: "block", passed: true }, { arm: "capped", passed: true }, { arm: "production", passed: true });
    const s = decide(armStats(scripted))[0]!;
    expect(s.verdict).toBe("insufficient");
    expect(s.reasons[0]).toMatch(/not measurable/);
  });

  it("provider failures neither pass nor fail an arm: they are excluded until re-run", () => {
    const records = [
      ...many(20, { arm: "block", passed: true, tokens: [600, 50] }),
      ...many(5, { arm: "block", passed: false, failure: { kind: "policy", message: "429", rerunEligible: true } }),
      ...many(20, { arm: "capped", passed: true, tokens: [900, 60] }),
      ...many(20, { arm: "production", passed: true, tokens: [1000, 80] }),
    ];
    const summary = summarize(records);
    expect(summary.decisions[0]!.verdict).toBe("pass");
    expect(summary.arms.find((a) => a.arm === "block")!.rerunEligible).toBe(5);
  });
});
