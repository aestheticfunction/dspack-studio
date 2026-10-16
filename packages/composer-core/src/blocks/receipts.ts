/**
 * Interface blocks (experimental): the beta's receipt and diagnostics export
 * (docs/blocks/PHASE-2-RELEASE-PLAN.md, §9; docs/blocks/BETA-OPERATIONS.md).
 *
 * The receipt states what a turn cost: its block and surface calls apart, the
 * exact model-call budget a block-mode run spent, the refinement mode in
 * words, and the model that served each call. The export is a file the user
 * asks for, holding each turn's call records, timings, outcome and the shape
 * of its block trace. Both read provider-reported figures only and never
 * estimate one.
 *
 * Neither may carry a prompt, a schema, generated output, surface content, a
 * credential, an entered value or an action parameter. A turn is read as
 * untrusted data, and every string that leaves here is fixed wording, a code
 * from a closed vocabulary, or a value that passes an id grammar (a model id,
 * a bundled block id, a sha256). Anything else is dropped or named "other".
 */
import type { SwitchReason } from "./refine";

type Json = Record<string, unknown>;

/** A model id as a provider names one: no spaces or markup, at most 100 characters. The Worker's operator log uses the same grammar. */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9@][A-Za-z0-9._:/@+-]{0,99}$/;

const OPERATIONS = ["plan", "flow-plan", "block", "block-repair", "generate", "refine", "repair"] as const;
const BLOCK_OPERATIONS: readonly string[] = ["block", "block-repair"];
const SURFACE_OPERATIONS: readonly string[] = ["generate", "refine", "repair"];
const CALL_OUTCOMES = ["ok", "unusable-output", "provider-error", "refused"] as const;
const SWITCH_REASONS: readonly SwitchReason[] = ["no-valid-seed", "block-unavailable", "repaired-prior", "digest-mismatch"];
/** A run's outcome: dspack-gen's four, and Composer's own invariant failure (build.ts). */
const RUN_OUTCOMES = ["passed", "failed-lint-exhausted", "failed-gate", "failed-adapter", "invariant-failure"] as const;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined => ((allowed as readonly unknown[]).includes(value) ? (value as T) : undefined);
/** A provider-reported token count as the app records it (normalizeUsage): finite and never negative. */
const tokens = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);
const index = (value: unknown): number | undefined => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined);
const millis = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined);
const recordsOf = (calls: unknown): Json[] => (Array.isArray(calls) ? calls.filter(isObject) : []);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const grouped = (n: number) => n.toLocaleString("en-US");

// ---------------------------------------------------------------------------
// The receipt.

/** One side of the split: provider calls with their reported tokens, and requests that reached no model. */
export interface ReceiptGroup {
  calls: number;
  /** Requests that reached no model: scripted, or refused before a provider call. */
  noModel: number;
  /** Sums of what was reported; a missing figure adds nothing and is counted below. */
  inputTokens: number;
  outputTokens: number;
  unreportedInput: number;
  unreportedOutput: number;
}

export type RefinementMode =
  | { mode: "compact"; outcome: "expanded" | "unsupported" | "invalid" | "fallback" | "provider-failure" | "unusable-output" | "refused" | "invariant-failure" }
  | { mode: "switch"; reason: SwitchReason | "unknown" }
  | { mode: "full-surface" };

export interface BetaReceipt {
  /** Block mode only: block calls (block, block-repair) and surface calls (generate, refine, repair). Planning is in neither. */
  split?: { block: ReceiptGroup; surface: ReceiptGroup };
  /** Block mode only: the requests the run's model-call budget counted, re-issues included, of its limit. */
  budget?: { used: number; limit: number; reissues: number; noModel: number };
  /** Refinements only. */
  refinement?: RefinementMode;
  /** Each model that served a provider call, in the order first seen, with its calls. */
  models: Array<{ model: string; calls: number }>;
  /** Provider calls that named no model. */
  unnamed: number;
  /** Provider calls that named something that is not a model id. */
  unrecognized: number;
}

/** Why a refinement switched to the full surface before any block call (composer-core refine.ts). */
export const SWITCH_REASON_TEXT: Record<SwitchReason, string> = {
  "no-valid-seed": "the previous turn has no validated block call to revise",
  "block-unavailable": "the previous turn's block is no longer offered",
  "repaired-prior": "the previous surface was repaired after its expansion",
  "digest-mismatch": "the previous surface changed after its expansion",
};

