/**
 * Interface blocks (experimental): the block phase.
 *
 * A pre-step at the proposal seam, provider-neutral: the adapter, the error
 * classifier, the linter and the error factory are injected, so this runs the
 * same way in the browser and in the Phase 1B harness. runPipeline stays the
 * authority on every surface; this phase only decides what its attempt 0 is.
 *
 * Budget (ADR-B4): at most `limit` provider generation calls per run, shared
 * by block calls, block repairs, the unusable-output re-issue and the
 * pipeline's own surface repairs. The budget is a counter, never a guess, and
 * an exhausted budget ends as the pipeline's own outcome, never a synthetic
 * one. Classification (ADR-B4): an unusable output is re-issued once if the
 * budget allows; a provider, policy or unknown failure ends the phase with no
 * further call; a template defect (expansion, S1/S2, an emit refusal, an
 * undeclared action, non-determinism) is an invariant failure with zero
 * further calls, never handed to a model.
 */
import type { Profile } from "@aestheticfunction/dspack-emit";
import { reconcileGenerationUsage, type ModelCallRecord } from "../usage";
import { callJsonSchema, checkConstraints, validateCall, type CallIssue } from "./call";
import { sha256Hex } from "./digest";
import { expandBlock, expansionDigest, type ExpandedSurface } from "./expand";
import { checkActions, emitCheck } from "./load";
import type { BlockDefinition } from "./schema";

type Json = Record<string, unknown>;

export type ErrorKind = "provider" | "output" | "policy" | "unknown";

/** What a block-mode caller tells its adapter about a call, beyond the request. */
export interface GenerateContext {
  operation?: "block" | "block-repair";
  /** The identical request, re-issued once after an unusable output. */
  reissue?: true;
}

export interface GenerateRequest {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  jsonSchema: Json;
}

export interface GenerateResult {
  json: unknown;
  raw: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  meta?: Json;
}

/** The structural adapter the phase and the pipeline share. */
export interface StructuralAdapter {
  readonly id: string;
  generate(request: GenerateRequest, context?: GenerateContext): Promise<GenerateResult>;
}

export interface LintVerdict {
  pass: boolean;
  gates: Array<{ gate: string; status: string; errors?: string[] }>;
}

export interface BlockPhaseDeps {
  /** The kind of a thrown error. Anything it cannot name is "unknown", which fails safe as a provider failure. */
  classify(error: unknown): ErrorKind;
  /** S1/S2/S3 over a surface (dspack-gen lintSurface, bound to the contract). */
  lint(surface: unknown): LintVerdict;
  /** An error the pipeline records as failed-adapter (an AdapterOutputError). */
  makeError(kind: string, message: string): Error;
}

// ---------------------------------------------------------------------------
// Budget

export interface Budget {
  readonly limit: number;
  used: number;
  remaining(): number;
  spend(): void;
}

export function createBudget(limit = 3): Budget {
  const budget: Budget = {
    limit,
    used: 0,
    remaining: () => Math.max(0, limit - budget.used),
    spend: () => {
      budget.used += 1;
    },
  };
  return budget;
}

/**
 * The one unusable-output rule, for every call in a block-mode run: if the
 * budget allows, the identical request is re-issued once and counted; else
 * the error is thrown as it is. A call past the budget never reaches a
 * provider: it fails as a typed adapter error.
 */
export function budgetedInner(inner: StructuralAdapter, budget: Budget, deps: Pick<BlockPhaseDeps, "classify" | "makeError">): StructuralAdapter {
  return {
    id: inner.id,
    async generate(request, context) {
      if (budget.remaining() <= 0) throw deps.makeError("budget", `the model-call budget of ${budget.limit} is exhausted`);
      budget.spend();
      try {
        return await inner.generate(request, context);
      } catch (error) {
        if (deps.classify(error) !== "output" || budget.remaining() <= 0) throw error;
        budget.spend();
        return await inner.generate(request, { ...(context ?? {}), reissue: true });
      }
    },
  };
}

