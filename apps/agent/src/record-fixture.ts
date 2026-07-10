/**
 * Record a replay fixture: run the governed pipeline once and capture the
 * mapped AG-UI event stream (with real timings) into a versioned fixture.
 *
 *   pnpm --filter agent record -- --model ollama:gpt-oss:latest \
 *     --prompt "..." --intent destructive-action \
 *     --id fixture-001 --name "The interface argues back" \
 *     --out ../../packages/replay/fixtures/fixture-001.json
 *
 * Honest-magic rule: fixtures shipped to the site must come from real model
 * runs (mode "live"); the deterministic ScriptedAdapter is allowed only for
 * CI fixtures and is labeled mode "scripted".
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createPipelineEventMapper, type PipelineEvent } from "@dspack-studio/agui-bridge";
import { createRecorder } from "@dspack-studio/replay";
import { governedRun } from "./pipeline.js";

function flag(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  console.error(`--${name} is required`);
  process.exit(1);
}

const modelRef = flag("model");
const prompt = flag("prompt");
const intent = flag("intent", "destructive-action");
const id = flag("id");
const name = flag("name", id);
const out = flag("out");
const requireRepair = process.argv.includes("--require-repair");
/** Fixture #2 class: reject runs that needed a repair (clean first pass only). */
const requireClean = process.argv.includes("--require-clean");
/** Fixture #3 class: keep failure runs (emitter refusal etc.) — the failure
 * panel needs real recorded failures, and failures are first-class artifacts. */
const allowFailure = process.argv.includes("--allow-failure");

const recorder = createRecorder({
  id,
  name,
  mode: modelRef === "scripted" ? "scripted" : "live",
  adapterId: modelRef,
  intent,
  prompt,
});

const map = createPipelineEventMapper({ threadId: "studio", runId: id });
let sawRepair = false;

const result = await governedRun({
  prompt,
  intent,
  modelRef,
  onEvent: (event) => {
    if ((event as PipelineEvent).type === "repair") sawRepair = true;
    for (const agui of map(event as PipelineEvent)) recorder.record(agui as any);
  },
});

console.log(`outcome: ${result.report.outcome} (exit ${result.exitCode}), repair seen: ${sawRepair}`);

if (result.exitCode !== 0) {
  const emitted = (result.report as any).emitted;
  if (emitted?.refusal) console.error(`emitter refusal: ${emitted.refusal}`);
  for (const v of emitted?.validations ?? []) {
    for (const g of v.gates ?? []) {
      if (g.pass === false) console.error(`gate ${g.gate} (${v.a2uiVersion}): ${(g.errors ?? []).join("; ")}`);
    }
  }
  const lastAttempt = (result.report as any).attempts?.at(-1);
  if (lastAttempt?.surface) {
    console.error(`final surface: ${JSON.stringify(lastAttempt.surface).slice(0, 600)}`);
  }
  if (!allowFailure) {
    console.error("run did not pass; fixture not written (pass --allow-failure to keep failure runs)");
    process.exit(result.exitCode);
  }
  console.error("run did not pass; keeping the failure fixture (--allow-failure)");
}
if (requireRepair && !sawRepair) {
  console.error("run passed but contained no repair; fixture not written (--require-repair)");
  process.exit(5);
}
if (requireClean && (sawRepair || result.exitCode !== 0)) {
  console.error("run was not a clean first pass; fixture not written (--require-clean)");
  process.exit(5);
}

const fixture = recorder.finish();
const target = resolve(out);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(fixture, null, 2) + "\n");
console.log(`fixture (${fixture.events.length} events, mode ${fixture.mode}) -> ${target}`);
