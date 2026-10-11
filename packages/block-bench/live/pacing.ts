/**
 * Pacing for the shared zone gateway (ADR-B3, 1B): a cap on the requests
 * one invocation may send, the run's cumulative cap across every
 * invocation (its ledger, bound by the runner), a minimum spacing between
 * requests, and a backoff for a request the Worker refused before any
 * provider call (429, 503 busy). A refused request is retried after the
 * backoff because it reached no model; it is not the unusable-output
 * re-issue, which budgetedInner owns. The waits are reported, never hidden.
 */
export interface PacingOptions {
  /** Requests this invocation may send; the run stops cleanly at the cap. */
  maxRequests: number;
  /** Minimum milliseconds between two requests. */
  spacingMs: number;
  /** Backoff schedule for refused requests; its length is the retry limit. */
  backoffMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class PacingCapReached extends Error {
  constructor(
    readonly cap: number,
    readonly scope: "invocation" | "run" = "invocation",
  ) {
    super(
      scope === "run"
        ? `the run's cumulative cap of ${cap} requests (manifest.json) is reached; resume with a higher --max-total-requests to continue`
        : `the pacing cap of ${cap} requests for this invocation is reached; resume later`,
    );
    this.name = "PacingCapReached";
  }
}

/**
 * A run's requests across every invocation: its cap (the manifest's) and its count (the run directory's
 * requests.jsonl). A resume is a new process with a new pacer, so only the ledger carries the count across.
 */
export interface RunLedger {
  /** Requests the whole run may send, across every invocation and resume. */
  readonly cap: number;
  /** Requests the run has sent, every earlier invocation included. */
  sent: number;
  /** Records one request (and counts it) BEFORE it is sent, so a killed invocation is still counted. */
  record(): void;
}

export interface Pacer {
  readonly config: { maxRequests: number; spacingMs: number; backoffMs: readonly number[] };
  /** Requests sent by this invocation. */
  sent: number;
  /** The run's cumulative cap and count, bound by the runner once it has read the run directory. */
  ledger?: RunLedger;
  readonly waits: Array<{ atMs: number; ms: number; reason: string }>;
  /** Throws PacingCapReached unless n more requests fit under both caps: a cell is refused before its first request rather than cut off inside. */
  reserve(n: number): void;
  /** Waits out the spacing, then records and counts the request. Throws PacingCapReached at either cap. */
  before(): Promise<void>;
  /** Waits the n-th backoff (0-based) and returns true, or returns false when the retries are spent. */
  backoff(attempt: number, reason: string): Promise<boolean>;
}

export const DEFAULT_BACKOFF_MS: readonly number[] = [30_000, 60_000, 120_000, 240_000];

export function createPacer(options: PacingOptions): Pacer {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const schedule = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const started = now();
  let last: number | null = null;
  const pacer: Pacer = {
    config: { maxRequests: options.maxRequests, spacingMs: options.spacingMs, backoffMs: schedule },
    sent: 0,
    waits: [],
    reserve(n) {
      if (pacer.sent + n > options.maxRequests) throw new PacingCapReached(options.maxRequests);
      if (pacer.ledger && pacer.ledger.sent + n > pacer.ledger.cap) throw new PacingCapReached(pacer.ledger.cap, "run");
    },
    async before() {
      if (pacer.sent >= options.maxRequests) throw new PacingCapReached(options.maxRequests);
      if (pacer.ledger && pacer.ledger.sent >= pacer.ledger.cap) throw new PacingCapReached(pacer.ledger.cap, "run");
      if (last !== null) {
        const due = last + options.spacingMs - now();
        if (due > 0) {
          pacer.waits.push({ atMs: now() - started, ms: due, reason: "spacing" });
          await sleep(due);
        }
      }
      last = now();
      pacer.ledger?.record();
      pacer.sent += 1;
    },
    async backoff(attempt, reason) {
      const ms = schedule[attempt];
      if (ms === undefined) return false;
      pacer.waits.push({ atMs: now() - started, ms, reason });
      await sleep(ms);
      return true;
    },
  };
  return pacer;
}