/** Attempt 0 is the expansion, with no call; later attempts are ordinary repairs through the inner adapter. */
export function preloadedAdapter(expansion: ExpandedSurface, inner: StructuralAdapter, mirror?: unknown): StructuralAdapter {
  let attempts = 0;
  return {
    id: inner.id,
    async generate(request, context) {
      if (attempts++ === 0) {
        return { json: expansion, raw: JSON.stringify(expansion), model: "block-expansion", ...(mirror !== undefined ? { meta: { blockTrace: mirror } } : {}) };
      }
      return inner.generate(request, context);
    },
  };
}

// ---------------------------------------------------------------------------
// Prompts

const SENTINEL_SCHEMA: Json = {
  type: "object",
  additionalProperties: false,
  required: ["unsupported", "reason"],
  properties: { unsupported: { const: true }, reason: { type: "string", maxLength: 240 } },
};

export function blockSystemPrompt(block: BlockDefinition, intent: string, reference: { name: string }, refinement: boolean): string {
  return [
    `You are filling an interface block for the "${reference.name}" design system.`,
    `Block: ${block.name} (${block.id} v${block.version}). ${block.summary}`,
    `Governed context: ${intent}.`,
    "Answer with ONE JSON object matching the schema: the block's props only, in plain product language.",
    "Never add a key the schema does not declare. Keep every string within its length limit and every list within its item limit.",
    ...(refinement
      ? [
          "The previous call is given. Answer with the complete revised call for the requested change.",
          'If this block\'s props cannot express the change (a new kind of field, a different layout), answer exactly { "unsupported": true, "reason": "<one sentence>" } instead.',
        ]
      : []),
  ].join("\n");
}

export function blockRepairMessage(issues: readonly CallIssue[]): string {
  return ["The call did not validate:", ...issues.map((i) => `- ${i.path}: ${i.message}`), "Answer again with ONE JSON object matching the schema, correcting these."].join("\n");
}

// ---------------------------------------------------------------------------
// Trace

export interface BlockCallAttempt {
  index: number;
  /** The model's literal text. */
  rawText?: string;
  call?: unknown;
  b1: CallIssue[];
  b2: CallIssue[];
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  outcome: "ok" | "invalid" | "unsupported" | "provider-error";
}

/** The immutable record of one block phase: complete before runPipeline starts. */
export interface BlockTrace {
  selected: { id: string; version: number; intent: string };
  encoding: "named";
  blockSchemaSha256: string;
  blockSystemSha256: string;
  attempts: readonly BlockCallAttempt[];
  /** Provider calls this phase spent, re-issues included. */
  providerCalls: number;
  outcome: "block" | "fallback" | "provider-failure" | "invariant-failure";
  fallback?: { reason: string; classification: string };
  providerError?: { classification: ErrorKind; message: string };
  invariant?: string[];
  expansionDigest?: string;
  /** The block attempt whose call was expanded. */
  expansionAttemptIndex?: number;
  rawBlockText?: string;
  /** The pipeline's attempt 0 raw text is the expansion, not model text. */
  rawIsExpansion: true;
  refinement?: { applied: boolean };
}

export type BlockPhaseResult =
  | { kind: "expanded"; surface: ExpandedSurface; trace: BlockTrace }
  | { kind: "fallback"; reason: string; classification: "invalid-call" | "unsupported-refinement"; trace: BlockTrace }
  | { kind: "provider-failure"; error: unknown; classification: ErrorKind; trace: BlockTrace }
  | { kind: "invariant-failure"; reasons: string[]; trace: BlockTrace };

export interface BlockPhaseInput {
  block: BlockDefinition;
  intent: string;
  goal: string;
  reference: { name: string };
  contract: Json;
  profile?: Profile;
  /** A budgeted adapter (budgetedInner). */
  inner: StructuralAdapter;
  budget: Budget;
  deps: BlockPhaseDeps;
  /** Compact refinement: the prior turn's goal and its named call. */
  seed?: { priorGoal: string; priorCall: Json };
  now?: () => number;
}

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

