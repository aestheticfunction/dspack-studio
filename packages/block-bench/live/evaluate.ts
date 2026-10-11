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
 * runs.torn.jsonl. A hosted run also carries a cumulative cap and a dollar
 * ceiling: the manifest records the requests the whole run may send and the
 * dollars it may commit, requests.jsonl records every request with its
 * worst case before it is sent and how that reservation ended after its
 * reply (released, settled at the reported usage, or raised), and each
 * invocation's pacer is bound to those totals, so no number of resumes
 * sends more, or spends more, than the run allows. Every call a hosted run
 * sends that reaches the provider is held to the run's integrity conditions
 * (live/integrity.ts): the manifest records the model the run measures, from
 * its first metered call, and a call that breaks one stops the run cleanly,
 * apart from arm results, so that a resume can continue it. One
 * invocation runs a directory at a time (run.lock), so two cannot spend the
 * same cap or interleave the logs.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256Hex } from "@dspack-studio/composer-core/blocks";
import { runCell } from "./arms";
import { corpusDigest, promptsFor, type Corpus, type CorpusPrompt } from "./corpus";
import { REQUEST_USD_BOUND } from "./cost";
import { codeIdentity, type CodeIdentity } from "./identity";
import { RunHalted } from "./integrity";
import { DEFAULT_DECISION, summarize, type DecisionOptions, type Summary } from "./metrics";
import { PacingCapReached, type RunLedger } from "./pacing";
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
  /**
   * Hosted: the requests the whole run may send, across every invocation and resume. Required to start a run
   * directory with a paced provider, and recorded in its manifest; on a resume, a value changes the recorded cap
   * and the manifest records the change.
   */
  maxTotalRequests?: number;
  /**
   * Hosted: the dollars the whole run may commit (live/cost.ts): what verified replies reported, plus the worst case of
   * every other request, across every invocation and resume. Required beside maxTotalRequests to start a run directory with a paced provider, and
   * recorded in its manifest; on a resume, a value changes the recorded ceiling and the manifest records the change.
   */
  maxTotalUsd?: number;
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
  /** Hosted: the run's cumulative cap and dollar ceiling, and the requests sent and dollars committed against them, every invocation included. */
  requests?: { cap: number; sent: number; capUsd?: number; usd: number };
  /** Hosted: why the run stopped early. "integrity" is a call the run cannot trust (live/integrity.ts), never an arm result. */
  stopped?: { reason: "cap" | "integrity" | "error"; message: string };
  /** Hosted: the model the run measures (manifest.json), once its first metered call has recorded it. */
  servedModel?: { id: string; at: string };
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
  /**
   * Hosted: the requests the whole run may send and the dollars it may commit, and every change a resume made to
   * either (a dollar change carries unit "usd"). Not identity: a resume may change them, on the record.
   */
  limits?: { maxTotalRequests: number; maxTotalUsd?: number; changes?: Array<{ at: string; unit?: "usd"; from?: number; to: number }> };
  /**
   * Hosted: the model the run measures, as the provider named it on the run's first metered call. Recorded once, before
   * that call returns, and never changed: every later call, every resume included, must report the same (live/integrity.ts).
   */
  servedModel?: { id: string; at: string };
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
    ...(options.maxTotalRequests !== undefined ? { limits: { maxTotalRequests: options.maxTotalRequests, ...(options.maxTotalUsd !== undefined ? { maxTotalUsd: options.maxTotalUsd } : {}) } } : {}),
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

/** Replaced whole, never truncated in place: a crash leaves the old file or the new one. */
function replaceJson(file: string, value: unknown) {
  writeJson(`${file}.tmp`, value);
  renameSync(`${file}.tmp`, file);
}

/**
 * The requests a run recorded before sending them, one line each with its priced worst case; the adjustment recorded
 * after each reply (a release, a settlement at the reported usage, or a raise), which is not a request; and the
 * invocations that recorded them. A request with no price (recorded before the dollar ledger, or unreadable) counts
 * at the most any request can cost.
 *
 * The ledger is settled before anything is appended. A cut-off last line is set aside: a request line cut off was
 * never sent, and an adjustment cut off leaves its request unsettled. A request whose reply was never read (the
 * invocation was killed after sending it) is raised to the most any request can cost, on the record.
 */
