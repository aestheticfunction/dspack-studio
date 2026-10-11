/**
 * Pacing for the shared zone gateway (ADR-B3, 1B): a cap on the requests
 * one invocation may send, the run's cumulative caps across every
 * invocation (its ledger, bound by the runner: requests, and the dollars
 * committed, live/cost.ts), a minimum spacing
 * between requests, and a backoff for a request the Worker refused before
 * any provider call (429, 503 busy). A refused request is retried after the
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
    readonly scope: "invocation" | "run" | "usd" = "invocation",
  ) {
    super(
      scope === "usd"
        ? `the run's dollar ceiling of $${cap.toFixed(2)} (manifest.json) cannot cover the worst case of the next request or cell; resume with a higher --max-total-usd to continue`
        : scope === "run"
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
  /** Dollars the whole run may commit, across every invocation and resume. */
  readonly capUsd?: number;
  /** Dollars the run has committed, every earlier invocation included: each request at its priced worst case, net of how its reservation ended. */
  usd?: number;
  /** Records one request, its count and its reservation, BEFORE it is sent, so a killed invocation is still counted. */
  record(usd?: number): void;
  /** Ends a reservation without a request: a release for a refusal that reached no model, a settlement at a verified reply's reported usage, or a raise for a reply that could not be verified. */
  adjust?(usd: number, reason: string): void;
}

export interface Pacer {
  readonly config: { maxRequests: number; spacingMs: number; backoffMs: readonly number[] };
  /** Requests sent by this invocation. */
  sent: number;
  /** The run's cumulative cap and count, bound by the runner once it has read the run directory. */
  ledger?: RunLedger;
  readonly waits: Array<{ atMs: number; ms: number; reason: string }>;
  /**
   * Throws PacingCapReached unless n more requests fit under both request caps and `usd` more fits under the run's
   * dollar ceiling: a cell is refused before its first request rather than cut off inside.
   */
  reserve(n: number, usd?: number): void;
  /**
   * Admits one request only if its absolute worst case (`headroom`, default `usd`) still fits under the dollar ceiling,
   * waits out the spacing, then records it with its priced worst case (`usd`). Throws PacingCapReached at any cap.
   */
  before(usd?: number, headroom?: number): Promise<void>;
  /** Changes the run's committed dollars, on the record: down for a release or a settlement, up for a raise. */
  adjust(usd: number, reason: string): void;
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
  /** Whether `usd` more fits under the run's dollar ceiling; a run without one has nothing to exceed. */
  const fitsUsd = (usd: number) => pacer.ledger?.capUsd === undefined || (pacer.ledger.usd ?? 0) + usd <= pacer.ledger.capUsd;
  const pacer: Pacer = {
    config: { maxRequests: options.maxRequests, spacingMs: options.spacingMs, backoffMs: schedule },
    sent: 0,
    waits: [],
    reserve(n, usd = 0) {
      if (pacer.sent + n > options.maxRequests) throw new PacingCapReached(options.maxRequests);
      if (pacer.ledger && pacer.ledger.sent + n > pacer.ledger.cap) throw new PacingCapReached(pacer.ledger.cap, "run");
      if (!fitsUsd(usd)) throw new PacingCapReached(pacer.ledger!.capUsd!, "usd");
    },
    async before(usd = 0, headroom = usd) {
      if (pacer.sent >= options.maxRequests) throw new PacingCapReached(options.maxRequests);
      if (pacer.ledger && pacer.ledger.sent >= pacer.ledger.cap) throw new PacingCapReached(pacer.ledger.cap, "run");
      if (!fitsUsd(headroom)) throw new PacingCapReached(pacer.ledger!.capUsd!, "usd");
      if (last !== null) {
        const due = last + options.spacingMs - now();
        if (due > 0) {
          pacer.waits.push({ atMs: now() - started, ms: due, reason: "spacing" });
          await sleep(due);
        }
      }
      last = now();
      pacer.ledger?.record(usd);
      pacer.sent += 1;
    },
    adjust(usd, reason) {
      pacer.ledger?.adjust?.(usd, reason);
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
