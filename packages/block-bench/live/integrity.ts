/**
 * Benchmark integrity for a hosted run (ADR-B3: one model and one deployment per comparison). A call that reached the
 * provider must report both usage figures and the model that served it; that model must be Claude Haiku 4.5; and it
 * must stay the model the run's first metered call reported, which the manifest records once and every resume holds
 * to. A call that breaks any of these stops the run cleanly (RunHalted), apart from arm results: the cell in flight
 * logs no record, what it spent stays in the ledger, and a resume continues once the cause is understood. A refusal
 * that reached no model is released before these checks and never trips them.
 *
 * The Worker names the model only on a successful reply (`raw.model`, or the configured id when the provider omits
 * it), so a reply the Worker sends as an error (an unusable output, a provider failure) stops the run too.
 */
import type { ModelCallRecord } from "@dspack-studio/composer-core";

/** Claude Haiku 4.5 as its providers name it: `claude-haiku-4-5`, its dated snapshots, `anthropic/claude-haiku-4.5`. */
export const MODEL_FAMILY = /(^|[^a-z0-9])claude-haiku-4[-.]5($|[^0-9a-z.])/i;

export type HaltCondition = "usage-missing" | "model-missing" | "model-family" | "model-changed";

/** A token count the run can meter: a whole number, never negative. */
const whole = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** The run's stop signal for a call it cannot trust: never an arm result, and the run stays resumable. */
export class RunHalted extends Error {
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
 * one. A reply that carries a model's answer (`answered`) must report a call that reached the provider. The run's model
 * is recorded only from a reply whose every call holds.
 */
export function holdCalls(calls: readonly ModelCallRecord[], served: ServedModel, configured: string, answered = false): void {
  const reached = calls.filter((call) => call.source !== "none");
  if (answered && reached.length === 0) throw new RunHalted("usage-missing", "a reply carried a model's answer but reported no call that reached the provider, so the run cannot meter it");
  for (const call of reached) {
    const where = `a ${call.operation} call (${call.outcome})`;
    if (!whole(call.inputTokens) || !whole(call.outputTokens)) {
      throw new RunHalted("usage-missing", `${where} reached the provider without reporting its ${whole(call.inputTokens) ? "output" : "input"} tokens as a whole count, so the run cannot meter it`);
    }
    if (!call.model) throw new RunHalted("model-missing", `${where} reached the provider without naming the model that served it`);
    if (!MODEL_FAMILY.test(call.model)) throw new RunHalted("model-family", `${where} was served by ${call.model}, not Claude Haiku 4.5 (${configured})`);
    const measured = served.id ?? reached[0]!.model;
    if (call.model !== measured) throw new RunHalted("model-changed", `${where} was served by ${call.model}, but the run measures ${measured}${served.id === undefined ? "" : " (manifest.json)"}`);
  }
  if (served.id === undefined && reached.length > 0) served.record(reached[0]!.model!);
}
