/**
 * The live pilot (docs/repositioning/LIVE-EVALUATION-PROPOSAL.md): twelve runs on Astryx with the production model,
 * through the same code the Phase 1B evaluation uses, under a cumulative dollar ceiling.
 *
 * Reused, not re-implemented:
 * - providers/hosted.ts: posts the app's exact request bytes, reserves each request's priced worst case before it is
 *   sent, admits it only while the most any request can cost still fits under the ceiling, settles it at the
 *   provider's reported usage when the reply proves it stayed inside the price, raises it otherwise, holds every call
 *   to Claude Haiku 4.5 (integrity.ts) and stops on another model or unbounded usage;
 * - arms.ts runCell, production arm: today's single build, the planning call then runPipeline with two repairs;
 * - composer-core's flow planner (buildFlowPlanRequest, reconcileFlowPlan) and each step as an ordinary build with the
 *   step's intent, as the app's Build a flow does.
 *
 * Added for the pilot: the cumulative ledger (ledger.ts), its stop rules (monitor.ts), the fixed run list (runs.ts)
 * and the access preflight (access.ts). No cell-level reservation (provider.beforeCell): at $5 it would refuse a cell
 * after about $0.53, because it reserves four requests at the model's absolute limits. The per-request admission still
 * guarantees the ceiling.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitSurface, extractInstances } from "@aestheticfunction/dspack-emit";
import { buildFlowPlanRequest, createCallRecorder, flowPlanDeterministic, reconcileFlowPlan, type FlowPlan } from "@dspack-studio/composer-core";
import type { GenerateContext, GenerateRequest, StructuralAdapter } from "@dspack-studio/composer-core/blocks";
import { runCell } from "../arms";
import type { Corpus } from "../corpus";
import { reportedUsd, toNanos } from "../cost";
import { createPacer, RunStop } from "../pacing";
import { createHostedProvider } from "../providers/hosted";
import { createMeter, type Provider } from "../providers/types";
import { loadReference, type LoadedReference } from "../references";
import type { RunRecord } from "../types";
import { openPilotLedger } from "./ledger";
import { createMonitor, PilotStop, type Monitor } from "./monitor";
import { goalFor, PILOT_CEILING_USD, PILOT_MAX_REQUESTS, PILOT_REFERENCE, PILOT_RUNS, TASK_FIT, taskFitKey, type PilotRun } from "./runs";

/** Astryx components with a native renderer (packages/astryx-renderers/src/registry.tsx), as the corpus harness uses. */
const ASTRYX_NATIVE = new Set(["AlertDialog", "Badge", "Button", "Card", "Column", "Dialog", "List", "MetadataList", "SelectableCard", "Table", "Text", "TextField"]);

export interface PilotOptions {
  /** The Composer origin; requests go to its /api/propose. */
  baseUrl: string;
  /** The run directory: ledger, state, one evidence file per run, SUMMARY.md. */
  outDir: string;
  /** A fetch that carries the Access service token (access.ts withToken). */
  fetchImpl: typeof fetch;
  /** A lower ceiling than the pilot's, never a higher one. */
  maxUsd?: number;
  spacingMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
  /** For tests: the reference to run on (default: the packaged Astryx reference). */
  reference?: LoadedReference;
}

export interface PilotState {
  completed: string[];
  servedModel?: string;
  stopped?: { reason: string; message: string; at: string };
}

export interface PilotResult {
  completed: string[];
  /** Runs this invocation finished. */
  ran: string[];
  stopped?: { reason: string; message: string };
  /** Dollars committed across the whole pilot, unverified reservations included. */
  usd: number;
  requests: number;
}

const PILOT_CORPUS: Corpus = { corpus: "live-pilot", version: 1, frozenAt: "2026-11-25", refinements: {}, prompts: [] };

const readState = (file: string): PilotState => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as PilotState) : { completed: [] });

