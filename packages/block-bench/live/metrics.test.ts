import { describe, expect, it } from "vitest";
import { armStats, decide, DEFAULT_DECISION, median, selectionStats, summarize } from "./metrics";
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

  it("tokens per success follows ADR-B3: every metered evaluated run's spend, failures included, over the metered successes; a run with an unreported call leaves the cohort entirely", () => {
    const records = [
      ...many(8, { arm: "block", passed: true, tokens: [100, 10] }),
      ...many(2, { arm: "block", passed: false, tokens: [250, 50] }),
      ...many(1, { arm: "block", passed: true, tokens: [100, 10], unreported: 1 }),
      ...many(1, { arm: "block", passed: false, tokens: [900, 0], unreported: 2 }),
    ];
    const [stats] = armStats(records);
    // cohort: 8 passing at 110 and 2 failing at 300 = 1480 tokens over 8 successes
    expect(stats).toMatchObject({ evaluated: 12, passed: 9, meteredRuns: 10, meteredSuccesses: 8, unmeteredRuns: 2, unmeteredSuccesses: 1, tokensPerSuccess: 185, tokensPerPassingRun: 110 });
    expect(stats!.inputTokensPerSuccess).toBeCloseTo((800 + 500) / 8);
    expect(stats!.outputTokensPerSuccess).toBeCloseTo((80 + 100) / 8);
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

  it("selection accuracy reads the planner's answer: explicit null, omitted and withdrawn answers are counted apart, and a withdrawn block on a null prompt is not correct", () => {
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
    expect(s).toMatchObject({ n: 6, correct: 2, hit: 1, missedToNull: 1, wrongBlock: 1, nullCorrect: 1, falseBlock: 2, explicitNull: 1, omitted: 1, rejected: 1, intentAccuracy: 1 });
    expect(s!.accuracy).toBeCloseTo(2 / 6);
  });

  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("the decision covers every result and judges its boundaries exactly (ADR-B3)", () => {
  it("pools every evaluated result of every condition: an arm whose refinements fail expensively cannot pass on its fresh builds", () => {
    const records = [
      ...many(20, { arm: "block", passed: true, tokens: [600, 50] }),
      ...many(20, { arm: "block", passed: false, tokens: [50_000, 5_000], condition: "refine-content" }),
      ...many(20, { arm: "capped", passed: true, tokens: [900, 60] }),
      ...many(20, { arm: "production", passed: true, tokens: [1000, 80] }),
    ];
    const [d] = summarize(records).decisions;
    expect(d!.evaluated.block).toBe(40);
    expect(d!.tokens.block).toBeCloseTo((20 * 650 + 20 * 55_000) / 20);
    expect(d!.verdict).toBe("fail");
  });

  it("needs the minimum in the metered cohort too: a token figure resting on one metered run is insufficient", () => {
    const records = [
      ...many(1, { arm: "block", passed: true, tokens: [600, 50] }),
      ...many(19, { arm: "block", passed: true, tokens: [600, 50], unreported: 1 }),
      ...many(20, { arm: "capped", passed: true, tokens: [900, 60] }),
      ...many(20, { arm: "production", passed: true, tokens: [1000, 80] }),
    ];
    const [d] = summarize(records).decisions;
    expect(d!.verdict).toBe("insufficient");
    expect(d!.reasons.join(" ")).toMatch(/block: 1 metered prompt thread \(1 metered cell\) in the token cohort/);
  });

  it("an exact 30% cut passes, and a pass-rate gap of exactly 5 points is within the margin", () => {
    const exact30 = [
      ...[...Array(8).fill(72), ...Array(12).fill(71)].map((t: number) => record({ arm: "block", passed: true, tokens: [t, 0] })),
      ...many(20, { arm: "capped", passed: true, tokens: [102, 0] }),
      ...many(20, { arm: "production", passed: true, tokens: [102, 0] }),
    ];
    expect(summarize(exact30).decisions[0]!.verdict).toBe("pass");
    const gap5 = [
      ...many(3, { arm: "block", passed: true, tokens: [10, 0] }),
      ...many(17, { arm: "block", passed: false, tokens: [10, 0] }),
      ...many(4, { arm: "capped", passed: true, tokens: [100, 0] }),
      ...many(16, { arm: "capped", passed: false, tokens: [100, 0] }),
      ...many(4, { arm: "production", passed: true, tokens: [100, 0] }),
      ...many(16, { arm: "production", passed: false, tokens: [100, 0] }),
    ];
    const g = summarize(gap5).decisions[0]!;
    expect(g.reasons.filter((r) => /within 5 points/.test(r))).toHaveLength(2);
    expect(g.verdict).toBe("pass");
  });
});

describe("the decision rule (ADR-B3)", () => {
  const arms = (block: Partial, capped: Partial, production: Partial, n = 20) => [...many(n, block), ...many(n, capped), ...many(n, production)];
  it("passes when tokens per success fall by 30% against production and the pass rate is within 5 points of both arms", () => {
    const records = arms({ arm: "block", passed: true, tokens: [600, 50] }, { arm: "capped", passed: true, tokens: [900, 60] }, { arm: "production", passed: true, tokens: [1000, 80] });
    const [d] = decide(records);
    expect(d!.verdict).toBe("pass");
    expect(d!.tokens.reductionVsProduction).toBeCloseTo(1 - 650 / 1080);
  });

  it("the decision reads the ADR-B3 figure: an arm that pays for many failures does not look cheaper than it is", () => {
    const records = [
      ...many(14, { arm: "block", passed: true, tokens: [600, 50] }),
      ...many(6, { arm: "block", passed: false, tokens: [600, 50] }),
      ...many(20, { arm: "capped", passed: true, tokens: [900, 60] }),
      ...many(20, { arm: "production", passed: true, tokens: [1000, 80] }),
    ];
    const [d] = decide(records);
    // 20 runs at 650 over 14 successes = 928.6 per success: only 14% below production's 1080
    expect(d!.tokens.block).toBeCloseTo((20 * 650) / 14);
    expect(d!.tokens.reductionVsProduction).toBeCloseTo(1 - (20 * 650) / 14 / 1080);
    expect(d!.verdict).toBe("fail");
  });

  it("fails on tokens, fails on the pass-rate guardrail against either arm, and is insufficient below the minimum or without metered successes", () => {
    const tokens = arms({ arm: "block", passed: true, tokens: [800, 50] }, { arm: "capped", passed: true, tokens: [900, 60] }, { arm: "production", passed: true, tokens: [1000, 80] });
    expect(decide(tokens)[0]!.verdict).toBe("fail");
    const guard = [
      ...many(17, { arm: "block", passed: true, tokens: [500, 50] }),
      ...many(3, { arm: "block", passed: false }),
      ...many(20, { arm: "capped", passed: true, tokens: [900, 60] }),
      ...many(17, { arm: "production", passed: true, tokens: [1000, 80] }),
      ...many(3, { arm: "production", passed: false }),
    ];
    const g = decide(guard)[0]!;
    expect(g.verdict).toBe("fail");
    expect(g.reasons.some((r) => /below capped/.test(r))).toBe(true);
    expect(g.reasons.some((r) => /within 5 points of production/.test(r))).toBe(true);
    const few = arms({ arm: "block", passed: true, tokens: [1, 1] }, { arm: "capped", passed: true, tokens: [1, 1] }, { arm: "production", passed: true, tokens: [1, 1] }, 5);
    expect(decide(few)[0]!.verdict).toBe("insufficient");
    const scripted = arms({ arm: "block", passed: true }, { arm: "capped", passed: true }, { arm: "production", passed: true });
    const s = decide(scripted)[0]!;
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

describe("the ADR-B3 thresholds are pinned", () => {
  it("are 30% fewer tokens per success, a 5-point margin and 20 runs per arm, and cannot be changed at run time", () => {
    expect(DEFAULT_DECISION).toEqual({ reduction: 0.3, margin: 0.05, minimum: 20 });
    expect(Object.isFrozen(DEFAULT_DECISION)).toBe(true);
    expect(() => {
      (DEFAULT_DECISION as { reduction: number }).reduction = 0.1;
    }).toThrow(TypeError);
  });
});

describe("the ADR-B3 decision reads production, capped and the named block arm only", () => {
  it("a positional-only run has no decision, and positional records never add, remove or change one", () => {
    const positional = [...many(25, { arm: "block-positional", passed: true, tokens: [50, 5] }), ...many(5, { arm: "block-positional", passed: false, tokens: [50, 5] })];
    expect(decide(positional)).toEqual([]);
    expect(summarize(positional).decisions).toEqual([]);
    const named = [...many(20, { arm: "block", passed: true, tokens: [60, 6] }), ...many(20, { arm: "capped", passed: true, tokens: [100, 10] }), ...many(20, { arm: "production", passed: true, tokens: [100, 10] })];
    expect(decide([...named, ...positional])).toEqual(decide(named));
    // Positional records on another reference or provider open no decision of their own.
    const elsewhere = positional.map((r) => ({ ...r, reference: "shadcn-v3" }));
    expect(decide([...named, ...elsewhere]).map((d) => d.reference)).toEqual(["astryx"]);
  });
});

describe("what each figure measures (pacing, parity, add and remove)", () => {
  it("latency is read from the execution clock, with the pacer's waits apart; a record that kept no execution figures has no latency, never its wall clock", () => {
    const paced: RunRecord = { ...record({ arm: "production", passed: true }), timings: { totalMs: 15_000, firstGatedAttemptMs: 14_000, emitMs: 4, pacingMs: 12_000, execution: { totalMs: 3_000, firstGatedAttemptMs: 2_000, emitMs: 4 } } };
    const [stats] = armStats([paced]);
    expect(stats!.latency).toMatchObject({ totalMs: 3_000, firstGatedAttemptMs: 2_000, emitMs: 4, pacingMs: 12_000, wallTotalMs: 15_000 });
    const [unseparated] = armStats([record({ arm: "production", passed: true })]);
    expect(unseparated!.latency).toMatchObject({ totalMs: null, firstGatedAttemptMs: null, emitMs: null, pacingMs: null, wallTotalMs: 10 });
  });

  it("parity is scored only where the checklist checks something: an empty checklist is counted apart, never as a full score", () => {
    const scored: RunRecord = { ...record({ arm: "block", passed: true }), parity: { score: 0.5, satisfied: ["label:status"], missing: ["label:priority"] } };
    const empty: RunRecord = { ...record({ arm: "block", passed: true }), parity: { score: 1, satisfied: [], missing: [] } };
    const [stats] = armStats([scored, empty]);
    expect(stats!.parity).toEqual({ meanScore: 0.5, scored: 1, fullyParityPassed: 0, noChecks: 1 });
  });

  it("counts passing add and remove refinements by what they did, per condition, per block and pooled, with the misses that left the surface unchanged apart", () => {
    const op = (requested: "add" | "remove", observed: "add" | "remove" | "mixed" | "none") => ({ requested, observed, deltas: {} });
    const records: RunRecord[] = [
      { ...record({ arm: "block", passed: true, condition: "refine-add", changed: true }), operation: { requested: "add", observed: "add", deltas: { "card.children>table.props.data": 1 } } },
      { ...record({ arm: "block", passed: true, condition: "refine-add", changed: false }), operation: op("add", "none") },
      { ...record({ arm: "block", passed: true, condition: "refine-add", changed: true }), operation: op("add", "mixed") },
      { ...record({ arm: "block", passed: true, condition: "refine-remove", changed: true, expectedBlock: "auth-form" }), operation: op("remove", "add") },
      record({ arm: "block", passed: false, condition: "refine-remove" }),
    ];
    expect(armStats(records).find((s) => s.condition === "refine-add")!.operation).toEqual({ checked: 3, performed: 1, mixed: 1, missed: 1, unchanged: 1 });
    expect(armStats(records).find((s) => s.condition === "refine-remove")!.operation).toEqual({ checked: 1, performed: 0, mixed: 0, missed: 1, unchanged: 0 });
    const [pooled] = armStats(records, { pooled: true });
    expect(pooled!.operation).toEqual({ checked: 4, performed: 1, mixed: 1, missed: 2, unchanged: 1 });
    expect(pooled!.operationByBlock).toEqual({ "records-table": { checked: 3, performed: 1, mixed: 1, missed: 1, unchanged: 1 }, "auth-form": { checked: 1, performed: 0, mixed: 0, missed: 1, unchanged: 0 } });
  });
});
