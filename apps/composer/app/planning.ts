/**
 * Goal-first planning dispatch — turn a user's natural-language goal into a
 * governed context (intent) + feasibility, using whichever provider is active.
 *
 * The user never picks our internal intent taxonomy; this step infers it. It is
 * a cheap routing decision layered before the unchanged deterministic pipeline
 * (intent is not a vocabulary gate), so it can never weaken S1/S2/S3.
 *
 *   hosted-ai → the model infers via the AI Gateway (best quality)
 *   scripted  → a deterministic keyword classifier (no model call, on-rails)
 *   agent     → the deterministic classifier for now; the agent's model still
 *               does the hard part (generation). Model-based agent inference is
 *               a later upgrade — the experience (goal → context → build) is the
 *               same either way.
 *
 * Any inference failure falls back to the deterministic classifier so the flow
 * always proceeds. Each planner also returns the model calls it made (none for
 * deterministic routing; a failed call is still a call), so the turn that
 * planned can account for them.
 */
import {
  buildFlowPlanRequest,
  buildPlanRequest,
  createCallRecorder,
  flowPlanDeterministic,
  planDeterministic,
  reconcileFlowPlan,
  reconcilePlan,
  type FlowPlan,
  type GoalPlan,
  type ModelCallRecord,
} from "@dspack-studio/composer-core";
import { runGatewayRequest } from "./hosted-build";
// Type-only: erased at compile time, so no block code enters the default bundle.
import type { BlockDefinition } from "@dspack-studio/composer-core/blocks";

export async function planGoal(
  goal: string,
  modelRef: string,
  contract: Record<string, unknown>,
  options: { blocks?: readonly BlockDefinition[] } = {},
): Promise<{ plan: GoalPlan; calls: ModelCallRecord[] }> {
  // Interface blocks (experimental): a hosted build that was offered blocks
  // asks the planner which one, if any. Default builds fold this away, and a
  // build offered none posts exactly today's bytes.
  if (process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL === "1" && modelRef === "hosted-ai" && options.blocks && options.blocks.length > 0) {
    const runtime = await import("../experimental/blocks-runtime");
    return runtime.planGoalWithBlocks(goal, contract, options.blocks);
  }
  if (modelRef === "hosted-ai") {
    const recorder = createCallRecorder();
    try {
      const { json } = await runGatewayRequest(buildPlanRequest(goal, contract), { operation: "plan", recorder });
      return { plan: reconcilePlan(json, contract, goal), calls: [...recorder.calls] };
    } catch {
      // The gateway/model was unavailable; deterministic routing keeps the
      // build moving rather than failing the whole turn on the routing step.
      return { plan: planDeterministic(goal, contract), calls: [...recorder.calls] };
    }
  }
  // scripted + agent (v1): deterministic routing.
  return { plan: planDeterministic(goal, contract), calls: [] };
}

/**
 * Flow decomposition (P4 Phase C): one workflow goal → an editable plan of
 * ordered steps, through the SAME dispatch shape as planGoal — hosted infers
 * via the gateway, everything else (and any gateway failure) gets the
 * clearly-labeled deterministic outline. Planning never blocks the flow.
 */
export async function planFlow(
  goal: string,
  modelRef: string,
  contract: Record<string, unknown>,
): Promise<{ plan: FlowPlan; calls: ModelCallRecord[] }> {
  if (modelRef === "hosted-ai") {
    const recorder = createCallRecorder();
    try {
      const { json } = await runGatewayRequest(buildFlowPlanRequest(goal, contract), { operation: "flow-plan", recorder });
      return { plan: reconcileFlowPlan(json, contract, goal), calls: [...recorder.calls] };
    } catch {
      return { plan: flowPlanDeterministic(goal, contract), calls: [...recorder.calls] };
    }
  }
  return { plan: flowPlanDeterministic(goal, contract), calls: [] };
}
