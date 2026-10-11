/**
 * The evaluation loop: every cell of (reference x prompt x arm x condition)
 * in prompt-major order, so that a run stopped at any point holds balanced
 * comparisons; each record appended to runs.jsonl as it completes, so a
 * run is resumable and auditable from its log alone.
 *
 * A run directory carries a manifest: the provider, the corpus, each
 * reference's contract, profile and sidecar by digest, the code, the local
 * model, the deployment, and the selection. A resume must match it, so a
 * report never mixes cells from two deployments, two corpora, two versions
 * of the code or two configurations; the original run id and preflight are
 * kept and each resume's preflight is filed beside them. Nothing a run
 * spent leaves the directory: records a re-run supersedes move to
 * runs.superseded.jsonl and stay in the totals, every invocation's pacing
 * is appended to pacing.jsonl, and a cut-off last line is set aside in
 * runs.torn.jsonl.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256Hex } from "@dspack-studio/composer-core/blocks";
import { runCell } from "./arms";
import { corpusDigest, promptsFor, type Corpus, type CorpusPrompt } from "./corpus";
import { codeIdentity, type CodeIdentity } from "./identity";
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

/** What a set of records spent, as the provider reported it. */
export interface Spend {
  records: number;
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  requestBytes: number;
}

export interface EvaluationResult {
  runId: string;
  records: RunRecord[];
  summary: Summary;
  preflight: Preflight;
  /** What the provider reports about itself (pacing, waits), this invocation. */
  telemetry?: Record<string, unknown>;
  /** Every invocation's telemetry, this one included, oldest first. */
  invocations: Array<{ at: string; telemetry: Record<string, unknown> }>;
  /** Records a re-run replaced: spent, and counted in no arm. */
  superseded: Spend;
  /** The arms this run selected (the manifest's), whether or not each has reached a cell yet. */
  arms: Arm[];
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
  references: Array<{ id: string; status: string; baseSha256: string | null; usable: string[]; sidecarSha256: string | null; contractSha256: string; profileSha256: string }>;
  /** The harness, composer-core and the dspack packages the cells run through. */
  code: CodeIdentity;
  /** The local model's tag and the digest of its weights (Ollama runs). */
  model: { name: string; digest: string | null } | null;
  deployment: { baseUrl: string | null; buildId: string | null; worker: string | null };
  selection: { arms: Arm[]; conditions: Condition[]; promptIds: string[] | null; blocks: string[] | null; limit: number | null };
  decision: DecisionOptions;
}

export async function manifestFor(options: EvaluationOptions): Promise<RunManifest> {
  const digest = (value: unknown) => sha256Hex(JSON.stringify(value));
  return {
    runId: options.runId,
    startedAt: options.preflight.at,
    provider: options.provider.descriptor,
    corpus: { id: options.corpus.corpus, version: options.corpus.version, frozenAt: options.corpus.frozenAt, sha256: await corpusDigest(options.corpus) },
    references: await Promise.all(
      options.references.map(async (r) => ({
        id: r.id,
        status: r.sidecar?.status ?? "invalid",
        baseSha256: r.sidecar?.baseSha256 ?? null,
        usable: r.blocks.map((b) => `${b.id}@${b.version}`),
        sidecarSha256: r.sidecar ? await digest(r.sidecar) : null,
        contractSha256: await digest(r.contract),
        profileSha256: await digest(r.profileRaw),
      })),
    ),
    code: codeIdentity(),
    model: options.preflight.model ? { name: options.preflight.model.name, digest: options.preflight.model.digest } : null,
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
  const REFERENCE_FIELDS = { status: "sidecar status", baseSha256: "sidecar binding", sidecarSha256: "sidecar content", usable: "usable blocks", contractSha256: "contract", profileSha256: "emit profile" } as const;
  const ids = [...new Set([...(recorded.references ?? []).map((r) => r.id), ...current.references.map((r) => r.id)])];
  for (const id of ids) {
    const was = (recorded.references ?? []).find((r) => r.id === id);
    const now = current.references.find((r) => r.id === id);
    if (!was || !now) {
      out.push(`references: ${id} ${was ? "is not in this invocation" : "was not in the run"}`);
      continue;
    }
    const moved = (Object.keys(REFERENCE_FIELDS) as Array<keyof typeof REFERENCE_FIELDS>).filter((k) => !same(was[k], now[k]));
    if (moved.length > 0) out.push(`references: ${id} changed since the run started (${moved.map((k) => REFERENCE_FIELDS[k]).join(", ")})`);
  }
  if (!same(recorded.code, current.code)) {
    const packages = Object.keys({ ...recorded.code?.packages, ...current.code.packages }).filter((name) => recorded.code?.packages?.[name] !== current.code.packages[name]);
    const what = [...(recorded.code?.sha256 !== current.code.sha256 ? ["the harness or composer-core source"] : []), ...packages.map((name) => `${name} ${recorded.code?.packages?.[name] ?? "absent"} -> ${current.code.packages[name] ?? "absent"}`)];
    out.push(`code: ${what.join("; ") || "the code identity"} changed since the run started`);
  }
  if (!same(recorded.model ?? null, current.model)) {
    const name = (m: RunManifest["model"]) => (m ? `${m.name} (${m.digest ? m.digest.slice(0, 19) : "no digest"})` : "no local model");
    out.push(`model: the run used ${name(recorded.model ?? null)}, this is ${name(current.model)}`);
  }
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

/**
 * A JSON-lines log. Every append ends with a newline, so text after the last one is an append cut off (disk full,
 * a killed process): `torn` holds it when it is not a whole entry. A line that is not JSON anywhere else is
 * corruption, refused with its file and line.
 */
export function readLog<T = RunRecord>(file: string): { records: T[]; torn?: string; complete: boolean } {
  if (!existsSync(file)) return { records: [], complete: true };
  const lines = readFileSync(file, "utf8").split("\n");
  const tail = lines.pop()!;
  const records: T[] = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try {
      records.push(JSON.parse(line) as T);
    } catch (error) {
      throw new Error(`${file}:${i + 1}: not a JSON line (${error instanceof Error ? error.message : String(error)}); only a cut-off last line is set aside on its own`);
    }
  });
  if (!tail.trim()) return { records, complete: true };
  try {
    records.push(JSON.parse(tail) as T);
    return { records, complete: false };
  } catch {
    return { records, torn: tail, complete: false };
  }
}

