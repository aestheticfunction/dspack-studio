/**
 * Flow decomposition planning (P4 Phase C) — "Build a flow".
 *
 * One workflow goal becomes an EDITABLE plan of 2–8 ordered steps, each step
 * an ordinary single-surface build: a short title, a one-sentence generation
 * goal in the user's domain language, and a governed intent chosen from the
 * contract's OWN taxonomy. The planner proposes; the person edits and
 * approves; every step then runs the unchanged deterministic pipeline with
 * every gate — dspack-gen never learns flows exist.
 *
 * Same layer and idioms as plan.ts: a provider-agnostic request (the caller
 * runs it through whatever adapter it has), a reconciler that clamps model
 * output to the contract, and a deterministic fallback that never blocks —
 * clearly labeled, pre-filling one step per list item or sentence cluster.
 */
import { planDeterministic } from "./plan";

export interface FlowPlanStep {
  /** Short human title — becomes the flow step's title. */
  title: string;
  /** The step's generation goal, in the user's domain language. */
  goal: string;
  /** A REAL contract intent id (the reconciler guarantees it). */
  intent: string;
}

export interface FlowPlan {
  name: string;
  steps: FlowPlanStep[];
  /** One line on how this plan came to be (deterministic outlines say so). */
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

/** The decomposition output schema. Step `intent` is an enum of real intent
 *  ids (optional — the reconciler fills gaps deterministically). */
export function flowPlanSchema(intentIds: string[]): Record<string, unknown> {
  const intentEnum = intentIds.length ? { enum: intentIds } : { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["name", "steps"],
    properties: {
      name: { type: "string", description: "A short name for the whole flow." },
      steps: {
        type: "array",
        minItems: 2,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "goal"],
          properties: {
            title: { type: "string", description: "Short step title (a few words)." },
            goal: { type: "string", description: "One sentence: the screen to build, in the user's domain language." },
            intent: intentEnum,
          },
        },
      },
    },
  };
}

/**
 * Build the provider-agnostic decomposition request. The caller runs it
 * through whatever adapter it has (hosted/local) and passes the result to
 * reconcileFlowPlan. Tested shape-only — never against a live gateway.
 */
export function buildFlowPlanRequest(
  goal: string,
  contract: Record<string, unknown>,
): { system: string; messages: Array<{ role: "user"; content: string }>; jsonSchema: Record<string, unknown> } {
  const intents = intentsOf(contract);
  const intentLines = intents
    .map((i) => `- ${i.id}${i.name ? ` (${i.name})` : ""}: ${(i.description ?? "").slice(0, 200)}`)
    .join("\n");
  const dsName = (contract.name as string | undefined) ?? "this design system";

  const system = [
    `You are the flow-decomposition step of a governed UI generation system for the "${dsName}" design system.`,
    "A user describes a WORKFLOW goal — a multi-step experience, not one screen. You do NOT design screens;",
    "you outline the flow the governed pipeline will build one step at a time.",
    "",
    "Governed contexts (pick each step's `intent` from these ids only):",
    intentLines || "(none)",
    "",
    "Rules:",
    "- Decompose the user's workflow goal into 2–8 ordered steps. Each step is ONE screen a user sees.",
    "- Give each step a short title, a one-sentence generation goal in the user's domain language, and",
    "  pick each step's intent from the listed ids only.",
    "- Do not invent steps the goal doesn't ask for.",
    "Respond with a single JSON object matching the schema.",
  ].join("\n");

  return {
    system,
    messages: [{ role: "user", content: goal }],
    jsonSchema: flowPlanSchema(intents.map((i) => i.id)),
  };
}

/* ------------------------- deterministic outline ------------------------- */

const MAX_OUTLINE_STEPS = 6;

/** Leading list markers ("1. ", "2) ", "- ", "* ", "• "). */
const ITEM_MARKER = /(?:^|\n)\s*(?:\d+[.)]\s+|[-*•]\s+)/;

/** Numbered/bulleted items, when the goal is written as a list. The chunk
 *  before the first marker is the workflow FRAMING, not a step. */