export async function runBlockPhase(input: BlockPhaseInput): Promise<BlockPhaseResult> {
  const { block, intent, goal, reference, contract, profile, inner, budget, deps, seed } = input;
  const now = input.now ?? (() => performance.now());
  const schema: Json = seed ? { anyOf: [callJsonSchema(block, "named"), SENTINEL_SCHEMA] } : callJsonSchema(block, "named");
  const system = blockSystemPrompt(block, intent, reference, !!seed);
  const usedBefore = budget.used;
  const attempts: BlockCallAttempt[] = [];
  const base = {
    selected: { id: block.id, version: block.version, intent },
    encoding: "named" as const,
    blockSchemaSha256: await sha256Hex(JSON.stringify(schema)),
    blockSystemSha256: await sha256Hex(system),
    rawIsExpansion: true as const,
    ...(seed ? { refinement: { applied: true } } : {}),
  };
  const finish = (rest: Partial<BlockTrace> & Pick<BlockTrace, "outcome">): BlockTrace =>
    Object.freeze({ ...base, attempts: Object.freeze(attempts.map((a) => Object.freeze({ ...a }))), providerCalls: budget.used - usedBefore, ...rest });
  const invariant = (reasons: string[]): BlockPhaseResult => ({ kind: "invariant-failure", reasons, trace: finish({ outcome: "invariant-failure", invariant: reasons }) });

  let messages: GenerateRequest["messages"] = seed
    ? [
        { role: "user", content: seed.priorGoal },
        { role: "assistant", content: JSON.stringify(seed.priorCall) },
        { role: "user", content: goal },
      ]
    : [{ role: "user", content: goal }];

  for (let index = 0; index < 2; index++) {
    const started = now();
    let result: GenerateResult;
    try {
      result = await inner.generate({ system, messages, jsonSchema: schema }, { operation: index === 0 ? "block" : "block-repair" });
    } catch (error) {
      const classification = deps.classify(error);
      attempts.push({ index, b1: [], b2: [], durationMs: now() - started, outcome: "provider-error" });
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "provider-failure", error, classification, trace: finish({ outcome: "provider-failure", providerError: { classification, message } }) };
    }
    const durationMs = now() - started;
    const usage = result.usage ?? {};
    const json = result.json;
    const record = (outcome: BlockCallAttempt["outcome"], b1: CallIssue[], b2: CallIssue[]) =>
      attempts.push({ index, rawText: result.raw, call: json, b1, b2, ...usage, durationMs, outcome });

    if (seed && isObject(json) && json.unsupported === true) {
      record("unsupported", [], []);
      const reason = typeof json.reason === "string" && json.reason.trim() ? json.reason.trim().slice(0, 240) : "the model reported the change as unsupported by this block";
      return { kind: "fallback", reason, classification: "unsupported-refinement", trace: finish({ outcome: "fallback", fallback: { reason, classification: "unsupported-refinement" } }) };
    }

    const b1 = validateCall(block, json);
    const b2 = b1.length === 0 && isObject(json) ? checkConstraints(block, json) : [];
    if (b1.length > 0 || b2.length > 0) {
      record("invalid", b1, b2);
      const issues = b1.length > 0 ? b1 : b2;
      if (index === 0) {
        messages = [...messages, { role: "assistant", content: result.raw }, { role: "user", content: blockRepairMessage(issues) }];
        continue;
      }
      const reason = issues.map((i) => `${i.path}: ${i.message}`).join("; ");
      return { kind: "fallback", reason, classification: "invalid-call", trace: finish({ outcome: "fallback", fallback: { reason, classification: "invalid-call" } }) };
    }
    record("ok", [], []);

    // Everything from here is deterministic machinery: a failure is a template defect.
    const expanded = expandBlock(block, json as Json, { reference, intent });
    if (!expanded.ok) return invariant([`expansion ${expanded.path}: ${expanded.message}`]);
    let verdict: LintVerdict;
    try {
      verdict = deps.lint(expanded.surface);
    } catch (error) {
      return invariant([`the linter threw: ${error instanceof Error ? error.message : String(error)}`]);
    }
    const structural = verdict.gates.filter((g) => g.status === "FAIL" && (g.gate === "S1" || g.gate === "S2"));
    if (structural.length > 0) return invariant(structural.flatMap((g) => (g.errors?.length ? g.errors : ["failed"]).map((e) => `${g.gate} FAIL: ${e}`)));
    const emitted = emitCheck(expanded.surface, contract, profile);
    if (!emitted.ok) return invariant([`emit refused the expansion: ${emitted.refusal}`]);
    const actions = checkActions(block, emitted.actions);
    if (actions.length > 0) return invariant(actions.map((i) => i.message));
    const digest = await expansionDigest(expanded.surface);
    const again = expandBlock(block, json as Json, { reference, intent });
    if (!again.ok || (await expansionDigest(again.surface)) !== digest) return invariant(["re-expanding the same call gave different bytes"]);
    return { kind: "expanded", surface: expanded.surface, trace: finish({ outcome: "block", expansionDigest: digest, expansionAttemptIndex: index, rawBlockText: result.raw }) };
  }
  /* unreachable: the loop returns on its second pass */
  return invariant(["the block phase ended without a result"]);
}

