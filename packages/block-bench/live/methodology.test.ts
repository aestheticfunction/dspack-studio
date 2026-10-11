/**
 * The ADR-B3 pre-data addendum (docs/blocks/ADR-B3-ADDENDUM.md): the prompt thread is the unit, refinements are
 * repeated observations within it, comparisons are paired by prompt, uncertainty is a paired cluster bootstrap over
 * prompts, and every rate is printed with its counts. The thresholds themselves do not move.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_DECISION, decide, summarize } from "./metrics";
import { renderReport } from "./report";
import { readCorpus } from "./corpus";
import { CONDITIONS, type Arm, type Condition, type RunRecord } from "./types";
import type { EvaluationResult } from "./evaluate";
import type { Preflight } from "./preflight";

type Cell = { arm: Arm; prompt: string; condition?: Condition; passed: boolean; tokens?: [number, number]; reference?: string };

function cell(c: Cell): RunRecord {
  const [input, output] = c.tokens ?? [100, 0];
  return {
    reference: c.reference ?? "astryx",
    provider: "hosted-ai",
    arm: c.arm,
    prompt: c.prompt,
    condition: c.condition ?? "fresh",
    at: "t",
    expected: { intent: "record-collection", block: "records-table" },
    status: "completed",
    outcome: c.passed ? "passed" : "failed-lint-exhausted",
    passed: c.passed,
    attempts: 1,
    path: "primitive",
    calls: [],
    tokens: { input, output, providerCalls: 1, unreportedCalls: 0, modelFreeCalls: 0 },
    requestBytes: 100,
    timings: { totalMs: 10 },
    plan: { intent: "record-collection", source: "model", calls: [], bytes: 0, durationMs: 0 },
  };
}

const prompts = (n: number) => Array.from({ length: n }, (_, i) => `p-${String(i).padStart(2, "0")}`);
/** A thread: one prompt's fresh cell and its four refinements, in one arm. */
const thread = (arm: Arm, prompt: string, passed: (condition: Condition) => boolean, tokens: [number, number]) =>
  CONDITIONS.map((condition) => cell({ arm, prompt, condition, passed: passed(condition), tokens }));

