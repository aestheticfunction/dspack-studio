/**
 * The ADR-B3 pre-data addendum (docs/blocks/ADR-B3-ADDENDUM.md): the prompt thread is the unit, refinements are
 * repeated observations within it, comparisons are paired by prompt, uncertainty is a paired cluster bootstrap over
 * prompts, and every rate is printed with its counts. The thresholds themselves do not move.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_DECISION, decide, operationSensitivity, summarize } from "./metrics";
import { renderReport } from "./report";
import { readCorpusVersion } from "./corpus";
import { CONDITIONS, type Arm, type Condition, type RunRecord } from "./types";
import type { EvaluationResult } from "./evaluate";
import type { Preflight } from "./preflight";

type Cell = { arm: Arm; prompt: string; condition?: Condition; passed: boolean; tokens?: [number, number]; reference?: string; extra?: Partial<RunRecord> };

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
    ...c.extra,
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
    // Below the minimum an interval is indicative at most (the addendum), however tight it looks: never clear.
    expect(d!.clarity).toEqual({ tokens: "insufficient", vsProduction: "insufficient", vsCapped: "insufficient", overall: "insufficient" });
  });

  it("calls no criterion clear below the minimum: four prompts are insufficient, and the report never says clearly met", () => {
    const records = prompts(4).flatMap((p) => [...thread("block", p, () => true, [50, 0]), ...thread("capped", p, () => true, [100, 0]), ...thread("production", p, () => true, [100, 0])]);
    const summary = summarize(records, DEFAULT_DECISION, "beside");
    const [d] = summary.decisions;
    expect(d!.intervals.reductionVsProduction).toMatchObject({ low: 0.5, high: 0.5, prompts: 4 });
    expect(d!.clarity).toEqual({ tokens: "insufficient", vsProduction: "insufficient", vsCapped: "insufficient", overall: "insufficient" });
    const report = renderReport(resultOf(records, summary), { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpusVersion(1) });
    expect(report).not.toMatch(/clearly met|clearly missed/);
    expect(report).toContain("insufficient: fewer prompts than the rule's minimum of 20 stand behind it, so it is indicative at most and never called clear");
  });

  it("leaves a criterion with no interval at all not measurable, below the minimum as above it: there is nothing to call insufficient", () => {
    // Four prompts; the block arm never passes, so no resample has a token figure for it.
    const records = prompts(4).flatMap((p) => [...thread("block", p, () => false, [50, 0]), ...thread("capped", p, () => true, [100, 0]), ...thread("production", p, () => true, [100, 0])]);
    const [d] = decide(records);
    expect(d!.intervals.reductionVsProduction).toBeNull();
    expect(d!.clarity).toEqual({ tokens: "n/a", vsProduction: "insufficient", vsCapped: "insufficient", overall: "insufficient" });
  });

  it("calls the token criterion insufficient when fewer metered prompt threads than the minimum stand behind it, as the verdict does", () => {
    // 24 prompts every arm evaluated, but the block arm's usage went unreported on 6 of them (an Ollama run can leave a
    // figure out), so its token figure rests on 18 metered threads.
    const records = prompts(24).flatMap((p, i) => [
      ...thread("block", p, () => true, [50, 0]).map((r) => (i < 6 ? { ...r, tokens: { ...r.tokens, unreportedCalls: 1 } } : r)),
      ...thread("capped", p, () => true, [100, 0]),
      ...thread("production", p, () => true, [100, 0]),
    ]);
    const summary = summarize(records, DEFAULT_DECISION, "beside");
    const [d] = summary.decisions;
    expect(d).toMatchObject({ verdict: "insufficient", cohort: 24, meteredThreads: { block: 18 } });
    expect(d!.intervals.reductionVsProduction).not.toBeNull();
    expect(d!.clarity).toEqual({ tokens: "insufficient", vsProduction: "clear-pass", vsCapped: "clear-pass", overall: "insufficient" });
    const report = renderReport(resultOf(records, summary), { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpusVersion(1) });
    expect(report).not.toMatch(/Token reduction vs production: [^\n]*clearly met/);
  });

  it("counts the token figure's minimum over the prompts every decision arm evaluated that are metered in both the block and production arms", () => {
    // 20 prompts every arm evaluated; the block arm's usage went unreported on 4 of them, and it ran 4 more prompts alone,
    // all metered: 20 metered block threads, but only 16 shared prompts with a metered block figure.
    const records = [
      ...prompts(24).slice(0, 20).flatMap((p, i) => [
        ...thread("block", p, () => true, [50, 0]).map((r) => (i < 4 ? { ...r, tokens: { ...r.tokens, unreportedCalls: 1 } } : r)),
        ...thread("capped", p, () => true, [100, 0]),
        ...thread("production", p, () => true, [100, 0]),
      ]),
      ...prompts(24).slice(20).flatMap((p) => thread("block", p, () => true, [50, 0])),
    ];
    const summary = summarize(records, DEFAULT_DECISION, "beside");
    const [d] = summary.decisions;
    expect(d).toMatchObject({ verdict: "pass", cohort: 20, meteredCohort: 16, meteredThreads: { block: 20, capped: 20, production: 20 } });
    // The token criterion cannot be called, so neither can the pass: uncertain, as the addendum has it.
    expect(d!.clarity).toMatchObject({ tokens: "insufficient", overall: "uncertain" });
    const report = renderReport(resultOf(records, summary), { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpusVersion(1) });
    expect(report).toContain("The token figure rests on the 16 of them metered in both the block and production arms, fewer than the 20 the rule needs.");
    expect(report).not.toMatch(/Token reduction vs production: [^\n]*clearly met/);
  });

  it("keeps a fail clear when a criterion is clearly missed over the minimum's prompts, whatever the token figure rests on (the addendum's clear decision)", () => {
    // 24 prompts every arm evaluated; the block arm passes 2 of each thread's 5 cells, 60 points below both primitive
    // arms. Its usage went unreported on 4 prompts and production's on 2 others: 18 prompts metered in both.
    const records = prompts(24).flatMap((p, i) => [
      ...thread("block", p, (c) => c === "fresh" || c === "refine-content", [50, 0]).map((r) => (i < 4 ? { ...r, tokens: { ...r.tokens, unreportedCalls: 1 } } : r)),
      ...thread("capped", p, () => true, [100, 0]),
      ...thread("production", p, () => true, [100, 0]).map((r) => (i >= 22 ? { ...r, tokens: { ...r.tokens, unreportedCalls: 1 } } : r)),
    ]);
    const [d] = decide(records);
    expect(d).toMatchObject({ verdict: "fail", cohort: 24, meteredCohort: 18, meteredThreads: { block: 20, capped: 24, production: 22 } });
    expect(d!.clarity).toEqual({ tokens: "insufficient", vsProduction: "clear-fail", vsCapped: "clear-fail", overall: "clear" });
  });
});

function resultOf(records: RunRecord[], summary = summarize(records, DEFAULT_DECISION, "beside")): EvaluationResult {
  const preflight: Preflight = { at: "2026-10-11T00:00:00.000Z", sidecars: [], drafts: false };
  return { runId: "r", records, summary, preflight, invocations: [], superseded: { records: 0, providerCalls: 0, inputTokens: 0, outputTokens: 0, requestBytes: 0 }, arms: ["block", "block-positional", "capped", "production"], cells: { total: records.length, done: records.length, reused: 0 } };
}

describe("the report prints counts beside every rate and labels the rule for what it is", () => {
  it("shows numerators and denominators, prompt threads, intervals and the descriptive label", () => {
    const records = prompts(24).flatMap((p, i) => [
      ...thread("block", p, (c) => !(i === 0 && c === "fresh"), [50, 0]),
      ...thread("block-positional", p, () => true, [45, 0]),
      ...thread("capped", p, () => true, [100, 0]),
      ...thread("production", p, () => true, [100, 0]),
    ]);
    const summary = summarize(records, DEFAULT_DECISION, "beside");
    const preflight: Preflight = { at: "2026-10-11T00:00:00.000Z", sidecars: [], drafts: false };
    const result: EvaluationResult = { runId: "r", records, summary, preflight, invocations: [], superseded: { records: 0, providerCalls: 0, inputTokens: 0, outputTokens: 0, requestBytes: 0 }, arms: ["block", "block-positional", "capped", "production"], cells: { total: records.length, done: records.length, reused: 0 } };
    const report = renderReport(result, { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpusVersion(1) });
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

/**
 * What the report says of the readings that leave out the misses that left their surface unchanged: an unchanged surface
 * is the right answer where a template does not apply, and also what an ignored instruction leaves.
 */
