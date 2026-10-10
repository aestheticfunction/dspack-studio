/**
 * The evaluation loop: every cell of (reference x prompt x arm x condition)
 * in prompt-major order, so that a run stopped at any point holds balanced
 * comparisons; each record appended to runs.jsonl as it completes, so a
 * run is resumable and auditable from its log alone.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCell } from "./arms";
import { promptsFor, type Corpus, type CorpusPrompt } from "./corpus";
import { DEFAULT_DECISION, summarize, type DecisionOptions, type Summary } from "./metrics";
import { PacingCapReached } from "./pacing";
import type { Preflight } from "./preflight";
import type { Provider } from "./providers/types";
import type { LoadedReference } from "./references";
import { renderReport } from "./report";
import { ARMS, CONDITIONS, cellId, type Arm, type Condition, type PriorResult, type RunRecord } from "./types";

export interface EvaluationOptions {
  runId: string;
  provider: Provider;
  references: readonly LoadedReference[];
  corpus: Corpus;
  preflight: Preflight;
  /** Drafts give provisional results (ADR-B3 counts approved sidecars only); the run refuses them unless allowed. */
  allowDrafts?: boolean;
  arms?: readonly Arm[];
  conditions?: readonly Condition[];
  /** Prompt ids to run; absent means every applicable prompt. */
  promptIds?: readonly string[];
  /** Expected-block filter: block ids, or "null" for the null prompts. */
  blocks?: readonly string[];
  /** At most this many prompts per reference. */
  limit?: number;
  /** The run directory (runs.jsonl, summary.json, preflight.json, REPORT.md). Absent means in memory. */
  outDir?: string;
  resume?: boolean;
  /** Re-run cells whose failure was a provider or policy failure (ADR-B3 re-run policy). */
  rerunFailed?: boolean;
  decision?: DecisionOptions;
  log?: (line: string) => void;
  now?: () => number;
  clock?: () => string;
}

export interface EvaluationResult {
  runId: string;
  records: RunRecord[];
  summary: Summary;
  preflight: Preflight;
  stopped?: { reason: "cap" | "error"; message: string };
  outDir?: string;
  cells: { total: number; done: number; reused: number };
}

interface Cell {
  reference: LoadedReference;
  prompt: CorpusPrompt & { expectedIntent: string };
  arm: Arm;
  condition: Condition;
}

export function planCells(options: Pick<EvaluationOptions, "references" | "corpus" | "arms" | "conditions" | "promptIds" | "blocks" | "limit">): Cell[] {
  const arms = options.arms ?? ARMS;
  const conditions = options.conditions ?? CONDITIONS;
  const cells: Cell[] = [];
  for (const reference of options.references) {
    let prompts = promptsFor(options.corpus, reference.id);
    if (options.promptIds) prompts = prompts.filter((p) => options.promptIds!.includes(p.id));
    if (options.blocks) prompts = prompts.filter((p) => options.blocks!.includes(p.block ?? "null"));
    if (options.limit !== undefined) prompts = prompts.slice(0, options.limit);
    for (const prompt of prompts) for (const arm of arms) for (const condition of CONDITIONS) if (conditions.includes(condition)) cells.push({ reference, prompt, arm, condition });
  }
  return cells;
}

export function readRecords(file: string): RunRecord[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RunRecord);
}

/** A passing fresh record, as the prior its refinements build on (from the log, after a resume). */
export function priorFromRecord(record: RunRecord, goal: string): PriorResult | undefined {
  if (record.condition !== "fresh" || !record.passed || !record.surface || !record.plan) return undefined;
  return {
    goal,
    record,
    surface: record.surface as Record<string, unknown>,
    progress: { ...(record.trace ? { block: record.trace } : {}), outcome: record.outcome, surface: record.surface, report: { attempts: new Array(record.attempts).fill({}) } },
    plan: { intent: record.plan.intent, source: record.plan.source, ...(record.plan.block ? { block: record.plan.block } : {}) },
  };
}