describe("the prompt thread is the unit (ADR-B3 addendum)", () => {
  it("counts the rule's minimum in prompt threads, so refinements cannot inflate the sample: 25 cells from 5 prompts are 5 threads", () => {
    const records = prompts(5).flatMap((p) => [
      ...thread("block", p, () => true, [70, 0]),
      ...thread("capped", p, () => true, [100, 0]),
      ...thread("production", p, () => true, [100, 0]),
    ]);
    const [d] = decide(records);
    expect(d!.evaluated).toEqual({ block: 25, capped: 25, production: 25 });
    expect(d!.threads).toEqual({ block: 5, capped: 5, production: 5 });
    expect(d!.verdict).toBe("insufficient");
    expect(d!.reasons.join("\n")).toMatch(/block: 5 prompt threads \(25 cells\), fewer than the 20 the rule needs/);
    // The same thresholds, unchanged: 20 independent prompts reach the minimum.
    expect(DEFAULT_DECISION).toEqual({ reduction: 0.3, margin: 0.05, minimum: 20 });
    const enough = prompts(20).flatMap((p) => [...thread("block", p, () => true, [70, 0]), ...thread("capped", p, () => true, [100, 0]), ...thread("production", p, () => true, [100, 0])]);
    expect(decide(enough)[0]).toMatchObject({ verdict: "pass", threads: { block: 20, capped: 20, production: 20 }, meteredThreads: { block: 20, capped: 20, production: 20 } });
  });

  it("bootstraps over prompts, not cells: repeating every thread's observations leaves every interval exactly where it was", () => {
    const passOf = (p: number, arm: Arm) => (c: Condition) => (p * 7 + CONDITIONS.indexOf(c) * 3 + (arm === "block" ? 1 : 0)) % 5 !== 0;
    const build = (repeat: number) =>
      prompts(24).flatMap((p, i) =>
        (["block", "capped", "production"] as Arm[]).flatMap((arm) =>
          Array.from({ length: repeat }, () => thread(arm, p, passOf(i, arm), arm === "block" ? [40 + (i % 7) * 5, 5] : [100 + (i % 5) * 10, 10])).flat(),
        ),
      );
    const [once] = decide(build(1));
    const [four] = decide(build(4));
    expect(once!.intervals.reductionVsProduction).not.toBeNull();
    expect(once!.intervals.passDiffVsProduction).not.toBeNull();
    expect(four!.evaluated.block).toBe(4 * once!.evaluated.block);
    expect(four!.threads).toEqual(once!.threads);
    expect(four!.intervals).toEqual(once!.intervals);
  });

  it("pairs arms by prompt: when the block arm passes exactly where production does, the pass-rate difference is exactly zero in every resample", () => {
    const passOf = (i: number) => (c: Condition) => (i + CONDITIONS.indexOf(c)) % 3 !== 0;
    const records = prompts(24).flatMap((p, i) => [
      ...thread("block", p, passOf(i), [50, 0]),
      ...thread("capped", p, passOf(i), [100, 0]),
      ...thread("production", p, passOf(i), [100, 0]),
    ]);
    const [d] = decide(records);
    expect(d!.intervals.passDiffVsProduction).toMatchObject({ low: 0, high: 0 });
    expect(d!.paired.vsProduction).toMatchObject({ prompts: 24, passRate: { better: 0, same: 24, worse: 0 }, tokensPerSuccess: { lower: 24, same: 0, higher: 0 } });
  });

  it("calls each criterion clear only when its whole interval is on one side of the unchanged threshold, and is reproducible", () => {
    const clear = prompts(24).flatMap((p) => [...thread("block", p, () => true, [50, 0]), ...thread("capped", p, () => true, [100, 0]), ...thread("production", p, () => true, [100, 0])]);
    const [c] = decide(clear);
    expect(c!.clarity).toEqual({ tokens: "clear-pass", vsProduction: "clear-pass", vsCapped: "clear-pass", overall: "clear" });
    expect(decide(clear)).toEqual(decide(clear));
    // A token cut that straddles 30% across prompts: point estimate near the line, interval across it.
    const near = prompts(24).flatMap((p, i) => [
      ...thread("block", p, () => true, [i % 2 === 0 ? 55 : 85, 0]),
      ...thread("capped", p, () => true, [100, 0]),
      ...thread("production", p, () => true, [100, 0]),
    ]);
    const [n] = decide(near);
    expect(n!.clarity.tokens).toBe("uncertain");
    expect(n!.clarity.overall).toBe("uncertain");
    expect(n!.intervals.reductionVsProduction!.low).toBeLessThan(0.3);
    expect(n!.intervals.reductionVsProduction!.high).toBeGreaterThan(0.3);
  });

  it("resamples only the prompts every compared arm evaluated, so a prompt one arm lacks (a partial run) joins no interval", () => {
    const shared = prompts(24).flatMap((p, i) => [
      ...thread("block", p, (c) => (i + CONDITIONS.indexOf(c)) % 4 !== 0, [40 + (i % 6) * 5, 5]),
      ...thread("capped", p, (c) => (i + CONDITIONS.indexOf(c)) % 5 !== 0, [100, 10]),
      ...thread("production", p, (c) => (i + CONDITIONS.indexOf(c)) % 5 !== 0, [110, 10]),
    ]);
    const extra = [...thread("block", "x-01", () => true, [10, 0]), ...thread("block", "x-02", () => true, [10, 0]), ...thread("production", "x-03", () => false, [500, 0])];
    const [alone] = decide(shared);
    const [partial] = decide([...shared, ...extra]);
    // The point estimates still pool every evaluated cell, as ADR-B3 does; the intervals rest on the shared prompts alone.
    expect(partial!.tokens.block).not.toBe(alone!.tokens.block);
    expect(partial!.intervals).toEqual(alone!.intervals);
    expect(partial!.intervals.reductionVsProduction).toMatchObject({ prompts: 24 });
    expect(partial!.cohort).toBe(24);
    // No prompt in common: no paired interval at all, as the paired counts already say.
    const [apart] = decide([...thread("block", "a", () => true, [50, 0]), ...thread("capped", "b", () => true, [100, 0]), ...thread("production", "b", () => true, [100, 0])]);
    expect(apart!.paired.vsProduction.prompts).toBe(0);
    expect(apart!.cohort).toBe(0);
    expect(apart!.intervals).toEqual({ reductionVsProduction: null, reductionVsCapped: null, passDiffVsProduction: null, passDiffVsCapped: null });
  });

  it("calls a decision clear only when its intervals agree with its verdict: a pooled fail with every interval clearly met is uncertain", () => {
    // 24 prompts every arm evaluated, all passing, and three the block arm alone reached, all failing (a partial run,
    // or threads another arm lost to provider failures): the pooled pass rate fails the margin, the shared intervals do not.
    const records = [
      ...prompts(24).flatMap((p) => [...thread("block", p, () => true, [50, 0]), ...thread("capped", p, () => true, [100, 0]), ...thread("production", p, () => true, [100, 0])]),
      ...["x-01", "x-02", "x-03"].flatMap((p) => thread("block", p, () => false, [50, 0])),
    ];
    const [d] = decide(records);
    expect(d!.verdict).toBe("fail");
    expect(d!.cohort).toBe(24);
    expect(d!.clarity).toMatchObject({ tokens: "clear-pass", vsProduction: "clear-pass", vsCapped: "clear-pass" });
    expect(d!.clarity.overall).toBe("uncertain");
  });

  it("calls a decision clear only when its intervals rest on at least the minimum's prompts in common", () => {
    // Every arm has its 20 threads, but the arms share only 10 prompts.
    const records = [
      ...prompts(30).slice(0, 20).flatMap((p) => thread("block", p, () => true, [50, 0])),
      ...prompts(30).slice(10).flatMap((p) => [...thread("capped", p, () => true, [100, 0]), ...thread("production", p, () => true, [100, 0])]),
    ];
    const [d] = decide(records);
    expect(d!.threads).toEqual({ block: 20, capped: 20, production: 20 });
    expect(d!.verdict).toBe("pass");
    expect(d!.cohort).toBe(10);
    expect(d!.intervals.reductionVsProduction).toMatchObject({ low: 0.5, high: 0.5, prompts: 10 });
    expect(d!.clarity.tokens).toBe("clear-pass");
    expect(d!.clarity.overall).toBe("uncertain");
  });
});