function listItems(goal: string): string[] {
  if (!ITEM_MARKER.test(goal)) return [];
  const parts = goal
    .split(new RegExp(ITEM_MARKER.source, "g"))
    .map((p) => p.trim())
    .filter(Boolean);
  const startsWithMarker = /^\s*(?:\d+[.)]\s+|[-*•]\s+)/.test(goal);
  const items = startsWithMarker ? parts : parts.slice(1);
  return items.length >= 2 ? items : [];
}

function sentences(goal: string): string[] {
  return goal
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Group N chunks into at most `max` clusters of adjacent chunks. */
function cluster(chunks: string[], max: number): string[] {
  if (chunks.length <= max) return chunks;
  const size = Math.ceil(chunks.length / max);
  const out: string[] = [];
  for (let i = 0; i < chunks.length; i += size) out.push(chunks.slice(i, i + size).join(" "));
  return out;
}

const clean = (s: string): string => s.replace(/^[\s\-*•\d.)]+/, "").replace(/[\s.:;,]+$/, "").trim();

function titleFor(chunk: string, index: number): string {
  const words = clean(chunk).split(/\s+/).slice(0, 6).join(" ");
  return (words || `Step ${index + 1}`).slice(0, 60);
}

function nameFor(goal: string): string {
  const first = clean(sentences(goal)[0] ?? goal);
  return (first || "Untitled flow").slice(0, 80);
}

/**
 * The honest fallback — a DETERMINISTIC outline, never a model call, never a
 * block: one step per numbered item, else per sentence (clustered to at most
 * 6), else the goal plus a review step. Every step's intent routes through
 * the same deterministic classifier scripted builds use. Clearly labeled so
 * the UI can say what this is; the plan is editable before anything builds.
 */
export function flowPlanDeterministic(goal: string, contract: Record<string, unknown>): FlowPlan {
  const items = listItems(goal);
  let chunks = items.length >= 2 ? items : cluster(sentences(goal), MAX_OUTLINE_STEPS);
  if (chunks.length < 2) {
    const clauses = goal
      .split(/\s*(?:;|,\s+then\s+|\s+then\s+)\s*/i)
      .map((c) => c.trim())
      .filter(Boolean);
    chunks = clauses.length >= 2 ? cluster(clauses, MAX_OUTLINE_STEPS) : [goal.trim(), `Review the outcome of: ${clean(goal).slice(0, 120)}`];
  }
  const steps: FlowPlanStep[] = chunks.slice(0, MAX_OUTLINE_STEPS).map((chunk, i) => ({
    title: titleFor(chunk, i),
    goal: clean(chunk).slice(0, 300) || titleFor(chunk, i),
    intent: planDeterministic(chunk, contract).intent,
  }));
  return {
    name: nameFor(goal),
    steps,
    reason: "Deterministic outline — one step per list item or sentence, no model call. Edit the steps before building.",
    source: "scripted",
  };
}

/**
 * Validate + normalize a model's raw decomposition against the contract.
 * Clamps every step intent to a real id (invalid/missing → the deterministic
 * classifier on THAT step's goal), bounds lengths and the step count, and
 * falls back to the deterministic outline when fewer than 2 usable steps
 * remain — a plan is never empty and never blocks.
 */
export function reconcileFlowPlan(raw: unknown, contract: Record<string, unknown>, goal: string): FlowPlan {
  const ids = new Set(intentsOf(contract).map((i) => i.id));
  const r = (raw ?? {}) as Record<string, unknown>;

  const rawSteps = Array.isArray(r.steps) ? r.steps : [];
  const steps: FlowPlanStep[] = [];
  for (const entry of rawSteps) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const title = typeof e.title === "string" ? e.title.trim() : "";
    const stepGoal = typeof e.goal === "string" ? e.goal.trim() : "";
    if (!title && !stepGoal) continue;
    const basis = stepGoal || title;
    steps.push({
      title: (title || basis).slice(0, 80),
      goal: basis.slice(0, 300),
      intent: typeof e.intent === "string" && ids.has(e.intent) ? e.intent : planDeterministic(basis, contract).intent,
    });
    if (steps.length === 8) break;
  }
  if (steps.length < 2) return flowPlanDeterministic(goal, contract);

  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 120) : nameFor(goal);
  return { name, steps, reason: "", source: "model" };
}
