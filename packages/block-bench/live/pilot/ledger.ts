/**
 * The pilot's cumulative ledger: one file, every invocation and resume together, so the $5 ceiling holds across the
 * whole pilot and not per process. It follows the Phase 1B ledger's rules (evaluate.ts readLedger) in a smaller form:
 *
 * - a request is written, with its priced worst case, BEFORE it is sent (RunLedger.record), so a killed process still
 *   counts it;
 * - its reply settles it (RunLedger.adjust): down to the provider's reported usage when verified, released when the
 *   Worker refused before any provider call, raised when usage could not be verified;
 * - on reading the file back, a request with no settlement counts at the most any request can cost (REQUEST_USD_BOUND)
 *   or its price if that is more, and a request line with no readable price counts at that most too.
 *
 * Dollars are kept in whole nanodollars (cost.ts toNanos), so sums and the comparison with the ceiling are exact.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { REQUEST_USD_BOUND, toNanos } from "../cost";
import type { RunLedger } from "../pacing";

type Line = { request?: unknown; usd?: unknown; adjust?: unknown; final?: unknown };

/** What a ledger file says has been committed: requests counted and dollars, in nanodollars. */
export function readPilotLedger(file: string): { sent: number; nanos: number } {
  if (!existsSync(file)) return { sent: 0, nanos: 0 };
  const lines = readFileSync(file, "utf8").split("\n");
  // A last line cut off partway is set aside: a request line cut off was never sent.
  if (lines.at(-1)!.trim() !== "") lines.pop();
  const bound = toNanos(REQUEST_USD_BOUND);
  const priced = new Map<string, number>();
  const finals = new Map<string, number>();
  let sent = 0;
  let unpriced = 0;
  for (const text of lines) {
    if (!text.trim()) continue;
    let line: Line;
    try {
      line = JSON.parse(text) as Line;
    } catch {
      sent += 1;
      unpriced += bound;
      continue;
    }
    const isSettlement = typeof line.adjust === "number";
    if (!isSettlement) {
      sent += 1;
      if (typeof line.request === "string" && typeof line.usd === "number" && Number.isFinite(line.usd) && line.usd >= 0 && !priced.has(line.request)) priced.set(line.request, toNanos(line.usd));
      else unpriced += bound;
    } else if (typeof line.request === "string" && typeof line.final === "number" && Number.isFinite(line.final) && line.final >= 0) {
      finals.set(line.request, Math.max(finals.get(line.request) ?? 0, toNanos(line.final)));
    }
  }
  let nanos = unpriced;
  for (const [request, price] of priced) nanos += finals.get(request) ?? Math.max(bound, price);
  return { sent, nanos };
}

/** A RunLedger on one file, for the Phase 1B pacer (pacing.ts): the pilot's cumulative caps. */
export function openPilotLedger(file: string, caps: { cap: number; capUsd: number }, invocation: string): RunLedger {
  const done = readPilotLedger(file);
  let committed = done.nanos;
  let sequence = 0;
  let open: { request: string; nanos: number } | undefined;
  const write = (value: Record<string, unknown>) => appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`);
  return {
    cap: caps.cap,
    sent: done.sent,
    capUsd: caps.capUsd,
    get usd() {
      return committed / 1e9;
    },
    get nanos() {
      return committed;
    },
    record(usd = 0) {
      const request = `${invocation}#${++sequence}`;
      write({ request, usd });
      this.sent += 1;
      committed += toNanos(usd);
      open = { request, nanos: toNanos(usd) };
    },
    adjust(usd, reason) {
      const delta = toNanos(usd);
      const of = open;
      open = undefined;
      committed += delta;
      write({ ...(of ? { request: of.request, final: (of.nanos + delta) / 1e9 } : {}), adjust: usd, reason });
    },
  };
}