// ---------------------------------------------------------------------------
// Reconciliation: the frozen trace, the recorder and the audit report.

const SURFACE_OPERATIONS = new Set(["generate", "refine", "repair"]);

export interface ReconciledBlockTrace {
  trace: BlockTrace;
  calls: { block: number; surface: number; total: number; reissues: number };
  budgetExceeded: boolean;
  /** The recorder agrees with the report's per-attempt usage. */
  consistent: boolean;
  pathLabel: "block" | "block-repair" | "fallback" | "provider-failure" | "invariant-failure";
}

export function reconcileBlockTrace(trace: BlockTrace, report: Json | undefined, recorded: readonly ModelCallRecord[], limit = 3): ReconciledBlockTrace {
  const provider = recorded.filter((r) => r.source === "provider");
  const block = provider.filter((r) => r.operation === "block" || r.operation === "block-repair").length;
  const surface = provider.filter((r) => SURFACE_OPERATIONS.has(r.operation)).length;
  const reissues = provider.filter((r) => r.reissue).length;
  const total = block + surface;
  const pathLabel: ReconciledBlockTrace["pathLabel"] =
    trace.outcome === "block" ? ((trace.expansionAttemptIndex ?? 0) > 0 ? "block-repair" : "block") : trace.outcome;
  return {
    trace,
    calls: { block, surface, total, reissues },
    budgetExceeded: total > limit,
    consistent: reconcileGenerationUsage(recorded, report as never).consistent,
    pathLabel,
  };
}

// ---------------------------------------------------------------------------
// The scripted twin for block mode: deterministic, no model.

const STRUCTURAL_CHANGE = /\b(add|remove|delete|drop|another|extra|new|column|field|step|provider|button|row|section|reorder|move|replace)\b/i;

/**
 * A fresh run plays the block's example call for the intent. A refinement
 * rewrites one string slot monotonically (mirroring the surface twin's
 * "(refined N)"), unless the instruction names a structural change, which
 * answers with the unsupported sentinel so the visible fallback is exercised.
 */
export function scriptedBlockScript(block: BlockDefinition, intent: string, goal: string, seed?: { priorGoal: string; priorCall: Json }): StructuralAdapter {
  return {
    id: "fake:scripted",
    async generate() {
      let json: Json;
      if (!seed) {
        const example = block.examples.find((e) => e.intent === intent) ?? block.examples[0];
        json = structuredClone((example?.call ?? {}) as Json);
      } else if (STRUCTURAL_CHANGE.test(goal)) {
        json = { unsupported: true, reason: `"${goal}" changes the block's structure; scripted block refinement only rewrites text` };
      } else {
        const slot = block.props.find((p) => p.type === "string" && typeof seed.priorCall[p.name] === "string");
        json = structuredClone(seed.priorCall);
        if (slot) {
          const current = String(seed.priorCall[slot.name]);
          const existing = /^(.*?)(?: \(refined(?: (\d+))?\))$/.exec(current);
          const text = existing ? existing[1]! : current;
          const next = existing ? Number(existing[2] ?? 1) + 1 : 1;
          json[slot.name] = next === 1 ? `${text} (refined)` : `${text} (refined ${next})`;
        }
      }
      return { json, raw: JSON.stringify(json), model: "fake-model", meta: { provider: "fake" } };
    },
  };
}