function readLedger(file: string, settle: { at: string; invocation: string }): { count: number; usd: number; invocations: Set<string> } {
  const invocations = new Set<string>();
  if (!existsSync(file)) return { count: 0, usd: 0, invocations };
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const torn = lines.pop()!.trim() !== "";
  let usd = 0;
  let count = 0;
  let pending: number | undefined;
  for (const entry of lines) {
    let parsed: { invocation?: unknown; usd?: unknown; adjust?: unknown } = {};
    try {
      parsed = JSON.parse(entry) as typeof parsed;
    } catch {
      /* still counted: a request was recorded */
    }
    if (typeof parsed.invocation === "string") invocations.add(parsed.invocation);
    if (typeof parsed.adjust === "number" && Number.isFinite(parsed.adjust)) {
      usd += parsed.adjust;
      pending = undefined;
      continue;
    }
    count += 1;
    const priced = typeof parsed.usd === "number" && Number.isFinite(parsed.usd) && parsed.usd >= 0 ? parsed.usd : undefined;
    usd += priced ?? REQUEST_USD_BOUND;
    pending = priced;
  }
  const raise = pending === undefined ? 0 : REQUEST_USD_BOUND - pending;
  if (torn || raise > 0) {
    writeFileSync(`${file}.tmp`, text.slice(0, text.lastIndexOf("\n") + 1) + (raise > 0 ? line({ ...settle, adjust: raise, reason: "a request whose reply was never read" }) : ""));
    renameSync(`${file}.tmp`, file);
    usd += raise;
  }
  return { count, usd, invocations };
}

/**
 * What the run has sent and committed so far, every invocation included: the ledger (settled first), plus what each
 * invocation from before the ledger reported (one that recorded nothing in it), each at the most a request can cost.
 */
function runTotals(requestsFile: string | undefined, earlier: EvaluationResult["invocations"], settle: { at: string; invocation: string }): { sent: number; usd: number } {
  const recorded = requestsFile ? readLedger(requestsFile, settle) : { count: 0, usd: 0, invocations: new Set<string>() };
  const unrecorded = earlier
    .filter((i) => !recorded.invocations.has(i.at))
    .reduce((sum, i) => {
      const sent = (i.telemetry.pacing as { sent?: unknown } | undefined)?.sent;
      return sum + (typeof sent === "number" && Number.isFinite(sent) ? sent : 0);
    }, 0);
  return { sent: recorded.count + unrecorded, usd: recorded.usd + unrecorded * REQUEST_USD_BOUND };
}

/** Whether a process is running: signal 0 tests for it without sending anything. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * One invocation at a time per run directory: two would each spend the same cumulative cap and interleave the logs.
 * A lock whose process is gone (a killed invocation) is taken over. Returns the release.
 */