const COMPACT_TEXT: Record<Extract<RefinementMode, { mode: "compact" }>["outcome"], string> = {
  expanded: "compact refinement: the block's call was revised",
  // A scripted twin answers too, so this never claims a model did.
  unsupported: "switched to a full-surface refinement: the reply said the block cannot express the change",
  invalid: "switched to a full-surface refinement: the revised call did not pass the block's checks",
  fallback: "switched to a full-surface refinement",
  "provider-failure": "compact refinement, stopped by a provider failure",
  "unusable-output": "compact refinement, stopped: the model's output was unusable",
  refused: "compact refinement, stopped: the request was refused",
  "invariant-failure": "compact refinement, stopped: the expansion failed its invariant checks",
};

function group(records: readonly Json[]): ReceiptGroup {
  const g: ReceiptGroup = { calls: 0, noModel: 0, inputTokens: 0, outputTokens: 0, unreportedInput: 0, unreportedOutput: 0 };
  for (const r of records) {
    if (r.source === "provider") {
      g.calls++;
      const input = tokens(r.inputTokens);
      const output = tokens(r.outputTokens);
      if (input === undefined) g.unreportedInput++;
      else g.inputTokens += input;
      if (output === undefined) g.unreportedOutput++;
      else g.outputTokens += output;
    } else if (r.source === "none") {
      g.noModel++;
    }
  }
  return g;
}

function refinementMode(turn: Json, trace: Json | undefined): RefinementMode | undefined {
  if (turn.refinement !== true) return undefined;
  if (!trace) return { mode: "full-surface" };
  const fallback = isObject(trace.fallback) ? trace.fallback : undefined;
  if (fallback?.classification === "switch") return { mode: "switch", reason: oneOf(fallback.reason, SWITCH_REASONS) ?? "unknown" };
  if (!isObject(trace.refinement) || trace.refinement.applied !== true) return { mode: "full-surface" };
  switch (trace.outcome) {
    case "block":
      return { mode: "compact", outcome: "expanded" };
    case "fallback":
      return {
        mode: "compact",
        outcome: fallback?.classification === "unsupported-refinement" ? "unsupported" : fallback?.classification === "invalid-call" ? "invalid" : "fallback",
      };
    case "provider-failure": {
      // What stopped it, as the block phase classified the error: an unknown or missing kind reads as a provider failure.
      // A refusal the client classifies by status (a 503 sent before any provider call) still shows in its record.
      const classification = isObject(trace.providerError) ? trace.providerError.classification : undefined;
      const last = recordsOf(turn.calls).filter((r) => BLOCK_OPERATIONS.includes(r.operation as string)).at(-1);
      const refused = classification === "policy" || (last?.source === "none" && last.outcome === "refused");
      return { mode: "compact", outcome: refused ? "refused" : classification === "output" ? "unusable-output" : "provider-failure" };
    }
    case "invariant-failure":
      return { mode: "compact", outcome: "invariant-failure" };
    default:
      return { mode: "full-surface" };
  }
}

/**
 * What one turn cost, read from the turn as the app keeps it: its call
 * records (`calls`), its block trace (`progress.block`) and whether it was a
 * refinement. The split and the budget appear only when the turn ran a block
 * phase; `limit` is the run's model-call budget (3 in the beta).
 */
export function betaReceipt(turn: unknown, limit = 3): BetaReceipt {
  const t = isObject(turn) ? turn : {};
  const all = recordsOf(t.calls);
  const progress = isObject(t.progress) ? t.progress : {};
  const trace = isObject(progress.block) ? progress.block : undefined;
  const receipt: BetaReceipt = { models: [], unnamed: 0, unrecognized: 0 };

  if (trace) {
    const block = all.filter((r) => BLOCK_OPERATIONS.includes(r.operation as string));
    const surface = all.filter((r) => SURFACE_OPERATIONS.includes(r.operation as string));
    receipt.split = { block: group(block), surface: group(surface) };
    const budgeted = [...block, ...surface].filter((r) => r.source === "provider" || r.source === "none");
    receipt.budget = {
      used: budgeted.length,
      limit,
      reissues: budgeted.filter((r) => r.reissue === true).length,
      noModel: budgeted.filter((r) => r.source === "none").length,
    };
  }

  const refinement = refinementMode(t, trace);
  if (refinement) receipt.refinement = refinement;

  const served = new Map<string, number>();
  for (const r of all) {
    if (r.source !== "provider") continue;
    if (r.model === undefined || r.model === null || r.model === "") receipt.unnamed++;
    else if (typeof r.model === "string" && MODEL_ID_PATTERN.test(r.model)) served.set(r.model, (served.get(r.model) ?? 0) + 1);
    else receipt.unrecognized++;
  }
  receipt.models = [...served].map(([model, calls]) => ({ model, calls }));
  return receipt;
}

