/**
 * The hosted provider: the deployed Composer Worker's /api/propose, posted
 * from Node with the SAME bytes the app posts (proposeBody) and read with
 * the SAME classification the app's gateway adapter applies. The parity
 * test (hosted.test.ts) runs this client and the app's adapter over the
 * same replies and requires identical kinds, outcomes and records, so the
 * two cannot drift apart silently.
 */
import { normalizeUsage, proposeBody, type CallOperation, type CallRecorder, type ModelCallRecord, type Usage } from "@dspack-studio/composer-core";
import type { ErrorKind, GenerateContext, GenerateRequest, StructuralAdapter } from "@dspack-studio/composer-core/blocks";
import { CELL_REQUESTS, CELL_USD_BOUND, PRICED_MODEL, absoluteUsd, reportedUsd, withinReservation, worstCaseUsd } from "../cost";
import { holdCalls } from "../integrity";
import type { Pacer } from "../pacing";
import type { FailureKind } from "../types";
import { HarnessError, classifyHarnessError, makeHarnessError, requestBytes, type AdapterOptions, type BlockAdapterOptions, type Meter, type PlanOptions, type Provider } from "./types";

/** The adapter id the deployed app records (hosted-build.ts HOSTED_AI_ID). */
export const HOSTED_AI_ID = "hosted-ai:claude-haiku-4.5";

