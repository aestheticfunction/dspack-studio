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
import { toNanos } from "./cost";
import type { ServedModel } from "./integrity";

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

/** The run's own stop signal, never a provider failure: every layer passes it through, and the run stops cleanly. */
export class RunStop extends Error {}

export class PacingCapReached extends RunStop {
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
 * The run could not write its own record (requests.jsonl). No request is sent unless its line is on the record first,
 * and a reply whose settlement cannot be written stops the run, its raise still counted in memory; the next resume
 * raises that request to the most it could have cost.
 */
export class RecordUnwritable extends RunStop {
  constructor(
    readonly file: string,
    cause: unknown,
  ) {
    const why = (cause as NodeJS.ErrnoException | undefined)?.code ?? (cause instanceof Error ? cause.message : String(cause));
    super(`the run could not write ${file} (${why}), so nothing more is sent; resume once it can be written, and a request it could not settle is raised to the most it could have cost`);
    this.name = "RecordUnwritable";
  }
}

/**
 * A reply named a model the run does not price (cost.ts prices Claude Haiku 4.5 alone). What it cost may exceed any
 * bound at those prices, so the run sends nothing more; its request is raised to the most it could cost at them, which
 * is all the record can say.
 */
export class UnpricedModel extends RunStop {
  constructor(readonly model: string) {
    super(`a reply was served by ${JSON.stringify(model.slice(0, 200))}, which the run does not price (it prices Claude Haiku 4.5 alone), so nothing more is sent; its request is raised to the most it could cost at those prices, which may understate it. Find out why the gateway served that model before resuming`);
    this.name = "UnpricedModel";
  }
}

/**
 * A reply showed that no bound the run prices holds: a call past Claude Haiku 4.5's documented limits, or more calls
 * than its request allows. It is charged what it reported, each call it could not see at the most one call can cost,
 * and the run sends nothing more.
 */
export class UnboundedReply extends RunStop {
  constructor(readonly why: string) {
    super(`a reply reported ${why}, so no bound the run prices holds and nothing more is sent; it is charged what it reported, and each call it could not see at the most one call can cost. Find out why before resuming`);
    this.name = "UnboundedReply";
  }
}

/**
 * The run's lock (run.lock) no longer names this invocation: another invocation took it over, so this one sends nothing
 * more. The request whose line it had just put on the record was never sent, and the next resume counts it at its worst
 * case.
 */
export class LockLost extends RunStop {
  constructor(readonly file: string) {
    super(`the run's lock ${file} no longer names this invocation, so nothing more is sent; another invocation may be running the run: let it finish, then resume`);
    this.name = "LockLost";
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
  /**
   * Dollars the run has committed, every earlier invocation included: each request at its priced worst case, net of how
   * its reservation ended.
   */
  usd?: number;
  /**
   * The same in whole nanodollars (toNanos), as the ledger counts it. It is what is compared with the ceiling, so the
   * comparison is exact: dollars read back into nanodollars can come out one off near the largest ceiling allowed.
   */
  readonly nanos?: number;
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
  /** The model the run measures (manifest.json), bound by the runner: every call that reaches the provider is held to it (live/integrity.ts). */
  served?: ServedModel;
  readonly waits: Array<{ atMs: number; ms: number; reason: string }>;
  /** Milliseconds this invocation has spent in those waits, measured on the clock a cell's latency uses: what that latency leaves out. */
  waitedMs: number;
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
  // Waits are measured on the clock a cell's latency is measured on: an injected one in a test, otherwise the monotonic
  // clock, so a wall clock stepped or suspended during a wait never counts as waiting (arms.ts takes these out).
  const elapsed = options.now ?? (() => performance.now());
  /** Sleeps, and counts the time it actually took: a sleep that takes no time is no wait, whatever it was asked for. */
  const waited = async (ms: number) => {
    const from = elapsed();
    await sleep(ms);
    pacer.waitedMs += elapsed() - from;
  };
  /** Whether `usd` more fits under the run's dollar ceiling, in whole nanodollars; a run without one has nothing to exceed. */
  const fitsUsd = (usd: number) => pacer.ledger?.capUsd === undefined || (pacer.ledger.nanos ?? toNanos(pacer.ledger.usd ?? 0)) + toNanos(usd) <= toNanos(pacer.ledger.capUsd);
  const pacer: Pacer = {
    config: { maxRequests: options.maxRequests, spacingMs: options.spacingMs, backoffMs: schedule },
    sent: 0,
    waits: [],
    waitedMs: 0,
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
          await waited(due);
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
      await waited(ms);
      return true;
    },
  };
  return pacer;
}
