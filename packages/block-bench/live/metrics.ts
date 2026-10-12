/**
 * The summary and the decision rule (ADR-B3), pure over run records.
 *
 * Pass rates count completed runs minus the provider and policy failures,
 * which are reported separately and re-run symmetrically; budget exhaustion,
 * fallback and invariant outcomes are arm results. Tokens per success is the
 * ADR-B3 figure: provider-reported input plus output across every call of
 * every metered evaluated run, failures included, divided by the metered
 * successes. A run with a call missing either figure leaves the cohort
 * entirely, never estimated. The guardrail holds the block arm within the
 * margin of BOTH primitive arms (ADR-B4 fairness).
 *
 * The decision pools every evaluated result of every condition, fresh
 * builds and refinements alike: ADR-B3 counts "every call (planning,
 * generation, repairs, fallback, refinement)". Its minimum applies to the
 * evaluated runs AND to the metered cohort the token figure rests on, and
 * its boundaries are inclusive: an exact 30% cut passes, and a gap of
 * exactly the margin is within it.
 *
 * The pre-data addendum (docs/blocks/ADR-B3-ADDENDUM.md) keeps every
 * threshold and makes the unit explicit. The rule is a descriptive product
 * decision rule, not a statistical test. The independent unit is the prompt
 * thread (one prompt on one reference in one arm: its fresh build and its
 * refinements, which are repeated observations), so the minimum counts
 * threads, never cells. Arms are compared paired by prompt. Each criterion
 * carries a 95% interval from a paired cluster bootstrap over prompts, and
 * is called clear only when the whole interval sits on one side of its
 * threshold.
 */
import { missed, performed } from "./operation";
import type { Arm, Condition, FailureKind, OperationCheck, Path, RunRecord } from "./types";

export interface DecisionOptions {
  /** The required drop in tokens per success against today's production configuration. */
  reduction: number;
  /** The non-inferiority margin on the pass rate, in points of rate. */
  margin: number;
  /** Evaluated runs each arm needs before the rule can be applied. */
  minimum: number;
}
/** ADR-B3's rule, fixed before any run: frozen here and pinned by a test, and recorded in every run manifest. */
export const DEFAULT_DECISION: Readonly<DecisionOptions> = Object.freeze({ reduction: 0.3, margin: 0.05, minimum: 20 });

export interface ArmStats {
  reference: string;
  provider: string;
  arm: Arm;
  /** "all" for the pooled stats the decision reads. */
  condition: Condition | "all";
  n: number;
  skipped: number;
  completed: number;
  /** Provider and policy failures: reported separately, to be re-run. */
  rerunEligible: number;
  rerunByKind: Partial<Record<FailureKind, number>>;
  /** completed - rerunEligible: the pass-rate denominator. */
  evaluated: number;
  passed: number;
  passRate: number | null;
  /** Passed at the first attempt: the numerator of firstAttemptPassRate (over evaluated). */
  firstAttemptPassed: number;
  firstAttemptPassRate: number | null;
  repairsPerSuccess: number | null;
  /** The cohort: evaluated runs whose every provider call reported its usage, failures included. */
  meteredRuns: number;
  meteredSuccesses: number;
  /** The cohort's provider-reported input plus output tokens: the numerator of tokensPerSuccess (over meteredSuccesses). */
  meteredTokens: number;
  unmeteredRuns: number;
  unmeteredSuccesses: number;
  /** ADR-B3: the cohort's tokens over its successes. Null when the cohort reports no provider usage at all (scripted). */
  tokensPerSuccess: number | null;
  inputTokensPerSuccess: number | null;
  outputTokensPerSuccess: number | null;
  /** The mean cost of a passing run alone: context for the figure above, never the rule's input. */
  tokensPerPassingRun: number | null;
  providerCallsPerRun: number | null;
  requestBytesPerRun: number | null;
  /**
   * Medians per cell. The first five are execution time: the harness's own pacing and backoff waits are left out, and
   * `pacingMs` is the median of those waits per cell. A record that kept no execution figures has none here, never its
   * wall clock; `wallTotalMs` is the median wall-clock total, waits included.
   */
  latency: { totalMs: number | null; firstGatedAttemptMs: number | null; blockPhaseMs: number | null; emitMs: number | null; planMs: number | null; pacingMs: number | null; wallTotalMs: number | null };
  /**
   * Mean checklist score over the passing runs scored (scored), and how many scored a full pass. A checklist with
   * nothing to check scores no one: those runs are counted apart (noChecks), never as a full score.
   */
  parity: { meanScore: number | null; scored: number; fullyParityPassed: number; noChecks: number };
  /**
   * Passing add and remove refinements, by what their surfaces did (live/operation.ts): performed (the requested
   * direction only), mixed (lists changed both ways), missed (no list changed, or only the other way). A measurement
   * beside the pass rate, never in it.
   */
  operation: { checked: number; performed: number; mixed: number; missed: number };
  paths: Partial<Record<Path, { n: number; passed: number }>>;
  budgetRemainingAtFallback: Record<string, number>;
  fallbackByClassification: Record<string, number>;
  invariantFailures: number;
  budgetExhausted: number;
  /** Refinements only: passing refinements that changed the surface (changed of refinedPassed). */
  changedRate: number | null;
  changed: number;
  refinedPassed: number;
  /** Refinements on a block prior that stayed in block mode (retained of onBlockPrior). */
  retention: number | null;
  retained: number;
  onBlockPrior: number;
}

