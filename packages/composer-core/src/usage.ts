/**
 * Model-call accounting: one record per PROVIDER call, whatever path made it.
 *
 * The audit report keeps one usage slot per generation attempt and nothing for
 * a call that threw (dspack-gen orchestrator: an adapter error records only
 * its message). It also never sees the planning call. So the per-run record of
 * truth is a recorder the caller fills at the transport boundary, on success
 * AND on failure, and the report is the cross-check. Provider-reported
 * figures and calls that never reached a model (scripted) are kept apart and
 * never summed together; offline estimates do not appear here at all.
 */

export type CallOperation = "plan" | "flow-plan" | "generate" | "refine" | "repair";

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ModelCallRecord {
  operation: CallOperation;
  /** 0-based pipeline attempt this call served (generation operations only). */
  attempt?: number;
  /** 0-based provider call within one gateway request (the Worker's parse retry is 1). */
  subCall?: number;
  inputTokens?: number;
  outputTokens?: number;
  /**
   * "provider": a call that reached (or may have reached) a model.
   * "none": no model was called: a scripted run, or a request the gateway
   * refused before any provider call (outcome "refused").
   */
  source: "provider" | "none";
  model?: string;
  durationMs?: number;
  outcome: "ok" | "unusable-output" | "provider-error" | "refused";
}

/** The per-run record of truth, filled at the transport boundary. */
export interface CallRecorder {
  readonly calls: readonly ModelCallRecord[];
  record(call: ModelCallRecord): void;
}

export function createCallRecorder(): CallRecorder {
  const calls: ModelCallRecord[] = [];
  return {
    calls,
    record(call) {
      calls.push({ ...call });
    },
  };
}

const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/**
 * Normalize every usage shape Composer can meet to {inputTokens, outputTokens}.
 * The legacy Worker {in, out} is accepted so a browser and Worker deployed at
 * different moments still account correctly.
 */
export function normalizeUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const inputTokens = count(r.inputTokens) ?? count(r.input_tokens) ?? count(r.prompt_tokens) ?? count(r.in);
  const outputTokens = count(r.outputTokens) ?? count(r.output_tokens) ?? count(r.completion_tokens) ?? count(r.out);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}) };
}

export interface UsageTotals {
  /** Sums of what WAS reported; a missing figure adds nothing here. */
  provider: { inputTokens: number; outputTokens: number; calls: number };
  /** Calls that reached a provider but reported no token counts. */
  unreported: number;
  /** Provider calls missing the input figure (fully unreported ones included). */
  unreportedInput: number;
  /** Provider calls missing the output figure (fully unreported ones included). */
  unreportedOutput: number;
  /** Requests that never reached a model (scripted, or refused before a provider call). */
  none: number;
}

export function aggregateUsage(records: readonly ModelCallRecord[]): UsageTotals {
  const totals: UsageTotals = {
    provider: { inputTokens: 0, outputTokens: 0, calls: 0 },
    unreported: 0,
    unreportedInput: 0,
    unreportedOutput: 0,
    none: 0,
  };
  for (const r of records) {
    if (r.source === "none") {
      totals.none++;
      continue;
    }
    totals.provider.calls++;
    if (r.inputTokens === undefined && r.outputTokens === undefined) totals.unreported++;
    if (r.inputTokens === undefined) totals.unreportedInput++;
    if (r.outputTokens === undefined) totals.unreportedOutput++;
    totals.provider.inputTokens += r.inputTokens ?? 0;
    totals.provider.outputTokens += r.outputTokens ?? 0;
  }
  return totals;
}

type Report = { generation?: { adapterId?: string }; attempts?: Array<Record<string, unknown>> } | undefined;

function isScripted(report: Report, attempt: Record<string, unknown>): boolean {
  const adapterId = String(report?.generation?.adapterId ?? "");
  const meta = (attempt.meta ?? {}) as Record<string, unknown>;
  return adapterId.startsWith("fake:") || meta.provider === "fake";
}

/**
 * Derive generation records from an audit report, for paths with no
 * transport recorder (the local agent). One record per attempt: the report
 * keeps a single usage slot per attempt, so a provider's internal retries are
 * invisible here, and a thrown attempt has no usage at all.
 */
export function callsFromReport(report: Report, options: { refinement?: boolean } = {}): ModelCallRecord[] {
  return (report?.attempts ?? []).map((attempt, i) => {
    const operation: CallOperation = i === 0 ? (options.refinement ? "refine" : "generate") : "repair";
    if (isScripted(report, attempt)) return { operation, attempt: i, source: "none", outcome: attempt.adapterError ? "provider-error" : "ok" };
    const usage = normalizeUsage(attempt.usage);
    return {
      operation,
      attempt: i,
      source: "provider",
      ...(usage ?? {}),
      ...(typeof attempt.model === "string" ? { model: attempt.model } : {}),
      outcome: attempt.adapterError ? "provider-error" : "ok",
    };
  });
}

/**
 * Cross-check the transport recorder against the report: for every attempt
 * the report carries usage for, the recorder's provider calls serving that
 * attempt must sum to the same input and output figures.
 */
