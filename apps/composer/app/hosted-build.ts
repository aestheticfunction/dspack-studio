/**
 * In-browser governed generation — the hosted BUILD path.
 *
 * The measured constraint that shaped this: Cloudflare Workers ban runtime
 * `new Function` (AJV compiles schema validators that way), so the deterministic
 * pipeline canNOT run in a Worker. The browser CAN — and already does for emit +
 * S1/S2/S3 (see validation.ts). So a visitor runs the SAME runPipeline the CLI
 * and agent run, right here, with no install: propose → S1/S2/S3 → repair → emit
 * → audit, streamed as the identical AG-UI events the agent emits, so
 * composer-core's foldBuildEvents renders it unchanged.
 *
 * Only the ADAPTER (the nondeterministic proposal) varies by mode:
 *   • scripted — replays THIS intent's last worked example (on-rails demo);
 *   • hosted managed AI — routes the proposal through the AI Gateway Worker
 *     (Phase 2, owner-provisioned AI binding); everything downstream is identical.
 * Local models stay on the agent (unchanged). This is the browser twin of
 * apps/agent/src/project.ts runProject — kept deliberately parallel.
 */
// The supported browser-safe boundary (dspack-gen >= 0.3.2): runPipeline + the
// scripted adapter, WITHOUT the package index's Node-only re-exports (undici,
// @anthropic-ai/sdk, node:fs/path eval helpers). Its only Node dependency is
// node:crypto (audit provenance hash), which next.config.mjs shims.
import { runPipeline, ScriptedAdapter } from "@aestheticfunction/dspack-gen/browser";
import { AdapterOutputError } from "@aestheticfunction/dspack-gen/adapter-types";
import { loadProfile } from "@aestheticfunction/dspack-emit";
import { createPipelineEventMapper } from "@dspack-studio/agui-bridge";
import {
  normalizeUsage,
  proposeBody,
  type CallOperation,
  type CallRecorder,
  type ModelCallRecord,
  type Usage,
} from "@dspack-studio/composer-core";
import type { BuildRunInput } from "./agent-client";

/** The active reference's governed documents the hosted pipeline runs over.
 *  Passed by the caller so the SAME pipeline serves any design system — there
 *  is no hardcoded demo, and no Astryx-specific path. */
export interface HostedReference {
  contract: Record<string, unknown>;
  profile: Record<string, unknown>;
}

/** First node in the surface tree carrying a text string (refinement anchor). */
function firstTextNode(node: unknown): { text: string } | null {
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  if (typeof record.text === "string") return record as { text: string };
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = firstTextNode(child);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = firstTextNode(value);
      if (found) return found;
    }
  }
  return null;
}

/**
 * The scripted deterministic twin — a byte-for-byte mirror of the agent's
 * scriptedRunAdapter (apps/agent/src/project.ts). Fresh runs replay the intent's
 * worked example behind ONE deliberately-violating first attempt, so the demo
 * shows the governance actually working: S1 rejects a bad proposal, repair
 * re-proposes, the clean surface passes. Refinements mutate the prior surface
 * MONOTONICALLY so a refinement is never a byte-identical no-op (#43). Keep in
 * sync with the agent (candidate for extraction into composer-core).
 */
function scriptedRunAdapter(surface: unknown, conversation: BuildRunInput["conversation"]): ScriptedAdapter {
  if (conversation && conversation.length > 0) {
    const priorRaw = [...conversation].reverse().find((m) => m.role === "assistant")?.content;
    if (priorRaw) {
      try {
        const refined = JSON.parse(priorRaw) as Record<string, unknown>;
        const textNode = firstTextNode(refined);
        if (textNode) {
          const existing = /^(.*?)(?: \(refined(?: (\d+))?\))$/.exec(textNode.text);
          const base = existing ? existing[1] : textNode.text;
          const next = existing ? Number(existing[2] ?? 1) + 1 : 1;
          textNode.text = next === 1 ? `${base} (refined)` : `${base} (refined ${next})`;
        } else {
          const previous = /^refined(?: (\d+))?$/.exec(String((refined as { id?: string }).id ?? ""));
          const next = previous ? Number(previous[1] ?? 1) + 1 : 1;
          (refined as { id?: string }).id = next === 1 ? "refined" : `refined ${next}`;
        }
        return new ScriptedAdapter([{ output: refined }, { output: refined }, { output: refined }]);
      } catch {
        /* Fall through: an unparseable prior surface behaves like a fresh run. */
      }
    }
  }
  const violating = structuredClone(surface) as { root?: { children?: Array<Record<string, unknown>> } };
  if (violating.root?.children?.[0]) {
    violating.root.children[0] = { ...violating.root.children[0], component: "not-a-component" };
  }
  return new ScriptedAdapter([{ output: violating }, { output: surface }, { output: surface }]);
}