export interface SelectionStats {
  reference: string;
  provider: string;
  n: number;
  correct: number;
  accuracy: number | null;
  /** expected block, same block chosen */
  hit: number;
  /** expected block, null answered */
  missedToNull: number;
  /** expected block, another block chosen */
  wrongBlock: number;
  /** expected null, null answered */
  nullCorrect: number;
  /** expected null, a block chosen */
  falseBlock: number;
  explicitNull: number;
  omitted: number;
  rejected: number;
  /** The planning call returned an unusable output: no answer, counted wrong and in no other bucket. */
  planningFailed: number;
  /** The planner's intent matched the label: the numerator of intentAccuracy (over n). */
  intentCorrect: number;
  intentAccuracy: number | null;
}

/** Named against positional encoding (ADR-B2), paired by prompt: informs ADR-B2 and decides nothing. */
export interface EncodingComparison {
  reference: string;
  provider: string;
  /** Positional against named, prompt by prompt. */
  paired: PairedCounts;
  /** 95% paired cluster-bootstrap intervals: positional pass rate minus named, and positional's token reduction against named. */
  intervals: { passDiff: Interval | null; tokenReduction: Interval | null };
}

/** The addendum's uncertainty: a paired cluster bootstrap over prompts, fixed before any hosted result. */
export const BOOTSTRAP: Readonly<{ resamples: number; level: number }> = Object.freeze({ resamples: 2000, level: 0.95 });

/** A percentile interval and what it rests on: its resamples (a resample with no success in an arm has no token figure) and the prompts they draw from. */
export interface Interval {
  low: number;
  high: number;
  resamples: number;
  /** The paired cohort: the prompts every compared arm evaluated, the only prompts a resample draws. */
  prompts: number;
}

/**
 * Whether a criterion's whole interval sits on one side of its unchanged threshold. Below the rule's minimum of prompts
 * in common the interval is not interpretable (the addendum), so the criterion is insufficient however it lies.
 */
export type Clarity = "clear-pass" | "clear-fail" | "uncertain" | "insufficient" | "n/a";

/** One arm against another, prompt by prompt, over the prompts both evaluated. */
export interface PairedCounts {
  prompts: number;
  /** The first arm's thread pass rate against the second's. */
  passRate: { better: number; same: number; worse: number };
  /** Tokens per success, over the prompts where both threads have a metered success. */
  tokensPerSuccess: { lower: number; same: number; higher: number; comparable: number };
}

type Trio<T> = { block: T; capped: T; production: T };

export interface Decision {
  reference: string;
  provider: string;
  verdict: "pass" | "fail" | "insufficient";
  reasons: string[];
  tokens: { block: number | null; capped: number | null; production: number | null; reductionVsProduction: number | null; reductionVsCapped: number | null };
  passRates: { block: number | null; capped: number | null; production: number | null };
  /** Evaluated cells per arm. */
  evaluated: Trio<number>;
  /** Cells in each arm's token cohort. */
  metered: Trio<number>;
  /** Prompt threads with an evaluated cell, per arm: the unit the minimum counts. */
  threads: Trio<number>;
  /** Prompt threads with a metered evaluated cell, per arm. */
  meteredThreads: Trio<number>;
  /** The raw counts behind every rate: passed of evaluated, metered tokens over metered successes. */
  counts: { passed: Trio<number>; meteredTokens: Trio<number>; meteredSuccesses: Trio<number> };
  /** The paired cohort: prompts every decision arm evaluated. The intervals resample these alone, and a decision is clear only when there are at least the minimum's. */
  cohort: number;
  /** 95% paired cluster-bootstrap intervals (prompts resampled, the same resample in every arm). Pass differences are the block arm's rate minus the other's. */
  intervals: { reductionVsProduction: Interval | null; reductionVsCapped: Interval | null; passDiffVsProduction: Interval | null; passDiffVsCapped: Interval | null };
  clarity: { tokens: Clarity; vsProduction: Clarity; vsCapped: Clarity; overall: "clear" | "uncertain" | "insufficient" };
  paired: { vsProduction: PairedCounts; vsCapped: PairedCounts };
  options: DecisionOptions;
}

