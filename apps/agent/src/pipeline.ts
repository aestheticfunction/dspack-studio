/**
 * The one place the agent invokes dspack-gen: load the Astryx contract, pick
 * an adapter, run the governed pipeline, and forward every pipeline event to
 * the caller (which maps them onto AG-UI events via the bridge).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  adapterFor,
  OllamaAdapter,
  runPipeline,
  ScriptedAdapter,
  type RunOptions,
  type RunResult,
} from "@aestheticfunction/dspack-gen";
import { astryxProfile } from "@dspack-studio/contracts";
import { BREAK_SCRIPTS } from "./scenarios/break-scripts.js";

const require = createRequire(import.meta.url);

/**
 * Ollama inference window (BYO-inference configuration, not a pipeline
 * change). Ollama's server default context (4096) is marginal for the
 * governed request: prompt + few-shot worked example (~1.6k tokens) plus
 * gpt-oss reasoning tokens leaves too little room for the constrained
 * output, and constrained decoding under token pressure closes the JSON
 * output. Ollama's server default (4096) leaves the governed request no
 * headroom: prompt + few-shot worked example is ~2k tokens before the
 * model's own reasoning tokens. The adapter's request body is patched via
 * its injectable fetch; every other adapter behavior (temperature, error
 * typing, parsing) is unchanged.
 */
const OLLAMA_OPTIONS = { num_ctx: 16384, num_predict: 4096 };

function ollamaAdapterWithWindow(modelRef: string) {
  const model = modelRef.slice("ollama:".length);
  return new OllamaAdapter({
    model,
    fetch: ((url: any, init: any) => {
      const body = JSON.parse(init.body);
      body.options = { ...body.options, ...OLLAMA_OPTIONS };
      return fetch(url, { ...init, body: JSON.stringify(body) });
    }) as typeof fetch,
  });
}

export function loadContract(): unknown {
  const path = require.resolve("@dspack-studio/contracts/astryx.dspack.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

export interface GovernedRunInput {
  prompt: string;
  intent: string;
  /** "ollama:<id>" | "anthropic:<id>" | "scripted" (deterministic dev mode). */
  modelRef: string;
  maxRepairs?: number;
  onEvent: NonNullable<RunOptions["onEvent"]>;
}

export async function governedRun(input: GovernedRunInput): Promise<RunResult> {
  const contract = loadContract() as Parameters<typeof runPipeline>[0]["contract"];
  // Scripted mode plays the contract's own worked example FOR THE REQUESTED
  // INTENT — the deterministic stand-in for generation (labeled scripted).
  const examples = (contract as any).examples ?? [];
  const example = examples.find((e: any) => e.intent === input.intent) ?? examples[0];
  const adapter = BREAK_SCRIPTS[input.modelRef]
    ? new ScriptedAdapter(structuredClone(BREAK_SCRIPTS[input.modelRef]))
    : input.modelRef === "scripted"
      ? new ScriptedAdapter([{ output: example.surface }])
      : input.modelRef.startsWith("ollama:")
        ? ollamaAdapterWithWindow(input.modelRef)
        : adapterFor(input.modelRef);

  return runPipeline({
    contract,
    intent: input.intent,
    prompt: input.prompt,
    adapter,
    maxRepairs: input.maxRepairs ?? 2,
    emitProfile: astryxProfile,
    onEvent: input.onEvent,
  });
}

export interface QuestionRunInput {
  /** The authored question surface (the deterministic script). */
  surface: unknown;
  /** The visitor-typable prompt (what a live model is asked). */
  prompt: string;
  /** "ollama:<id>" generates the question live; anything else plays the
   * authored surface through the SAME pipeline (scripted, real gates). */
  modelRef?: string;
  onEvent: NonNullable<RunOptions["onEvent"]>;
}

/**
 * FM-7: the agent's HITL question runs through the ORDINARY pipeline —
 * S1/S2/S3, repair loop, emission, audit — exactly like any generation.
 * Nothing about the question is synthesized into the stream.
 */
export async function governedQuestion(input: QuestionRunInput): Promise<RunResult> {
  const contract = loadContract() as Parameters<typeof runPipeline>[0]["contract"];
  const adapter = input.modelRef?.startsWith("ollama:")
    ? ollamaAdapterWithWindow(input.modelRef)
    : new ScriptedAdapter([{ output: input.surface }]);
  return runPipeline({
    contract,
    intent: "scheduling",
    prompt: input.prompt,
    adapter,
    maxRepairs: 2,
    emitProfile: astryxProfile,
    onEvent: input.onEvent,
  });
}