function lockRun(outDir: string): () => void {
  const file = join(outDir, "run.lock");
  const take = () => writeFileSync(file, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`, { flag: "wx" });
  try {
    take();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let holder: { pid?: unknown; at?: unknown } = {};
    try {
      holder = JSON.parse(readFileSync(file, "utf8")) as typeof holder;
    } catch {
      /* unreadable: its writer died mid-write */
    }
    if (typeof holder.pid === "number" && alive(holder.pid)) {
      throw new Error(`another invocation (pid ${holder.pid}, started ${String(holder.at)}) is running the run in ${outDir}; wait for it to finish or stop it. If no invocation is running, delete ${file}.`);
    }
    rmSync(file, { force: true });
    take();
  }
  return () => rmSync(file, { force: true });
}

export async function runEvaluation(options: EvaluationOptions): Promise<EvaluationResult> {
  if (options.preflight.drafts && !options.allowDrafts) {
    throw new Error("the sidecars in use are drafts; Phase 1B counts approved sidecars only. Pass allowDrafts for a provisional run.");
  }
  if (!options.outDir) return evaluate(options);
  mkdirSync(options.outDir, { recursive: true });
  const unlock = lockRun(options.outDir);
  try {
    return await evaluate(options);
  } finally {
    unlock();
  }
}

async function evaluate(options: EvaluationOptions): Promise<EvaluationResult> {
  const log = options.log ?? (() => undefined);
  const cells = planCells(options);
  const outDir = options.outDir;
  const logFile = outDir ? join(outDir, "runs.jsonl") : undefined;
  // A hosted run in a directory must pass every request through a pacer bound to the run's cumulative cap. The
  // provider's kind decides, not whether a pacer happens to be present.
  const hosted = options.provider.kind === "hosted";
  if (outDir && hosted && !options.provider.pacer) throw new Error("a hosted run in a run directory needs a pacer: every request it sends must count against the run's cumulative cap");

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
      // The cumulative cap and the dollar ceiling stay what the run recorded unless this invocation names a new one,
      // which is recorded.
      const was = recorded.limits;
      // A limit holds what the run has already done: it can be raised, or lowered as far as that, never past it.
      if (options.maxTotalRequests !== undefined || options.maxTotalUsd !== undefined) {
        const done = runTotals(join(outDir, "requests.jsonl"), readLog<EvaluationResult["invocations"][number]>(join(outDir, "pacing.jsonl")).records, { at: new Date().toISOString(), invocation: options.preflight.at });
        if (options.maxTotalRequests !== undefined && options.maxTotalRequests < done.sent) {
          throw new Error(`--max-total-requests ${options.maxTotalRequests} is below the ${done.sent} requests the run in ${outDir} has already sent; a cap can be lowered only as far as that`);
        }
        if (options.maxTotalUsd !== undefined && options.maxTotalUsd < done.usd) {
          throw new Error(`--max-total-usd ${options.maxTotalUsd} is below the $${done.usd.toFixed(4)} the run in ${outDir} has already committed; a ceiling can be lowered only as far as that`);
        }
      }
      const changes = [...(was?.changes ?? [])];
      const said: string[] = [];
      if (options.maxTotalRequests !== undefined && options.maxTotalRequests !== was?.maxTotalRequests) {
        changes.push({ at: options.preflight.at, ...(was?.maxTotalRequests !== undefined ? { from: was.maxTotalRequests } : {}), to: options.maxTotalRequests });
        said.push(`the run's cumulative cap is now ${options.maxTotalRequests} requests${was?.maxTotalRequests !== undefined ? ` (it was ${was.maxTotalRequests})` : ""}`);
      }
      if (options.maxTotalUsd !== undefined && options.maxTotalUsd !== was?.maxTotalUsd) {
        changes.push({ at: options.preflight.at, unit: "usd", ...(was?.maxTotalUsd !== undefined ? { from: was.maxTotalUsd } : {}), to: options.maxTotalUsd });
        said.push(`the run's dollar ceiling is now $${options.maxTotalUsd.toFixed(2)}${was?.maxTotalUsd !== undefined ? ` (it was $${was.maxTotalUsd.toFixed(2)})` : ""}`);
      }
      const maxTotalRequests = options.maxTotalRequests ?? was?.maxTotalRequests;
      const maxTotalUsd = options.maxTotalUsd ?? was?.maxTotalUsd;
      if (said.length > 0 && maxTotalRequests !== undefined) {
        manifest = { ...recorded, limits: { maxTotalRequests, ...(maxTotalUsd !== undefined ? { maxTotalUsd } : {}), changes } };
        replaceJson(manifestFile, manifest);
        for (const message of said) log(message);
      }
      if (hosted && manifest.limits === undefined) throw new Error(`the run in ${outDir} records no cumulative cap; pass --max-total-requests to set the requests the whole run may send`);
      if (hosted && manifest.limits?.maxTotalUsd === undefined) throw new Error(`the run in ${outDir} records no dollar ceiling; pass --max-total-usd to set the dollars the whole run may commit`);
      const original = join(outDir, "preflight.json");
      if (existsSync(original)) preflight = JSON.parse(readFileSync(original, "utf8")) as Preflight;
      let n = 1;
      while (existsSync(join(outDir, `preflight.resume-${n}.json`))) n += 1;
      writeJson(join(outDir, `preflight.resume-${n}.json`), options.preflight);
    } else {
      if (existsSync(manifestFile) || (logFile && existsSync(logFile))) throw new Error(`${outDir} already holds a run; pass resume to continue it`);
      if (hosted && options.maxTotalRequests === undefined) {
        throw new Error("a hosted run needs a cumulative cap: the requests the whole run may send across every invocation and resume (--max-total-requests)");
      }
      if (hosted && options.maxTotalUsd === undefined) {
        throw new Error("a hosted run needs a dollar ceiling: the dollars the whole run may commit, across every invocation and resume (--max-total-usd)");
      }
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

  // The run's cumulative cap and dollar ceiling, bound to this invocation's pacer. Its count is every request the run
  // has recorded, plus what each invocation from before the ledger reported (one that recorded nothing in it), each
  // at the most a request can cost; each request is recorded with its priced worst case before it is sent.
  const pacer = options.provider.pacer;
  const cap = manifest.limits?.maxTotalRequests;
  const capUsd = manifest.limits?.maxTotalUsd;
  const requestsFile = outDir ? join(outDir, "requests.jsonl") : undefined;
  let ledger: RunLedger | undefined;
  if (pacer && cap !== undefined) {
    const done = runTotals(requestsFile, earlierInvocations, { at: new Date().toISOString(), invocation: options.preflight.at });
    ledger = {
      cap,
      sent: done.sent,
      ...(capUsd !== undefined ? { capUsd } : {}),
      usd: done.usd,
      record(usd = 0) {
        if (requestsFile) appendFileSync(requestsFile, line({ at: new Date().toISOString(), invocation: options.preflight.at, usd }));
        this.sent += 1;
        this.usd = (this.usd ?? 0) + usd;
      },
      adjust(usd, reason) {
        if (requestsFile) appendFileSync(requestsFile, line({ at: new Date().toISOString(), invocation: options.preflight.at, adjust: usd, reason }));
        this.usd = (this.usd ?? 0) + usd;
      },
    };
    pacer.ledger = ledger;
  }
  // The model the run measures: recorded once, from its first metered call, and held to by every later call and every
  // resume (live/integrity.ts). It is on disk before the call that reported it returns.
  if (pacer) {
    pacer.served = {
      get id() {
        return manifest.servedModel?.id;
      },
      record(id) {
        if (manifest.servedModel) return;
        const next = { ...manifest, servedModel: { id, at: new Date().toISOString() } };
        if (outDir) replaceJson(join(outDir, "manifest.json"), next);
        manifest = next;
      },
    };
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
      // A call the run cannot trust: the cell in flight logs no record, and what it spent stays in the ledger.
      if (error instanceof RunHalted) {
        stopped = { reason: "integrity", message: error.message };
        log(`stopped on ${key}, a call the run cannot trust: ${error.message}`);
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
    ...(ledger ? { requests: { cap: ledger.cap, sent: ledger.sent, ...(ledger.capUsd !== undefined ? { capUsd: ledger.capUsd } : {}), usd: ledger.usd ?? 0 } } : {}),
    ...(stopped ? { stopped } : {}),
    ...(manifest.servedModel ? { servedModel: manifest.servedModel } : {}),
    ...(outDir ? { outDir } : {}),
    cells: { total: cells.length, done: records.length, reused },
  };
  if (outDir) {
    writeJson(join(outDir, "summary.json"), { runId: manifest.runId, provider: options.provider.descriptor, corpus: manifest.corpus, cells: result.cells, stopped: stopped ?? null, servedModel: manifest.servedModel ?? null, telemetry: telemetry ?? null, invocations, ...(result.requests ? { requests: result.requests } : {}), superseded: spent, summary });
    writeFileSync(join(outDir, "REPORT.md"), renderReport(result, { providerId: options.provider.id, corpus: options.corpus }));
  }
  return result;
}