const UNCHANGED_NOTE =
  "Leaving out the misses that left their surface unchanged matters where a template does not apply to a prompt's surface, since an unchanged surface is the right answer there. It is also what a refinement that ignored its instruction leaves (a block refinement that re-sends its prior call expands to exactly the same surface), so the readings that leave those misses out can excuse real ones too; the add and remove table by block shows which templates they come from.";

/** A passing add or remove refinement's check, as live/operation.ts records it. */
const operation = (condition: Condition, observed: "add" | "remove" | "mixed" | "none") =>
  condition === "refine-add" || condition === "refine-remove" ? { operation: { requested: condition === "refine-add" ? ("add" as const) : ("remove" as const), observed, deltas: {} } } : {};
/** Every arm passes everything; the block arm is half as costly; `observed` says what each add and remove did. */
const checked = (observed: (arm: Arm, condition: Condition, index: number) => "add" | "remove" | "mixed" | "none") =>
  prompts(24).flatMap((p, i) =>
    (["block", "capped", "production"] as Arm[]).flatMap((arm) =>
      CONDITIONS.map((condition) => cell({ arm, prompt: p, condition, passed: true, tokens: arm === "block" ? [50, 0] : [100, 0], extra: operation(condition, observed(arm, condition, i)) })),
    ),
  );
