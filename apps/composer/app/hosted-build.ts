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
 * adapters. An endpoint failure throws AdapterOutputError so the pipeline
 * records an honest `failed-adapter` outcome in the thread rather than crashing.
 */
const HOSTED_AI_ID = "hosted-ai:claude-haiku-4.5";

function gatewayAdapter() {
  return {
    id: HOSTED_AI_ID,
    async generate(request: { system: string; messages: unknown[]; jsonSchema: unknown }) {
      let res: Response;
      try {
        res = await fetch("/api/propose", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ system: request.system, messages: request.messages, jsonSchema: request.jsonSchema }),
        });
      } catch (error) {
        throw new AdapterOutputError(HOSTED_AI_ID, `hosted AI request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!res.ok) {
        let message = `hosted AI endpoint returned ${res.status}`;
        try {
          const body = (await res.json()) as { message?: string };
          if (body?.message) message = body.message;
        } catch {
          /* non-JSON error body: keep the status message */
        }
        throw new AdapterOutputError(HOSTED_AI_ID, message);
      }
      const body = (await res.json()) as { json: unknown; raw?: string; model?: string; usage?: unknown };
      return {
        json: body.json,
        raw: body.raw ?? JSON.stringify(body.json),
        model: body.model ?? "hosted-ai",
        ...(body.usage ? { usage: body.usage } : {}),
      };
    },
  };
}

/**
 * Run one lightweight {system, messages, jsonSchema} request through the hosted
 * AI Gateway and return the parsed JSON. Used for the goal-planning step (a
 * SMALL schema), which shares the provider path with a full proposal but is not
 * a surface generation. Throws on an endpoint/model failure so the caller can
 * fall back deterministically.
 */
export async function runGatewayRequest(request: {
  system: string;
  messages: unknown[];
  jsonSchema: unknown;
}): Promise<unknown> {
  const result = await gatewayAdapter().generate(request as never);
  return (result as { json: unknown }).json;
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

      // The ONLY thing that varies by mode is the adapter answering the
      // proposal. Everything after — S1/S2/S3, repair, emit, audit — is the
      // SAME deterministic pipeline, running here in the browser.
      let adapter;
      if (modelRef === "hosted-ai") {
        // Managed Claude Haiku through the governed AI Gateway Worker.
        adapter = gatewayAdapter();
      } else if (modelRef === "scripted") {
        const examples = (contract.examples as Array<{ intent: string; surface: unknown }> | undefined) ?? [];
        // LAST match for THIS intent (accepted results join the corpus at the
        // end): the scripted twin plays the owner's latest worked example, never
        // another intent's — a screen built for a different intent is a wrong
        // answer reported as a right one (#43).
        const example = examples.filter((e) => e.intent === intent).at(-1);
        if (!example) {
          handlers.onError(
            `Scripted mode replays this intent's own worked example, and '${intent || "(none)"}' has none. ` +
              "Pick an intent that already has a worked scenario, or connect the local agent to generate from the contract without few-shot context.",
          );
          handlers.onComplete();
          return;
        }
        adapter = scriptedRunAdapter(example.surface, input.conversation);
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
