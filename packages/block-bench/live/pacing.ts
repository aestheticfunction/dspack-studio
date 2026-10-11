/**
 * Pacing for the shared zone gateway (ADR-B3, 1B): a cap on the requests
 * one invocation may send, a minimum spacing between requests, and a
 * backoff for a request the Worker refused before any provider call (429,
 * 503 busy). A refused request is retried after the backoff because it
 * reached no model; it is not the unusable-output re-issue, which
 * budgetedInner owns. The waits are reported, never hidden.
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
  constructor(readonly cap: number) {
    super(`the pacing cap of ${cap} requests for this invocation is reached; resume later`);
    this.name = "PacingCapReached";
  }
}

export interface Pacer {
  readonly config: { maxRequests: number; spacingMs: number; backoffMs: readonly number[] };
  /** Requests sent by this invocation. */
  sent: number;
  readonly waits: Array<{ atMs: number; ms: number; reason: string }>;
  /** Throws PacingCapReached unless n more requests fit under the cap: a cell is refused before its first request rather than cut off inside. */
  reserve(n: number): void;
  /** Waits out the spacing, then counts the request. Throws PacingCapReached at the cap. */
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
    },
    async before() {
      if (pacer.sent >= options.maxRequests) throw new PacingCapReached(options.maxRequests);
      if (last !== null) {
        const due = last + options.spacingMs - now();
        if (due > 0) {
          pacer.waits.push({ atMs: now() - started, ms: due, reason: "spacing" });
          await sleep(due);
        }
      }
      last = now();
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
