/**
 * The live pilot's fixed scope (docs/repositioning/LIVE-EVALUATION-PROPOSAL.md, "Pilot"). Twelve runs on Astryx, the
 * production model, and nothing else. The list is closed: the runner takes no prompt, reference or count from its
 * caller, so the pilot cannot grow into the full baseline, which needs its own authorization.
 *
 * The three corpus prompts are read from acceptance/gateway-corpus/corpus.mjs by number, never copied: the twelve
 * Gateway prompts stay exactly as committed (pinned by packages/composer-core/src/corpus-pin.test.ts).
 */

/** The pilot's whole budget, every invocation and resume together: $5, accepted in principle by the owner. */
export const PILOT_CEILING_USD = 5;
/**
 * The most requests the pilot may send, a backstop under the dollar ceiling. Its worst case: a single build makes a
 * planning request and up to three generation requests (two repairs); a flow makes one flow-planning request and,
 * for each of at most 8 steps, the same four. 3 single hotel builds and 4 corpus builds are 28; 5 flows are 165.
 */
export const PILOT_MAX_REQUESTS = 200;
/**
 * Time between requests. ds-ai-gateway allows 5 provider calls per 60 s (fixed window) and one /api/propose request can
 * make two calls (the Worker's parse retry), so a request every 31 s stays at or under 4 calls a minute. The pilot never
 * retries a 429, so a faster pace would only end it early.
 */
export const PILOT_SPACING_MS = 31_000;
/** The only reference the pilot runs on. */
export const PILOT_REFERENCE = "astryx";
/** Consecutive provider failures that stop the pilot. */
export const MAX_CONSECUTIVE_PROVIDER_FAILURES = 3;

/** The hotel request from the repositioning brief, verbatim. */
export const HOTEL_GOAL =
  "Create a hotel reservation experience where a user can search for hotels by destination, check-in date, check-out date and number of guests, compare available hotels, select a hotel and room, review the reservation details, and confirm the booking.";

export type PilotRun =
  | { id: string; kind: "single" | "flow"; source: "hotel"; sample: number }
  | { id: string; kind: "single" | "flow"; source: "corpus"; corpusN: 3 | 5 | 10; sample: number };

/** The twelve runs, in the order they are sent. */
export const PILOT_RUNS: readonly PilotRun[] = Object.freeze([
  { id: "hotel-single-1", kind: "single", source: "hotel", sample: 1 },
  { id: "hotel-single-2", kind: "single", source: "hotel", sample: 2 },
  { id: "hotel-single-3", kind: "single", source: "hotel", sample: 3 },
  { id: "hotel-flow-1", kind: "flow", source: "hotel", sample: 1 },
  { id: "hotel-flow-2", kind: "flow", source: "hotel", sample: 2 },
  { id: "hotel-flow-3", kind: "flow", source: "hotel", sample: 3 },
  { id: "corpus-03-1", kind: "single", source: "corpus", corpusN: 3, sample: 1 },
  { id: "corpus-03-2", kind: "single", source: "corpus", corpusN: 3, sample: 2 },
  { id: "corpus-10-1", kind: "single", source: "corpus", corpusN: 10, sample: 1 },
  { id: "corpus-10-2", kind: "single", source: "corpus", corpusN: 10, sample: 2 },
  { id: "corpus-05-1", kind: "flow", source: "corpus", corpusN: 5, sample: 1 },
  { id: "corpus-05-2", kind: "flow", source: "corpus", corpusN: 5, sample: 2 },
] as const);

/**
 * What a person marks for task fit, per goal: the offline rubric decision D16 allows. It is never a gate and is never
 * scored by a model; the runner writes it beside each result, unmarked.
 */
export const TASK_FIT: Readonly<Record<string, readonly string[]>> = Object.freeze({
  hotel: ["destination", "check-in date", "check-out date", "guest count", "a comparison of at least two hotels", "a room choice", "a review of the reservation", "an explicit confirmation"],
  "corpus-3": ["the estimate reference and status", "the line items or services estimated", "totals", "what the user can do next, as EXPECTED.md row 3 describes"],
  "corpus-10": ["the filename and type", "the associated resource", "what the user can do with the file", "as EXPECTED.md row 10 describes (classified Partial)"],
  "corpus-5": ["a summary of the estimate being converted", "an explicit confirmation before the change", "the change cannot be repeated by accident", "a read-back of the result", "as EXPECTED.md row 5 describes"],
});

export const taskFitKey = (run: PilotRun): string => (run.source === "hotel" ? "hotel" : `corpus-${run.corpusN}`);

/** The Gateway corpus, read from the committed module. */
export async function loadCorpus(): Promise<ReadonlyArray<{ n: number; title: string; body: string }>> {
  const module = (await import(new URL("../../../../acceptance/gateway-corpus/corpus.mjs", import.meta.url).href)) as { CORPUS: Array<{ n: number; title: string; body: string }> };
  return module.CORPUS;
}

/** The goal a run sends. */
export async function goalFor(run: PilotRun): Promise<string> {
  if (run.source === "hotel") return HOTEL_GOAL;
  const prompt = (await loadCorpus()).find((p) => p.n === run.corpusN);
  if (!prompt) throw new Error(`corpus prompt ${run.corpusN} is missing from acceptance/gateway-corpus/corpus.mjs`);
  return prompt.body;
}