export interface HostedOptions {
  /** The deployed origin, e.g. https://composer.aesthetic-function.com. */
  baseUrl: string;
  pacer?: Pacer;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const WORKER_OUTCOMES = new Set<ModelCallRecord["outcome"]>(["ok", "unusable-output", "provider-error"]);

export function errorKind(status: number, body: Record<string, unknown> | undefined): FailureKind {
  if (status === 502 && body?.cause === "unusable-output") return "output";
  if (status >= 400 && status < 500) return "policy";
  return "provider";
}

/** One record per provider call the Worker reports; the app's rule, verbatim (hosted-build.ts callRecords). */
export function callRecords(
  body: Record<string, unknown> | undefined,
  at: { operation: CallOperation; attempt?: number; reissue?: true },
  fallback: { outcome: ModelCallRecord["outcome"]; durationMs: number },
): ModelCallRecord[] {
  const where = {
    operation: at.operation,
    ...(at.attempt !== undefined ? { attempt: at.attempt } : {}),
    ...(at.reissue ? { reissue: true as const } : {}),
  };
  const model = typeof body?.model === "string" ? { model: body.model } : {};
  if (Array.isArray(body?.calls)) {
    if (body.calls.length === 0) return [{ ...where, source: "none", outcome: "refused", durationMs: fallback.durationMs }];
    return body.calls.map((raw, subCall): ModelCallRecord => {
      const call = (raw ?? {}) as Record<string, unknown>;
      const outcome = WORKER_OUTCOMES.has(call.outcome as never) ? (call.outcome as ModelCallRecord["outcome"]) : "provider-error";
      return {
        ...where,
        subCall,
        source: "provider",
        ...normalizeUsage(call),
        ...model,
        ...(typeof call.durationMs === "number" ? { durationMs: call.durationMs } : {}),
        outcome,
      };
    });
  }
  const refused = fallback.outcome === "refused" || body?.error === "unavailable";
  return [
    {
      ...where,
      source: refused ? "none" : "provider",
      ...normalizeUsage(body?.usage),
      ...model,
      durationMs: fallback.durationMs,
      outcome: refused ? "refused" : fallback.outcome,
    },
  ];
}

const FAILURE_OUTCOME: Record<FailureKind, ModelCallRecord["outcome"]> = {
  provider: "provider-error",
  output: "unusable-output",
  policy: "refused",
  budget: "refused",
  unknown: "provider-error",
};

/**
 * Whether a refused reply reached no model, so a retry after a backoff costs nothing: the zone limiter's 429
 * (`calls: []`), or the gateway's busy 503, which reports the one call the gateway rejected, with no usage
 * (propose.mjs callModel). A reply that reports any usage, or any other outcome, spent something and is never retried.
 */
export const retryableRefusal = (status: number, body: Record<string, unknown> | undefined): boolean =>
  (status === 429 || status === 503) &&
  Array.isArray(body?.calls) &&
  body.calls.every((raw) => {
    const call = (raw ?? {}) as Record<string, unknown>;
    return call.outcome === "provider-error" && call.inputTokens == null && call.outputTokens == null;
  });

export { CELL_REQUESTS };

/** Whether a refusal reached no model: the Worker refused before any provider call (`calls: []`), or the gateway turned the call away unspent. */
const modelFree = (status: number, body: Record<string, unknown> | undefined): boolean => Array.isArray(body?.calls) && (body.calls.length === 0 || retryableRefusal(status, body));

/**
 * A cell's worst case under the request caps: every request refused and retried through the whole backoff schedule.
 * A cell is admitted only when the caps cover it, and the dollar ceiling its worst case (CELL_USD_BOUND), so no cap
 * cuts a cell off after it has spent.
 */
export const cellRequestBound = (backoffSteps: number): number => CELL_REQUESTS * (1 + backoffSteps);

export interface ProposeResult {
  json: unknown;
  raw?: string;
  model?: string;
  usage?: Usage;
  calls: ModelCallRecord[];
  durationMs: number;
}

export function createHostedProvider(options: HostedOptions): Provider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => performance.now());
  const base = options.baseUrl.replace(/\/+$/, "");

  async function propose(
    request: GenerateRequest,
    at: { operation: CallOperation; attempt?: number; reissue?: true; recorder: CallRecorder; meter: Meter; maxCalls?: 1 | 2 },
  ): Promise<ProposeResult> {
    const where = { operation: at.operation, ...(at.attempt !== undefined ? { attempt: at.attempt } : {}), ...(at.reissue ? { reissue: true as const } : {}) };
    const body = proposeBody(request, at.maxCalls !== undefined ? { maxCalls: at.maxCalls } : {});
    // Priced before it is sent (live/cost.ts): reserved at its worst case, and admitted only while the most it could
    // cost, from the model's documented limits alone, still fits under the run's dollar ceiling. The Worker makes at
    // most two calls when maxCalls is absent.
    const calls = at.maxCalls ?? 2;
    const priced = worstCaseUsd(request, calls);
    const absolute = absoluteUsd(calls);
    // Metered once: a refused retry re-sends the same bytes, and an arm's request size is what it asks for, not how
    // often the gateway turned it away. The pacer counts every send against the cap.
    at.meter.bytes += requestBytes(body);
    at.meter.requests += 1;
    const failed = (error: unknown) => (error instanceof Error ? error.message : String(error));

    for (let refusal = 0; ; refusal++) {
      if (options.pacer) await options.pacer.before(priced, absolute);
      const started = now();
      // How the reservation ends: a refusal that reached no model releases it, a reply proving that it stayed inside
      // the price (at least one provider call and no more than priced, each within its bounds) settles it at what the
      // calls reported, and anything else (usage missing, a figure past its bound, an extra call, no call reported, no
      // reply at all) raises it to the absolute worst case, or to what it reported if that is more, on the way out.
      // The run's total never falls below what it spent.
      let released = false;
      let reported = 0;
      let verified = false;
      const settle = (reply: Record<string, unknown> | undefined, outcome: ModelCallRecord["outcome"]) => {
        const durationMs = now() - started;
        const records = callRecords(reply, where, { outcome, durationMs });
        for (const call of records) at.recorder.record(call);
        reported = reportedUsd(records);
        const charged = records.filter((call) => call.source !== "none").length;
        verified = charged >= 1 && charged <= calls && records.every((call) => withinReservation(request, call));
        // Then held to the run's integrity conditions (live/integrity.ts), on every path but a release: a call that
        // reached the provider must report its usage and the model the run measures, or the run stops (RunHalted)
        // with this request settled on the way out like any other.
        const served = options.pacer?.served;
        if (served && !released) holdCalls(records, served, PRICED_MODEL, { itemized: Array.isArray(reply?.calls) });
        return { calls: records, durationMs };
      };
      try {
        let res: Response;
        try {
          res = await fetchImpl(`${base}/api/propose`, { method: "POST", headers: { "content-type": "application/json" }, body });
        } catch (error) {
          settle(undefined, "provider-error");
          throw new HarnessError(HOSTED_AI_ID, `hosted AI request failed: ${failed(error)}`, "provider");
        }
        let text: string;
        try {
          text = await res.text();
        } catch (error) {
          const kind: FailureKind = res.ok ? "provider" : errorKind(res.status, undefined);
          settle(undefined, FAILURE_OUTCOME[kind]);
          throw new HarnessError(HOSTED_AI_ID, `hosted AI response could not be read: ${failed(error)}`, kind, res.status);
        }
        let reply: Record<string, unknown> | undefined;
        try {
          const parsed: unknown = JSON.parse(text);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) reply = parsed as Record<string, unknown>;
        } catch {
          /* not JSON: classified below */
        }
        if (!res.ok) {
          // A refusal the Worker made before any provider call (`calls: []`), or the busy gateway's, cost nothing.
          if (options.pacer && modelFree(res.status, reply)) {
            options.pacer.adjust(-priced, "refused before any provider call");
            released = true;
          }
          // A refusal that reached no model (the zone limiter, the busy gateway) is retried after a backoff: nothing
          // was spent, the arm sees one request, and the refused attempt is recorded as model-free. Once the schedule
          // is spent, the refusal is recorded and thrown as the app's adapter would.
          if (options.pacer && retryableRefusal(res.status, reply)) {
            const durationMs = now() - started;
            if (await options.pacer.backoff(refusal, `${res.status} ${String(reply?.error ?? "")}`.trim())) {
              at.recorder.record({ ...where, source: "none", outcome: "refused", durationMs });
              continue;
            }
          }
          const kind = errorKind(res.status, reply);
          settle(reply, FAILURE_OUTCOME[kind]);
          const message = typeof reply?.message === "string" && reply.message ? reply.message : `hosted AI endpoint returned ${res.status}`;
          throw new HarnessError(HOSTED_AI_ID, message, kind, res.status, typeof reply?.cause === "string" ? reply.cause : undefined, normalizeUsage(reply?.usage));
        }
        if (!reply) {
          settle(undefined, "provider-error");
          throw new HarnessError(HOSTED_AI_ID, "hosted AI endpoint returned an unreadable response", "provider", res.status);
        }
        const { calls: records, durationMs } = settle(reply, "ok");
        const usage = normalizeUsage(reply.usage);
        return {
          json: reply.json,
          ...(typeof reply.raw === "string" ? { raw: reply.raw } : {}),
          ...(typeof reply.model === "string" ? { model: reply.model } : {}),
          ...(usage ? { usage } : {}),
          calls: records,
          durationMs,
        };
      } finally {
        if (options.pacer && !released) {
          if (verified) options.pacer.adjust(reported - priced, "settled at the reported usage");
          else options.pacer.adjust(Math.max(absolute, reported) - priced, "usage not verified");
        }
      }
    }
  }

  /** The app's gatewayAdapter attempt and operation labelling, verbatim. */
  function adapter(opts: AdapterOptions): StructuralAdapter {
    let attempts = 0;
    let blockAttempts = 0;
    let last = 0;
    return {
      id: HOSTED_AI_ID,
      async generate(request: GenerateRequest, context?: GenerateContext) {
        const blockOp = context?.operation;
        const attempt = context?.attempt ?? (context?.reissue ? last : blockOp ? blockAttempts++ : attempts++);
        last = attempt;
        const operation: CallOperation = blockOp ?? (attempt > 0 ? "repair" : opts.refinement ? "refine" : "generate");
        const result = await propose(request, {
          operation,
          attempt,
          ...(context?.reissue ? { reissue: true as const } : {}),
          recorder: opts.recorder,
          meter: opts.meter,
          ...(opts.maxCalls !== undefined ? { maxCalls: opts.maxCalls } : {}),
        });
        return {
          json: result.json,
          raw: result.raw ?? JSON.stringify(result.json),
          model: result.model ?? "hosted-ai",
          ...(result.usage ? { usage: result.usage } : {}),
          meta: { durationMs: result.durationMs, calls: result.calls.length },
        };
      },
    };
  }

  return {
    id: HOSTED_AI_ID,
    descriptor: `${HOSTED_AI_ID}@${base}`,
    kind: "hosted",
    plansWithModel: true,
    ...(options.pacer ? { pacer: options.pacer } : {}),
    beforeCell: () => options.pacer?.reserve(cellRequestBound(options.pacer.config.backoffMs.length), CELL_USD_BOUND),
    telemetry: () => (options.pacer ? { pacing: { ...options.pacer.config, backoffMs: [...options.pacer.config.backoffMs], sent: options.pacer.sent, waits: [...options.pacer.waits] } } : undefined),
    surfaceAdapter: adapter,
    blockAdapter: (opts: BlockAdapterOptions) => adapter({ ...opts, maxCalls: 1 }),
    async plan(request: GenerateRequest, opts: PlanOptions) {
      const result = await propose(request, { operation: "plan", recorder: opts.recorder, meter: opts.meter });
      return result.json;
    },
    classify: classifyHarnessError as (error: unknown) => ErrorKind,
    makeError: makeHarnessError(HOSTED_AI_ID),
  };
}
