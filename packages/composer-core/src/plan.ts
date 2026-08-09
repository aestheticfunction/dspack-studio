/**
 * Goal-first planning — the routing step that lets a user describe an OUTCOME
 * instead of picking our internal intent taxonomy.
 *
 * A user says "I want a reservation for two Friday at 7pm"; the Composer must
 * decide (1) which governed intent that belongs to, (2) whether the approved
 * component vocabulary can even express it, and (3) a clean restatement to feed
 * the proposal. Intent is NOT a vocabulary gate (the generation schema exposes
 * every approved component regardless of intent — see dspack-gen compiler); it
 * selects governance rules, few-shot examples, and design framing. So inference
 * is a cheap routing decision layered BEFORE the unchanged deterministic
 * pipeline — it never weakens S1/S2/S3.
 *
 * The plan runs through the SAME provider path as a proposal (it's just an
 * adapter.generate with a SMALL schema), so it works with hosted Haiku, local
 * Ollama, or a deterministic scripted classifier — provider choice changes the
 * proposer, not the workflow.
 */

export interface GoalPlan {
  /** Primary governed intent inferred for this goal (a real contract intent id). */
  intent: string;
  /** Other governed intents the goal also touches (multi-intent representation). */
  alsoConsidered: string[];
  /** The goal restated as a concrete UI outcome — feeds the proposal, shown to the user. */
  restated: string;
  /** Whether the approved component vocabulary can express this goal. */
  feasible: boolean;
  /** When !feasible: the missing capability in plain language (the vocabulary-gap message). */
  missingCapability: string | null;
  /** One-line, human-readable reason for the chosen governed context. */
  reason: string;
  /** How the plan was produced — for honesty in the UI and receipts. */
  source: "model" | "scripted";
}

interface IntentLike {
  id: string;
  name?: string;
  description?: string;
}

function intentsOf(contract: Record<string, unknown>): IntentLike[] {
  return ((contract.intents as IntentLike[] | undefined) ?? []).filter((i) => i && typeof i.id === "string");
}

/** Compact "what each component is" list — small enough to give the model as context. */
function vocabularySummary(contract: Record<string, unknown>): string {
  const components = (contract.components ?? {}) as Record<string, { whenToUse?: string; name?: string }>;
  return Object.entries(components)
    .map(([id, c]) => `- ${id}: ${(c.whenToUse ?? c.name ?? id).toString().slice(0, 120)}`)
    .join("\n");
}

/** The plan output schema. `intent` is an enum of real intent ids, so the model cannot invent one. */
export function planSchema(intentIds: string[]): Record<string, unknown> {
  const intentEnum = intentIds.length ? { enum: intentIds } : { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["intent", "restated", "feasible", "reason"],
    properties: {
      intent: intentEnum,
      alsoConsidered: { type: "array", items: intentEnum },
      restated: { type: "string", description: "The goal restated as a concrete UI outcome, one sentence." },
      feasible: { type: "boolean", description: "Can the approved components express this goal?" },
      missingCapability: {
        type: ["string", "null"],
        description: "If not feasible: the ONE missing capability in plain product language (e.g. 'a date-range picker').",
      },
      reason: { type: "string", description: "One short sentence: why this governed context fits." },
    },
  };
}

/**
 * Build the provider-agnostic request that infers the governed context for a
 * goal. The caller runs it through whatever adapter it has (hosted/local) and
 * passes the result to reconcilePlan.
 */
export function buildPlanRequest(
  goal: string,
  contract: Record<string, unknown>,
): { system: string; messages: Array<{ role: "user"; content: string }>; jsonSchema: Record<string, unknown> } {
  const intents = intentsOf(contract);
  const intentLines = intents
    .map((i) => `- ${i.id}${i.name ? ` (${i.name})` : ""}: ${(i.description ?? "").slice(0, 200)}`)
    .join("\n");
  const dsName = (contract.name as string | undefined) ?? "this design system";

  const system = [
    `You are the routing step of a governed UI generation system for the "${dsName}" design system.`,
    "A user describes a real-world product goal. You do NOT design the screen; you decide how the governed",
    "pipeline should handle it. Choose the single best-fit governed CONTEXT (intent) for the goal, note any",
    "other contexts it also touches, restate the goal as one concrete UI outcome, and judge whether the",
    "approved components below can express it.",
    "",
    "Governed contexts (choose `intent` from these ids only):",
    intentLines || "(none)",
    "",
    "Approved component vocabulary (what the design system can build with):",
    vocabularySummary(contract),
    "",
    "Rules:",
    "- Pick the intent whose description best matches the user's OUTCOME, not its surface keywords.",
    "- feasible=true when the approved components can reasonably express the goal (most enterprise",
    "  screens can). feasible=false ONLY when a genuinely required capability has no approved component",
    "  — then name that ONE capability in missingCapability, in plain product language. Never invent",
    "  components or intents.",
    "- Keep `restated` to one sentence describing the UI to build.",
    "Respond with a single JSON object matching the schema.",
  ].join("\n");

  return {
    system,
    messages: [{ role: "user", content: goal }],
    jsonSchema: planSchema(intents.map((i) => i.id)),
  };
}

