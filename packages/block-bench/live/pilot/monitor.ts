/**
 * The pilot's early-termination rules beyond the dollar ceiling and the model checks the Phase 1B provider already
 * enforces (providers/hosted.ts: UnpricedModel, UnboundedReply, RunHalted). From the proposal:
 *
 * - three consecutive provider failures;
 * - any 429 from the gateway or the Worker's rate limiter (the pilot's pacer has no backoff, so a 429 is never retried);
 * - evidence that is unusable: every plan identical regardless of the prompt.
 *
 * Each is a RunStop, so runPipeline and runCell let it escape and nothing more is sent.
 */
import { failureKindOf, HarnessError } from "../providers/types";
import { RunStop } from "../pacing";
import { MAX_CONSECUTIVE_PROVIDER_FAILURES } from "./runs";

export type PilotStopReason = "provider-failures" | "rate-limited" | "unusable-evidence" | "operator";

export class PilotStop extends RunStop {
  constructor(
    readonly reason: PilotStopReason,
    message: string,
  ) {
    super(message);
    this.name = "PilotStop";
  }
}

export interface Monitor {
  /** A request came back with a usable answer. */
  succeeded(): void;
  /** A request failed; throws PilotStop when a stop rule is met. */
  failed(error: unknown): void;
  /**
   * A planning answer for a goal, of one kind (a goal plan or a flow plan); throws PilotStop when every answer of that
   * kind is identical across three or more different goals.
   */
  planned(kind: string, goal: string, raw: unknown): void;
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export function createMonitor(maxFailures = MAX_CONSECUTIVE_PROVIDER_FAILURES): Monitor {
  let consecutive = 0;
  const plans = new Map<string, Map<string, string>>();
  return {
    succeeded() {
      consecutive = 0;
    },
    failed(error) {
      if (error instanceof RunStop) return;
      const status = error instanceof HarnessError ? error.status : undefined;
      if (status === 429) throw new PilotStop("rate-limited", "the gateway answered 429; the pilot stops on any rate limit (LIVE-EVALUATION-PROPOSAL.md, early termination)");
      if (failureKindOf(error) === "provider") {
        consecutive += 1;
        if (consecutive >= maxFailures) throw new PilotStop("provider-failures", `${consecutive} consecutive provider failures; the pilot stops (LIVE-EVALUATION-PROPOSAL.md, early termination)`);
      } else {
        consecutive = 0;
      }
    },
    planned(kind, goal, raw) {
      const ofKind = plans.get(kind) ?? new Map<string, string>();
      plans.set(kind, ofKind);
      ofKind.set(goal, canonical(raw));
      if (ofKind.size >= 3 && new Set(ofKind.values()).size === 1) {
        throw new PilotStop("unusable-evidence", `every ${kind} is identical across ${ofKind.size} different goals, so the evidence is unusable; the pilot stops`);
      }
    },
  };
}