// loadProfile is pure over the doc; cache per profile object identity so each
// reference's profile parses once (the reference objects are stable).
const profileCache = new WeakMap<object, ReturnType<typeof loadProfile>>();
function loadedProfile(profile: Record<string, unknown>): ReturnType<typeof loadProfile> {
  let parsed = profileCache.get(profile);
  if (!parsed) {
    parsed = loadProfile(profile as never);
    profileCache.set(profile, parsed);
  }
  return parsed;
}

/**
 * Managed hosted AI — the proposal comes from Claude Haiku through the governed
 * AI Gateway Worker (/api/propose). The pipeline built {system, messages,
 * jsonSchema}; this adapter is a thin transport that forwards them and returns
 * the raw proposal. It runs NO validation — S1/S2/S3, repair, and emit happen
 * around it, here in the browser, exactly as for the scripted and local
 * adapters. An endpoint failure throws a GatewayError (an AdapterOutputError)
 * so the pipeline records an honest `failed-adapter` outcome in the thread
 * rather than crashing.
 */
const HOSTED_AI_ID = "hosted-ai:claude-haiku-4.5";

type ProposeRequest = { system: string; messages: unknown[]; jsonSchema: unknown };

/**
 * What kind of failure ended a gateway request:
 *   provider: the call failed or its result could not be read (timeout,
 *             transport, 5xx, a non-JSON 200, a fetch that threw);
 *   output:   the model answered, but not with a usable proposal;
 *   policy:   the endpoint refused the request (rate limit, size, shape).
 */
export type GatewayErrorKind = "provider" | "output" | "policy";

export class GatewayError extends AdapterOutputError {
  constructor(
    message: string,
    readonly kind: GatewayErrorKind,
    /** Every model call this request made, as recorded. */
    readonly calls: readonly ModelCallRecord[],
    /** The HTTP status, when a response arrived. */
    readonly status?: number,
    /** The Worker's own `cause` for a 502, when it reported one. */
    readonly failure?: string,
    /** Provider-reported usage summed over this request's calls. */
    readonly usage?: Usage,
  ) {
    super(HOSTED_AI_ID, message);
    this.name = "GatewayError";
  }
}

const WORKER_OUTCOMES = new Set<ModelCallRecord["outcome"]>(["ok", "unusable-output", "provider-error"]);

function errorKind(status: number, body: Record<string, unknown> | undefined): GatewayErrorKind {
  if (status === 502 && body?.cause === "unusable-output") return "output";
  if (status >= 400 && status < 500) return "policy";
  return "provider";
}

/**
 * One record per provider call the Worker reports. A Worker that reports an
 * empty list made no provider call (it refused first). A reply with no list
 * at all (a Worker deployed before Phase 0.5, a non-JSON reply, a fetch that
 * threw) is ONE record for the whole request, unmetered unless the reply
 * carried usage: never zero, never guessed.
 */
function callRecords(
  body: Record<string, unknown> | undefined,
  at: { operation: CallOperation; attempt?: number },
  fallback: { outcome: ModelCallRecord["outcome"]; durationMs: number },
): ModelCallRecord[] {
  const where = { operation: at.operation, ...(at.attempt !== undefined ? { attempt: at.attempt } : {}) };
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
  // An old Worker's 429 came from its own limiter, before any provider call.
  const source = fallback.outcome === "refused" ? "none" : "provider";
  return [{ ...where, source, ...normalizeUsage(body?.usage), ...model, durationMs: fallback.durationMs, outcome: fallback.outcome }];
}

const FAILURE_OUTCOME: Record<GatewayErrorKind, ModelCallRecord["outcome"]> = {
  provider: "provider-error",
  output: "unusable-output",
  policy: "refused",
};

/**
 * POST one request to /api/propose and record every model call it caused,
 * BEFORE returning or throwing, so a failed request is never free.
 */