export async function runEvaluation(options: EvaluationOptions): Promise<EvaluationResult> {
  const log = options.log ?? (() => undefined);
  if (options.preflight.drafts && !options.allowDrafts) {
    throw new Error("the sidecars in use are drafts; Phase 1B counts approved sidecars only. Pass allowDrafts for a provisional run.");
  }
  const cells = planCells(options);
  const outDir = options.outDir;
  const logFile = outDir ? join(outDir, "runs.jsonl") : undefined;
  if (outDir) mkdirSync(outDir, { recursive: true });

  const done = new Map<string, RunRecord>();
  if (logFile && options.resume) {
    for (const record of readRecords(logFile)) {
      if (options.rerunFailed && record.failure?.rerunEligible) continue;
      done.set(cellId(record), record);
    }
  }
  if (logFile && !options.resume && existsSync(logFile)) throw new Error(`${logFile} exists; pass resume to continue it`);
  if (logFile && options.resume && options.rerunFailed) {
    // Rewrite the log without the cells being re-run, so the file stays one record per cell.
    writeFileSync(logFile, [...done.values()].map((r) => `${JSON.stringify(r)}\n`).join(""));
  }
  if (outDir) writeFileSync(join(outDir, "preflight.json"), `${JSON.stringify(options.preflight, null, 2)}\n`);

  const records: RunRecord[] = [];
  const priors = new Map<string, PriorResult>();
  const priorKey = (c: Cell) => `${c.reference.id}|${c.arm}|${c.prompt.id}`;
  let reused = 0;
  let stopped: EvaluationResult["stopped"];
  for (const cell of cells) {
    const key = cellId({ reference: cell.reference.id, provider: options.provider.id, arm: cell.arm, prompt: cell.prompt.id, condition: cell.condition });
    const existing = done.get(key);
    if (existing) {
      records.push(existing);
      reused += 1;
      const prior = priorFromRecord(existing, cell.prompt.goal);
      if (prior) priors.set(priorKey(cell), prior);
      continue;
    }
    try {
      const output = await runCell({
        reference: cell.reference,
        provider: options.provider,
        arm: cell.arm,
        condition: cell.condition,
        prompt: cell.prompt,
        corpus: options.corpus,
        ...(cell.condition !== "fresh" && priors.has(priorKey(cell)) ? { prior: priors.get(priorKey(cell))! } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(options.clock ? { clock: options.clock } : {}),
      });
      records.push(output.record);
      if (output.prior) priors.set(priorKey(cell), output.prior);
      if (logFile) appendFileSync(logFile, `${JSON.stringify(output.record)}\n`);
      log(`${key}: ${output.record.status === "skipped" ? `skipped (${output.record.skipReason})` : `${output.record.outcome} via ${output.record.path} in ${output.record.attempts} attempt(s), ${output.record.tokens.providerCalls} provider call(s)`}`);
    } catch (error) {
      if (error instanceof PacingCapReached) {
        stopped = { reason: "cap", message: error.message };
        log(`stopped: ${error.message}`);
        break;
      }
      stopped = { reason: "error", message: error instanceof Error ? error.message : String(error) };
      log(`stopped on ${key}: ${stopped.message}`);
      break;
    }
  }

  const summary = summarize(records, options.decision ?? DEFAULT_DECISION);
  const result: EvaluationResult = {
    runId: options.runId,
    records,
    summary,
    preflight: options.preflight,
    ...(stopped ? { stopped } : {}),
    ...(outDir ? { outDir } : {}),
    cells: { total: cells.length, done: records.length, reused },
  };
  if (outDir) {
    writeFileSync(join(outDir, "summary.json"), `${JSON.stringify({ runId: options.runId, provider: options.provider.id, corpus: { id: options.corpus.corpus, frozenAt: options.corpus.frozenAt }, cells: result.cells, stopped: stopped ?? null, summary }, null, 2)}\n`);
    writeFileSync(join(outDir, "REPORT.md"), renderReport(result, { providerId: options.provider.id, corpus: options.corpus }));
  }
  return result;
}