/** Components the emitted messages use, split by whether Astryx renders them natively. */
function rendererCoverage(surface: unknown, reference: LoadedReference): { used: string[]; native: string[]; wireframe: string[] } | { refused: string } {
  try {
    const { messages } = emitSurface(surface as never, reference.contract as never, { profile: reference.profile });
    const used = [...new Set(extractInstances({ messages } as never).map((i) => String(i.component)))].sort();
    return { used, native: used.filter((c) => ASTRYX_NATIVE.has(c)), wireframe: used.filter((c) => !ASTRYX_NATIVE.has(c)) };
  } catch (error) {
    return { refused: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The provider, watched by the pilot's stop rules. `intent` overrides a flow step's planned intent, as the app's Build a
 * flow does (the planning call is still made and paid for); `track` feeds goal-level plans to the identical-plan rule.
 */
function watched(provider: Provider, monitor: Monitor, how: { intent?: string; track?: boolean }, stopFile: string): Provider {
  const watch = async <T>(work: () => Promise<T>): Promise<T> => {
    // The operator's stop: a STOP file in the run directory, read before every request.
    if (existsSync(stopFile)) throw new PilotStop("operator", `${stopFile} exists, so nothing more is sent; delete it to resume`);
    try {
      const value = await work();
      monitor.succeeded();
      return value;
    } catch (error) {
      monitor.failed(error);
      throw error;
    }
  };
  const { beforeCell: _cellReservation, ...rest } = provider;
  return {
    ...rest,
    async plan(request, opts) {
      const json = await watch(() => provider.plan(request, opts));
      const kind = (request.jsonSchema as { properties?: { steps?: unknown } } | undefined)?.properties?.steps ? "flow plan" : "goal plan";
      if (how.track) monitor.planned(kind, request.messages.at(-1)?.content ?? "", json);
      return how.intent === undefined ? json : { ...(json as Record<string, unknown>), intent: how.intent };
    },
    surfaceAdapter(opts) {
      const inner: StructuralAdapter = provider.surfaceAdapter(opts);
      return { id: inner.id, generate: (request: GenerateRequest, context?: GenerateContext) => watch(() => inner.generate(request, context)) };
    },
  };
}

/** One ordinary build: the production arm of the Phase 1B evaluation, which is the app's single build. */
async function build(provider: Provider, reference: LoadedReference, id: string, goal: string): Promise<RunRecord> {
  const { record } = await runCell({
    reference,
    provider,
    arm: "production",
    condition: "fresh",
    prompt: { id, goal, block: null, intent: {}, parity: { labels: [] }, expectedIntent: "" },
    corpus: PILOT_CORPUS,
  });
  return record;
}

function buildEvidence(record: RunRecord, reference: LoadedReference) {
  const repairs = Math.max(0, record.attempts - 1);
  return {
    plan: record.plan ? { intent: record.plan.intent, source: record.plan.source, failure: record.plan.failure, durationMs: record.plan.durationMs } : undefined,
    outcome: record.outcome,
    passed: record.passed,
    firstPass: record.passed && record.attempts === 1,
    attempts: record.attempts,
    repairs,
    failure: record.failure,
    models: [...new Set(record.calls.map((c) => c.model).filter(Boolean))],
    tokens: record.tokens,
    usd: reportedUsd(record.calls),
    timings: record.timings,
    renderer: record.passed && record.surface ? rendererCoverage(record.surface, reference) : undefined,
    calls: record.calls,
    surface: record.surface,
  };
}

export async function runPilot(options: PilotOptions): Promise<PilotResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const capUsd = options.maxUsd ?? PILOT_CEILING_USD;
  if (!(capUsd > 0) || toNanos(capUsd) > toNanos(PILOT_CEILING_USD)) throw new Error(`the pilot's ceiling is at most $${PILOT_CEILING_USD}; ${capUsd} was given`);
  mkdirSync(options.outDir, { recursive: true });
  const stateFile = join(options.outDir, "state.json");
  const state = readState(stateFile);
  const save = () => writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const ledgerFile = join(options.outDir, "requests.jsonl");
  const stopFile = join(options.outDir, "STOP");
  const invocation = `inv-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const ledger = openPilotLedger(ledgerFile, { cap: PILOT_MAX_REQUESTS, capUsd }, invocation);
  const summary = (ran: string[], stopped?: PilotResult["stopped"]): PilotResult => ({ completed: [...state.completed], ran, ...(stopped ? { stopped } : {}), usd: ledger.usd ?? 0, requests: ledger.sent });

  const remaining = PILOT_RUNS.filter((r) => !state.completed.includes(r.id));
  if (remaining.length === 0) {
    log("The pilot is complete: all twelve runs are recorded. Nothing is sent. The full baseline needs separate authorization.");
    return summary([]);
  }
  if (state.stopped) log(`Resuming after a stop (${state.stopped.reason}): ${state.stopped.message}`);
  delete state.stopped;
  save();

  const pacer = createPacer({ maxRequests: PILOT_MAX_REQUESTS, spacingMs: options.spacingMs ?? 3000, backoffMs: [], ...(options.sleep ? { sleep: options.sleep } : {}), ...(options.now ? { now: options.now } : {}) });
  pacer.ledger = ledger;
  pacer.served = {
    get id() {
      return state.servedModel;
    },
    record(id) {
      if (state.servedModel) return;
      state.servedModel = id;
      save();
    },
  };
  const provider = createHostedProvider({ baseUrl: options.baseUrl, pacer, fetchImpl: options.fetchImpl });
  const monitor = createMonitor();
  const reference = options.reference ?? (await loadReference(PILOT_REFERENCE));
  const ran: string[] = [];

  for (const run of remaining) {
    const goal = await goalFor(run);
    const started = Date.now();
    const evidence: Record<string, unknown> = { run, goal, reference: reference.id, startedAt: new Date(started).toISOString(), taskFit: { marked: false, items: TASK_FIT[taskFitKey(run)] } };
    const file = join(options.outDir, `${run.id}.json`);
    try {
      if (run.kind === "single") {
        const record = await build(watched(provider, monitor, { track: true }, stopFile), reference, run.id, goal);
        evidence.builds = [buildEvidence(record, reference)];
      } else {
        let flow: FlowPlan;
        const recorder = createCallRecorder();
        const flowStarted = Date.now();
        try {
          const json = await watched(provider, monitor, { track: true }, stopFile).plan(buildFlowPlanRequest(goal, reference.contract) as GenerateRequest, { recorder, meter: createMeter() });
          flow = reconcileFlowPlan(json, reference.contract, goal);
          evidence.flowPlan = { source: "model", raw: json };
        } catch (error) {
          if (error instanceof RunStop) throw error;
          flow = flowPlanDeterministic(goal, reference.contract);
          evidence.flowPlan = { source: "deterministic-fallback", error: error instanceof Error ? error.message : String(error) };
        }
        evidence.flowPlan = { ...(evidence.flowPlan as object), name: flow.name, steps: flow.steps, durationMs: Date.now() - flowStarted, calls: [...recorder.calls], usd: reportedUsd(recorder.calls) };
        const builds: unknown[] = [];
        evidence.builds = builds;
        for (const [index, step] of flow.steps.entries()) {
          const record = await build(watched(provider, monitor, { intent: step.intent }, stopFile), reference, `${run.id}-step-${index + 1}`, step.goal.trim() || step.title);
          builds.push({ step: { index: index + 1, title: step.title, intent: step.intent }, ...buildEvidence(record, reference) });
        }
      }
      evidence.durationMs = Date.now() - started;
      evidence.pilotUsdAfter = ledger.usd;
      writeFileSync(file, `${JSON.stringify(evidence, null, 1)}\n`);
      state.completed.push(run.id);
      save();
      ran.push(run.id);
      log(`${run.id}: done, pilot total $${(ledger.usd ?? 0).toFixed(4)} committed over ${ledger.sent} requests`);
    } catch (error) {
      if (!(error instanceof RunStop)) throw error;
      const reason = error instanceof PilotStop ? error.reason : error.name;
      evidence.stopped = { reason, message: error.message };
      evidence.durationMs = Date.now() - started;
      writeFileSync(join(options.outDir, `${run.id}.stopped.json`), `${JSON.stringify(evidence, null, 1)}\n`);
      state.stopped = { reason, message: error.message, at: new Date().toISOString() };
      save();
      log(`STOPPED in ${run.id} (${reason}): ${error.message}`);
      writeSummary(options.outDir, state, ledger.usd ?? 0, ledger.sent);
      return summary(ran, { reason, message: error.message });
    }
  }
  writeSummary(options.outDir, state, ledger.usd ?? 0, ledger.sent);
  log("The pilot is complete. Nothing further runs: the full baseline needs separate authorization.");
  return summary(ran);
}

/** SUMMARY.md: one row per build, and the task-fit checklists left for a person to mark. */
export function writeSummary(outDir: string, state: PilotState, usd: number, requests: number): void {
  const rows: string[] = [];
  const checklists: string[] = [];
  for (const run of PILOT_RUNS) {
    const file = join(outDir, `${run.id}.json`);
    if (!existsSync(file)) continue;
    const ev = JSON.parse(readFileSync(file, "utf8")) as { builds: Array<Record<string, any>>; flowPlan?: { source: string; steps: unknown[] } };
    for (const b of ev.builds) {
      const wire = b.renderer && "wireframe" in b.renderer ? b.renderer.wireframe.join(" ") || "none" : b.renderer?.refused ? "emit refused" : "";
      rows.push(`| ${run.id}${b.step ? ` step ${b.step.index}` : ""} | ${b.plan?.intent ?? ""} | ${b.outcome ?? ""} | ${b.firstPass ? "yes" : "no"} | ${b.repairs} | ${b.tokens?.input ?? ""}/${b.tokens?.output ?? ""} | $${(b.usd ?? 0).toFixed(4)} | ${Math.round(b.timings?.totalMs ?? 0)} | ${wire} | ${(b.models ?? []).join(" ")} |`);
    }
    checklists.push(`### ${run.id}${ev.flowPlan ? ` (flow plan: ${ev.flowPlan.source}, ${ev.flowPlan.steps.length} steps)` : ""}\n\n${TASK_FIT[taskFitKey(run)]!.map((item) => `- [ ] ${item}`).join("\n")}\n`);
  }
  const text = [
    "# Live pilot summary",
    "",
    `Runs completed: ${state.completed.length} of ${PILOT_RUNS.length}. Committed: $${usd.toFixed(4)} over ${requests} requests (unverified reservations counted at their worst case). Served model: ${state.servedModel ?? "none recorded"}.`,
    state.stopped ? `\n**Stopped** (${state.stopped.reason}): ${state.stopped.message}` : "",
    "",
    "Governance compliance (the gates) and task fit (the checklists below, marked by a person) are separate results.",
    "",
    "| Build | Planned intent | Outcome | First pass | Repairs | Tokens in/out | Cost | Latency ms | Wireframe components | Model |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "## Task fit (to be marked by a person)",
    "",
    ...checklists,
  ].join("\n");
  writeFileSync(join(outDir, "SUMMARY.md"), `${text}\n`);
}
