/**
 * The evaluation loop: every cell of (reference x prompt x arm x condition)
 * in prompt-major order, so that a run stopped at any point holds balanced
 * comparisons; each record appended to runs.jsonl as it completes, so a
 * run is resumable and auditable from its log alone.
 *
 * A run directory carries a manifest: the provider, the corpus and sidecars
 * by digest, the deployment, and the selection. A resume must match it,
 * so a report never mixes cells from two deployments, two corpora or two
 * configurations; the original run id and preflight are kept and each
 * resume's preflight is filed beside them.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "@dspack-studio/composer-core/blocks";
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
  /** The run directory (runs.jsonl, manifest.json, preflight.json, summary.json, REPORT.md). Absent means in memory. */
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
  /** What the provider reports about itself (pacing, waits). */
  telemetry?: Record<string, unknown>;
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

/** What a resume must match. */
export interface RunManifest {
  runId: string;
  startedAt: string;
  provider: string;
  corpus: { id: string; version: number; frozenAt: string; sha256: string };
  references: Array<{ id: string; status: string; baseSha256: string | null; usable: string[] }>;
  deployment: { baseUrl: string | null; buildId: string | null; worker: string | null };
  selection: { arms: Arm[]; conditions: Condition[]; promptIds: string[] | null; blocks: string[] | null; limit: number | null };
  decision: DecisionOptions;
}

export async function manifestFor(options: EvaluationOptions): Promise<RunManifest> {
  return {
    runId: options.runId,
    startedAt: options.preflight.at,
    provider: options.provider.descriptor,
    corpus: { id: options.corpus.corpus, version: options.corpus.version, frozenAt: options.corpus.frozenAt, sha256: await sha256Hex(JSON.stringify(options.corpus)) },
    references: options.references.map((r) => ({ id: r.id, status: r.sidecar?.status ?? "invalid", baseSha256: r.sidecar?.baseSha256 ?? null, usable: r.blocks.map((b) => `${b.id}@${b.version}`) })),
    deployment: { baseUrl: options.preflight.baseUrl ?? null, buildId: options.preflight.buildId ?? null, worker: options.preflight.worker?.shape ?? null },
    selection: {
      arms: [...(options.arms ?? ARMS)],
      conditions: [...(options.conditions ?? CONDITIONS)],
      promptIds: options.promptIds ? [...options.promptIds] : null,
      blocks: options.blocks ? [...options.blocks] : null,
      limit: options.limit ?? null,
    },
    decision: options.decision ?? DEFAULT_DECISION,
  };
}

/** The fields a resume must match, each named so a refusal says what moved. */
export function manifestMismatches(recorded: RunManifest, current: RunManifest): string[] {
  const out: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (recorded.provider !== current.provider) out.push(`provider: the run was ${recorded.provider}, this is ${current.provider}`);
  if (!same(recorded.corpus, current.corpus)) out.push(`corpus: the run used ${recorded.corpus.id} v${recorded.corpus.version} frozen ${recorded.corpus.frozenAt} (${recorded.corpus.sha256.slice(0, 12)}), this is ${current.corpus.id} v${current.corpus.version} frozen ${current.corpus.frozenAt} (${current.corpus.sha256.slice(0, 12)})`);
  if (!same(recorded.references, current.references)) out.push("references: the sidecars, their binding or their usable blocks differ from the run's");
  if (recorded.deployment.baseUrl !== current.deployment.baseUrl) out.push(`deployment: the run was against ${recorded.deployment.baseUrl ?? "no deployment"}, this is ${current.deployment.baseUrl ?? "no deployment"}`);
  if (recorded.deployment.buildId !== current.deployment.buildId) {
    out.push(`deployment: the run was against build id ${recorded.deployment.buildId ?? "none"}, this is ${current.deployment.buildId ?? "none"}`);
  }
  if (recorded.deployment.worker !== current.deployment.worker) out.push(`deployment: the Worker was ${recorded.deployment.worker ?? "not probed"}, this is ${current.deployment.worker ?? "not probed"}`);
  for (const key of ["arms", "conditions", "promptIds", "blocks", "limit"] as const) {
    if (!same(recorded.selection[key], current.selection[key])) out.push(`selection: ${key} differ (${JSON.stringify(recorded.selection[key])} vs ${JSON.stringify(current.selection[key])})`);
  }
  if (!same(recorded.decision, current.decision)) out.push("decision: the rule's options differ");
  return out;
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
  if (record.condition !== "fresh" || !record.passed || !record.surface || !record.plan || record.plan.intent === undefined || record.plan.source === undefined) return undefined;
  return {
    goal,
    record,
    surface: record.surface as Record<string, unknown>,
    progress: { ...(record.trace ? { block: record.trace } : {}), outcome: record.outcome, surface: record.surface, report: { attempts: new Array(record.attempts).fill({}) } },
    plan: { intent: record.plan.intent, source: record.plan.source, ...(record.plan.block ? { block: record.plan.block } : {}) },
  };
}