const STOP_WORDS = new Set(
  "a an the of for to and or with in on at your you i want need me my our create build make show give please that this it is are can new".split(
    " ",
  ),
);
const tokenize = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));

/** Two words "match" when they share a >=4-char prefix — cheap stemming so
 *  delete~deleting, account~accounts, revoke~revoking all count. */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  let i = 0;
  while (i < min && a[i] === b[i]) i++;
  return i >= 4;
}

/**
 * Deterministic planner for scripted mode (no model call). Scores each intent by
 * word overlap between the goal and the intent's name+description, so a goal
 * routes to a plausible governed context reproducibly. Scripted then replays
 * that intent's worked example — a representative, deterministic demonstration
 * rather than a bespoke generation (the UI says so).
 */
export function planDeterministic(goal: string, contract: Record<string, unknown>): GoalPlan {
  const intents = intentsOf(contract);
  const goalTokens = tokenize(goal);
  let best: IntentLike | null = null;
  let bestScore = -1;
  for (const intent of intents) {
    const hay = tokenize(`${intent.name ?? ""} ${intent.description ?? ""}`);
    // Count DISTINCT goal words covered by this intent — not description-token
    // hits, which would just reward the longest description.
    const score = goalTokens.reduce((n, g) => n + (hay.some((w) => wordsMatch(g, w)) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }
  const chosen = best ?? intents[0];
  return {
    intent: chosen?.id ?? "",
    alsoConsidered: [],
    restated: goal.trim(),
    feasible: true,
    missingCapability: null,
    reason: chosen ? `Closest governed context to your request (${chosen.name ?? chosen.id}).` : "Default context.",
    source: "scripted",
  };
}

/**
 * Validate + normalize a model's raw plan against the contract. Clamps `intent`
 * to a real id (falls back to the deterministic classifier if the model somehow
 * returned an unknown one), coerces types, and bounds the free text.
 */
export function reconcilePlan(raw: unknown, contract: Record<string, unknown>, goal: string): GoalPlan {
  const intents = intentsOf(contract);
  const ids = new Set(intents.map((i) => i.id));
  const r = (raw ?? {}) as Record<string, unknown>;

  const intent = typeof r.intent === "string" && ids.has(r.intent) ? r.intent : planDeterministic(goal, contract).intent;
  const alsoConsidered = Array.isArray(r.alsoConsidered)
    ? [...new Set(r.alsoConsidered.filter((x): x is string => typeof x === "string" && ids.has(x) && x !== intent))]
    : [];
  const feasible = r.feasible !== false; // default to feasible unless the model explicitly said no
  const missingCapability =
    !feasible && typeof r.missingCapability === "string" && r.missingCapability.trim()
      ? r.missingCapability.trim().slice(0, 240)
      : null;
  const restated = typeof r.restated === "string" && r.restated.trim() ? r.restated.trim().slice(0, 300) : goal.trim();
  const reason = typeof r.reason === "string" && r.reason.trim() ? r.reason.trim().slice(0, 240) : "";

  return {
    intent,
    alsoConsidered,
    restated,
    // A gap is only honest if the model actually named the missing capability.
    feasible: feasible || missingCapability === null,
    missingCapability,
    reason,
    source: "model",
  };
}

/** Human label for a governed intent (name if present, else the id). */
export function intentLabel(contract: Record<string, unknown>, intentId: string): string {
  const found = intentsOf(contract).find((i) => i.id === intentId);
  return found?.name ?? intentId;
}