function providerText(g: ReceiptGroup): string {
  const head = plural(g.calls, "model call");
  const figures = [g.unreportedInput < g.calls ? `${grouped(g.inputTokens)} input` : null, g.unreportedOutput < g.calls ? `${grouped(g.outputTokens)} output` : null].filter(Boolean);
  if (figures.length === 0) return `${head}, usage not reported`;
  const gaps = (missing: number, what: string) => (missing === g.calls ? [`${what} not reported`] : missing > 0 ? [`${what} not reported for ${plural(missing, "call")}`] : []);
  const notes = [...gaps(g.unreportedInput, "input"), ...gaps(g.unreportedOutput, "output")];
  return `${head}: ${figures.join(" + ")} tokens${notes.length > 0 ? `, ${notes.join(", ")}` : ""}`;
}

function groupText(g: ReceiptGroup): string {
  const parts = [...(g.calls > 0 ? [providerText(g)] : []), ...(g.noModel > 0 ? [`${plural(g.noModel, "request")} reached no model`] : [])];
  return parts.length > 0 ? parts.join(", ") : "no calls";
}

function refinementText(mode: RefinementMode): string {
  if (mode.mode === "compact") return COMPACT_TEXT[mode.outcome];
  if (mode.mode === "switch") return mode.reason === "unknown" ? "switched to a full-surface refinement" : `switched to a full-surface refinement: ${SWITCH_REASON_TEXT[mode.reason]}`;
  return "full-surface refinement (no block)";
}

