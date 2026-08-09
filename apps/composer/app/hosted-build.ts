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
// Deep imports (aliased in next.config.mjs) load ONLY the orchestrator + the
// scripted adapter — a clean, browser-safe subgraph — instead of dspack-gen's
// package index, which re-exports Node-only adapters (undici, @anthropic-ai/sdk)
// and eval helpers (node:fs/node:path). Types come from app/gen-deep.d.ts.
import { runPipeline } from "@composer/gen-run";
import { ScriptedAdapter } from "@composer/gen-scripted";
import { loadProfile } from "@aestheticfunction/dspack-emit";
import { createPipelineEventMapper } from "@dspack-studio/agui-bridge";
import type { BuildRunInput } from "./agent-client";
import { DEMO_CONTRACT, DEMO_PROFILE } from "./demo-data";

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

// loadProfile is pure over the doc; cache the parsed demo profile.
let profileCache: ReturnType<typeof loadProfile> | null = null;
function demoProfile() {
  return (profileCache ??= loadProfile(DEMO_PROFILE as never));
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
export function streamHostedBuild(input: BuildRunInput, handlers: HostedRunHandlers): { cancel(): void } {
  let cancelled = false;
  const emit = (event: Record<string, unknown>) => {
    if (!cancelled) handlers.onEvent(event);
  };

  void (async () => {
    try {
      const contract = DEMO_CONTRACT as Record<string, unknown>;
      const intents = (contract.intents as Array<{ id: string }> | undefined) ?? [];
      const intent = input.intent || intents[0]?.id || "";
      const modelRef = input.modelRef || "scripted";

      if (modelRef !== "scripted") {
        // Phase 2: the AI Gateway Worker answers the proposal for managed
        // hosted AI. Until its binding is provisioned, be honest about the
        // path rather than silently failing.
        handlers.onError(
          "Hosted AI generation is being connected through the governed AI Gateway. " +
            'For now choose "scripted" to watch the governed pipeline run on rails, ' +
            "or connect the local agent to generate with a local model.",
        );
        handlers.onComplete();
        return;
      }

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

      const adapter = scriptedRunAdapter(example.surface, input.conversation);
      const runId = `run-${Date.now()}`;
      const map = createPipelineEventMapper({ threadId: `build-${input.path}`, runId });

      await runPipeline({
        contract: contract as Parameters<typeof runPipeline>[0]["contract"],
        intent,
        prompt: input.prompt,
        adapter,
        maxRepairs: 2,
        emitProfile: demoProfile(),
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