const done = (_arm: Arm, condition: Condition) => (condition === "refine-add" ? "add" : "remove");

describe("the add and remove check sits beside the rule: it never changes the verdict, and says when the verdict rests on it", () => {
  const TABLE = "| Counted as failures | Verdict | Clarity | Pass rate, block | Pass rate, capped | Pass rate, production | Token reduction vs production |";
  const report = (records: RunRecord[], summary = summarize(records, DEFAULT_DECISION, "beside")) => renderReport(resultOf(records, summary), { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpusVersion(1) });

  it("a verdict that holds only because add refinements passed without adding anything is flagged, and stays the verdict", () => {
    const records = checked((arm, condition) => (arm === "block" && condition === "refine-add" ? "none" : done(arm, condition)));
    const summary = summarize(records, DEFAULT_DECISION, "beside");
    const [d] = summary.decisions;
    expect(d).toMatchObject({ verdict: "pass", clarity: { overall: "clear" }, passRates: { block: 1 } });
    const [s] = summary.sensitivity;
    expect(s).toMatchObject({
      reference: "astryx",
      operation: { block: { checked: 48, performed: 24, mixed: 0, missed: 24 }, capped: { checked: 48, performed: 48 }, production: { checked: 48, performed: 48 } },
      readings: [{ failing: "missed", reading: { verdict: "fail" } }],
      verdictHolds: false,
      robust: false,
    });
    const text = report(records, summary);
    expect(text).toContain("- Add and remove refinements (live/operation.ts; beside the rule, never in it): block performed 24 of the 48 that passed (0 mixed, 24 missed); capped 48 of 48 (0 mixed, 0 missed); production 48 of 48 (0 mixed, 0 missed). The decision recomputed with some of them counted as failures is below; the verdict above stands.");
    expect(text).toContain(TABLE);
    expect(text).toContain("| the missed ones | fail | clear | 80.0% (96/120) | 100.0% (120/120) | 100.0% (120/120) | 37.5% |");
    expect(text).toContain("The verdict changes in one reading: the missed ones.");
  });

  it("mixed changes are read apart, and a verdict that survives every reading is said to", () => {
    const records = checked((arm, condition) => (arm === "production" && condition === "refine-remove" ? "mixed" : done(arm, condition)));
    const summary = summarize(records, DEFAULT_DECISION, "beside");
    expect(summary.decisions[0]).toMatchObject({ verdict: "pass", clarity: { overall: "clear" } });
    expect(summary.sensitivity[0]).toMatchObject({ operation: { production: { checked: 48, performed: 24, mixed: 24, missed: 0 } }, readings: [{ failing: "missed-and-mixed", reading: { verdict: "pass", overall: "clear" } }], verdictHolds: true, clarityHolds: true, robust: true });
    const text = report(records, summary);
    expect(text).toContain("| the missed and mixed ones | pass | clear | 100.0% (120/120) | 100.0% (120/120) | 80.0% (96/120) | 60.0% |");
    expect(text).toContain("Neither the verdict nor its clarity changes in any reading.");
    // Every one performed: nothing to recompute.
    const clean = summarize(checked(done), DEFAULT_DECISION, "beside");
    expect(clean.sensitivity[0]).toMatchObject({ readings: [], robust: true, operation: { block: { checked: 48, performed: 48 } } });
    const cleanText = report(checked(done), clean);
    expect(cleanText).toContain("Every one changed its lists the way its template asked, so the verdict does not rest on the check.");
    expect(cleanText).not.toContain(TABLE);
  });

  it("a verdict that holds while its clarity changes says exactly that, never that the verdict changes", () => {
    // The block arm's add missed its operation on 4 of 24 prompts: still a pass on the point estimates, no longer clear.
    const records = checked((arm, condition, i) => (arm === "block" && condition === "refine-add" && i < 4 ? "none" : done(arm, condition)));
    const summary = summarize(records, DEFAULT_DECISION, "beside");
    expect(summary.decisions[0]).toMatchObject({ verdict: "pass", clarity: { overall: "clear" } });
    expect(summary.sensitivity[0]).toMatchObject({ readings: [{ failing: "missed", reading: { verdict: "pass", overall: "uncertain" } }], verdictHolds: true, clarityHolds: false, robust: false });
    const text = report(records, summary);
    expect(text).toContain("The verdict holds in every reading, but its clarity changes in one reading: the missed ones.");
    expect(text).not.toContain("The verdict changes");
  });

  it("reads the decision again without the misses that left the surface unchanged, the right answer where a template does not apply", () => {
    // Seven block removes left their surface exactly as it was (an auth form with no provider buttons to remove, say).
    const records = checked((arm, condition, i) => (arm === "block" && condition === "refine-remove" && i < 7 ? "none" : done(arm, condition))).map((r) =>
      r.arm === "block" && r.condition === "refine-remove" && r.operation?.observed === "none" ? { ...r, changed: false } : r,
    );
    const summary = summarize(records, DEFAULT_DECISION, "beside");
    expect(summary.decisions[0]).toMatchObject({ verdict: "pass", clarity: { overall: "clear" } });
    expect(summary.sensitivity[0]).toMatchObject({
      operation: { block: { checked: 48, performed: 41, missed: 7, unchanged: 7 } },
      readings: [
        { failing: "missed", reading: { verdict: "fail" } },
        { failing: "changed-missed", reading: { verdict: "pass", overall: "clear" } },
      ],
      verdictHolds: false,
    });
    const text = report(records, summary);
    expect(text).toContain("| the missed ones that changed their surface | pass | clear | 100.0% (120/120) | 100.0% (120/120) | 100.0% (120/120) | 50.0% |");
    expect(text).toContain(`The verdict changes in one reading: the missed ones. ${UNCHANGED_NOTE}`);
  });

  it("never calls an unchanged surface a correct no-op outright: a block add that ignored its instruction re-sends its prior call, and leaves its surface exactly as it was", () => {
    // Seven block adds re-sent their prior call, so each expanded to the same surface: unchanged misses, although adding a
    // row applies to every table. The reading that leaves them out excuses them, and the report says it can.
    const records = checked((arm, condition, i) => (arm === "block" && condition === "refine-add" && i < 7 ? "none" : done(arm, condition))).map((r) =>
      r.arm === "block" && r.condition === "refine-add" && r.operation?.observed === "none" ? { ...r, changed: false } : r,
    );
    const summary = summarize(records, DEFAULT_DECISION, "beside");
    expect(summary.sensitivity[0]).toMatchObject({
      operation: { block: { checked: 48, performed: 41, missed: 7, unchanged: 7 } },
      readings: [
        { failing: "missed", reading: { verdict: "fail" } },
        { failing: "changed-missed", reading: { verdict: "pass", overall: "clear" } },
      ],
      verdictHolds: false,
    });
    const text = report(records, summary);
    expect(text).toContain(`The verdict changes in one reading: the missed ones. ${UNCHANGED_NOTE}`);
    expect(text).toContain("| refine-add | records-table | 17/24; 0 mixed, 7 missed, 7 of them unchanged | 24/24 | 24/24 |");
    expect(text).toContain("An unchanged miss is also what a refinement that ignored its instruction leaves, so unchanged misses on a template that applies to every surface, such as an added row or step, are real ones.");
  });

  it("never says the verdict is safe while a reading without the unchanged misses moves it: correct no-ops in the primitive arms cannot mask the block arm's real misses", () => {
    // Every arm misses 7 removes, but only the block arm's changed their surface: the primitive arms' left theirs as it
    // was (a remove that did not apply). Counting all misses, every arm falls alike and the verdict holds; counting only
    // the misses that changed their surface, the block arm falls alone and the verdict changes.
    const records = checked((arm, condition, i) => (condition === "refine-remove" && i < 7 ? "none" : done(arm, condition))).map((r) =>
      r.arm !== "block" && r.condition === "refine-remove" && r.operation?.observed === "none" ? { ...r, changed: false } : r,
    );
    const summary = summarize(records, DEFAULT_DECISION, "beside");
    expect(summary.sensitivity[0]).toMatchObject({
      readings: [
        { failing: "missed", reading: { verdict: "pass" } },
        { failing: "changed-missed", reading: { verdict: "fail" } },
      ],
      verdictHolds: false,
      robust: false,
    });
    const text = report(records, summary);
    expect(text).toContain("The verdict changes in one reading: the missed ones that changed their surface.");
    expect(text).not.toContain("Neither the verdict");
  });
});