export const readRecords = (file: string): RunRecord[] => readLog<RunRecord>(file).records;

const line = (value: unknown) => `${JSON.stringify(value)}\n`;

/** Replaced whole, never truncated in place: a crash leaves the old log or the new one. */
function rewriteLog(file: string, entries: readonly unknown[]) {
  writeFileSync(`${file}.tmp`, entries.map(line).join(""));
  renameSync(`${file}.tmp`, file);
}

/**
 * A log made whole before anything is appended to it: a cut-off last line is set aside in runs.torn.jsonl (its
 * cell, if it is a run record, simply runs again) and the file is rewritten to end on a whole line.
 */
function settleLog<T>(file: string, log: (line: string) => void): T[] {
  const read = readLog<T>(file);
  if (read.torn !== undefined) {
    appendFileSync(join(dirname(file), "runs.torn.jsonl"), `${read.torn}\n`);
    log(`set aside the cut-off last line of ${file} in runs.torn.jsonl`);
  }
  if (!read.complete) rewriteLog(file, read.records);
  return read.records;
}

export function spendOf(records: readonly RunRecord[]): Spend {
  return {
    records: records.length,
    providerCalls: records.reduce((a, r) => a + r.tokens.providerCalls, 0),
    inputTokens: records.reduce((a, r) => a + r.tokens.input, 0),
    outputTokens: records.reduce((a, r) => a + r.tokens.output, 0),
    requestBytes: records.reduce((a, r) => a + r.requestBytes, 0),
  };
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

  // Every log is made whole, and read, before any cell spends anything.
  const done = new Map<string, RunRecord>();
  const supersededFile = outDir ? join(outDir, "runs.superseded.jsonl") : undefined;
  const pacingFile = outDir ? join(outDir, "pacing.jsonl") : undefined;
  let superseded: RunRecord[] = [];
  let earlierInvocations: EvaluationResult["invocations"] = [];
  if (outDir && options.resume) {
    superseded = settleLog<RunRecord>(supersededFile!, log);
    earlierInvocations = settleLog<EvaluationResult["invocations"][number]>(pacingFile!, log);
    let kept = settleLog<RunRecord>(logFile!, log);
    if (options.rerunFailed) {
      // A re-run fresh cell takes along the refinements skipped for want of it, so they run once it passes.
      const owner = (r: RunRecord) => `${r.reference}|${r.provider}|${r.arm}|${r.prompt}`;
      const rerunFresh = new Set(kept.filter((r) => r.condition === "fresh" && r.failure?.rerunEligible).map(owner));
      const replaced = new Set(kept.filter((r) => r.failure?.rerunEligible || (r.status === "skipped" && r.condition !== "fresh" && rerunFresh.has(owner(r)))));
      if (replaced.size > 0) {
        // Moved aside before the log is rewritten, so nothing a superseded attempt spent leaves the directory.
        appendFileSync(supersededFile!, [...replaced].map(line).join(""));
        superseded = [...superseded, ...replaced];
        kept = kept.filter((r) => !replaced.has(r));
        rewriteLog(logFile!, kept);
      }
    }
    for (const record of kept) done.set(cellId(record), record);
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
      if (logFile) appendFileSync(logFile, line(output.record));
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
  // Every invocation's pacing is kept: a resume must not erase the waits an earlier invocation sat through.
  const invocation = telemetry ? { at: options.preflight.at, telemetry } : undefined;
  if (pacingFile && invocation) appendFileSync(pacingFile, line(invocation));
  const invocations = [...earlierInvocations, ...(invocation ? [invocation] : [])];
  // Each superseded record once: a crash between moving records aside and rewriting the log can repeat a move.
  const spent = spendOf([...new Map(superseded.map((r) => [JSON.stringify(r), r])).values()]);
  const result: EvaluationResult = {
    runId: manifest.runId,
    records,
    summary,
    preflight,
    ...(telemetry ? { telemetry } : {}),
    invocations,
    superseded: spent,
    arms: [...manifest.selection.arms],
    ...(stopped ? { stopped } : {}),
    ...(outDir ? { outDir } : {}),
    cells: { total: cells.length, done: records.length, reused },
  };
  if (outDir) {
    writeJson(join(outDir, "summary.json"), { runId: manifest.runId, provider: options.provider.descriptor, corpus: manifest.corpus, cells: result.cells, stopped: stopped ?? null, telemetry: telemetry ?? null, invocations, superseded: spent, summary });
    writeFileSync(join(outDir, "REPORT.md"), renderReport(result, { providerId: options.provider.id, corpus: options.corpus }));
  }
  return result;
}
