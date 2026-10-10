/**
 * Interface blocks (experimental): the refinement decision (RFC section 7).
 *
 * Compact refinement (the model revises the prior CALL, against the block's
 * small schema) is used only when three things hold: the prior turn's trace
 * ended in block mode, the prior run passed at the expansion attempt (its
 * surface IS the expansion, not a later repair), and the prior surface's
 * digest still equals the trace's expansion digest. Anything else switches,
 * visibly, to primitive refinement over the full prior surface, which is
 * unchanged from today. A digest mismatch is a switch, never an invariant
 * failure: a person may edit an accepted surface.
 */
import { expansionDigest } from "./expand";
import type { BlockTrace } from "./phase";
import type { BlockDefinition } from "./schema";

type Json = Record<string, unknown>;

export interface BlockSeed {
  id: string;
  version: number;
  intent: string;
  /** The prior turn's accepted named call. */
  call: Json;
  priorGoal: string;
}

export type SwitchReason = "no-valid-seed" | "block-unavailable" | "repaired-prior" | "digest-mismatch";

export type RefinementDecision = { mode: "compact"; seed: BlockSeed } | { mode: "switch"; reason: SwitchReason } | { mode: "primitive" };

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

export async function decideRefinement(
  prior: { prompt: string; progress: { block?: unknown; outcome?: string; report?: Json; surface?: unknown } },
  available: readonly BlockDefinition[],
): Promise<RefinementDecision> {
  const trace = prior.progress.block as BlockTrace | undefined;
  if (!trace) return { mode: "primitive" };
  const switchTo = (reason: SwitchReason): RefinementDecision => ({ mode: "switch", reason });
  if (trace.outcome !== "block" || typeof trace.expansionDigest !== "string") return switchTo("no-valid-seed");
  const call = trace.attempts?.[trace.expansionAttemptIndex ?? -1]?.call;
  if (!isObject(call)) return switchTo("no-valid-seed");
  const block = available.find((b) => b.id === trace.selected.id && b.version === trace.selected.version);
  if (!block) return switchTo("block-unavailable");
  const attempts = prior.progress.report?.attempts;
  if (Array.isArray(attempts) && attempts.length > 1) return switchTo("repaired-prior");
  if (!isObject(prior.progress.surface) || (await expansionDigest(prior.progress.surface)) !== trace.expansionDigest) return switchTo("digest-mismatch");
  return { mode: "compact", seed: { id: block.id, version: block.version, intent: trace.selected.intent, call, priorGoal: prior.prompt } };
}