describe("the report says what each figure is", () => {
  it("per success for input and output, execution latency with pacing and emit apart, every condition's paths, fallbacks and invariant failures, the add and remove check, and parity's limits", () => {
    const timings = { totalMs: 12_500, firstGatedAttemptMs: 12_300, emitMs: 3, pacingMs: 12_000, execution: { totalMs: 500, firstGatedAttemptMs: 300, emitMs: 3 } };
    const records = prompts(4).flatMap((p, i) =>
      (["block", "capped", "production"] as Arm[]).flatMap((arm) =>
        CONDITIONS.map((condition) => {
          // The first prompt's remove left its surface exactly as it was.
          const extra: Partial<RunRecord> = { timings, ...operation(condition, condition === "refine-add" ? "add" : "none"), ...(condition !== "fresh" ? { changed: !(condition === "refine-remove" && i === 0) } : {}), parity: i === 0 ? { score: 1, satisfied: [], missing: [] } : { score: 1, satisfied: ["label:status"], missing: [] } };
          if (arm === "block" && condition === "refine-structural") Object.assign(extra, { path: "fallback", budgetRemainingAtFallback: 2, trace: { outcome: "fallback", fallback: { reason: "unsupported", classification: "unsupported-refinement" } } });
          if (arm === "block" && condition === "refine-content" && i === 1) Object.assign(extra, { path: "invariant", outcome: "invariant-failure", parity: undefined, operation: undefined });
          return cell({ arm, prompt: p, condition, passed: !(arm === "block" && condition === "refine-content" && i === 1), extra });
        }),
      ),
    );
    const report = renderReport(resultOf(records), { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpusVersion(1) });
    // Input and output are per success, like the figure they split.
    expect(report).toContain("| Input/success | Output/success |");
    expect(report).not.toMatch(/\| Input \| Output \|/);
    // Latency is execution time; the pacer's waits and the emit time have their own columns.
    expect(report).toContain("| p50 total | p50 first gated | p50 block phase | p50 emit | p50 pacing |");
    expect(report).toMatch(/\| 500 ms \| 300 ms \| n\/a \| 3 ms \| 12000 ms \|/);
    expect(report).toContain("Latencies are execution time: the harness's own pacing and backoff waits are taken out and shown apart (p50 pacing, per cell).");
    // Paths, fallbacks and invariant failures for every arm and condition, and the pooled rows the decision reads.
    expect(report).toContain("### Paths, fallbacks and invariant failures (every arm and condition)");
    expect(report).toContain("| refine-structural | block | 4 | fallback 4/4 | unsupported-refinement 4 | 2 left: 4 | 0 | 0 |");
    expect(report).toContain("| refine-content | block | 4 | primitive 3/3, invariant 0/1 | none | none | 1 | 0 |");
    expect(report).toContain("| all conditions | block | 20 | fallback 4/4, primitive 15/15, invariant 0/1 | unsupported-refinement 4 | 2 left: 4 | 1 | 0 |");
    expect(report).toContain("Completed also counts provider and policy failures, which the pass rate leaves out for re-running.");
    // The add and remove check, per condition.
    expect(report).toContain("| Condition | Arm | Cells | Skipped | Evaluated | Pass rate | Changed | Operation performed | Retention |");
    expect(report).toContain("| refine-add | block | 4 | 0 | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4); 0 mixed, 0 missed |");
    expect(report).toContain("| refine-remove | block | 4 | 0 | 4 | 100.0% (4/4) | 75.0% (3/4) | 0.0% (0/4); 0 mixed, 4 missed, 1 of them unchanged |");
    // By block, per arm, so a template that does not apply to a surface shows where its misses fall.
    expect(report).toContain("### Add and remove refinements, by block");
    expect(report).toContain("| Condition | Block | block | capped | production |");
    expect(report).toContain("| refine-add | records-table | 4/4 | 4/4 | 4/4 |");
    expect(report).toContain("| refine-remove | records-table | 0/4; 0 mixed, 4 missed, 1 of them unchanged | 0/4; 0 mixed, 4 missed, 1 of them unchanged | 0/4; 0 mixed, 4 missed, 1 of them unchanged |");
    expect(report).toContain("| the missed ones that changed their surface | insufficient |");
    expect(report).toContain(UNCHANGED_NOTE);
    expect(report).toContain("| refine-content | block | 4 | 0 | 4 | 75.0% (3/4) | 100.0% (3/3) | n/a |");
    // Parity: an empty checklist is not scored, and action names are not in the frozen checklist.
    expect(report).toContain("100.0% (3 scored, 1 with no checks)");
    expect(report).toContain("- Action names in parity: the plan behind ADR-B3 lists them in the parity checklist, but the frozen corpus (blocks-1b v1) names none, so parity scores labels and components only and cannot show whether an expected action exists. A checklist with nothing to check is not scored.");
  });
});