async function propose(
  request: ProposeRequest,
  options: { operation: CallOperation; attempt?: number; recorder?: CallRecorder; maxCalls?: 1 | 2 },
): Promise<{ json: unknown; raw?: string; model?: string; usage?: Usage; calls: ModelCallRecord[]; durationMs: number }> {
  const at = { operation: options.operation, ...(options.attempt !== undefined ? { attempt: options.attempt } : {}) };
  const started = performance.now();
  const settle = (body: Record<string, unknown> | undefined, outcome: ModelCallRecord["outcome"]) => {
    const durationMs = performance.now() - started;
    const calls = callRecords(body, at, { outcome, durationMs });
    for (const call of calls) options.recorder?.record(call);
    return { calls, durationMs };
  };

  let res: Response;
  let text: string;
  try {
    res = await fetch("/api/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: proposeBody(request, options.maxCalls !== undefined ? { maxCalls: options.maxCalls } : {}),
    });
    text = await res.text();
  } catch (error) {
    const { calls } = settle(undefined, "provider-error");
    throw new GatewayError(`hosted AI request failed: ${error instanceof Error ? error.message : String(error)}`, "provider", calls);
  }
  let body: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    /* not JSON: classified below */
  }

  if (!res.ok) {
    const kind = errorKind(res.status, body);
    const { calls } = settle(body, FAILURE_OUTCOME[kind]);
    const message = typeof body?.message === "string" && body.message ? body.message : `hosted AI endpoint returned ${res.status}`;
    const usage = normalizeUsage(body?.usage);
    throw new GatewayError(message, kind, calls, res.status, typeof body?.cause === "string" ? body.cause : undefined, usage);
  }
  if (!body) {
    const { calls } = settle(undefined, "provider-error");
    throw new GatewayError("hosted AI endpoint returned an unreadable response", "provider", calls, res.status);
  }
  const { calls, durationMs } = settle(body, "ok");
  const usage = normalizeUsage(body.usage);
  return {
    json: body.json,
    ...(typeof body.raw === "string" ? { raw: body.raw } : {}),
    ...(typeof body.model === "string" ? { model: body.model } : {}),
    ...(usage ? { usage } : {}),
    calls,
    durationMs,
  };
}

/**
 * The hosted generation adapter. Each generate() is one pipeline attempt
 * (runPipeline calls it once per attempt and stops at the first
 * AdapterOutputError), so the n-th call serves attempt n: attempt 0 is the
 * generation (or refinement), later attempts are repairs. `maxCalls` caps the
 * Worker's provider calls per request; omitted, the request bytes are today's.
 */
export function gatewayAdapter(options: { recorder?: CallRecorder; refinement?: boolean; maxCalls?: 1 | 2 } = {}) {
  let attempts = 0;
  return {
    id: HOSTED_AI_ID,
    async generate(request: ProposeRequest) {
      const attempt = attempts++;
      const operation: CallOperation = attempt > 0 ? "repair" : options.refinement ? "refine" : "generate";
      const result = await propose(request, {
        operation,
        attempt,
        ...(options.recorder ? { recorder: options.recorder } : {}),
        ...(options.maxCalls !== undefined ? { maxCalls: options.maxCalls } : {}),
      });
      return {
        json: result.json,
        raw: result.raw ?? JSON.stringify(result.json),
        model: result.model ?? "hosted-ai",
        ...(result.usage ? { usage: result.usage } : {}),
      };
    },
  };
}

/**
 * Run one lightweight {system, messages, jsonSchema} request through the hosted
 * AI Gateway: the goal-planning and flow-planning steps (a SMALL schema), which
 * share the provider path with a full proposal but are not a surface
 * generation. Returns the parsed JSON with this request's usage, calls and
 * duration. Throws a GatewayError (carrying its calls) on an endpoint/model
 * failure so the caller can fall back deterministically.
 */
export async function runGatewayRequest(
  request: ProposeRequest,
  options: { operation: "plan" | "flow-plan"; recorder?: CallRecorder },
): Promise<{ json: unknown; usage?: Usage; calls: ModelCallRecord[]; durationMs: number }> {
  const { json, usage, calls, durationMs } = await propose(request, options);
  return { json, ...(usage ? { usage } : {}), calls, durationMs };
}

