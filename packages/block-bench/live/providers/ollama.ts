/**
 * A local Ollama model through dspack-gen's own OllamaAdapter, configured as
 * the agent configures it (the context window the governed request needs),
 * wrapped in the harness classifier the plan names: an HTTP or transport
 * failure is a provider failure; empty or non-JSON output is an unusable
 * output. Every call is recorded with the usage Ollama reports.
 */
import { OllamaAdapter } from "@aestheticfunction/dspack-gen";
import { AdapterOutputError } from "@aestheticfunction/dspack-gen/adapter-types";
import { proposeBody, type CallOperation, type ModelCallRecord } from "@dspack-studio/composer-core";
import type { ErrorKind, GenerateContext, GenerateRequest, StructuralAdapter } from "@dspack-studio/composer-core/blocks";
import type { FailureKind } from "../types";
import { HarnessError, classifyHarnessError, makeHarnessError, requestBytes, type AdapterOptions, type BlockAdapterOptions, type Meter, type PlanOptions, type Provider } from "./types";

/** Mirrors apps/agent/src/providers.ts: Ollama's 4096 default context is marginal for the governed request. */
const OLLAMA_OPTIONS = { num_ctx: 16384, num_predict: 4096 };

export interface OllamaOptions {
  model: string;
  host?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** The host a run talks to: the option, else OLLAMA_HOST, else the local default. */
export const ollamaHost = (host?: string): string => (host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "");

/**
 * dspack-gen appends the head of an unusable output to its error message ("(output head: ...)"). The harness keeps
 * the diagnosis and drops the model's text, so no failure it records carries an answer.
 */
function withoutOutput(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (typeof (error as { rawHead?: unknown })?.rawHead !== "string") return message;
  const at = message.lastIndexOf(" (output head: ");
  return at >= 0 ? message.slice(0, at) : message;
}

/** The plan's classifier for local models. */
export function ollamaFailureKind(error: unknown): FailureKind {
  const message = error instanceof Error ? error.message : String(error);
  if (/^HTTP \d{3}/.test(message) || /^transport failure/.test(message)) return "provider";
  return "output";
}

export function createOllamaProvider(options: OllamaOptions): Provider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => performance.now());
  const inner = new OllamaAdapter({
    model: options.model,
    host: ollamaHost(options.host),
    fetch: ((url: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body);
      body.options = { ...body.options, ...OLLAMA_OPTIONS };
      return fetchImpl(url as string, { ...init, body: JSON.stringify(body) });
    }) as typeof fetch,
  });
  const id = inner.id;

  async function call(request: GenerateRequest, at: { operation: CallOperation; attempt?: number; reissue?: true; recorder: AdapterOptions["recorder"]; meter: Meter }) {
    const where = { operation: at.operation, ...(at.attempt !== undefined ? { attempt: at.attempt } : {}), ...(at.reissue ? { reissue: true as const } : {}) };
    at.meter.bytes += requestBytes(proposeBody(request));
    at.meter.requests += 1;
    const started = now();
    try {
      const result = await inner.generate(request as never);
      const record: ModelCallRecord = {
        ...where,
        source: "provider",
        ...(typeof result.usage?.inputTokens === "number" ? { inputTokens: result.usage.inputTokens } : {}),
        ...(typeof result.usage?.outputTokens === "number" ? { outputTokens: result.usage.outputTokens } : {}),
        model: result.model,
        durationMs: now() - started,
        outcome: "ok",
      };
      at.recorder.record(record);
      return result;
    } catch (error) {
      const kind = error instanceof AdapterOutputError ? ollamaFailureKind(error) : "provider";
      at.recorder.record({ ...where, source: "provider", model: options.model, durationMs: now() - started, outcome: kind === "output" ? "unusable-output" : "provider-error" });
      throw new HarnessError(id, withoutOutput(error), kind);
    }
  }

  function adapter(opts: AdapterOptions): StructuralAdapter {
    let attempts = 0;
    let blockAttempts = 0;
    let last = 0;
    return {
      id,
      async generate(request: GenerateRequest, context?: GenerateContext) {
        const blockOp = context?.operation;
        const attempt = context?.attempt ?? (context?.reissue ? last : blockOp ? blockAttempts++ : attempts++);
        last = attempt;
        const operation: CallOperation = blockOp ?? (attempt > 0 ? "repair" : opts.refinement ? "refine" : "generate");
        const result = await call(request, { operation, attempt, ...(context?.reissue ? { reissue: true as const } : {}), recorder: opts.recorder, meter: opts.meter });
        return { json: result.json, raw: result.raw, model: result.model, ...(result.usage ? { usage: result.usage } : {}), ...(result.meta ? { meta: result.meta } : {}) };
      },
    };
  }

  return {
    id,
    descriptor: `${id}@${ollamaHost(options.host)}`,
    kind: "ollama",
    plansWithModel: true,
    surfaceAdapter: adapter,
    blockAdapter: (opts: BlockAdapterOptions) => adapter(opts),
    async plan(request: GenerateRequest, opts: PlanOptions) {
      return (await call(request, { operation: "plan", recorder: opts.recorder, meter: opts.meter })).json;
    },
    classify: classifyHarnessError as (error: unknown) => ErrorKind,
    makeError: makeHarnessError(id),
  };
}
