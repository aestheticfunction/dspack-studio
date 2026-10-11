/**
 * The scripted provider: the dry run. No model, no network. Surfaces are the
 * reference's own worked example for the intent (the app's scripted twin
 * replays the same); a refinement edits the prior surface's first text the
 * way the app's twin does; block calls come from composer-core's
 * scriptedBlockScript. Every call is recorded as reaching no model.
 *
 * With `faults`, a deterministic schedule keyed by the goal injects the
 * failure shapes ADR-B4 classifies (an invalid block call, an unusable
 * output, a provider failure, a surface that fails S1), so the fallback,
 * re-issue, repair and provider-failure paths are exercised end to end.
 */
import { proposeBody, type CallOperation } from "@dspack-studio/composer-core";
import { encodeCall, scriptedBlockScript, type ErrorKind, type GenerateContext, type GenerateRequest, type GenerateResult, type StructuralAdapter } from "@dspack-studio/composer-core/blocks";
import { HarnessError, classifyHarnessError, makeHarnessError, requestBytes, type AdapterOptions, type BlockAdapterOptions, type Provider } from "./types";

export const SCRIPTED_ID = "fake:scripted";

type Json = Record<string, any>;

export type Fault = "none" | "invalid-block-call" | "unusable-output" | "provider-failure" | "invalid-surface";
const FAULTS: readonly Fault[] = ["none", "invalid-block-call", "unusable-output", "provider-failure", "invalid-surface"];

/** A stable small hash, so a prompt always draws the same fault. */
export function faultFor(goal: string, faults: boolean): Fault {
  if (!faults) return "none";
  let h = 7;
  for (const ch of goal) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FAULTS[h % FAULTS.length]!;
}

/** The app's scripted twin: the first text node gains "(refined)", then "(refined N)". */
function refinedCopy(prior: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(prior ?? {})) as Json;
  const first = (node: unknown): Json | null => {
    if (!node || typeof node !== "object") return null;
    const record = node as Json;
    if (typeof record.text === "string") return record;
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          const found = first(child);
          if (found) return found;
        }
      } else if (value && typeof value === "object") {
        const found = first(value);
        if (found) return found;
      }
    }
    return null;
  };
  const node = first(copy.root ?? copy);
  if (node) {
    const existing = /^(.*?)(?: \(refined(?: (\d+))?\))$/.exec(node.text as string);
    const base = existing ? existing[1]! : (node.text as string);
    const next = existing ? Number(existing[2] ?? 1) + 1 : 1;
    node.text = next === 1 ? `${base} (refined)` : `${base} (refined ${next})`;
  }
  return copy;
}

export function createScriptedProvider(options: { faults?: boolean; now?: () => number } = {}): Provider {
  const now = options.now ?? (() => performance.now());
  const faults = options.faults ?? false;

  const recordCall = (opts: AdapterOptions, where: { operation: CallOperation; attempt?: number; reissue?: true }, started: number, outcome: "ok" | "unusable-output" | "provider-error", request: GenerateRequest) => {
    opts.meter.bytes += requestBytes(proposeBody(request));
    opts.meter.requests += 1;
    opts.recorder.record({ ...where, source: "none", durationMs: now() - started, outcome });
  };

  const labelled = (opts: AdapterOptions, inner: (request: GenerateRequest, context: GenerateContext | undefined, nth: number) => Promise<GenerateResult>): StructuralAdapter => {
    let attempts = 0;
    let blockAttempts = 0;
    let last = 0;
    let nth = 0;
    return {
      id: SCRIPTED_ID,
      async generate(request: GenerateRequest, context?: GenerateContext) {
        const blockOp = context?.operation;
        const attempt = context?.attempt ?? (context?.reissue ? last : blockOp ? blockAttempts++ : attempts++);
        last = attempt;
        const operation: CallOperation = blockOp ?? (attempt > 0 ? "repair" : opts.refinement ? "refine" : "generate");
        const where = { operation, attempt, ...(context?.reissue ? { reissue: true as const } : {}) };
        const started = now();
        try {
          const result = await inner(request, context, nth++);
          recordCall(opts, where, started, "ok", request);
          return result;
        } catch (error) {
          recordCall(opts, where, started, error instanceof HarnessError && error.kind === "output" ? "unusable-output" : "provider-error", request);
          throw error;
        }
      },
    };
  };

  return {
    id: SCRIPTED_ID,
    descriptor: faults ? `${SCRIPTED_ID}:faults` : SCRIPTED_ID,
    kind: "scripted",
    plansWithModel: false,
    surfaceAdapter(opts: AdapterOptions): StructuralAdapter {
      const fault = faultFor(opts.scripted?.goal ?? "", faults);
      return labelled(opts, async (request, _context, nth) => {
        const refinement = opts.refinement && opts.scripted?.prior !== undefined;
        if (fault === "unusable-output" && nth === 0) throw new HarnessError(SCRIPTED_ID, "scripted fault: the model answered with no usable proposal", "output", 502, "unusable-output");
        if (fault === "provider-failure" && nth === 0) throw new HarnessError(SCRIPTED_ID, "scripted fault: the provider is unavailable", "provider", 502, "provider");
        const surface = refinement ? refinedCopy(opts.scripted!.prior) : opts.scripted?.example;
        // As the app's twin: a governed context with no worked example cannot be replayed.
        if (surface === undefined) throw new HarnessError(SCRIPTED_ID, "scripted mode replays this governed context's own surface, and it has none yet", "unknown");
        const json = fault === "invalid-surface" && nth === 0 ? { dspackSurface: "0.1", root: { component: "no-such-component" } } : surface;
        void request;
        return { json, raw: JSON.stringify(json), model: "scripted" };
      });
    },
    blockAdapter(opts: BlockAdapterOptions): StructuralAdapter {
      const script = scriptedBlockScript(opts.block, opts.intent, opts.goal, opts.seed);
      const fault = faultFor(opts.goal, faults);
      let answered = 0;
      // The script answers named calls; a positional run gets their compact projection (the sentinel stays as it is).
      const wire = (result: GenerateResult): GenerateResult => {
        const json = result.json as Json;
        if (opts.encoding !== "positional" || json?.unsupported === true) return result;
        const compact = encodeCall(opts.block, json);
        return { ...result, json: compact, raw: JSON.stringify(compact) };
      };
      return labelled(opts, async (request, context, nth) => {
        if (fault === "provider-failure" && nth === 0) throw new HarnessError(SCRIPTED_ID, "scripted fault: the provider is unavailable", "provider", 502, "provider");
        if (fault === "unusable-output" && nth === 0) throw new HarnessError(SCRIPTED_ID, "scripted fault: the model answered with no usable proposal", "output", 502, "unusable-output");
        answered += 1;
        if (fault === "invalid-block-call" && answered === 1) {
          const json = { block: opts.block.id, version: opts.block.version };
          return wire({ json, raw: JSON.stringify(json), model: "scripted" });
        }
        return wire(await script.generate(request, context));
      });
    },
    async plan() {
      throw new HarnessError(SCRIPTED_ID, "the scripted provider routes deterministically; plan() is never called", "policy");
    },
    classify: classifyHarnessError as (error: unknown) => ErrorKind,
    makeError: makeHarnessError(SCRIPTED_ID),
  };
}