describe("the report prints counts beside every rate and labels the rule for what it is", () => {
  it("shows numerators and denominators, prompt threads, intervals and the descriptive label", () => {
    const records = prompts(24).flatMap((p, i) => [
      ...thread("block", p, (c) => !(i === 0 && c === "fresh"), [50, 0]),
      ...thread("block-positional", p, () => true, [45, 0]),
      ...thread("capped", p, () => true, [100, 0]),
      ...thread("production", p, () => true, [100, 0]),
    ]);
    const summary = summarize(records);
    const preflight: Preflight = { at: "2026-10-11T00:00:00.000Z", sidecars: [], drafts: false };
    const result: EvaluationResult = { runId: "r", records, summary, preflight, invocations: [], superseded: { records: 0, providerCalls: 0, inputTokens: 0, outputTokens: 0, requestBytes: 0 }, arms: ["block", "block-positional", "capped", "production"], cells: { total: records.length, done: records.length, reused: 0 } };
    const report = renderReport(result, { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpus() });
    expect(report).toContain("descriptive product decision rule");
    expect(report).toMatch(/\| block \| 24 \| 120 \|/);
    expect(report).toContain("99.2% (119/120)");
    expect(report).toContain("100.0% (120/120)");
    expect(report).toMatch(/95% interval/);
    expect(report).toMatch(/2000 resamples over 24 prompts/);
    expect(report).toMatch(/paired by prompt: 24 prompts/);
    // Tokens per success beside its own numerator and denominator in every table: metered tokens over metered successes.
    expect(report).toContain("52 (1200/23)"); // the block arm's fresh builds: 24 x 50 tokens over 23 successes
    expect(report).toContain("45 (5400/120)"); // the positional arm, every condition pooled
    expect(report).not.toMatch(/metered runs \/ successes/);
  });
});
