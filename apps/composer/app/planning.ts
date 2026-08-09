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
 * always proceeds.
 */
import { buildPlanRequest, planDeterministic, reconcilePlan, type GoalPlan } from "@dspack-studio/composer-core";
import { runGatewayRequest } from "./hosted-build";

export async function planGoal(goal: string, modelRef: string, contract: Record<string, unknown>): Promise<GoalPlan> {
  if (modelRef === "hosted-ai") {
    try {
      const json = await runGatewayRequest(buildPlanRequest(goal, contract));
      return reconcilePlan(json, contract, goal);
    } catch {
      // The gateway/model was unavailable; deterministic routing keeps the
      // build moving rather than failing the whole turn on the routing step.
      return planDeterministic(goal, contract);
    }
  }
  // scripted + agent (v1): deterministic routing.
  return planDeterministic(goal, contract);
}
