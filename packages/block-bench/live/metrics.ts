/**
 * The summary and the decision rule (ADR-B3), pure over run records.
 *
 * Pass rates count completed runs minus the provider and policy failures,
 * which are reported separately and re-run symmetrically; budget exhaustion,
 * fallback and invariant outcomes are arm results. Tokens per success use
 * provider-reported figures only: a passing run with any unreported call is
 * counted as unmetered and excluded, never estimated. The guardrail holds the
 * block arm within the margin of BOTH primitive arms (ADR-B4 fairness).
 */
import type { Arm, Condition, FailureKind, Path, RunRecord } from "./types";

export interface DecisionOptions {
  /** The required drop in tokens per success against today's production configuration. */
  reduction: number;
  /** The non-inferiority margin on the pass rate, in points of rate. */
  margin: number;
  /** Evaluated runs each arm needs before the rule can be applied. */
  minimum: number;
}
export const DEFAULT_DECISION: DecisionOptions = { reduction: 0.3, margin: 0.05, minimum: 20 };

export interface ArmStats {
  reference: string;
  provider: string;
  arm: Arm;
  condition: Condition;
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
  firstAttemptPassRate: number | null;
  repairsPerSuccess: number | null;
  meteredSuccesses: number;
  unmeteredSuccesses: number;
  tokensPerSuccess: number | null;
  inputTokensPerSuccess: number | null;
  outputTokensPerSuccess: number | null;
  providerCallsPerRun: number | null;
  requestBytesPerRun: number | null;
  latency: { totalMs: number | null; firstGatedAttemptMs: number | null; blockPhaseMs: number | null; emitMs: number | null; planMs: number | null };
  parity: { meanScore: number | null; fullyParityPassed: number };
  paths: Partial<Record<Path, { n: number; passed: number }>>;
  budgetRemainingAtFallback: Record<string, number>;
  fallbackByClassification: Record<string, number>;
  invariantFailures: number;
  budgetExhausted: number;
  /** Refinements only. */
  changedRate: number | null;
  retention: number | null;
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
  intentAccuracy: number | null;
}

export interface Decision {
  reference: string;
  provider: string;
  verdict: "pass" | "fail" | "insufficient";
  reasons: string[];
  tokens: { block: number | null; capped: number | null; production: number | null; reductionVsProduction: number | null; reductionVsCapped: number | null };
  passRates: { block: number | null; capped: number | null; production: number | null };
  evaluated: { block: number; capped: number; production: number };
  options: DecisionOptions;
}

