/**
 * One evaluated cell, through the real code paths (ADR-B4). The arms:
 *
 * - production: today's configuration, flag off. The planning call, then
 *   runPipeline with the provider's own adapter and maxRepairs 2 (the
 *   Worker's parse retry stays on for hosted: no maxCalls key).
 * - capped: the budget-matched primitive arm. The same planning call, then
 *   runPipeline through budgetedInner with the shared budget of 3 and
 *   maxCalls 1, so the arm shares the unusable-output rule with block mode.
 * - block: the experimental path. The planning call with the block
 *   question, the block phase under the shared budget, then runPipeline
 *   preloaded with the expansion (maxRepairs 3 - k), on fallback the
 *   budgeted primitive (3 - k - 1), on a provider failure the captured
 *   error replayed (today's failed-adapter shape), on an invariant failure
 *   no pipeline at all. A null selection is today's path, as in the app.
 * - block-positional: the block arm with the model answering the compact
 *   positional call (ADR-B2), decoded to the named call by the block phase.
 *
 * Refinements run on the same arm's fresh result: production and capped
 * refine over the full prior surface (refinementConversation); the block
 * arm decides compact, switch or primitive from the prior trace exactly as
 * the app does (decideRefinement). Outcome, attempts and surface are read
 * from the pipeline's audit report, the artifact the app's fold reads too.
 */
import { runPipeline, type PipelineEvent, type RunResult } from "@aestheticfunction/dspack-gen";
import {
  aggregateUsage,
  buildPlanRequest,
  createCallRecorder,
  planDeterministic,
  reconcilePlan,
  refinementConversation,
  type BlockChoice,
  type GoalPlan,
  type ModelCallRecord,
} from "@dspack-studio/composer-core";
import {
  budgetedInner,
  createBudget,
  decideRefinement,
  expansionDigest,
  preloadedAdapter,
  reconcileBlockChoice,
  runBlockPhase,
  selectBlockDeterministic,
  withBlockChoice,
  type BlockDefinition,
  type BlockPhaseDeps,
  type BlockTrace,
  type StructuralAdapter,
} from "@dspack-studio/composer-core/blocks";
import { parityComponents, refinementFor, type Corpus, type CorpusPrompt } from "./corpus";
import { checkParity } from "./parity";
import { PacingCapReached } from "./pacing";
import { createMeter, failureKindOf, type Provider } from "./providers/types";
import type { LoadedReference } from "./references";
import { REFINEMENT_KIND, type Arm, type Condition, type FailureKind, type Path, type PriorResult, type RunRecord } from "./types";

type Json = Record<string, any>;

/** ADR-B4: at most three provider generation calls per run. */
export const BUDGET = 3;
/** Today's production configuration: two repairs after the first attempt. */
export const PRODUCTION_MAX_REPAIRS = 2;

export interface CellInput {
  reference: LoadedReference;
  provider: Provider;
  arm: Arm;
  condition: Condition;
  prompt: CorpusPrompt & { expectedIntent: string };
  corpus: Corpus;
  /** The same arm's fresh result for this prompt; required for a refinement. */
  prior?: PriorResult;
  now?: () => number;
  clock?: () => string;
}

export interface CellOutput {
  record: RunRecord;
  /** For a passing fresh build: what this arm's refinements build on. */
  prior?: PriorResult;
}

/** The intent's LAST worked example, as the app's scripted twin replays it; undefined when the context has none. */
export const exampleFor = (reference: LoadedReference, intent: string): unknown => {
  const examples = (reference.contract.examples as Array<{ intent: string; surface: unknown }> | undefined) ?? [];
  return examples.filter((e) => e.intent === intent).at(-1)?.surface;
};

const switchTrace = (prior: { id: string; version: number; intent: string }, reason: string): BlockTrace =>
  Object.freeze({
    selected: prior,
    encoding: "named" as const,
    blockSchemaSha256: "",
    blockSystemSha256: "",
    attempts: Object.freeze([]),
    providerCalls: 0,
    outcome: "fallback" as const,
    fallback: { reason, classification: "switch" },
    rawIsExpansion: true as const,
    refinement: { applied: false },
  });

/** Provider-reported figures. A call missing EITHER figure is unreported: summing the missing one as zero would flatter the arm. */
function tokensOf(calls: readonly ModelCallRecord[]): RunRecord["tokens"] {
  const usage = aggregateUsage(calls);
  return {
    input: usage.provider.inputTokens,
    output: usage.provider.outputTokens,
    providerCalls: usage.provider.calls,
    unreportedCalls: calls.filter((c) => c.source === "provider" && (c.inputTokens === undefined || c.outputTokens === undefined)).length,
    modelFreeCalls: usage.none,
  };
}