export function reconcileGenerationUsage(
  recorded: readonly ModelCallRecord[],
  report: Report,
): { consistent: boolean; mismatches: Array<{ attempt: number; reported: Usage; recorded: Usage }> } {
  const mismatches: Array<{ attempt: number; reported: Usage; recorded: Usage }> = [];
  (report?.attempts ?? []).forEach((attempt, i) => {
    const reported = normalizeUsage(attempt.usage);
    if (!reported || isScripted(report, attempt)) return;
    const mine = recorded.filter((r) => r.attempt === i && r.source === "provider" && r.operation !== "plan" && r.operation !== "flow-plan");
    const sum = {
      inputTokens: mine.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
      outputTokens: mine.reduce((n, r) => n + (r.outputTokens ?? 0), 0),
    };
    if ((reported.inputTokens ?? 0) !== sum.inputTokens || (reported.outputTokens ?? 0) !== sum.outputTokens) {
      mismatches.push({ attempt: i, reported, recorded: sum });
    }
  });
  return { consistent: mismatches.length === 0, mismatches };
}

// ---------------------------------------------------------------------------

export interface TurnTimings {
  /** Routing (planning) time, when a planning step ran. */
  planMs?: number;
  /** Submit to the first gated attempt of any verdict. */
  firstGatedAttemptMs?: number;
  /**
   * Submit to the first VALID preview. The preview renders a surface only once
   * the run's audit arrives, so today this equals completion for passing runs.
   */
  firstValidPreviewMs?: number;
  /** From the last gated attempt to the emit event. */
  emitMs?: number;
  /** Submit to the end of the run. */
  totalMs: number;
}

/** Timings from stamped events (atMs relative to submit). Pure. */
export function turnTimings(
  stamped: ReadonlyArray<{ atMs: number; event: Record<string, unknown> }>,
  options: { totalMs: number; planMs?: number },
): TurnTimings {
  let firstGated: number | undefined;
  let lastGated: number | undefined;
  let emitMs: number | undefined;
  let firstValidPreviewMs: number | undefined;
  for (const { atMs, event } of stamped) {
    if (event.type !== "CUSTOM") continue;
    const name = String(event.name ?? "");
    if (name === "dspack.gates") {
      if (firstGated === undefined) firstGated = atMs;
      lastGated = atMs;
    } else if (name === "dspack.emit" && emitMs === undefined && lastGated !== undefined) {
      emitMs = atMs - lastGated;
    } else if (name === "dspack.audit" && firstValidPreviewMs === undefined) {
      const value = (event.value ?? {}) as Record<string, any>;
      if (value.outcome === "passed" && value.report?.attempts?.at?.(-1)?.surface) firstValidPreviewMs = atMs;
    }
  }
  return {
    ...(options.planMs !== undefined ? { planMs: options.planMs } : {}),
    ...(firstGated !== undefined ? { firstGatedAttemptMs: firstGated } : {}),
    ...(firstValidPreviewMs !== undefined ? { firstValidPreviewMs } : {}),
    ...(emitMs !== undefined ? { emitMs } : {}),
    totalMs: options.totalMs,
  };
}

// ---------------------------------------------------------------------------
// Receipts: what a turn cost, in words. Provider-reported figures only; an
// estimate never appears in a deployed receipt.

const OPERATION_ORDER: readonly CallOperation[] = ["plan", "flow-plan", "generate", "refine", "repair"];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const grouped = (n: number) => n.toLocaleString("en-US");

/** One line: how many model calls, for what, and their reported tokens. */
export function describeCalls(calls: readonly ModelCallRecord[] | undefined): string {
  if (!calls) return "model calls not reported";
  const provider = calls.filter((c) => c.source === "provider");
  const refused = calls.filter((c) => c.source === "none" && c.outcome === "refused").length;
  const scripted = calls.length - provider.length - refused;
  const parts: string[] = [];
  if (provider.length === 0) {
    parts.push(scripted > 0 ? "no model calls (scripted)" : "no model calls");
  } else {
    const totals = aggregateUsage(provider);
    const byOperation = OPERATION_ORDER.map((op) => [op, provider.filter((c) => c.operation === op).length] as const)
      .filter(([, n]) => n > 0)
      .map(([op, n]) => `${op} ${n}`);
    parts.push(`${plural(provider.length, "model call")} (${byOperation.join(", ")})`);
    if (totals.unreported === provider.length) {
      parts.push("usage not reported");
    } else {
      // Only figures some call reported are shown; a missing one is named.
      const figures = [
        totals.unreportedInput < provider.length ? `${grouped(totals.provider.inputTokens)} input` : null,
        totals.unreportedOutput < provider.length ? `${grouped(totals.provider.outputTokens)} output` : null,
      ].filter(Boolean);
      parts.push(`${figures.join(" + ")} tokens, provider-reported`);
      if (totals.unreported > 0) parts.push(`${plural(totals.unreported, "call")} reported no usage`);
      const inputGaps = totals.unreportedInput - totals.unreported;
      const outputGaps = totals.unreportedOutput - totals.unreported;
      if (inputGaps > 0) parts.push(`input not reported for ${plural(inputGaps, "call")}`);
      if (outputGaps > 0) parts.push(`output not reported for ${plural(outputGaps, "call")}`);
    }
  }
  if (refused > 0) parts.push(`${plural(refused, "request")} refused before reaching a model`);
  return parts.join(" · ");
}

/** One line: the turn's timings, in seconds, only those that happened. */
export function describeTimings(timings: TurnTimings): string {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  return [
    timings.planMs !== undefined ? `planning ${seconds(timings.planMs)}` : null,
    timings.firstGatedAttemptMs !== undefined ? `first gated attempt ${seconds(timings.firstGatedAttemptMs)}` : null,
    timings.firstValidPreviewMs !== undefined ? `valid preview ${seconds(timings.firstValidPreviewMs)}` : null,
    timings.emitMs !== undefined ? `emit ${seconds(timings.emitMs)}` : null,
    `total ${seconds(timings.totalMs)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