export interface Summary {
  arms: ArmStats[];
  selection: SelectionStats[];
  decisions: Decision[];
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
const groupKey = (r: RunRecord) => `${r.reference}|${r.provider}|${r.arm}|${r.condition}`;

export function armStats(records: readonly RunRecord[]): ArmStats[] {
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
    const metered = passed.filter((r) => r.tokens.unreportedCalls === 0 && r.tokens.providerCalls > 0);
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
    const refinements = first.condition !== "fresh" ? completed : [];
    const withBlockPrior = refinements.filter((r) => r.refinement && r.refinement.mode !== "primitive");
    out.push({
      reference: first.reference,
      provider: first.provider,
      arm: first.arm,
      condition: first.condition,
      n: list.length,
      skipped: list.length - completed.length,
      completed: completed.length,
      rerunEligible: rerun.length,
      rerunByKind,
      evaluated: evaluated.length,
      passed: passed.length,
      passRate: ratio(passed.length, evaluated.length),
      firstAttemptPassRate: ratio(passed.filter((r) => r.attempts === 1).length, evaluated.length),
      repairsPerSuccess: passed.length === 0 ? null : passed.reduce((a, r) => a + Math.max(0, r.attempts - 1), 0) / passed.length,
      meteredSuccesses: metered.length,
      unmeteredSuccesses: passed.length - metered.length,
      tokensPerSuccess: mean(metered.map((r) => r.tokens.input + r.tokens.output)),
      inputTokensPerSuccess: mean(metered.map((r) => r.tokens.input)),
      outputTokensPerSuccess: mean(metered.map((r) => r.tokens.output)),
      providerCallsPerRun: mean(completed.map((r) => r.tokens.providerCalls)),
      requestBytesPerRun: mean(completed.map((r) => r.requestBytes)),
      latency: {
        totalMs: median(completed.map((r) => r.timings.totalMs)),
        firstGatedAttemptMs: median(completed.map((r) => r.timings.firstGatedAttemptMs).filter((v): v is number => typeof v === "number")),
        blockPhaseMs: median(completed.map((r) => r.timings.blockPhaseMs).filter((v): v is number => typeof v === "number")),
        emitMs: median(completed.map((r) => r.timings.emitMs).filter((v): v is number => typeof v === "number")),
        planMs: median(completed.map((r) => r.timings.planMs).filter((v): v is number => typeof v === "number")),
      },
      parity: { meanScore: mean(passed.map((r) => r.parity?.score).filter((v): v is number => typeof v === "number")), fullyParityPassed: passed.filter((r) => r.parity?.score === 1).length },
      paths,
      budgetRemainingAtFallback,
      fallbackByClassification,
      invariantFailures: completed.filter((r) => r.outcome === "invariant-failure").length,
      budgetExhausted: completed.filter((r) => r.failure?.kind === "budget").length,
      changedRate: refinements.length === 0 ? null : ratio(refinements.filter((r) => r.passed && r.changed).length, refinements.filter((r) => r.passed).length),
      retention: withBlockPrior.length === 0 ? null : ratio(withBlockPrior.filter((r) => r.refinement!.retained).length, withBlockPrior.length),
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
    const s = { n: list.length, correct: 0, hit: 0, missedToNull: 0, wrongBlock: 0, nullCorrect: 0, falseBlock: 0, explicitNull: 0, omitted: 0, rejected: 0, intentCorrect: 0 };
    for (const r of list) {
      const sel = r.selection!;
      if (sel.correct) s.correct += 1;
      if (r.expected.block) {
        if (sel.chosen === r.expected.block) s.hit += 1;
        else if (sel.chosen === null) s.missedToNull += 1;
        else s.wrongBlock += 1;
      } else if (sel.chosen === null) s.nullCorrect += 1;
      else s.falseBlock += 1;
      if (sel.source === "omitted") s.omitted += 1;
      else if (sel.chosen === null) s.explicitNull += 1;
      if (sel.rejected) s.rejected += 1;
      if (r.plan?.intent === r.expected.intent) s.intentCorrect += 1;
    }
    const first = list[0]!;
    out.push({ reference: first.reference, provider: first.provider, ...s, accuracy: ratio(s.correct, s.n), intentAccuracy: ratio(s.intentCorrect, s.n) });
  }
  return out.sort((a, b) => `${a.reference}|${a.provider}`.localeCompare(`${b.reference}|${b.provider}`));
}

export function decide(stats: readonly ArmStats[], options: DecisionOptions = DEFAULT_DECISION): Decision[] {
  const keys = new Set(stats.filter((s) => s.condition === "fresh").map((s) => `${s.reference}|${s.provider}`));
  const out: Decision[] = [];
  for (const key of keys) {
    const [reference, provider] = key.split("|") as [string, string];
    const arm = (a: Arm) => stats.find((s) => s.reference === reference && s.provider === provider && s.condition === "fresh" && s.arm === a);
    const block = arm("block");
    const capped = arm("capped");
    const production = arm("production");
    const evaluated = { block: block?.evaluated ?? 0, capped: capped?.evaluated ?? 0, production: production?.evaluated ?? 0 };
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
    for (const [name, n] of Object.entries(evaluated)) if (n < options.minimum) reasons.push(`${name}: ${n} evaluated runs, fewer than the ${options.minimum} the rule needs`);
    if (reasons.length > 0) verdict = "insufficient";
    else {
      if (tokens.reductionVsProduction === null) {
        verdict = "insufficient";
        reasons.push("tokens per success is not measurable: a metered passing run is missing in the block arm or the production arm (scripted or unreported usage)");
      } else if (tokens.reductionVsProduction < options.reduction) {
        verdict = "fail";
        reasons.push(`tokens per success fell ${(100 * tokens.reductionVsProduction).toFixed(1)}% against production; the rule needs ${100 * options.reduction}%`);
      } else reasons.push(`tokens per success fell ${(100 * tokens.reductionVsProduction).toFixed(1)}% against production (needs ${100 * options.reduction}%)`);
      for (const [name, rate] of [["production", passRates.production], ["capped", passRates.capped]] as const) {
        if (passRates.block === null || rate === null) {
          verdict = "insufficient";
          reasons.push(`pass rate unavailable for the ${name} comparison`);
        } else if (passRates.block < rate - options.margin) {
          verdict = verdict === "insufficient" ? verdict : "fail";
          reasons.push(`pass rate ${(100 * passRates.block).toFixed(1)}% is more than ${100 * options.margin} points below ${name} (${(100 * rate).toFixed(1)}%)`);
        } else reasons.push(`pass rate ${(100 * passRates.block).toFixed(1)}% is within ${100 * options.margin} points of ${name} (${(100 * rate).toFixed(1)}%)`);
      }
    }
    out.push({ reference, provider, verdict, reasons, tokens, passRates, evaluated, options });
  }
  return out.sort((a, b) => `${a.reference}|${a.provider}`.localeCompare(`${b.reference}|${b.provider}`));
}

export function summarize(records: readonly RunRecord[], options: DecisionOptions = DEFAULT_DECISION): Summary {
  const arms = armStats(records);
  const completed = records.filter((r) => r.status === "completed");
  return {
    arms,
    selection: selectionStats(records),
    decisions: decide(arms, options),
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