/** Watches the pipeline's adapter so a failed-adapter outcome keeps its typed cause. */
function observed(adapter: StructuralAdapter, seen: { last?: unknown }): StructuralAdapter {
  return {
    id: adapter.id,
    async generate(request, context) {
      try {
        return await adapter.generate(request, context);
      } catch (error) {
        seen.last = error;
        throw error;
      }
    },
  };
}

export async function runCell(input: CellInput): Promise<CellOutput> {
  const { reference, provider, arm, condition, prompt, corpus } = input;
  const now = input.now ?? (() => performance.now());
  const clock = input.clock ?? (() => new Date().toISOString());
  const key = { reference: reference.id, provider: provider.id, arm, prompt: prompt.id, condition };
  const blockArm = arm === "block" || arm === "block-positional";
  const encoding = arm === "block-positional" ? ("positional" as const) : ("named" as const);
  const expected = { intent: prompt.expectedIntent, block: prompt.block };
  const empty = (): RunRecord => ({
    ...key,
    at: clock(),
    expected,
    status: "skipped",
    passed: false,
    attempts: 0,
    calls: [],
    tokens: { input: 0, output: 0, providerCalls: 0, unreportedCalls: 0, modelFreeCalls: 0 },
    requestBytes: 0,
    timings: { totalMs: 0 },
  });

  if (condition !== "fresh" && !input.prior) return { record: { ...empty(), skipReason: "the arm's fresh build for this prompt did not pass" } };

  // A hosted provider refuses the cell here when its cap cannot cover it (PacingCapReached).
  provider.beforeCell?.();
  const contract = reference.contract;
  const profile = reference.profile;
  const eligible: readonly BlockDefinition[] = reference.blocks;
  const goal = prompt.goal;
  const t0 = now();
  const recorder = createCallRecorder();
  const meter = createMeter();
  const stamped: Array<{ atMs: number; type: PipelineEvent["type"] }> = [];
  let result: RunResult | undefined;

  // --- PLAN (fresh); a refinement reuses the fresh plan and makes no plan call ---
  let plan: GoalPlan;
  let planMs: number | undefined;
  let planCalls: ModelCallRecord[] = [];
  let planBytes = 0;
  let planFailure: { kind: FailureKind; message: string } | undefined;
  if (condition === "fresh") {
    const started = now();
    const planRecorder = createCallRecorder();
    const planMeter = createMeter();
    if (!provider.plansWithModel) {
      plan = planDeterministic(goal, contract);
      if (blockArm) plan = { ...plan, block: selectBlockDeterministic(goal, plan.intent, eligible) };
    } else {
      const request = blockArm ? withBlockChoice(buildPlanRequest(goal, contract), eligible) : buildPlanRequest(goal, contract);
      try {
        const json = await provider.plan(request, { recorder: planRecorder, meter: planMeter });
        plan = reconcilePlan(json, contract, goal);
        if (blockArm) plan = { ...plan, block: reconcileBlockChoice(json, { intent: plan.intent, eligible }) };
      } catch (error) {
        if (error instanceof PacingCapReached) throw error;
        const kind = failureKindOf(error);
        planFailure = { kind: kind === "output" || kind === "policy" ? kind : "provider", message: error instanceof Error ? error.message : String(error) };
        plan = planDeterministic(goal, contract);
        if (blockArm) plan = { ...plan, block: { id: null, reason: "planning-provider-failure", source: "deterministic" } };
      }
    }
    planMs = now() - started;
    planCalls = [...planRecorder.calls];
    for (const call of planCalls) recorder.record(call);
    planBytes = planMeter.bytes;
    meter.bytes += planMeter.bytes;
    meter.requests += planMeter.requests;
  } else {
    plan = { ...planDeterministic(goal, contract), intent: input.prior!.plan.intent, source: input.prior!.plan.source as GoalPlan["source"], ...(input.prior!.plan.block ? { block: input.prior!.plan.block } : {}) };
  }

  // A planning call the provider or the gateway failed ends the cell before generation: a provider (or policy)
  // failure, re-run symmetrically and never an arm result (ADR-B3), so an outage cannot send one arm's prompts down
  // another path. An unusable planning OUTPUT is the model's answer: the cell routes deterministically, as the app does.
  if (planFailure && planFailure.kind !== "output") {
    const calls = [...recorder.calls];
    return {
      record: {
        ...key,
        at: clock(),
        expected,
        plan: { calls: planCalls, bytes: planBytes, durationMs: planMs ?? 0, failure: planFailure },
        status: "completed",
        outcome: "planning-failure",
        passed: false,
        attempts: 0,
        path: "planning-failure",
        calls,
        tokens: tokensOf(calls),
        requestBytes: meter.bytes,
        timings: { ...(planMs !== undefined ? { planMs } : {}), totalMs: now() - t0 },
        failure: { ...planFailure, rerunEligible: true },
      },
    };
  }
  const intent = plan.intent;
  const choice: BlockChoice | undefined = plan.block;

  // --- ARM ---
  const refinementKind = condition === "fresh" ? undefined : REFINEMENT_KIND[condition];
  const template = refinementKind ? refinementFor(corpus, prompt.block, refinementKind) : undefined;
  const promptText = template ? template.instruction : goal;
  const conversation = condition === "fresh" ? undefined : refinementConversation(input.prior!.goal, input.prior!.surface);
  const deps: BlockPhaseDeps = { classify: provider.classify, lint: reference.lint, makeError: provider.makeError };
  const scripted = provider.kind === "scripted" ? { scripted: { example: exampleFor(reference, intent), ...(input.prior ? { prior: input.prior.surface } : {}), goal } } : {};
  const seen: { last?: unknown } = {};
  const refining = condition !== "fresh";
  const productionAdapter = () => observed(provider.surfaceAdapter({ recorder, meter, refinement: refining, ...scripted }), seen);
  const cappedAdapter = (budget: ReturnType<typeof createBudget>) =>
    observed(budgetedInner(provider.surfaceAdapter({ recorder, meter, refinement: refining, maxCalls: 1, ...scripted }), budget, deps), seen);

  let trace: BlockTrace | undefined;
  const pipeline = async (adapter: StructuralAdapter, maxRepairs: number) => {
    result = await runPipeline({
      contract: contract as never,
      intent,
      prompt: promptText,
      adapter: adapter as never,
      maxRepairs: Math.max(0, maxRepairs),
      emitProfile: profile,
      ...(conversation ? { conversation } : {}),
      onEvent: (event) => stamped.push({ atMs: now() - t0, type: event.type }),
    });
  };

  let path: Path = "primitive";
  let budgetRemainingAtFallback: number | undefined;
  let blockPhaseMs: number | undefined;
  let refinement: RunRecord["refinement"];
  let providerFailure: unknown;

  const blockRun = async (block: BlockDefinition, runIntent: string, runGoal: string, seed?: { priorGoal: string; priorCall: Json }): Promise<Path> => {
    const budget = createBudget(BUDGET);
    const surfaceInner = cappedAdapter(budget);
    const blockInner = budgetedInner(provider.blockAdapter({ recorder, meter, refinement: !!seed, maxCalls: 1, block, intent: runIntent, goal: runGoal, encoding, ...(seed ? { seed } : {}), ...scripted }), budget, deps);
    const started = now();
    const result = await runBlockPhase({ block, intent: runIntent, goal: runGoal, reference: { name: reference.name }, contract, profile, inner: blockInner, budget, deps, encoding, ...(seed ? { seed } : {}) });
    blockPhaseMs = now() - started;
    // The block phase classifies every throw; the run's own stop signal is not a provider failure.
    if (result.kind === "provider-failure" && result.error instanceof PacingCapReached) throw result.error;
    trace = result.trace;
    switch (result.kind) {
      case "expanded": {
        const mirror = { block: block.id, version: block.version, expansionDigest: result.trace.expansionDigest, rawIsExpansion: true };
        await pipeline(preloadedAdapter(result.surface, surfaceInner, mirror), BUDGET - budget.used);
        return result.trace.expansionAttemptIndex === 0 ? "block" : "block-repair";
      }
      case "fallback":
        budgetRemainingAtFallback = budget.remaining();
        await pipeline(surfaceInner, BUDGET - budget.used - 1);
        return "fallback";
      case "provider-failure": {
        providerFailure = result.error;
        const replay: StructuralAdapter = { id: provider.id, generate: async () => Promise.reject(result.error) };
        await pipeline(replay, 0);
        return "provider-failure";
      }
      case "invariant-failure":
        // Never a pipeline run: the template is defective (ADR-B4).
        return "invariant";
    }
  };

  if (arm === "production") {
    await pipeline(productionAdapter(), PRODUCTION_MAX_REPAIRS);
  } else if (arm === "capped") {
    await pipeline(cappedAdapter(createBudget(BUDGET)), BUDGET - 1);
  } else if (condition === "fresh") {
    const chosen = choice?.id ? eligible.find((b) => b.id === choice.id) : undefined;
    if (!chosen) await pipeline(productionAdapter(), PRODUCTION_MAX_REPAIRS);
    else path = await blockRun(chosen, intent, goal);
  } else {
    const prior = input.prior!;
    const decision = await decideRefinement({ prompt: prior.goal, progress: prior.progress }, eligible);
    if (decision.mode === "primitive") {
      refinement = { mode: "primitive", retained: false };
      await pipeline(productionAdapter(), PRODUCTION_MAX_REPAIRS);
    } else if (decision.mode === "switch") {
      path = "switch";
      refinement = { mode: "switch", retained: false, reason: decision.reason };
      const selected = ((prior.progress.block as Json | undefined)?.selected ?? {}) as Json;
      trace = switchTrace({ id: String(selected.id ?? ""), version: Number(selected.version ?? 0), intent: String(selected.intent ?? intent) }, decision.reason);
      await pipeline(cappedAdapter(createBudget(BUDGET)), BUDGET - 1);
    } else {
      const block = eligible.find((b) => b.id === decision.seed.id)!;
      path = await blockRun(block, decision.seed.intent, promptText, { priorGoal: decision.seed.priorGoal, priorCall: decision.seed.call });
      const taken: Path = path;
      refinement = { mode: "compact", retained: taken === "block" || taken === "block-repair", ...(trace?.fallback ? { reason: trace.fallback.reason } : {}) };
    }
  }

  // --- READ-OUT, from the audit report (the artifact the app's fold reads) ---
  const report = result?.report as Json | undefined;
  const outcome: string | undefined = report ? String(report.outcome) : path === "invariant" ? "invariant-failure" : undefined;
  const passed = outcome === "passed";
  const surface = passed ? (result?.surface as Json | undefined) : undefined;
  const attemptCount = Array.isArray(report?.attempts) ? report!.attempts.length : 0;
  const totalMs = now() - t0;
  const firstGated = stamped.find((s) => s.type === "attempt")?.atMs;
  const lastGated = [...stamped].reverse().find((s) => s.type === "attempt")?.atMs;
  const emitted = stamped.find((s) => s.type === "emitted")?.atMs;
  const timings = {
    ...(planMs !== undefined ? { planMs } : {}),
    ...(blockPhaseMs !== undefined ? { blockPhaseMs } : {}),
    ...(firstGated !== undefined ? { firstGatedAttemptMs: firstGated } : {}),
    ...(emitted !== undefined && lastGated !== undefined ? { emitMs: emitted - lastGated } : {}),
    totalMs,
  };
  const progress: Json = { status: "finished", ...(trace ? { block: trace } : {}), ...(outcome ? { outcome } : {}), ...(report ? { report } : {}), ...(surface ? { surface } : {}) };
  const calls = [...recorder.calls];
  const failureError = providerFailure ?? seen.last;
  const failure: RunRecord["failure"] | undefined =
    outcome === "failed-adapter"
      ? (() => {
          const kind = failureKindOf(failureError);
          return { kind, message: failureError instanceof Error ? failureError.message : String(failureError ?? "adapter failure"), rerunEligible: kind === "provider" || kind === "policy" };
        })()
      : undefined;
  const checklist = { labels: [...prompt.parity.labels, ...(template?.expectText ? [template.expectText] : [])], components: parityComponents(prompt, reference.id) };
  const parity = passed && surface ? checkParity(surface, checklist) : undefined;
  const surfaceDigest = passed && surface ? await expansionDigest(surface as never) : undefined;
  // Selection is scored on the planner's ANSWER: a block it named that reconciliation withdrew is still its answer.
  // An unusable planning output is no answer at all: neither a null nor a block, and never correct.
  const selection: RunRecord["selection"] =
    blockArm && condition === "fresh" && choice
      ? planFailure
        ? { chosen: null, source: choice.source, planningFailed: true, correct: false }
        : { chosen: choice.id, source: choice.source, ...(choice.rejected ? { rejected: choice.rejected } : {}), correct: (choice.rejected ?? choice.id) === prompt.block }
      : undefined;

  const record: RunRecord = {
    ...key,
    at: clock(),
    expected,
    ...(condition === "fresh" ? { plan: { intent, source: plan.source, ...(choice ? { block: choice } : {}), calls: planCalls, bytes: planBytes, durationMs: planMs ?? 0, ...(planFailure ? { failure: planFailure } : {}) } } : {}),
    ...(selection ? { selection } : {}),
    status: "completed",
    ...(outcome ? { outcome } : {}),
    passed,
    attempts: attemptCount,
    path,
    ...(budgetRemainingAtFallback !== undefined ? { budgetRemainingAtFallback } : {}),
    ...(trace ? { trace: trace as unknown as Record<string, unknown> } : {}),
    calls,
    tokens: tokensOf(calls),
    requestBytes: meter.bytes,
    timings,
    ...(parity ? { parity } : {}),
    ...(refining && passed ? { changed: surfaceDigest !== input.prior!.record.surfaceDigest } : {}),
    ...(failure ? { failure } : {}),
    ...(refinement ? { refinement } : {}),
    ...(surfaceDigest ? { surfaceDigest } : {}),
    ...(passed && surface ? { surface } : {}),
  };

  const prior: PriorResult | undefined =
    condition === "fresh" && passed && surface
      ? { goal, record, surface: surface as Json, progress, plan: { intent, source: plan.source, ...(choice ? { block: choice } : {}) } }
      : undefined;
  return { record, ...(prior ? { prior } : {}) };
}