/**
 * The scripted twin under the same accounting: every attempt is recorded as
 * reaching no model, so a scripted receipt never shows provider-shaped zeros.
 */
function recordedScripted(adapter: ScriptedAdapter, recorder: CallRecorder | undefined, refinement: boolean) {
  let attempts = 0;
  return {
    id: adapter.id,
    async generate(request: Parameters<ScriptedAdapter["generate"]>[0]) {
      const attempt = attempts++;
      const operation: CallOperation = attempt > 0 ? "repair" : refinement ? "refine" : "generate";
      const started = performance.now();
      const record = (outcome: ModelCallRecord["outcome"]) =>
        recorder?.record({ operation, attempt, source: "none", durationMs: performance.now() - started, outcome });
      try {
        const result = await adapter.generate(request);
        record("ok");
        return result;
      } catch (error) {
        record("provider-error");
        throw error;
      }
    },
  };
}

export interface HostedRunHandlers {
  onEvent(event: Record<string, unknown>): void;
  onError(message: string): void;
  onComplete(): void;
}

/**
 * Run one governed generation entirely in the browser, streaming AG-UI events
 * to the same handlers as streamProjectRun. Returns a cancel handle: the
 * pipeline can't be interrupted mid-attempt, but cancel() stops further events
 * from reaching the (possibly unmounted) caller.
 */
export function streamHostedBuild(
  input: BuildRunInput,
  handlers: HostedRunHandlers,
  reference: HostedReference,
  options: { recorder?: CallRecorder } = {},
): { cancel(): void } {
  let cancelled = false;
  const emit = (event: Record<string, unknown>) => {
    if (!cancelled) handlers.onEvent(event);
  };

  void (async () => {
    try {
      const contract = reference.contract;
      const intents = (contract.intents as Array<{ id: string }> | undefined) ?? [];
      const intent = input.intent || intents[0]?.id || "";
      const modelRef = input.modelRef || "scripted";
      const refinement = !!input.conversation && input.conversation.length > 0;

      // The ONLY thing that varies by mode is the adapter answering the
      // proposal. Everything after — S1/S2/S3, repair, emit, audit — is the
      // SAME deterministic pipeline, running here in the browser.
      let adapter;
      if (modelRef === "hosted-ai") {
        // Managed Claude Haiku through the governed AI Gateway Worker.
        adapter = gatewayAdapter({ ...(options.recorder ? { recorder: options.recorder } : {}), refinement });
      } else if (modelRef === "scripted") {
        const examples = (contract.examples as Array<{ intent: string; surface: unknown }> | undefined) ?? [];
        // LAST match for THIS intent (accepted results join the corpus at the
        // end): the scripted twin plays the owner's latest worked example, never
        // another intent's — a screen built for a different intent is a wrong
        // answer reported as a right one (#43).
        const example = examples.filter((e) => e.intent === intent).at(-1);
        if (!example) {
          handlers.onError(
            `Scripted mode replays this governed context's own surface, and '${intent || "(none)"}' has none yet. ` +
              "Pick a governed context that already has a surface, or connect the local agent to generate from the contract without few-shot context.",
          );
          handlers.onComplete();
          return;
        }
        adapter = recordedScripted(scriptedRunAdapter(example.surface, input.conversation), options.recorder, refinement);
      } else {
        handlers.onError(
          `Model '${modelRef}' isn't available in this browser project. Choose "scripted" or "hosted-ai", ` +
            "or connect the local agent for a local model.",
        );
        handlers.onComplete();
        return;
      }

      const runId = `run-${Date.now()}`;
      const map = createPipelineEventMapper({ threadId: `build-${input.path}`, runId });

      await runPipeline({
        contract: contract as Parameters<typeof runPipeline>[0]["contract"],
        intent,
        prompt: input.prompt,
        adapter,
        maxRepairs: 2,
        emitProfile: loadedProfile(reference.profile),
        ...(input.conversation && input.conversation.length > 0 ? { conversation: input.conversation } : {}),
        onEvent: (event) => {
          for (const agui of map(event as never)) emit(agui as unknown as Record<string, unknown>);
        },
      });
      handlers.onComplete();
    } catch (error) {
      handlers.onError(error instanceof Error ? error.message : String(error));
      handlers.onComplete();
    }
  })();

  return {
    cancel() {
      cancelled = true;
    },
  };
}