/** A recomputed decision, with the raw counts behind its pass rates. */
export interface SensitivityReading {
  verdict: Decision["verdict"];
  overall: Decision["clarity"]["overall"];
  passed: Trio<number>;
  evaluated: Trio<number>;
  reductionVsProduction: number | null;
}

/**
 * Whether a decision rests on add and remove refinements that did not do what they asked (live/operation.ts). The
 * verdict counts them as ADR-B3 froze the pass, whatever they did; this recomputes the decision with them failing, as a
 * sensitivity check that never replaces the verdict. Missed refinements (no list changed, or only the other way) fail
 * in the first reading; mixed ones (lists changed both ways) fail too in the second, so the two bound what the check
 * could do to the decision.
 */
export interface OperationSensitivity {
  reference: string;
  provider: string;
  /** Per decision arm, its passing add and remove refinements by what they did. */
  operation: Trio<ArmStats["operation"]>;
  missedAsFailures: SensitivityReading;
  notPerformedAsFailures: SensitivityReading;
  /** Both readings give the verdict and its clarity: the decision does not rest on what the check found. */
  robust: boolean;
}

export interface Summary {
  /** Per condition. */
  arms: ArmStats[];
  /** Per arm, every condition pooled: what the decision reads. */
  pooled: ArmStats[];
  selection: SelectionStats[];
  decisions: Decision[];
  /** Per decision, whether it rests on add and remove refinements that did not do what they asked. */
  sensitivity: OperationSensitivity[];
  encodings: EncodingComparison[];
  totals: { records: number; completed: number; providerCalls: number; inputTokens: number; outputTokens: number; requestBytes: number };
}

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);
const mean = (values: number[]): number | null => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
/** Boundaries are inclusive and judged exactly: floating point must not turn an exact 30% cut or a 5-point gap into a failure. */
const EPSILON = 1e-9;