/** The receipt in words, one line: never an estimate, and nothing a model wrote or a person typed. */
export function describeBetaReceipt(receipt: BetaReceipt): string {
  const parts: string[] = [];
  if (receipt.split) parts.push(`block ${groupText(receipt.split.block)}`, `surface ${groupText(receipt.split.surface)}`);
  if (receipt.budget) {
    const b = receipt.budget;
    const notes = [...(b.reissues > 0 ? [`${b.reissues} re-issued`] : []), ...(b.noModel > 0 ? [`${b.noModel} reached no model`] : [])];
    parts.push(`budget ${b.used} of ${b.limit} ${b.noModel === 0 ? "model calls" : "calls"}${notes.length > 0 ? `, ${notes.join(", ")}` : ""}`);
  }
  if (receipt.refinement) parts.push(refinementText(receipt.refinement));
  if (receipt.models.length === 1) parts.push(`served by ${receipt.models[0]!.model}`);
  else if (receipt.models.length > 1) parts.push(`served by ${receipt.models.map((m) => `${m.model} (${plural(m.calls, "call")})`).join(", ")}`);
  if (receipt.unnamed > 0) parts.push(`model not named for ${plural(receipt.unnamed, "call")}`);
  if (receipt.unrecognized > 0) parts.push(`${plural(receipt.unrecognized, "call")} named an unrecognized model`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// The diagnostics export.

export const DIAGNOSTICS_FORMAT = "composer-beta-diagnostics";

export const DIAGNOSTICS_NOTICE =
  "Field data from the Composer beta: the builds listed in Build, in one browser session. It is descriptive only, and never ADR-B3 decision evidence. " +
  "It holds call records, timings, outcomes and the shape of each block trace; no prompt, schema, generated output, surface content, credential, entered value or action parameter, and no local model's name.";

/** A call record as the file keeps it: codes, indexes and provider-reported numbers. */
export interface DiagnosticsCall {
  operation: (typeof OPERATIONS)[number] | "other";
  attempt?: number;
  subCall?: number;
  source: "provider" | "none" | "other";
  outcome: (typeof CALL_OUTCOMES)[number] | "other";
  inputTokens?: number;
  outputTokens?: number;
  /** A model id that passes MODEL_ID_PATTERN, or "unrecognized". */
  model?: string;
  durationMs?: number;
  reissue?: true;
}

/** A block attempt's shape. Its token figures stay out: a re-issue sums them, reading a missing figure as zero, so the call records carry each call's own instead. */
export interface DiagnosticsAttempt {
  index: number;
  outcome: "ok" | "invalid" | "unsupported" | "provider-error" | "other";
  b1Issues: number;
  b2Issues: number;
  durationMs?: number;
}

/** The shape of a block trace: never its call, an issue's text, a message or a digest of model text. */
export interface DiagnosticsBlock {
  /** A block this build bundles, or "other". */
  id: string;
  version?: number;
  encoding?: "named" | "positional";
  outcome: "block" | "fallback" | "provider-failure" | "invariant-failure" | "other";
  providerCalls?: number;
  expansionAttemptIndex?: number;
  fallback?: { classification: "invalid-call" | "unsupported-refinement" | "switch" | "other"; reason?: SwitchReason };
  providerError?: { classification: "provider" | "output" | "policy" | "unknown" | "other" };
  invariantCount: number;
  /** The bundled block's schema and system-prompt digests: of the sidecar's text, never the model's. */
  blockSchemaSha256?: string;
  blockSystemSha256?: string;
  attempts: DiagnosticsAttempt[];
}

const TIMING_KEYS = ["planMs", "firstGatedAttemptMs", "firstValidPreviewMs", "emitMs", "totalMs"] as const;

export interface DiagnosticsTurn {
  turn: number;
  modelRef: "hosted-ai" | "scripted" | "other";
  status: "streaming" | "finished" | "error" | "other";
  /** The run's outcome, "other" for anything outside the five codes, or null before it has one. */
  outcome: (typeof RUN_OUTCOMES)[number] | "other" | null;
  refinement: RefinementMode | null;
  budget: NonNullable<BetaReceipt["budget"]> | null;
  /** describeBetaReceipt's line: fixed wording, numbers and model ids. */
  receipt: string;
  calls: DiagnosticsCall[];
  timings: Partial<Record<(typeof TIMING_KEYS)[number], number>>;
  block: DiagnosticsBlock | null;
}

export interface DiagnosticsFile {
  format: typeof DIAGNOSTICS_FORMAT;
  version: 1;
  exportedAt: string;
  notice: string;
  turns: DiagnosticsTurn[];
}

function withoutModel(r: Json): Json {
  const { model: _withheld, ...rest } = r;
  return rest;
}

function safeCall(r: Json): DiagnosticsCall {
  const attempt = index(r.attempt);
  const subCall = index(r.subCall);
  const input = tokens(r.inputTokens);
  const output = tokens(r.outputTokens);
  const ms = millis(r.durationMs);
  const named = !(r.model === undefined || r.model === null || r.model === "");
  return {
    operation: oneOf(r.operation, OPERATIONS) ?? "other",
    ...(attempt !== undefined ? { attempt } : {}),
    ...(subCall !== undefined ? { subCall } : {}),
    source: oneOf(r.source, ["provider", "none"] as const) ?? "other",
    outcome: oneOf(r.outcome, CALL_OUTCOMES) ?? "other",
    ...(input !== undefined ? { inputTokens: input } : {}),
    ...(output !== undefined ? { outputTokens: output } : {}),
    ...(named ? { model: typeof r.model === "string" && MODEL_ID_PATTERN.test(r.model) ? r.model : "unrecognized" } : {}),
    ...(ms !== undefined ? { durationMs: ms } : {}),
    ...(r.reissue === true ? { reissue: true as const } : {}),
  };
}

function safeTimings(value: unknown): DiagnosticsTurn["timings"] {
  const t = isObject(value) ? value : {};
  const out: DiagnosticsTurn["timings"] = {};
  for (const key of TIMING_KEYS) {
    const ms = millis(t[key]);
    if (ms !== undefined) out[key] = ms;
  }
  return out;
}

/** The shape of a block trace (durableTrace's diagnostics, without the call, any issue text, any message or any digest of model text). */
function safeTrace(trace: Json, knownBlocks: readonly string[]): DiagnosticsBlock {
  const selected = isObject(trace.selected) ? trace.selected : {};
  const version = index(selected.version);
  const encoding = oneOf(trace.encoding, ["named", "positional"] as const);
  const providerCalls = index(trace.providerCalls);
  const expansionAttemptIndex = index(trace.expansionAttemptIndex);
  let fallback: DiagnosticsBlock["fallback"];
  if (isObject(trace.fallback)) {
    const classification = oneOf(trace.fallback.classification, ["invalid-call", "unsupported-refinement", "switch"] as const) ?? "other";
    const reason = classification === "switch" ? oneOf(trace.fallback.reason, SWITCH_REASONS) : undefined;
    fallback = { classification, ...(reason ? { reason } : {}) };
  }
  const sha = (value: unknown) => (typeof value === "string" && SHA256.test(value) ? value : undefined);
  const schemaSha = sha(trace.blockSchemaSha256);
  const systemSha = sha(trace.blockSystemSha256);
  return {
    id: typeof selected.id === "string" && knownBlocks.includes(selected.id) ? selected.id : "other",
    ...(version !== undefined && version >= 1 ? { version } : {}),
    ...(encoding ? { encoding } : {}),
    outcome: oneOf(trace.outcome, ["block", "fallback", "provider-failure", "invariant-failure"] as const) ?? "other",
    ...(providerCalls !== undefined ? { providerCalls } : {}),
    ...(expansionAttemptIndex !== undefined ? { expansionAttemptIndex } : {}),
    ...(fallback ? { fallback } : {}),
    ...(isObject(trace.providerError)
      ? { providerError: { classification: oneOf(trace.providerError.classification, ["provider", "output", "policy", "unknown"] as const) ?? "other" } }
      : {}),
    invariantCount: Array.isArray(trace.invariant) ? trace.invariant.length : 0,
    ...(schemaSha ? { blockSchemaSha256: schemaSha } : {}),
    ...(systemSha ? { blockSystemSha256: systemSha } : {}),
    attempts: (Array.isArray(trace.attempts) ? trace.attempts.filter(isObject) : []).map((a, i): DiagnosticsAttempt => {
      const ms = millis(a.durationMs);
      return {
        index: index(a.index) ?? i,
        outcome: oneOf(a.outcome, ["ok", "invalid", "unsupported", "provider-error"] as const) ?? "other",
        b1Issues: Array.isArray(a.b1) ? a.b1.length : 0,
        b2Issues: Array.isArray(a.b2) ? a.b2.length : 0,
        ...(ms !== undefined ? { durationMs: ms } : {}),
      };
    }),
  };
}

/**
 * The file a user saves from the beta: each turn's call records, timings,
 * outcome, receipt and block-trace shape, in the order the session ran them.
 * `knownBlocks` are the block ids this build bundles; any other id is "other".
 * Only a hosted turn keeps its calls' model names, as its records hold them
 * from the Worker's replies (with the top-level fallback); a local model's or
 * the local agent's name is the user's own entry, so the file withholds it,
 * and its receipt line says nothing of it.
 */
export function diagnosticsExport(turns: readonly unknown[], options: { exportedAt: string; knownBlocks: readonly string[]; limit?: number }): DiagnosticsFile {
  return {
    format: DIAGNOSTICS_FORMAT,
    version: 1,
    exportedAt: ISO_TIME.test(options.exportedAt) ? options.exportedAt : "unknown",
    notice: DIAGNOSTICS_NOTICE,
    turns: turns.map((turn, i): DiagnosticsTurn => {
      const t = isObject(turn) ? turn : {};
      const progress = isObject(t.progress) ? t.progress : {};
      const trace = isObject(progress.block) ? progress.block : undefined;
      const hosted = t.modelRef === "hosted-ai";
      const records = recordsOf(t.calls).map((r) => (hosted ? r : withoutModel(r)));
      const counted = betaReceipt({ ...t, calls: records }, options.limit);
      // Withheld is not missing: a local turn's receipt line says nothing of its names.
      const receipt = hosted ? counted : { ...counted, unnamed: 0 };
      return {
        turn: i + 1,
        modelRef: oneOf(t.modelRef, ["hosted-ai", "scripted"] as const) ?? "other",
        status: oneOf(progress.status, ["streaming", "finished", "error"] as const) ?? "other",
        outcome: progress.outcome === undefined ? null : (oneOf(progress.outcome, RUN_OUTCOMES) ?? "other"),
        refinement: receipt.refinement ?? null,
        budget: receipt.budget ?? null,
        receipt: describeBetaReceipt(receipt),
        calls: records.map(safeCall),
        timings: safeTimings(t.timings),
        block: trace ? safeTrace(trace, options.knownBlocks) : null,
      };
    }),
  };
}