/** Every arm, the comparative positional arm too: the binding check reads each the same way. */
const EVERY_ARM: Arm[] = ["block", "block-positional", "capped", "production"];
/** 24 prompts, every cell passing its gates; `observed` says what each add and remove did, per arm and prompt index. */
const everyArm = (observed: (arm: Arm, condition: Condition, index: number) => "add" | "remove" | "mixed" | "none", extra: (arm: Arm, condition: Condition, index: number) => Partial<RunRecord> = () => ({})) =>
  prompts(24).flatMap((p, i) =>
    EVERY_ARM.flatMap((arm) =>
      CONDITIONS.map((condition) => cell({ arm, prompt: p, condition, passed: true, tokens: arm.startsWith("block") ? [50, 0] : [100, 0], extra: { ...operation(condition, observed(arm, condition, i)), ...extra(arm, condition, i) } })),
    ),
  );

describe("corpus v2 makes the operation check binding (ADR-B3 amendment 2), the same way for every arm", () => {
  it("fails a passing add or remove that missed its operation, in every arm alike, and leaves every other cell as the pipeline scored it", () => {
    // In every arm, three adds changed no list and one remove only grew a list; one more remove was mixed.
    const records = everyArm((arm, condition, i) => (condition === "refine-add" && i < 3 ? "none" : condition === "refine-remove" && i === 3 ? "add" : condition === "refine-remove" && i === 4 ? "mixed" : done(arm, condition)));
    const beside = summarize(records, DEFAULT_DECISION, "beside");
    const binding = summarize(records, DEFAULT_DECISION, "binding");
    expect(beside.scoring).toBe("beside");
    expect(binding.scoring).toBe("binding");
    for (const arm of EVERY_ARM) {
      const of = (summary: typeof beside, condition: string) => summary.arms.find((s) => s.arm === arm && s.condition === condition)!;
      expect([of(beside, "refine-add").passed, of(binding, "refine-add").passed], arm).toEqual([24, 21]);
      // The mixed remove passes; the one that only added is missed.
      expect([of(beside, "refine-remove").passed, of(binding, "refine-remove").passed], arm).toEqual([24, 23]);
      for (const condition of ["fresh", "refine-content", "refine-structural"]) expect(of(binding, condition), `${arm} ${condition}`).toEqual(of(beside, condition));
      // The check's own counts stay those of the refinements the pipeline passed.
      expect(of(binding, "refine-add").operation).toEqual(of(beside, "refine-add").operation);
      expect(of(binding, "refine-remove").operation).toMatchObject({ checked: 24, performed: 22, mixed: 1, missed: 1 });
      expect(of(binding, "refine-add").changed).toBe(of(beside, "refine-add").changed);
    }
  });

  it("feeds both inputs of the rule: a missed operation lowers the pass rate and is no success in tokens per success", () => {
    // Only the block arm misses: 8 of its 24 adds changed no list.
    const records = everyArm((arm, condition, i) => (arm === "block" && condition === "refine-add" && i < 8 ? "none" : done(arm, condition)));
    const [beside] = summarize(records, DEFAULT_DECISION, "beside").decisions;
    const [binding] = summarize(records, DEFAULT_DECISION, "binding").decisions;
    expect(beside).toMatchObject({ verdict: "pass", counts: { passed: { block: 120, capped: 120, production: 120 }, meteredSuccesses: { block: 120 } } });
    expect(binding).toMatchObject({ verdict: "fail", counts: { passed: { block: 112, capped: 120, production: 120 }, meteredSuccesses: { block: 112 } } });
    expect(binding!.reasons.join("\n")).toMatch(/pass rate 93\.3% is more than 5 points below production \(100\.0%\)/);
    // Every call still counts: the block arm's tokens stay 120 x 50, over 112 successes.
    expect(binding!.tokens.block).toBeCloseTo(6000 / 112, 6);
  });

  it("fails closed: a passing add or remove the check never read is no success under binding", () => {
    const records = everyArm((arm, condition) => done(arm, condition), (arm, condition, i) => (arm === "capped" && condition === "refine-remove" && i === 0 ? { operation: undefined } : {}));
    const capped = summarize(records, DEFAULT_DECISION, "binding").arms.find((s) => s.arm === "capped" && s.condition === "refine-remove")!;
    expect(capped).toMatchObject({ passed: 23, operation: { checked: 23, performed: 23, unchecked: 1 } });
  });

  it("names the adds and removes it failed closed, in the bullet and the tables, and never calls them none", () => {
    // Twelve production adds and removes passed the pipeline with no check record.
    const some = everyArm(done, (arm, condition, i) => (arm === "production" && (condition === "refine-add" || condition === "refine-remove") && i < 6 ? { operation: undefined } : {}));
    const summary = summarize(some, DEFAULT_DECISION, "binding");
    expect(summary.decisions[0]).toMatchObject({ counts: { passed: { block: 120, capped: 120, production: 108 } } });
    const text = renderReport(resultOf(some, summary), { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpusVersion(2) });
    expect(text).toContain("block performed 48 of the 48 the pipeline passed (0 mixed, 0 missed); capped 48 of 48 (0 mixed, 0 missed); production 36 of 48 (0 mixed, 0 missed, 12 unchecked).");
    expect(text).toContain("| refine-add | production | 24 | 0 | 24 | 75.0% (18/24) | 0.0% (0/24) | 75.0% (18/24); 0 mixed, 0 missed, 6 unchecked |");
    expect(text).toContain("Performed of those the pipeline passed, per arm. Under corpus v2 the missed and unchecked ones are failures (the check is binding).");
    // None checked at all: every add and remove failed closed, and the report says so.
    const all = everyArm(done, (_arm, condition) => (condition === "refine-add" || condition === "refine-remove" ? { operation: undefined } : {}));
    const none = summarize(all, DEFAULT_DECISION, "binding");
    expect(none.decisions[0]).toMatchObject({ counts: { passed: { block: 72, capped: 72, production: 72 } } });
    const noneText = renderReport(resultOf(all, none), { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpusVersion(2) });
    expect(noneText).toContain("block performed 0 of the 48 the pipeline passed (0 mixed, 0 missed, 48 unchecked); capped 0 of 48 (0 mixed, 0 missed, 48 unchecked); production 0 of 48 (0 mixed, 0 missed, 48 unchecked).");
    expect(noneText).not.toContain("failed none");
  });

  it("refuses to report a summary scored otherwise than its corpus says, so a v2 run is never shown with v1's scoring", () => {
    const records = everyArm((arm, condition, i) => (condition === "refine-add" && i < 2 ? "none" : done(arm, condition)));
    expect(() => renderReport(resultOf(records, summarize(records, DEFAULT_DECISION, "beside")), { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpusVersion(2) })).toThrow(/the summary was scored "beside", but corpus blocks-1b v2 scores "binding"/);
    expect(() => renderReport(resultOf(records, summarize(records, DEFAULT_DECISION, "binding")), { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpusVersion(1) })).toThrow(/the summary was scored "binding", but corpus blocks-1b v1 scores "beside"/);
  });

  it("brackets the verdict in the sensitivity table: the pipeline's pass alone below it, the mixed ones failing too above it", () => {
    const records = everyArm((arm, condition, i) => (arm === "block" && condition === "refine-add" && i < 8 ? "none" : arm === "production" && condition === "refine-remove" && i < 4 ? "mixed" : done(arm, condition)));
    const summary = summarize(records, DEFAULT_DECISION, "binding");
    expect(summary.decisions[0]).toMatchObject({ verdict: "fail" });
    expect(summary.sensitivity[0]).toMatchObject({
      readings: [
        { failing: "none", reading: { verdict: "pass", passed: { block: 120, capped: 120, production: 120 } } },
        { failing: "missed-and-mixed", reading: { verdict: "fail", passed: { block: 112, capped: 120, production: 116 } } },
      ],
      verdictHolds: false,
    });
    const text = renderReport(resultOf(records, summary), { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpusVersion(2) });
    expect(text).toContain("- Scoring: corpus blocks-1b v2 makes the add and remove check binding (ADR-B3 amendment 2): a passing add or remove refinement that missed its operation, changing no list or only the other way, counts as a failure in every arm, and so does one the check never read (unchecked); a mixed change passes.");
    expect(text).toContain("- Add and remove refinements (live/operation.ts; binding, so the missed and unchecked ones are failures): block performed 40 of the 48 the pipeline passed (0 mixed, 8 missed); capped 48 of 48 (0 mixed, 0 missed); production 44 of 48 (4 mixed, 0 missed). The decision read without the check, and with the mixed ones failing too, is below; the verdict above stands.");
    expect(text).toContain("| no refinement (the pipeline's pass alone) | pass | clear | 100.0% (120/120) | 100.0% (120/120) | 100.0% (120/120) | 50.0% |");
    expect(text).toContain("| the missed and mixed ones | fail |");
    expect(text).toContain("The verdict changes in one reading: no refinement (the pipeline's pass alone).");
    expect(text).toContain("Under corpus v2 the pass rate counts a missed or unchecked add or remove as a failure (the check is binding); Changed and Operation performed are of the refinements the pipeline passed.");
  });

  it("says so when the binding check failed nothing, and leaves corpus v1's scoring exactly as it was", () => {
    const records = everyArm(done);
    const binding = summarize(records, DEFAULT_DECISION, "binding");
    expect(binding.sensitivity[0]).toMatchObject({ readings: [], robust: true });
    expect(renderReport(resultOf(records, binding), { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpusVersion(2) })).toContain("Every one changed its lists the way its template asked, so the binding check failed none.");
    const mixed = everyArm((arm, condition, i) => (condition === "refine-add" && i < 2 ? "none" : done(arm, condition)));
    // Corpus v1 keeps the pipeline's pass: its decision is the one read on the records as they are.
    expect(summarize(mixed, DEFAULT_DECISION, "beside").decisions).toEqual(decide(mixed, DEFAULT_DECISION));
    expect(renderReport(resultOf(mixed), { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpusVersion(1) })).toContain("- Scoring: corpus blocks-1b v1 reports the add and remove check beside the pass, never in it.");
  });

  it("has no default scoring: summarizing without the corpus's rule is refused, so a v2 run is never summarized as v1", () => {
    const records = everyArm((arm, condition, i) => (condition === "refine-add" && i < 2 ? "none" : done(arm, condition)));
    expect(() => summarize(records, DEFAULT_DECISION, undefined as never)).toThrow(/scoring/);
    expect(() => operationSensitivity(records, DEFAULT_DECISION, [], undefined as never)).toThrow(/scoring/);
  });

  it("under corpus v1, never says every add and remove changed its lists while some were never read", () => {
    const records = everyArm(done, (arm, condition, i) => (arm === "production" && condition === "refine-add" && i < 6 ? { operation: undefined } : {}));
    const summary = summarize(records, DEFAULT_DECISION, "beside");
    expect(summary.sensitivity[0]).toMatchObject({ readings: [] });
    const text = renderReport(resultOf(records, summary), { providerId: "hosted-ai:claude-haiku-4.5", corpus: readCorpusVersion(1) });
    expect(text).not.toContain("Every one changed its lists the way its template asked");
    expect(text).toContain("Every one the check read changed its lists the way its template asked; the 6 it never read count as the pipeline passed them, which the check cannot confirm.");
    expect(text).not.toContain("(the check is binding)");
  });
});
