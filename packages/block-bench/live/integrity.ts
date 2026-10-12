/**
 * Benchmark integrity for a hosted run (ADR-B3: one model and one deployment per comparison). A call that reached the
 * provider must report both usage figures and the model that served it; that model must be Claude Haiku 4.5; and it
 * must stay the model the run's first metered call reported, which the manifest records once and every resume holds
 * to once the run's records show it measured (evaluate.ts holdServedModel). A call that breaks any of these stops the
 * run cleanly (RunHalted), apart from arm results: the cell in flight logs no record, what it spent stays in the
 * ledger, and a resume continues once the cause is understood. A refusal that showed it reached no model is released
 * before these checks and never trips them; any other reply is held to them, so a reply that cannot show whether a
 * model ran (no itemized calls, or none reported) stops the run too.
 *
 * Each call is held to its own model (Option B): the Worker names the model that served every call on that call's
 * calls[] entry, read from the provider's response as soon as it arrives, so a parse retry, an unusable output and an
 * answer the Worker could not send on each carry their calls' models and are ordinary results when every call holds.
 * A call that names none (a call the provider rejected, which returned nothing, or a Worker from before Option B)
 * stops the run. The reply's top-level model is the app's, never a call's: when the reply names one, it must be the
 * model its calls name.
 */
import type { ModelCallRecord } from "@dspack-studio/composer-core";
import { PRICED_FAMILY } from "./cost";
import { RunStop } from "./pacing";

/**
 * Claude Haiku 4.5 by the whole ids this deployment can return (cost.ts PRICED_FAMILY): the model the run prices is
 * the model it measures, so the two are one pattern. Any other spelling stops the run, until it is added there
 * deliberately.
 */
export const MODEL_FAMILY = PRICED_FAMILY;

export type HaltCondition = "usage-missing" | "model-missing" | "model-family" | "model-changed";

/** A token count the run can meter: a whole number, never negative; a call that reached the model read at least one input token. */
const whole = (n: unknown, least = 0): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= least;

/** The run's stop signal for a call it cannot trust: never an arm result, and the run stays resumable. */
export class RunHalted extends RunStop {
  constructor(
    readonly condition: HaltCondition,
    detail: string,
  ) {
    super(`${condition}: ${detail}`);
    this.name = "RunHalted";
  }
}

/** The model the run measures, bound by the runner: recorded once, from the run's first metered call. */
export interface ServedModel {
  /** The recorded model (manifest.json), once there is one. */
  readonly id?: string;
  /** Records the run's model; the runner persists it before the call returns. */
  record(id: string): void;
}

/**
 * Holds one reply's calls to the run's integrity conditions, in order, and throws RunHalted at the first that breaks
 * one. The runner holds every reply but a refusal that showed it reached no model, so the reply must report a call that
 * reached the provider, itemize its calls (`itemized`, the Worker's calls[]) so that its usage covers every call it
 * made, give each call its usage and its own model, and state that usage once (`statedOnce`: every spelling of a figure
 * agreeing, and its total its calls' sum). A model the reply names at its top (`model`), present at all, must be its
 * calls' model. The run's model is recorded only from a reply that holds.
 */
export function holdCalls(calls: readonly ModelCallRecord[], served: ServedModel, configured: string, reply: { itemized: boolean; statedOnce: boolean; model?: unknown }): void {
  const reached = calls.filter((call) => call.source !== "none");
  if (reached.length === 0) throw new RunHalted("usage-missing", "a reply that is not a refusal made before any provider call reported no call that reached the provider, so the run cannot show whether a model ran, or meter it");
  if (!reply.itemized) throw new RunHalted("usage-missing", "a reply did not itemize its calls (calls[]), so the run cannot show that its usage covers every call it made");
  // The run's model once recorded; before that, the first call's (which the first pass of the loop holds to a model).
  const measured = served.id ?? reached[0]!.model;
  for (const call of reached) {
    const where = `a ${call.operation} call (${call.outcome})`;
    if (!whole(call.inputTokens, 1) || !whole(call.outputTokens)) {
      throw new RunHalted("usage-missing", `${where} reached the provider without reporting its ${whole(call.inputTokens, 1) ? "output" : "input"} tokens as a whole count, so the run cannot meter it`);
    }
    if (!call.model) throw new RunHalted("model-missing", `${where} reached the provider without naming the model that served it`);
    if (!MODEL_FAMILY.test(call.model)) throw new RunHalted("model-family", `${where} was served by ${call.model}, not Claude Haiku 4.5 (${configured})`);
    if (call.model !== measured) throw new RunHalted("model-changed", `${where} was served by ${call.model}, but the run measures ${measured}${served.id === undefined ? "" : " (manifest.json)"}`);
  }
  if (reply.model !== undefined) {
    // Present at all, it must be a whole Claude Haiku 4.5 id: a number, an object or null at the top is no model.
    if (typeof reply.model !== "string" || !MODEL_FAMILY.test(reply.model)) {
      throw new RunHalted("model-family", `a reply names ${typeof reply.model === "string" ? reply.model : JSON.stringify(reply.model)} at its top, not Claude Haiku 4.5 (${configured})`);
    }
    if (reply.model !== measured) throw new RunHalted("model-changed", `a reply names ${reply.model} at its top, but its calls were served by ${measured}`);
  }
  if (!reply.statedOnce) throw new RunHalted("usage-missing", "a reply stated its usage two ways that disagree (a figure under two spellings, or a total that is not its calls' sum), so the run cannot meter it");
  if (served.id === undefined) served.record(reached[0]!.model!);
}
