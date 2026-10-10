/**
 * Interface blocks (experimental): selection.
 *
 * Three pure pieces, all over the ELIGIBLE blocks only (eligibility.ts):
 * - selectBlockDeterministic, for scripted runs: a block needs real evidence
 *   (a declared keyword, or at least two distinct matching words), and a tie
 *   goes to null. It never guesses.
 * - withBlockChoice extends the planning request with a required
 *   `block` (eligible ids, or null) and `blockReason`, listing the eligible
 *   blocks after the unchanged routing text. With no eligible blocks it
 *   returns the request untouched, so flag-off bytes stay identical.
 * - reconcileBlockChoice and recheckBlockChoice keep the choice honest: a
 *   block that is not eligible, or does not serve the plan's intent, is
 *   withdrawn to null with the rejection recorded; an omitted answer is told
 *   apart from an explicit null.
 */
import { tokenize, wordsMatch, type BlockChoice } from "../plan";
import type { BlockDefinition } from "./schema";

type Json = Record<string, unknown>;
type PlanRequest = { system: string; messages: unknown[]; jsonSchema: Json };

const normalize = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()} `;

/** Evidence one block has for a goal: matched keywords and distinct matched words. */
function evidence(goal: string, block: BlockDefinition): { keywords: string[]; words: string[] } {
  const text = normalize(goal);
  const goalTokens = tokenize(goal);
  const keywords = block.keywords.filter((keyword) => {
    const phrase = normalize(keyword).trim();
    return phrase.includes(" ") ? text.includes(` ${phrase} `) : goalTokens.some((t) => wordsMatch(t, phrase));
  });
  const hay = tokenize(`${block.name} ${block.summary} ${block.keywords.join(" ")}`);
  const words = [...new Set(goalTokens.filter((t) => hay.some((w) => wordsMatch(t, w))))];
  return { keywords, words };
}

export function selectBlockDeterministic(goal: string, intent: string, eligible: readonly BlockDefinition[]): BlockChoice {
  if (eligible.length === 0) return { id: null, reason: "no block is eligible for this build", source: "deterministic" };
  const candidates = eligible.filter((b) => b.intents.includes(intent));
  if (candidates.length === 0) {
    return { id: null, reason: `no eligible block serves ${intent} (${eligible.map((b) => `${b.id}: ${b.intents.join("/")}`).join(", ")})`, source: "deterministic" };
  }
  const scored = candidates
    .map((block) => {
      const found = evidence(goal, block);
      const enough = found.keywords.length > 0 || found.words.length >= 2;
      return { block, found, score: found.keywords.length * 2 + found.words.length, enough };
    })
    .filter((c) => c.enough)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) {
    return {
      id: null,
      reason: `no block serving ${intent} (${candidates.map((c) => c.id).join(", ")}) has enough evidence for this goal: a declared keyword, or two matching words`,
      source: "deterministic",
    };
  }
  const tied = scored.filter((c) => c.score === best.score);
  if (tied.length > 1) {
    return { id: null, reason: `tie between ${tied.map((c) => c.block.id).join(" and ")}; no block selected`, source: "deterministic" };
  }
  const why = best.found.keywords.length > 0 ? `keyword ${best.found.keywords.map((k) => `'${k}'`).join(", ")}` : `matching words ${best.found.words.join(", ")}`;
  return { id: best.block.id, reason: `${why} matched ${best.block.id}`, source: "deterministic" };
}

/**
 * The planning request with the block question added. Only the eligible
 * blocks are named, so an ineligible project never sees block metadata.
 */
export function withBlockChoice<T extends PlanRequest>(request: T, eligible: readonly BlockDefinition[]): T {
  if (eligible.length === 0) return request;
  const lines = eligible.map((b) => `- ${b.id} (${b.name}; serves ${b.intents.join(", ")}): ${b.summary}`).join("\n");
  const system = [
    request.system,
    "",
    "Interface blocks (experimental). Each is a governed interface pattern the system can fill deterministically.",
    "If the goal is a clear instance of exactly one block AND that block serves the chosen intent, answer `block`",
    "with its id; otherwise answer null. Never pick a block for a goal that only resembles it.",
    lines,
    "Give one short sentence in `blockReason`, whichever you answer.",
  ].join("\n");
  const schema = request.jsonSchema;
  const jsonSchema: Json = {
    ...schema,
    required: [...((schema.required as string[] | undefined) ?? []), "block", "blockReason"],
    properties: {
      ...((schema.properties as Json | undefined) ?? {}),
      block: { enum: [...eligible.map((b) => b.id), null], description: "The one block this goal is an instance of, or null." },
      blockReason: { type: "string", description: "One short sentence: why that block, or why none." },
    },
  };
  return { ...request, system, jsonSchema };
}

/** The planner's answer, held to the eligible blocks and the plan's intent. */
export function reconcileBlockChoice(raw: unknown, options: { intent: string; eligible: readonly BlockDefinition[] }): BlockChoice {
  const r = (raw ?? {}) as Json;
  const reason = typeof r.blockReason === "string" && r.blockReason.trim() ? r.blockReason.trim().slice(0, 240) : "";
  if (!Object.hasOwn(r, "block")) return { id: null, reason: "the planner did not answer the block question", source: "omitted" };
  if (r.block === null) return { id: null, reason: reason || "the planner chose no block", source: "model" };
  const id = String(r.block);
  const block = options.eligible.find((b) => b.id === id);
  if (!block) return { id: null, reason: `${id} is not an eligible block`, source: "model", rejected: id };
  if (!block.intents.includes(options.intent)) return { id: null, reason: `${id} does not serve ${options.intent}`, source: "model", rejected: id };
  return { id, reason: reason || `the planner chose ${id}`, source: "model" };
}

/** After the context changed (an override, or a flow step), a choice the new intent cannot use is withdrawn. */
export function recheckBlockChoice(choice: BlockChoice, intent: string, eligible: readonly BlockDefinition[]): BlockChoice {
  if (choice.id === null) return choice;
  const block = eligible.find((b) => b.id === choice.id);
  if (!block) return { id: null, reason: `${choice.id} is no longer eligible`, source: choice.source, rejected: choice.id };
  if (!block.intents.includes(intent)) {
    return { id: null, reason: `${choice.id} does not serve ${intent}, which the context was changed to`, source: choice.source, rejected: choice.id };
  }
  return choice;
}