export function armStats(records: readonly RunRecord[], options: { pooled?: boolean } = {}): ArmStats[] {
  const groupKey = (r: RunRecord) => `${r.reference}|${r.provider}|${r.arm}|${options.pooled ? "all" : r.condition}`;
  const groups = new Map<string, RunRecord[]>();
  for (const r of records) {
    const list = groups.get(groupKey(r)) ?? [];
    list.push(r);
    groups.set(groupKey(r), list);
  }
  const out: ArmStats[] = [];
  for (const list of groups.values()) {
    const first = list[0]!;
    const completed = list.filter((r) => r.status === "completed");
    const rerun = completed.filter((r) => r.failure?.rerunEligible);
    const rerunByKind: Partial<Record<FailureKind, number>> = {};
    for (const r of rerun) rerunByKind[r.failure!.kind] = (rerunByKind[r.failure!.kind] ?? 0) + 1;
    const evaluated = completed.filter((r) => !r.failure?.rerunEligible);
    const passed = evaluated.filter((r) => r.passed);
    const metered = evaluated.filter((r) => r.tokens.unreportedCalls === 0);
    const meteredSuccesses = metered.filter((r) => r.passed);
    const reported = metered.some((r) => r.tokens.providerCalls > 0);
    const perSuccess = (pick: (r: RunRecord) => number): number | null =>
      !reported || meteredSuccesses.length === 0 ? null : metered.reduce((a, r) => a + pick(r), 0) / meteredSuccesses.length;
    const paths: ArmStats["paths"] = {};
    for (const r of completed) {
      const p = r.path ?? "primitive";
      const entry = paths[p] ?? { n: 0, passed: 0 };
      entry.n += 1;
      if (r.passed) entry.passed += 1;
      paths[p] = entry;
    }
    const budgetRemainingAtFallback: Record<string, number> = {};
    const fallbackByClassification: Record<string, number> = {};
    for (const r of completed) {
      if (r.budgetRemainingAtFallback !== undefined) budgetRemainingAtFallback[String(r.budgetRemainingAtFallback)] = (budgetRemainingAtFallback[String(r.budgetRemainingAtFallback)] ?? 0) + 1;
      const classification = (r.trace as { fallback?: { classification?: string } } | undefined)?.fallback?.classification;
      if (classification) fallbackByClassification[classification] = (fallbackByClassification[classification] ?? 0) + 1;
    }
    const refinements = completed.filter((r) => r.condition !== "fresh");
    const withBlockPrior = refinements.filter((r) => r.refinement && r.refinement.mode !== "primitive");
    const refinedPassed = refinements.filter((r) => r.passed);
    // A checklist with nothing to check (no label, no component) scores no one; it is counted apart, never as a full score.
    const checks = (r: RunRecord) => (r.parity ? r.parity.satisfied.length + r.parity.missing.length : 0);
    const parityScored = passed.filter((r) => typeof r.parity?.score === "number" && checks(r) > 0);
    const scored = parityScored.map((r) => r.parity!.score);
    const operations = passed.map((r) => r.operation).filter((o): o is OperationCheck => o !== undefined);
    const execution = (pick: (t: NonNullable<RunRecord["timings"]["execution"]>) => number | undefined) =>
      median(completed.map((r) => (r.timings.execution ? pick(r.timings.execution) : undefined)).filter((v): v is number => typeof v === "number"));
    out.push({
      reference: first.reference,
      provider: first.provider,
      arm: first.arm,
      condition: options.pooled ? "all" : first.condition,
      n: list.length,
      skipped: list.length - completed.length,
      completed: completed.length,
      rerunEligible: rerun.length,
      rerunByKind,
      evaluated: evaluated.length,
      passed: passed.length,
      passRate: ratio(passed.length, evaluated.length),
      firstAttemptPassed: passed.filter((r) => r.attempts === 1).length,
      firstAttemptPassRate: ratio(passed.filter((r) => r.attempts === 1).length, evaluated.length),
      repairsPerSuccess: passed.length === 0 ? null : passed.reduce((a, r) => a + Math.max(0, r.attempts - 1), 0) / passed.length,
      meteredRuns: metered.length,
      meteredSuccesses: meteredSuccesses.length,
      meteredTokens: metered.reduce((a, r) => a + r.tokens.input + r.tokens.output, 0),
      unmeteredRuns: evaluated.length - metered.length,
      unmeteredSuccesses: passed.length - meteredSuccesses.length,
      tokensPerSuccess: perSuccess((r) => r.tokens.input + r.tokens.output),
      inputTokensPerSuccess: perSuccess((r) => r.tokens.input),
      outputTokensPerSuccess: perSuccess((r) => r.tokens.output),
      tokensPerPassingRun: !reported ? null : mean(meteredSuccesses.map((r) => r.tokens.input + r.tokens.output)),
      providerCallsPerRun: mean(completed.map((r) => r.tokens.providerCalls)),
      requestBytesPerRun: mean(completed.map((r) => r.requestBytes)),
      latency: {
        totalMs: execution((t) => t.totalMs),
        firstGatedAttemptMs: execution((t) => t.firstGatedAttemptMs),
        blockPhaseMs: execution((t) => t.blockPhaseMs),
        emitMs: execution((t) => t.emitMs),
        planMs: execution((t) => t.planMs),
        pacingMs: median(completed.map((r) => r.timings.pacingMs).filter((v): v is number => typeof v === "number")),
        wallTotalMs: median(completed.map((r) => r.timings.totalMs)),
      },
      parity: { meanScore: mean(scored), scored: scored.length, fullyParityPassed: parityScored.filter((r) => r.parity!.score === 1).length, noChecks: passed.filter((r) => r.parity && checks(r) === 0).length },
      operation: { checked: operations.length, performed: operations.filter(performed).length, mixed: operations.filter((o) => o.observed === "mixed").length, missed: operations.filter(missed).length },
      paths,
      budgetRemainingAtFallback,
      fallbackByClassification,
      invariantFailures: completed.filter((r) => r.outcome === "invariant-failure").length,
      budgetExhausted: completed.filter((r) => r.failure?.kind === "budget").length,
      changedRate: refinements.length === 0 ? null : ratio(refinedPassed.filter((r) => r.changed).length, refinedPassed.length),
      changed: refinedPassed.filter((r) => r.changed).length,
      refinedPassed: refinedPassed.length,
      retention: withBlockPrior.length === 0 ? null : ratio(withBlockPrior.filter((r) => r.refinement!.retained).length, withBlockPrior.length),
      retained: withBlockPrior.filter((r) => r.refinement!.retained).length,
      onBlockPrior: withBlockPrior.length,
    });
  }
  return out.sort((a, b) => `${a.reference}|${a.provider}|${a.condition}|${a.arm}`.localeCompare(`${b.reference}|${b.provider}|${b.condition}|${b.arm}`));
}

