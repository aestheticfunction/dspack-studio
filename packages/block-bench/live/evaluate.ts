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
 * dollars it may commit, requests.jsonl records every request, by id, with
 * its worst case, on the disk before it is sent, and how that reservation
 * ended after its reply (released, settled at the reported usage, or
 * raised), in whole nanodollars, and each
 * invocation's pacer is bound to those totals, so no number of resumes
 * sends more, or spends more, than the run allows. One
 * invocation runs a directory at a time (run.lock), so two cannot spend the
 * same cap or interleave the logs.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { sha256Hex } from "@dspack-studio/composer-core/blocks";
import { runCell } from "./arms";
import { corpusDigest, promptsFor, type Corpus, type CorpusPrompt } from "./corpus";
import { REQUEST_USD_BOUND, toNanos } from "./cost";
import { codeIdentity, type CodeIdentity } from "./identity";
import { DEFAULT_DECISION, summarize, type DecisionOptions, type Summary } from "./metrics";
import { LockLost, PacingCapReached, RecordUnwritable, type RunLedger } from "./pacing";
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
  /** Every invocation's telemetry, this one included, oldest first, with the id its lines carry in requests.jsonl. */
  invocations: Array<{ at: string; id?: string; telemetry: Record<string, unknown> }>;
  /** Records a re-run replaced: spent, and counted in no arm. */
  superseded: Spend;
  /** The arms this run selected (the manifest's), whether or not each has reached a cell yet. */
  arms: Arm[];
  /** Hosted: the run's cumulative cap and dollar ceiling, and the requests sent and dollars committed against them, every invocation included. */
  requests?: { cap: number; sent: number; capUsd?: number; usd: number };
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
  /**
   * Hosted: the requests the whole run may send and the dollars it may commit, and every change a resume made to
   * either (a dollar change carries unit "usd"). Not identity: a resume may change them, on the record.
   */
  limits?: { maxTotalRequests: number; maxTotalUsd?: number; changes?: Array<{ at: string; unit?: "usd"; from?: number; to: number }> };
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

/** The errors a platform or filesystem gives when it cannot sync a directory at all, as opposed to failing to. */
const CANNOT_SYNC_DIRECTORIES = new Set(["EISDIR", "EINVAL", "ENOTSUP", "EPERM"]);

