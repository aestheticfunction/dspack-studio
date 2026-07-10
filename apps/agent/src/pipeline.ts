/**
 * The one place the agent invokes dspack-gen: load the Astryx contract, pick
 * an adapter, run the governed pipeline, and forward every pipeline event to
 * the caller (which maps them onto AG-UI events via the bridge).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  adapterFor,
  runPipeline,
  ScriptedAdapter,
  type RunOptions,
  type RunResult,
} from "@aestheticfunction/dspack-gen";
import { astryxProfile } from "@dspack-studio/contracts";

const require = createRequire(import.meta.url);

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
  const adapter =
    input.modelRef === "scripted"
      ? new ScriptedAdapter([{ output: (contract as any).examples[0].surface }])
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