export function selectionStats(records: readonly RunRecord[]): SelectionStats[] {
  const groups = new Map<string, RunRecord[]>();
  for (const r of records) {
    if (r.arm !== "block" || r.condition !== "fresh" || r.status !== "completed" || !r.selection) continue;
    const k = `${r.reference}|${r.provider}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: SelectionStats[] = [];
  for (const list of groups.values()) {
    const s = { n: list.length, correct: 0, hit: 0, missedToNull: 0, wrongBlock: 0, nullCorrect: 0, falseBlock: 0, explicitNull: 0, omitted: 0, rejected: 0, planningFailed: 0, intentCorrect: 0 };
    for (const r of list) {
      const sel = r.selection!;
      // No answer: the routing came from the deterministic fallback, so neither the block nor the intent is the planner's.
      if (sel.planningFailed) {
        s.planningFailed += 1;
        continue;
      }
      // The planner's answer: a block reconciliation withdrew is still the block it named.
      const answer = sel.rejected ?? sel.chosen;
      if (answer === r.expected.block) s.correct += 1;
      if (r.expected.block) {
        if (answer === r.expected.block) s.hit += 1;
        else if (answer === null) s.missedToNull += 1;
        else s.wrongBlock += 1;
      } else if (answer === null) s.nullCorrect += 1;
      else s.falseBlock += 1;
      if (sel.source === "omitted") s.omitted += 1;
      else if (answer === null) s.explicitNull += 1;
      if (sel.rejected) s.rejected += 1;
      if (r.plan?.intent === r.expected.intent) s.intentCorrect += 1;
    }
    const first = list[0]!;
    out.push({ reference: first.reference, provider: first.provider, ...s, accuracy: ratio(s.correct, s.n), intentAccuracy: ratio(s.intentCorrect, s.n) });
  }
  return out.sort((a, b) => `${a.reference}|${a.provider}`.localeCompare(`${b.reference}|${b.provider}`));
}

/** One prompt thread's evaluated cells, summed: what the bootstrap resamples. */
interface ThreadSums {
  evaluated: number;
  passed: number;
  metered: number;
  meteredSuccesses: number;
  meteredTokens: number;
  reported: boolean;
}

/** Per prompt, the sums of one arm's evaluated cells (provider and policy failures excluded, as in the pass rate). */
export function threadSums(records: readonly RunRecord[], arm: Arm): Map<string, ThreadSums> {
  const out = new Map<string, ThreadSums>();
  for (const r of records) {
    if (r.arm !== arm || r.status !== "completed" || r.failure?.rerunEligible) continue;
    const t = out.get(r.prompt) ?? { evaluated: 0, passed: 0, metered: 0, meteredSuccesses: 0, meteredTokens: 0, reported: false };
    t.evaluated += 1;
    if (r.passed) t.passed += 1;
    if (r.tokens.unreportedCalls === 0) {
      t.metered += 1;
      t.meteredTokens += r.tokens.input + r.tokens.output;
      if (r.passed) t.meteredSuccesses += 1;
      if (r.tokens.providerCalls > 0) t.reported = true;
    }
    out.set(r.prompt, t);
  }
  return out;
}

/** An arm's pooled pass rate and tokens per success over a multiset of prompts (a resample repeats prompts). */
function pooledOver(sums: Map<string, ThreadSums>, prompts: readonly string[]): { passRate: number | null; tokensPerSuccess: number | null } {
  let evaluated = 0;
  let passed = 0;
  let meteredSuccesses = 0;
  let meteredTokens = 0;
  let reported = false;
  for (const p of prompts) {
    const t = sums.get(p);
    if (!t) continue;
    evaluated += t.evaluated;
    passed += t.passed;
    meteredSuccesses += t.meteredSuccesses;
    meteredTokens += t.meteredTokens;
    reported ||= t.reported;
  }
  return { passRate: ratio(passed, evaluated), tokensPerSuccess: !reported || meteredSuccesses === 0 ? null : meteredTokens / meteredSuccesses };
}

/** A small seeded generator (mulberry32), so an interval is the same every time the same records are summarized. */
function seeded(label: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 16777619) >>> 0;
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The percentile interval of the values a statistic took across resamples; null when it never had one. */
function interval(values: number[], level: number, prompts: number): Interval | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => {
    const i = q * (sorted.length - 1);
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
  };
  return { low: at((1 - level) / 2), high: at(1 - (1 - level) / 2), resamples: values.length, prompts };
}

/** The prompts every arm evaluated (a thread exists only where an arm has an evaluated cell), in a stable order. */
export function sharedPrompts(sums: Readonly<Record<string, Map<string, ThreadSums>>>): string[] {
  const [first, ...rest] = Object.values(sums);
  if (!first) return [];
  return [...first.keys()].filter((p) => rest.every((m) => m.has(p))).sort();
}

/**
 * A paired cluster bootstrap: resample the prompts with replacement and compute every arm's pooled figures on the
 * same resample, so each interval carries the between-prompt variation and the pairing. Only the prompts every arm
 * evaluated are drawn, so a prompt one arm lacks (a partial run) cannot pass for a pair. Cells inside a thread are
 * never resampled on their own, so repeating them cannot narrow an interval.
 */
export function pairedBootstrap(
  sums: Readonly<Record<string, Map<string, ThreadSums>>>,
  statistics: Record<string, (pooled: Record<string, { passRate: number | null; tokensPerSuccess: number | null }>) => number | null>,
  label: string,
  options: { resamples: number; level: number } = BOOTSTRAP,
): Record<string, Interval | null> {
  const prompts = sharedPrompts(sums);
  const values: Record<string, number[]> = Object.fromEntries(Object.keys(statistics).map((k) => [k, []]));
  if (prompts.length > 0) {
    const random = seeded(label);
    const sample: string[] = new Array(prompts.length);
    for (let b = 0; b < options.resamples; b++) {
      for (let i = 0; i < prompts.length; i++) sample[i] = prompts[Math.floor(random() * prompts.length)]!;
      const pooled = Object.fromEntries(Object.entries(sums).map(([arm, m]) => [arm, pooledOver(m, sample)]));
      for (const [name, statistic] of Object.entries(statistics)) {
        const v = statistic(pooled);
        if (v !== null && Number.isFinite(v)) values[name]!.push(v);
      }
    }
  }
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, interval(v, options.level, prompts.length)]));
}

/** One arm against another, prompt by prompt. */
export function pairedCounts(first: Map<string, ThreadSums>, second: Map<string, ThreadSums>): PairedCounts {
  const out: PairedCounts = { prompts: 0, passRate: { better: 0, same: 0, worse: 0 }, tokensPerSuccess: { lower: 0, same: 0, higher: 0, comparable: 0 } };
  for (const [prompt, a] of first) {
    const b = second.get(prompt);
    if (!b || a.evaluated === 0 || b.evaluated === 0) continue;
    out.prompts += 1;
    const ra = a.passed / a.evaluated;
    const rb = b.passed / b.evaluated;
    out.passRate[ra > rb ? "better" : ra < rb ? "worse" : "same"] += 1;
    if (a.reported && b.reported && a.meteredSuccesses > 0 && b.meteredSuccesses > 0) {
      const ta = a.meteredTokens / a.meteredSuccesses;
      const tb = b.meteredTokens / b.meteredSuccesses;
      out.tokensPerSuccess.comparable += 1;
      out.tokensPerSuccess[ta < tb ? "lower" : ta > tb ? "higher" : "same"] += 1;
    }
  }
  return out;
}

const clarityOf = (iv: Interval | null, threshold: number, enough: boolean): Clarity =>
  !iv ? "n/a" : !enough ? "insufficient" : iv.low >= threshold - EPSILON ? "clear-pass" : iv.high < threshold - EPSILON ? "clear-fail" : "uncertain";

/** The arms the ADR-B3 rule reads. The positional arm is comparative (ADR-B2) and never opens or changes a decision. */
export const DECISION_ARMS: readonly Arm[] = ["block", "capped", "production"];

/** The ADR-B3 decision per reference and provider, over every evaluated result of every condition. */
export function decide(records: readonly RunRecord[], options: DecisionOptions = DEFAULT_DECISION): Decision[] {
  const decisionRecords = records.filter((r) => DECISION_ARMS.includes(r.arm));
  const stats = armStats(decisionRecords, { pooled: true });
  const keys = new Set(stats.map((s) => `${s.reference}|${s.provider}`));
  const out: Decision[] = [];
  for (const key of keys) {
    const [reference, provider] = key.split("|") as [string, string];
    const arm = (a: Arm) => stats.find((s) => s.reference === reference && s.provider === provider && s.arm === a);
    const block = arm("block");
    const capped = arm("capped");
    const production = arm("production");
    const evaluated = { block: block?.evaluated ?? 0, capped: capped?.evaluated ?? 0, production: production?.evaluated ?? 0 };
    const metered = { block: block?.meteredRuns ?? 0, capped: capped?.meteredRuns ?? 0, production: production?.meteredRuns ?? 0 };
    const scope = decisionRecords.filter((r) => r.reference === reference && r.provider === provider);
    const sums = { block: threadSums(scope, "block"), capped: threadSums(scope, "capped"), production: threadSums(scope, "production") };
    const trio = <T>(pick: (m: Map<string, ThreadSums>) => T): Trio<T> => ({ block: pick(sums.block), capped: pick(sums.capped), production: pick(sums.production) });
    const threads = trio((m) => [...m.values()].filter((t) => t.evaluated > 0).length);
    const meteredThreads = trio((m) => [...m.values()].filter((t) => t.metered > 0).length);
    const total = (pick: (t: ThreadSums) => number) => trio((m) => [...m.values()].reduce((a, t) => a + pick(t), 0));
    const counts = { passed: total((t) => t.passed), meteredTokens: total((t) => t.meteredTokens), meteredSuccesses: total((t) => t.meteredSuccesses) };
    const reduction = (other: "production" | "capped") => (p: Record<string, { tokensPerSuccess: number | null }>) => {
      const b = p.block?.tokensPerSuccess ?? null;
      const o = p[other]?.tokensPerSuccess ?? null;
      return b === null || o === null || o <= 0 ? null : 1 - b / o;
    };
    const passDiff = (other: "production" | "capped") => (p: Record<string, { passRate: number | null }>) => {
      const b = p.block?.passRate ?? null;
      const o = p[other]?.passRate ?? null;
      return b === null || o === null ? null : b - o;
    };
    const iv = pairedBootstrap(sums, { reductionVsProduction: reduction("production"), reductionVsCapped: reduction("capped"), passDiffVsProduction: passDiff("production"), passDiffVsCapped: passDiff("capped") }, `${reference}|${provider}`);
    const intervals = { reductionVsProduction: iv.reductionVsProduction ?? null, reductionVsCapped: iv.reductionVsCapped ?? null, passDiffVsProduction: iv.passDiffVsProduction ?? null, passDiffVsCapped: iv.passDiffVsCapped ?? null };
    const paired = { vsProduction: pairedCounts(sums.block, sums.production), vsCapped: pairedCounts(sums.block, sums.capped) };
    const cohort = sharedPrompts(sums).length;
    const tokens = {
      block: block?.tokensPerSuccess ?? null,
      capped: capped?.tokensPerSuccess ?? null,
      production: production?.tokensPerSuccess ?? null,
      reductionVsProduction: null as number | null,
      reductionVsCapped: null as number | null,
    };
    if (tokens.block !== null && tokens.production !== null && tokens.production > 0) tokens.reductionVsProduction = 1 - tokens.block / tokens.production;
    if (tokens.block !== null && tokens.capped !== null && tokens.capped > 0) tokens.reductionVsCapped = 1 - tokens.block / tokens.capped;
    const passRates = { block: block?.passRate ?? null, capped: capped?.passRate ?? null, production: production?.passRate ?? null };
    const reasons: string[] = [];
    let verdict: Decision["verdict"] = "pass";
    // The minimum counts independent prompt threads (the addendum's unit), never cells: refinements are repeated
    // observations within a thread and cannot stand in for prompts.
    for (const [name, n] of Object.entries(threads) as Array<[keyof typeof threads, number]>) {
      if (n < options.minimum) reasons.push(`${name}: ${n} prompt ${n === 1 ? "thread" : "threads"} (${evaluated[name]} cells), fewer than the ${options.minimum} the rule needs`);
    }
    // The token figure rests on the metered cohort, so the minimum applies there too.
    for (const [name, n] of Object.entries(meteredThreads) as Array<[keyof typeof threads, number]>) {
      if (n < options.minimum && n < threads[name]) reasons.push(`${name}: ${n} metered prompt ${n === 1 ? "thread" : "threads"} (${metered[name]} metered ${metered[name] === 1 ? "cell" : "cells"}) in the token cohort, fewer than the ${options.minimum} the rule needs`);
    }
    if (reasons.length > 0) verdict = "insufficient";
    else {
      if (tokens.reductionVsProduction === null) {
        verdict = "insufficient";
        reasons.push("tokens per success is not measurable: a metered passing run is missing in the block arm or the production arm (scripted or unreported usage)");
      } else if (tokens.reductionVsProduction < options.reduction - EPSILON) {
        verdict = "fail";
        reasons.push(`tokens per success fell ${(100 * tokens.reductionVsProduction).toFixed(1)}% against production; the rule needs ${100 * options.reduction}%`);
      } else reasons.push(`tokens per success fell ${(100 * tokens.reductionVsProduction).toFixed(1)}% against production (needs ${100 * options.reduction}%)`);
      for (const [name, rate] of [["production", passRates.production], ["capped", passRates.capped]] as const) {
        if (passRates.block === null || rate === null) {
          verdict = "insufficient";
          reasons.push(`pass rate unavailable for the ${name} comparison`);
        } else if (passRates.block < rate - options.margin - EPSILON) {
          verdict = verdict === "insufficient" ? verdict : "fail";
          reasons.push(`pass rate ${(100 * passRates.block).toFixed(1)}% is more than ${100 * options.margin} points below ${name} (${(100 * rate).toFixed(1)}%)`);
        } else reasons.push(`pass rate ${(100 * passRates.block).toFixed(1)}% is within ${100 * options.margin} points of ${name} (${(100 * rate).toFixed(1)}%)`);
      }
    }
    // Intervals over fewer prompts in common than the minimum are not interpretable (the addendum): every criterion and
    // the decision are then insufficient, however the intervals lie.
    const enough = cohort >= options.minimum;
    const clarity = {
      tokens: clarityOf(intervals.reductionVsProduction, options.reduction, enough),
      vsProduction: clarityOf(intervals.passDiffVsProduction, -options.margin, enough),
      vsCapped: clarityOf(intervals.passDiffVsCapped, -options.margin, enough),
    };
    const criteria = [clarity.tokens, clarity.vsProduction, clarity.vsCapped];
    // Clear: the outcome cannot flip inside the intervals (every criterion clearly passes, or one clearly fails), that
    // outcome is the verdict's (the verdict pools prompts an arm alone reached; the intervals draw from the shared ones),
    // and the intervals rest on at least the minimum's prompts in common, not on a few the arms happen to share.
    const agrees = (verdict === "pass" && criteria.every((c) => c === "clear-pass")) || (verdict === "fail" && criteria.includes("clear-fail"));
    const overall: Decision["clarity"]["overall"] = !enough ? "insufficient" : agrees ? "clear" : "uncertain";
    out.push({ reference, provider, verdict, reasons, tokens, passRates, evaluated, metered, threads, meteredThreads, counts, cohort, intervals, clarity: { ...clarity, overall }, paired, options });
  }
  return out.sort((a, b) => `${a.reference}|${a.provider}`.localeCompare(`${b.reference}|${b.provider}`));
}

/**
 * The decision again with the passing add and remove refinements that did not do what they asked counted as failures
 * (OperationSensitivity): never the verdict, which counts them as ADR-B3 froze the pass.
 */
export function operationSensitivity(records: readonly RunRecord[], options: DecisionOptions = DEFAULT_DECISION, decisions: readonly Decision[] = decide(records, options)): OperationSensitivity[] {
  const decisionRecords = records.filter((r) => DECISION_ARMS.includes(r.arm));
  const failing = (miss: (check: OperationCheck) => boolean): Decision[] => {
    let flipped = 0;
    const counted = decisionRecords.map((r) => (r.passed && r.operation && miss(r.operation) ? (flipped++, { ...r, passed: false }) : r));
    return flipped === 0 ? [...decisions] : decide(counted, options);
  };
  const lenient = failing(missed);
  const strict = failing((check) => !performed(check));
  const pooled = armStats(decisionRecords, { pooled: true });
  const none = { checked: 0, performed: 0, mixed: 0, missed: 0 };
  return decisions.map((d) => {
    const find = (list: readonly Decision[]) => list.find((x) => x.reference === d.reference && x.provider === d.provider)!;
    const reading = (x: Decision): SensitivityReading => ({ verdict: x.verdict, overall: x.clarity.overall, passed: x.counts.passed, evaluated: x.evaluated, reductionVsProduction: x.tokens.reductionVsProduction });
    const operation = (arm: Arm) => pooled.find((s) => s.reference === d.reference && s.provider === d.provider && s.arm === arm)?.operation ?? none;
    const readings = [find(lenient), find(strict)];
    return {
      reference: d.reference,
      provider: d.provider,
      operation: { block: operation("block"), capped: operation("capped"), production: operation("production") },
      missedAsFailures: reading(readings[0]!),
      notPerformedAsFailures: reading(readings[1]!),
      robust: readings.every((x) => x.verdict === d.verdict && x.clarity.overall === d.clarity.overall),
    };
  });
}

/** Named against positional (ADR-B2), paired by prompt, wherever both arms ran on a reference. */
export function compareEncodings(records: readonly RunRecord[]): EncodingComparison[] {
  const keys = [...new Set(records.filter((r) => r.arm === "block-positional").map((r) => `${r.reference}|${r.provider}`))].sort();
  const out: EncodingComparison[] = [];
  for (const key of keys) {
    const [reference, provider] = key.split("|") as [string, string];
    const scope = records.filter((r) => r.reference === reference && r.provider === provider);
    const sums = { named: threadSums(scope, "block"), positional: threadSums(scope, "block-positional") };
    if (sums.named.size === 0) continue;
    const iv = pairedBootstrap(
      sums,
      {
        passDiff: (p) => (p.positional?.passRate == null || p.named?.passRate == null ? null : p.positional.passRate - p.named.passRate),
        tokenReduction: (p) => (p.positional?.tokensPerSuccess == null || p.named?.tokensPerSuccess == null || p.named.tokensPerSuccess <= 0 ? null : 1 - p.positional.tokensPerSuccess / p.named.tokensPerSuccess),
      },
      `${key}|encoding`,
    );
    out.push({ reference, provider, paired: pairedCounts(sums.positional, sums.named), intervals: { passDiff: iv.passDiff ?? null, tokenReduction: iv.tokenReduction ?? null } });
  }
  return out;
}

export function summarize(records: readonly RunRecord[], options: DecisionOptions = DEFAULT_DECISION): Summary {
  const arms = armStats(records);
  const completed = records.filter((r) => r.status === "completed");
  const decisions = decide(records, options);
  return {
    arms,
    pooled: armStats(records, { pooled: true }),
    selection: selectionStats(records),
    decisions,
    sensitivity: operationSensitivity(records, options, decisions),
    encodings: compareEncodings(records),
    totals: {
      records: records.length,
      completed: completed.length,
      providerCalls: completed.reduce((a, r) => a + r.tokens.providerCalls, 0),
      inputTokens: completed.reduce((a, r) => a + r.tokens.input, 0),
      outputTokens: completed.reduce((a, r) => a + r.tokens.output, 0),
      requestBytes: completed.reduce((a, r) => a + r.requestBytes, 0),
    },
  };
}