/** Flushes a directory's entries to the disk (a file created or renamed in it). A real failure to do so is thrown. */
function syncDirectory(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch (error) {
    if (!CANNOT_SYNC_DIRECTORIES.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Writes text through a descriptor opened with `flags` (append, replace, or create exclusively) and syncs it to the
 * disk before returning. The sync is explicit, never left to an option a later change could drop.
 */
function writeDurably(file: string, text: string, flags: "a" | "w" | "wx"): void {
  const fd = openSync(file, flags);
  try {
    const bytes = Buffer.from(text, "utf8");
    for (let at = 0; at < bytes.length; ) at += writeSync(fd, bytes, at, bytes.length - at);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Replaced whole, never truncated in place, and on the disk before it is moved into place: a crash leaves the old file or the new one. */
function replaceJson(file: string, value: unknown) {
  writeDurably(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, "w");
  renameSync(`${file}.tmp`, file);
  syncDirectory(dirname(file));
}

/**
 * Appends one line to the run's ledger and syncs it to the disk before returning, so a request is on the record
 * before it is sent and a crash of the machine cannot take it back. A line that cannot be written stops the run.
 */
function appendRecord(file: string, value: unknown): void {
  try {
    writeDurably(file, line(value), "a");
  } catch (error) {
    throw new RecordUnwritable(file, error);
  }
}

/**
 * Puts the ledger's own directory entry on the disk before an invocation sends anything: created here if it is new,
 * and synced whatever an earlier invocation managed, so a crash cannot lose the file itself.
 */
function settleLedgerEntry(file: string): void {
  try {
    writeDurably(file, "", "a");
    syncDirectory(dirname(file));
  } catch (error) {
    throw new RecordUnwritable(file, error);
  }
}

/**
 * The requests a run recorded before sending them, one line each with its id and its priced worst case; the settlement
 * recorded after each reply (a release, a settlement at the reported usage, or a raise), which names its request and
 * carries its final amount, and is not a request; and how many requests each invocation recorded. The ledger counts in
 * whole nanodollars (toNanos), so its sums are exact.
 *
 * Each request counts at its settlement, the largest if it has several, in whatever order they were written. One that
 * has none it could have (its reply was never read, or its settlement could not be written), wherever it sits, is raised
 * to the most any request can cost, on the record. A settlement whose request has no line is a request that was sent,
 * counted at least at that most. A request with no id or no price (unreadable, or recorded before either existed)
 * counts at that most, and no settlement lowers it.
 *
 * The ledger is settled before anything is appended. A cut-off last line is set aside: a request line cut off was
 * never sent, and a settlement cut off leaves its request unsettled.
 */
function readLedger(file: string, settle: { at: string; invocation: string }): { count: number; nanos: number; invocations: Map<string, number> } {
  const invocations = new Map<string, number>();
  if (!existsSync(file)) return { count: 0, nanos: 0, invocations };
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const torn = lines.pop()!.trim() !== "";
  const bound = toNanos(REQUEST_USD_BOUND);
  type Entry = { invocation?: unknown; request?: unknown; usd?: unknown; adjust?: unknown; final?: unknown };
  const entries = lines.map((entry): Entry => {
    try {
      const parsed: unknown = JSON.parse(entry);
      return parsed && typeof parsed === "object" ? (parsed as Entry) : {};
    } catch {
      return {}; /* still counted: a request was recorded */
    }
  });
  const nanosOf = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? toNanos(value) : undefined);
  const isSettlement = (entry: Entry) => nanosOf(entry.adjust) !== undefined;
  let count = 0;
  let nanos = 0;
  const counted = (invocation: unknown) => {
    count += 1;
    if (typeof invocation === "string") invocations.set(invocation, (invocations.get(invocation) ?? 0) + 1);
  };
  // Each request by its id, at its price; one without either at the most any request can cost.
  const priced = new Map<string, number>();
  for (const entry of entries) {
    if (isSettlement(entry)) continue;
    counted(entry.invocation);
    const price = nanosOf(entry.usd);
    if (typeof entry.request === "string" && !priced.has(entry.request) && price !== undefined && price >= 0) priced.set(entry.request, price);
    else nanos += bound;
  }
  // Each settlement as its request's final amount, never below nothing; the largest counts.
  const finals = new Map<string, number>();
  const strays = new Map<string, { invocation: unknown; final: number }>();
  for (const entry of entries) {
    if (!isSettlement(entry) || typeof entry.request !== "string") continue;
    const price = priced.get(entry.request);
    // A settlement's final amount, and never less than its request's price plus its adjustment.
    const stated = nanosOf(entry.final);
    const adjusted = price !== undefined ? price + nanosOf(entry.adjust)! : undefined;
    const final = stated === undefined ? adjusted : adjusted === undefined ? stated : Math.max(stated, adjusted);
    if (price === undefined) {
      const stray = strays.get(entry.request) ?? { invocation: entry.invocation, final: bound };
      if (final !== undefined && final > stray.final) stray.final = final;
      strays.set(entry.request, stray);
    } else if (final !== undefined && final >= 0) finals.set(entry.request, Math.max(finals.get(entry.request) ?? 0, final));
  }
  const raises: string[] = [];
  for (const [request, price] of priced) {
    const final = finals.get(request);
    if (final !== undefined) {
      nanos += final;
      continue;
    }
    const raised = Math.max(bound, price);
    raises.push(line({ ...settle, request, adjust: (raised - price) / 1e9, final: raised / 1e9, reason: "a request whose reply was never read" }));
    nanos += raised;
  }
  for (const stray of strays.values()) {
    counted(stray.invocation);
    nanos += stray.final;
  }
  if (torn || raises.length > 0) {
    writeDurably(`${file}.tmp`, text.slice(0, text.lastIndexOf("\n") + 1) + raises.join(""), "w");
    renameSync(`${file}.tmp`, file);
    syncDirectory(dirname(file));
  }
  return { count, nanos, invocations };
}

/**
 * What the run has sent and committed so far, every invocation included: the ledger (settled first), plus whatever
 * each earlier invocation reported sending beyond the lines it left there (all of it, for one from before the ledger),
 * each at the most a request can cost. A report of fewer than none counts as none. Invocations are told apart by the
 * id each writes on its lines and its report, unique even when callers reuse a preflight.
 */
function runTotals(requestsFile: string | undefined, earlier: EvaluationResult["invocations"], settle: { at: string; invocation: string }): { sent: number; nanos: number } {
  const recorded = requestsFile ? readLedger(requestsFile, settle) : { count: 0, nanos: 0, invocations: new Map<string, number>() };
  const unrecorded = earlier.reduce((sum, i) => {
    const sent = (i.telemetry.pacing as { sent?: unknown } | undefined)?.sent;
    const reported = typeof sent === "number" && Number.isFinite(sent) && sent > 0 ? Math.floor(sent) : 0;
    return sum + Math.max(0, reported - (recorded.invocations.get(i.id ?? i.at) ?? 0));
  }, 0);
  return { sent: recorded.count + unrecorded, nanos: recorded.nanos + unrecorded * toNanos(REQUEST_USD_BOUND) };
}

/** The errors a filesystem gives when it cannot make hard links at all. */
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"]);

/** Whether a process is running: signal 0 tests for it without sending anything. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** A run directory's lock, held by one invocation. */
export interface RunLock {
  readonly file: string;
  /** Whether the lock still names this invocation; one that cannot be read is not held. */
  held(): boolean;
  /** Removes the lock, only while it is still this invocation's own. */
  release(): void;
}

/**
 * One invocation at a time per run directory: two would each spend the same cumulative cap and interleave the logs.
 * The lock names its holder (its pid, its host and a nonce of its own) and is written whole before it is linked into
 * place, so it is never seen empty. A lock whose process is gone from this host (a killed invocation) is taken over:
 * moved aside under this invocation's own name, and taken only if what moved is the lock judged stale, else put back.
 * A holder on another host is never judged gone. Three invocations racing one stale lock can still leave one running
 * without it (a second moves its fresh lock aside as stale, and a third takes the empty place before it is put back),
 * so the run checks `held` before each request it sends.
 */
export function lockRun(outDir: string): RunLock {
  const file = join(outDir, "run.lock");
  const nonce = randomUUID();
  const host = hostname();
  const own = `${JSON.stringify({ pid: process.pid, host, nonce, at: new Date().toISOString() })}\n`;
  // Only a lock that is gone reads as nothing; any other failure to read one refuses, and never takes it over.
  const read = (path: string) => {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  };
  const holderOf = (text: string): { pid?: unknown; host?: unknown; at?: unknown } => {
    try {
      const holder: unknown = JSON.parse(text);
      return holder && typeof holder === "object" ? (holder as { pid?: unknown; host?: unknown; at?: unknown }) : {};
    } catch {
      return {}; /* unreadable: its writer died mid-write */
    }
  };
  const busy = (text: string) => {
    const holder = holderOf(text);
    return new Error(`another invocation (pid ${String(holder.pid)}${typeof holder.host === "string" ? ` on ${holder.host}` : ""}, started ${String(holder.at)}) is running the run in ${outDir}; wait for it to finish or stop it. If no invocation is running, delete ${file}.`);
  };
  const take = (): boolean => {
    const whole = `${file}.${nonce}`;
    writeDurably(whole, own, "w");
    try {
      linkSync(whole, file);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (code === "EEXIST") return false;
      if (!NO_HARD_LINKS.has(code)) throw error;
    } finally {
      rmSync(whole, { force: true });
    }
    // A filesystem without hard links: the lock is created exclusively instead, so another invocation can see it empty
    // for an instant; a takeover that moves it then finds it changed, and refuses.
    try {
      writeDurably(file, own, "wx");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  };
  if (!take()) {
    const seen = read(file);
    const holder = holderOf(seen);
    if ((typeof holder.host === "string" && holder.host !== host) || (typeof holder.pid === "number" && alive(holder.pid))) throw busy(seen);
    const aside = `${file}.stale.${nonce}`;
    try {
      renameSync(file, aside);
    } catch {
      throw busy(read(file)); /* gone: another invocation is taking it over */
    }
    const moved = read(aside);
    if (moved !== seen) {
      // Another invocation took it between the read and the move: its lock goes back, and this one refuses. It is
      // linked back, or renamed back if it cannot be linked; it is deleted only when a third lock already stands.
      try {
        linkSync(aside, file);
        rmSync(aside, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") rmSync(aside, { force: true });
        else {
          try {
            renameSync(aside, file);
          } catch {
            /* left aside under this invocation's name, never deleted */
          }
        }
      }
      throw busy(moved);
    }
    rmSync(aside, { force: true });
    if (!take()) throw busy(read(file));
  }
  const held = () => {
    try {
      return read(file) === own;
    } catch {
      return false;
    }
  };
  return {
    file,
    held,
    release() {
      // An unreadable lock is left for the next invocation to judge.
      if (held()) rmSync(file, { force: true });
    },
  };
}

export async function runEvaluation(options: EvaluationOptions): Promise<EvaluationResult> {
  if (options.preflight.drafts && !options.allowDrafts) {
    throw new Error("the sidecars in use are drafts; Phase 1B counts approved sidecars only. Pass allowDrafts for a provisional run.");
  }
  if (!options.outDir) return evaluate(options);
  mkdirSync(options.outDir, { recursive: true });
  const lock = lockRun(options.outDir);
  try {
    return await evaluate(options, lock);
  } finally {
    lock.release();
  }
}

async function evaluate(options: EvaluationOptions, lock?: RunLock): Promise<EvaluationResult> {
  const log = options.log ?? (() => undefined);
  // This invocation's own id in the run's records: its preflight time, which a caller may reuse, made unique.
  const invocationId = `${options.preflight.at}~${randomUUID()}`;
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
        const done = runTotals(join(outDir, "requests.jsonl"), readLog<EvaluationResult["invocations"][number]>(join(outDir, "pacing.jsonl")).records, { at: new Date().toISOString(), invocation: invocationId });
        if (options.maxTotalRequests !== undefined && options.maxTotalRequests < done.sent) {
          throw new Error(`--max-total-requests ${options.maxTotalRequests} is below the ${done.sent} requests the run in ${outDir} has already sent; a cap can be lowered only as far as that`);
        }
        if (options.maxTotalUsd !== undefined && toNanos(options.maxTotalUsd) < done.nanos) {
          throw new Error(`--max-total-usd ${options.maxTotalUsd} is below the $${(done.nanos / 1e9).toFixed(4)} the run in ${outDir} has already committed; a ceiling can be lowered only as far as that`);
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
      replaceJson(manifestFile, manifest);
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
  // has recorded, plus whatever each earlier invocation reported sending beyond its lines there, each at the most a
  // request can cost; each request is recorded with its id and priced worst case, on the disk, before it is sent, and
  // settled by its id after its reply. The dollars are kept in whole nanodollars, so they sum exactly.
  const pacer = options.provider.pacer;
  const cap = manifest.limits?.maxTotalRequests;
  const capUsd = manifest.limits?.maxTotalUsd;
  const requestsFile = outDir ? join(outDir, "requests.jsonl") : undefined;
  let ledger: RunLedger | undefined;
  if (pacer && cap !== undefined) {
    const done = runTotals(requestsFile, earlierInvocations, { at: new Date().toISOString(), invocation: invocationId });
    if (requestsFile) settleLedgerEntry(requestsFile);
    let committed = done.nanos;
    let sequence = 0;
    // The request the next settlement is for: requests are sent one at a time, and each is settled before the next.
    let open: { request: string; nanos: number } | undefined;
    const stamp = () => ({ at: new Date().toISOString(), invocation: invocationId });
    ledger = {
      cap,
      sent: done.sent,
      ...(capUsd !== undefined ? { capUsd } : {}),
      get usd() {
        return committed / 1e9;
      },
      record(usd = 0) {
        const request = `${invocationId}#${sequence + 1}`;
        if (requestsFile) appendRecord(requestsFile, { ...stamp(), request, usd });
        // Sent only while the lock is still this invocation's, checked after its line is on the disk: an invocation
        // that takes the lock over reads the ledger after it does, so it counts every request this one could send.
        if (lock && !lock.held()) throw new LockLost(lock.file);
        sequence += 1;
        this.sent += 1;
        committed += toNanos(usd);
        open = { request, nanos: toNanos(usd) };
      },
      adjust(usd, reason) {
        const delta = toNanos(usd);
        const of = open;
        open = undefined;
        // A raise counts even when its line cannot be written: the run's total never falls below what it spent.
        if (delta > 0) committed += delta;
        if (requestsFile) appendRecord(requestsFile, { ...stamp(), ...(of ? { request: of.request, final: (of.nanos + delta) / 1e9 } : {}), adjust: usd, reason });
        if (delta <= 0) committed += delta;
      },
    };
    pacer.ledger = ledger;
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
  const invocation = telemetry ? { at: options.preflight.at, id: invocationId, telemetry } : undefined;
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
    ...(outDir ? { outDir } : {}),
    cells: { total: cells.length, done: records.length, reused },
  };
  if (outDir) {
    writeJson(join(outDir, "summary.json"), { runId: manifest.runId, provider: options.provider.descriptor, corpus: manifest.corpus, cells: result.cells, stopped: stopped ?? null, telemetry: telemetry ?? null, invocations, ...(result.requests ? { requests: result.requests } : {}), superseded: spent, summary });
    writeFileSync(join(outDir, "REPORT.md"), renderReport(result, { providerId: options.provider.id, corpus: options.corpus }));
  }
  return result;
}