const writeJson = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

export async function runEvaluation(options: EvaluationOptions): Promise<EvaluationResult> {
  const log = options.log ?? (() => undefined);
  if (options.preflight.drafts && !options.allowDrafts) {
    throw new Error("the sidecars in use are drafts; Phase 1B counts approved sidecars only. Pass allowDrafts for a provisional run.");
  }
  const cells = planCells(options);
  const outDir = options.outDir;
  const logFile = outDir ? join(outDir, "runs.jsonl") : undefined;
  if (outDir) mkdirSync(outDir, { recursive: true });

  // The manifest: written on the first run, held to on a resume.
  let manifest = await manifestFor(options);
  let preflight = options.preflight;
  if (outDir) {
    const manifestFile = join(outDir, "manifest.json");
    if (options.resume) {
      if (!existsSync(manifestFile)) throw new Error(`${outDir} has no manifest.json to resume from`);
      const recorded = JSON.parse(readFileSync(manifestFile, "utf8")) as RunManifest;
      const mismatches = manifestMismatches(recorded, manifest);
      if (mismatches.length > 0) throw new Error(`resume refused, the run in ${outDir} does not match this invocation:\n- ${mismatches.join("\n- ")}\nStart a new run directory instead.`);
      manifest = recorded;
      const original = join(outDir, "preflight.json");
      if (existsSync(original)) preflight = JSON.parse(readFileSync(original, "utf8")) as Preflight;
      let n = 1;
      while (existsSync(join(outDir, `preflight.resume-${n}.json`))) n += 1;
      writeJson(join(outDir, `preflight.resume-${n}.json`), options.preflight);
    } else {
      if (existsSync(manifestFile) || (logFile && existsSync(logFile))) throw new Error(`${outDir} already holds a run; pass resume to continue it`);
      writeJson(manifestFile, manifest);
      writeJson(join(outDir, "preflight.json"), preflight);
    }
  }

  const done = new Map<string, RunRecord>();
  if (logFile && options.resume) {
    for (const record of readRecords(logFile)) {
      if (options.rerunFailed && record.failure?.rerunEligible) continue;
      done.set(cellId(record), record);
    }
    if (options.rerunFailed) {
      // Rewrite the log without the cells being re-run, so the file stays one record per cell.
      writeFileSync(logFile, [...done.values()].map((r) => `${JSON.stringify(r)}\n`).join(""));
    }
  }

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
  const telemetry = options.provider.telemetry?.();
  const result: EvaluationResult = {
    runId: manifest.runId,
    records,
    summary,
    preflight,
    ...(telemetry ? { telemetry } : {}),
    ...(stopped ? { stopped } : {}),
    ...(outDir ? { outDir } : {}),
    cells: { total: cells.length, done: records.length, reused },
  };
  if (outDir) {
    writeJson(join(outDir, "summary.json"), { runId: manifest.runId, provider: options.provider.descriptor, corpus: manifest.corpus, cells: result.cells, stopped: stopped ?? null, telemetry: telemetry ?? null, summary });
    writeFileSync(join(outDir, "REPORT.md"), renderReport(result, { providerId: options.provider.id, corpus: options.corpus }));
  }
  return result;
}
