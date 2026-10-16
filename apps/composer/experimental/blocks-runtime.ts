/**
 * Interface blocks (experimental): the one app module that imports block
 * code and the sidecars.
 *
 * It is reached only through `import("../experimental/blocks-runtime")`
 * written behind the literal `process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL
 * === "1"` check, which a default build folds away; the default build also
 * aliases this whole directory to nothing (next.config.mjs). So nothing here
 * is in production's deploy artifact, and the smoke suite and
 * check-default-artifact prove it on every build; only the beta's
 * experimental artifact carries it.
 *
 * What lives here (docs/BLOCKS.md, Phase 1A): eligibility against the
 * packaged references, the planning request with the block question, the
 * selection, the decision for a refinement, the block-mode run (the block
 * phase, then the SAME runPipeline with its attempt 0 decided), provenance
 * for accepted block surfaces, and the status Settings shows. Phase 2 adds
 * the beta's runtime switch (docs/blocks/PHASE-2-RELEASE-PLAN.md, §6), read
 * from /api/models before every build, and the action manifest the beta's
 * Catalog export carries (§7; docs/blocks/HOST-ACTIONS.md).
 */
import { loadProfile, type Profile } from "@aestheticfunction/dspack-emit";
import { AdapterOutputError } from "@aestheticfunction/dspack-gen/adapter-types";
import { runPipeline } from "@aestheticfunction/dspack-gen/browser";
import { lintSurface } from "@aestheticfunction/dspack-gen/core";
import { createPipelineEventMapper } from "@dspack-studio/agui-bridge";
import {
  buildPlanRequest,
  createCallRecorder,
  planDeterministic,
  reconcilePlan,
  type BlockChoice,
  type CallRecorder,
  type GoalPlan,
  type ModelCallRecord,
} from "@dspack-studio/composer-core";
import {
  actionManifest,
  budgetedInner,
  buildProvenanceEntry,
  createBudget,
  decideRefinement,
  eligibleBlocks,
  gateBlocksBeta,
  liveBaseDigest,
  loadBlocks,
  parseBlocksBeta,
  parseProvenance,
  preloadedAdapter,
  pruneProvenance,
  recheckBlockChoice,
  reconcileBlockChoice,
  runBlockPhase,
  scriptedBlockScript,
  selectBlockDeterministic,
  withBlockChoice,
  type ActionManifest,
  type BlockDefinition,
  type BlockPhaseDeps,
  type BlockSeed,
  type BlockTrace,
  type BlocksBetaReason,
  type BlocksBetaSwitch,
  type BlocksSidecar,
  type ErrorKind,
  type IneligibleReason,
  type LoadedBlocks,
  type ManifestReference,
  type StructuralAdapter,
  type SwitchReason,
} from "@dspack-studio/composer-core/blocks";
import type { BuildRunInput } from "../app/agent-client";
import { loadBlockProvenance, saveBlockProvenance } from "../app/block-provenance";
import type { CatalogBundle } from "../app/catalog-export";
import { REFERENCES } from "../app/demo-data";
import { GatewayError, gatewayAdapter, recordedScripted, runGatewayRequest, scriptedRunAdapter } from "../app/hosted-build";
import astryxSidecar from "./blocks/astryx.blocks.json";
import shadcnSidecar from "./blocks/shadcn-v3.blocks.json";

type Json = Record<string, any>;

/** The sidecars, by packaged reference id (demo-data REFERENCES). */
const SIDECARS: Record<string, unknown> = { shadcn: shadcnSidecar, astryx: astryxSidecar };

// ---------------------------------------------------------------------------
// Loading and eligibility, memoized per reference and per live document.

const loadedCache = new Map<string, Promise<LoadedBlocks>>();
const baseProfileCache = new Map<string, { parsed: Profile; json: string }>();
const liveDigestCache = new WeakMap<object, Promise<string>>();
const profileMatchCache = new WeakMap<object, boolean>();

function baseProfile(referenceId: string): { parsed: Profile; json: string } {
  let entry = baseProfileCache.get(referenceId);
  if (!entry) {
    const profile = REFERENCES[referenceId]!.profile;
    entry = { parsed: loadProfile(profile as never) as Profile, json: JSON.stringify(profile) };
    baseProfileCache.set(referenceId, entry);
  }
  return entry;
}

function loadedFor(referenceId: string): Promise<LoadedBlocks> {
  let loaded = loadedCache.get(referenceId);
  if (!loaded) {
    loaded = loadBlocks(SIDECARS[referenceId], { baseContract: REFERENCES[referenceId]!.contract as Json, profile: baseProfile(referenceId).parsed });
    loadedCache.set(referenceId, loaded);
  }
  return loaded;
}

export type BlockBase = { contract: Json; profile: Json; loadedProfile: Profile; sidecar: BlocksSidecar };

export interface BlockContext {
  referenceId: string | null;
  loaded: LoadedBlocks | null;
  /** The blocks this build may be offered, in sidecar order. */
  offered: BlockDefinition[];
  reason: IneligibleReason | BlocksBetaReason | null;
  /** More on the reason, for the build's note. */
  detail?: string;
  base: BlockBase | null;
}

const NOT_LOADED: LoadedBlocks = { binding: "invalid", usable: [], disabled: [], issues: ["no packaged reference"] };

type ProjectSource = { kind: "reference" | "agent" | "imported"; referenceId?: string } | null;

const packagedReference = (source: ProjectSource): string | null =>
  source?.kind === "reference" && source.referenceId && REFERENCES[source.referenceId] && SIDECARS[source.referenceId] ? source.referenceId : null;

// ---------------------------------------------------------------------------
// The beta's runtime switch (docs/blocks/PHASE-2-RELEASE-PLAN.md, §6, layer 4).

/** The ids a switch may name: the packaged references with sidecars, and their blocks. */
const BETA_KNOWN = {
  references: Object.keys(SIDECARS),
  blocks: [...new Set(Object.values(SIDECARS).flatMap((s) => ((s as Json).blocks as Json[] | undefined)?.map((b) => String(b.id)) ?? []))],
};

/**
 * The switch the beta Worker reports in /api/models, read fresh for every
 * build, so turning it off applies to the next build. Production's reply has
 * no switch; a reply that cannot be read, or arrives late, offers nothing.
 */
export async function readBlocksBeta(): Promise<BlocksBetaSwitch> {
  try {
    const res = await fetch("/api/models", { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { state: "off", reason: "unreadable" };
    return parseBlocksBeta(await res.json(), BETA_KNOWN);
  } catch {
    return { state: "off", reason: "unreadable" };
  }
}

/** Why a packaged reference is held out of the beta (docs/blocks/PHASE-2-DECISION-RECORD.md). */
const WITHHELD: Record<string, string> = {
  shadcn: "shadcn/ui v3 blocks are withheld from this beta: their evaluation remains inconclusive",
};

function baseFor(referenceId: string, loaded: LoadedBlocks): BlockBase | null {
  const base = REFERENCES[referenceId]!;
  return loaded.sidecar ? { contract: base.contract as Json, profile: base.profile as Json, loadedProfile: baseProfile(referenceId).parsed, sidecar: loaded.sidecar } : null;
}

/**
 * The sidecar binding an accepted block surface's provenance is written
 * against: the project's packaged reference, whatever the switch says now.
 * A turn that ran a block keeps its provenance after the switch goes off.
 */
export async function blockBinding(source: ProjectSource): Promise<BlockBase | null> {
  const referenceId = packagedReference(source);
  return referenceId ? baseFor(referenceId, await loadedFor(referenceId)) : null;
}

export async function blockContext(input: {
  mode: string;
  source: ProjectSource;
  inBrowser: boolean;
  contract: Json;
  profile: Json;
  disabled: ReadonlySet<string>;
  /** The beta's switch for this build (readBlocksBeta). */
  beta: BlocksBetaSwitch;
}): Promise<BlockContext> {
  const referenceId = packagedReference(input.source);
  if (!referenceId) {
    const { reason } = eligibleBlocks({ mode: input.mode, source: input.source, inBrowser: input.inBrowser, liveDigest: "", profileMatchesBase: false, loaded: NOT_LOADED, disabled: input.disabled });
    return { referenceId: null, loaded: null, offered: [], reason, base: null };
  }
  const base = REFERENCES[referenceId]!;
  const loaded = await loadedFor(referenceId);
  let digest = liveDigestCache.get(input.contract);
  if (!digest) {
    digest = liveBaseDigest(input.contract, base.contract as Json);
    liveDigestCache.set(input.contract, digest);
  }
  let profileMatchesBase = profileMatchCache.get(input.profile);
  if (profileMatchesBase === undefined) {
    profileMatchesBase = JSON.stringify(input.profile) === baseProfile(referenceId).json;
    profileMatchCache.set(input.profile, profileMatchesBase);
  }
  const eligible = eligibleBlocks({
    mode: input.mode,
    source: input.source,
    inBrowser: input.inBrowser,
    liveDigest: await digest,
    profileMatchesBase,
    loaded,
    disabled: input.disabled,
  });
  // Eligibility answers first, so an ineligible project keeps its own reason;
  // the switch then narrows what an eligible one is offered.
  const { blocks, reason } = eligible.reason === null ? gateBlocksBeta(eligible.blocks, referenceId, input.beta) : eligible;
  const withheld = () => WITHHELD[referenceId] ?? `${String((base as Json).label ?? base.contract.name ?? referenceId)} is not among this beta's references`;
  return {
    referenceId,
    loaded,
    offered: blocks,
    reason,
    ...(reason === "reference-not-in-beta" ? { detail: withheld() } : {}),
    base: baseFor(referenceId, loaded),
  };
}

// ---------------------------------------------------------------------------
// Planning with the block question, selection, and the decision for a run.

export async function planGoalWithBlocks(goal: string, contract: Json, eligible: readonly BlockDefinition[]): Promise<{ plan: GoalPlan; calls: ModelCallRecord[] }> {
  const recorder = createCallRecorder();
  try {
    const { json } = await runGatewayRequest(withBlockChoice(buildPlanRequest(goal, contract), eligible), { operation: "plan", recorder });
    const plan = reconcilePlan(json, contract, goal);
    return { plan: { ...plan, block: reconcileBlockChoice(json, { intent: plan.intent, eligible }) }, calls: [...recorder.calls] };
  } catch {
    // The gateway or model failed: deterministic routing keeps the build
    // moving, and a block is never selected after a provider failure.
    return {
      plan: { ...planDeterministic(goal, contract), block: { id: null, reason: "planning-provider-failure", source: "deterministic" } },
      calls: [...recorder.calls],
    };
  }
}

/** The block for a build, on the FINAL intent (after any override). */
export function chooseBlock(input: { ctx: BlockContext; plan: GoalPlan; intent: string; modelRef: string; goal: string }): BlockChoice {
  if (input.modelRef === "scripted") return selectBlockDeterministic(input.goal, input.intent, input.ctx.offered);
  const choice = input.plan.block ?? { id: null, reason: "the planner did not answer the block question", source: "omitted" as const };
  return recheckBlockChoice(choice, input.intent, input.ctx.offered);
}

export type BlockRun =
  | { kind: "fresh"; block: BlockDefinition; intent: string }
  | { kind: "compact"; block: BlockDefinition; intent: string; seed: BlockSeed }
  | { kind: "switch"; reason: SwitchReason; intent: string; priorBlock: { id: string; version: number; intent: string } };

/**
 * Whether this build runs in block mode, and how. Null is today's path with
 * no trace: the preference is off, the project is not eligible now (an edit
 * since the prior turn included), nothing was selected, or a refinement has
 * no prior trace. A prior trace that cannot seed a compact refinement is a
 * visible switch, only while the project is still eligible.
 */
export async function blockRunFor(input: {
  ctx: BlockContext;
  choice: BlockChoice;
  intent: string;
  goal: string;
  preferenceOn: boolean;
  prior?: { prompt: string; progress: { block?: unknown; outcome?: string; report?: Json; surface?: unknown } };
}): Promise<BlockRun | null> {
  const { ctx } = input;
  if (!input.preferenceOn || ctx.reason !== null || ctx.offered.length === 0) return null;
  if (input.prior?.progress.block) {
    const decision = await decideRefinement(input.prior, ctx.offered);
    if (decision.mode === "primitive") return null;
    if (decision.mode === "switch") {
      const selected = ((input.prior.progress.block as Json).selected ?? {}) as Json;
      return {
        kind: "switch",
        reason: decision.reason,
        intent: input.intent,
        priorBlock: { id: String(selected.id ?? ""), version: Number(selected.version ?? 0), intent: String(selected.intent ?? input.intent) },
      };
    }
    const block = ctx.offered.find((b) => b.id === decision.seed.id)!;
    return { kind: "compact", block, intent: decision.seed.intent, seed: decision.seed };
  }
  // A refinement without a prior trace is today's refinement of the prior
  // surface, whatever block choice its plan inherited from the thread's first
  // turn: a fresh block run here would discard that surface and report a new
  // expansion as a refinement.
  if (input.prior) return null;
  if (!input.choice.id) return null;
  const block = ctx.offered.find((b) => b.id === input.choice.id);
  return block ? { kind: "fresh", block, intent: input.intent } : null;
}

// ---------------------------------------------------------------------------
// The block-mode run.

const BUDGET = 3;

function classify(error: unknown): ErrorKind {
  if (!(error instanceof GatewayError)) return "unknown";
  return error.kind === "budget" ? "policy" : error.kind;
}

function makeError(kind: string, message: string, cause?: unknown): Error {
  if (cause instanceof AdapterOutputError) return cause;
  const gatewayKind = kind === "budget" ? "budget" : kind === "output" ? "output" : kind === "policy" ? "policy" : "provider";
  return new GatewayError(`${kind}: ${message}`, gatewayKind, []);
}

function switchTrace(run: Extract<BlockRun, { kind: "switch" }>): BlockTrace {
  return Object.freeze({
    selected: run.priorBlock,
    encoding: "named" as const,
    blockSchemaSha256: "",
    blockSystemSha256: "",
    attempts: Object.freeze([]),
    providerCalls: 0,
    outcome: "fallback" as const,
    fallback: { reason: run.reason, classification: "switch" },
    rawIsExpansion: true as const,
    refinement: { applied: false },
  });
}

export async function runHostedBlockBuild(args: {
  run: { kind: string };
  input: BuildRunInput;
  intent: string;
  modelRef: string;
  refinement: boolean;
  reference: { contract: Json; profile: Profile };
  recorder?: CallRecorder;
  emit: (event: Record<string, unknown>) => void;
}): Promise<void> {
  const run = args.run as BlockRun;
  const { input, intent, modelRef, refinement, recorder, emit } = args;
  const contract = args.reference.contract;
  const profile = args.reference.profile;
  const budget = createBudget(BUDGET);
  const deps: BlockPhaseDeps = { classify, lint: (surface) => lintSurface(surface, contract as never), makeError };

  // Adapters. Every hosted block-mode request carries maxCalls 1, so one
  // request is one provider call and the budget arithmetic is exact.
  let surfaceRaw: StructuralAdapter;
  let blockRaw: StructuralAdapter | null = null;
  if (modelRef === "hosted-ai") {
    surfaceRaw = gatewayAdapter({ ...(recorder ? { recorder } : {}), refinement, maxCalls: 1 });
    blockRaw = gatewayAdapter({ ...(recorder ? { recorder } : {}), maxCalls: 1 });
  } else {
    const examples = (contract.examples as Array<{ intent: string; surface: unknown }> | undefined) ?? [];
    const example = examples.filter((e) => e.intent === intent).at(-1);
    surfaceRaw = example
      ? recordedScripted(scriptedRunAdapter(example.surface, input.conversation), recorder, refinement)
      : { id: "fake:scripted", generate: async () => Promise.reject(new AdapterOutputError("fake:scripted", `scripted mode has no surface for '${intent}'`)) };
    if (run.kind !== "switch") {
      blockRaw = recordedScripted(scriptedBlockScript(run.block, run.intent, input.prompt, run.kind === "compact" ? { priorGoal: run.seed.priorGoal, priorCall: run.seed.call } : undefined), recorder, refinement);
    }
  }
  const surfaceInner = budgetedInner(surfaceRaw, budget, deps);

  const threadId = `build-${input.path}`;
  const runId = `run-${Date.now()}`;
  const map = createPipelineEventMapper({ threadId, runId });
  const pipeline = async (adapter: StructuralAdapter, maxRepairs: number, trace: BlockTrace) => {
    let announced = false;
    await runPipeline({
      contract: contract as Parameters<typeof runPipeline>[0]["contract"],
      intent,
      prompt: input.prompt,
      adapter: adapter as never,
      maxRepairs: Math.max(0, maxRepairs),
      emitProfile: profile,
      ...(input.conversation && input.conversation.length > 0 ? { conversation: input.conversation } : {}),
      onEvent: (event) => {
        for (const agui of map(event as never)) {
          emit(agui as unknown as Record<string, unknown>);
          // The trace is a turn-level artifact: complete before the pipeline
          // started, delivered right after the run opens.
          if (!announced && (agui as { type?: string }).type === "RUN_STARTED") {
            announced = true;
            emit({ type: "CUSTOM", name: "dspack.block", value: trace });
          }
        }
      },
    });
  };

  if (run.kind === "switch") {
    await pipeline(surfaceInner, BUDGET - 1, switchTrace(run));
    return;
  }

  const result = await runBlockPhase({
    block: run.block,
    intent: run.intent,
    goal: input.prompt,
    reference: { name: String(contract.name) },
    contract,
    profile,
    inner: budgetedInner(blockRaw!, budget, deps),
    budget,
    deps,
    // Named calls only (Phase 2 plan, §5): the measured encoding.
    encoding: "named",
    ...(run.kind === "compact" ? { seed: { priorGoal: run.seed.priorGoal, priorCall: run.seed.call } } : {}),
  });

  switch (result.kind) {
    case "expanded": {
      const mirror = { block: run.block.id, version: run.block.version, expansionDigest: result.trace.expansionDigest, rawIsExpansion: true };
      await pipeline(preloadedAdapter(result.surface, surfaceInner, mirror), BUDGET - budget.used, result.trace);
      return;
    }
    case "fallback":
      await pipeline(surfaceInner, BUDGET - budget.used - 1, result.trace);
      return;
    case "provider-failure": {
      // The report keeps today's failed-adapter shape: the captured error is
      // replayed once through an adapter with the real id.
      const replay: StructuralAdapter = { id: surfaceRaw.id, generate: async () => Promise.reject(result.error) };
      await pipeline(replay, 0, result.trace);
      return;
    }
    case "invariant-failure":
      // Never a pipeline run: the template is defective and the block is
      // disabled for the session (the fold reads the trace's outcome).
      emit({ type: "RUN_STARTED", threadId, runId });
      emit({ type: "CUSTOM", name: "dspack.block", value: result.trace });
      emit({ type: "RUN_FINISHED", threadId, runId });
      return;
  }
}

// ---------------------------------------------------------------------------
// Provenance: project data for accepted block surfaces, writes serialized.

export interface ProvenanceStore {
  key: string;
  load(): Record<string, unknown>;
  save(map: Record<string, unknown>): void;
}

export function projectProvenanceStore(projectId: string): ProvenanceStore {
  return { key: projectId, load: () => loadBlockProvenance(projectId), save: (map) => void saveBlockProvenance(projectId, map) };
}

export function memoryProvenanceStore(holder: { current: Record<string, unknown> }, key = "session"): ProvenanceStore {
  return { key, load: () => holder.current, save: (map) => void (holder.current = map) };
}

const chains = new Map<string, Promise<void>>();
function serialized(key: string, work: () => Promise<void>): Promise<void> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(work, work);
  chains.set(key, next);
  return next;
}

async function sidecarsLoaded(): Promise<BlocksSidecar[]> {
  const loaded = await Promise.all(Object.keys(SIDECARS).map((id) => loadedFor(id)));
  return loaded.map((l) => l.sidecar).filter((s): s is BlocksSidecar => !!s);
}

/** After an accept: write the entry when the accepted surface IS the expansion, then prune. */
export function recordProvenance(input: {
  store: ProvenanceStore;
  exampleId: string;
  trace: unknown;
  accepted: unknown;
  sidecar: BlocksSidecar;
  examples: ReadonlyArray<{ id: string; surface?: unknown }>;
}): Promise<void> {
  return serialized(input.store.key, async () => {
    const entry = await buildProvenanceEntry(input.trace as BlockTrace, input.accepted, { reference: input.sidecar.reference, baseSha256: input.sidecar.baseSha256 });
    const map = { ...input.store.load() };
    if (entry) map[input.exampleId] = entry;
    input.store.save(await pruneProvenance(map, input.examples));
  });
}

/** After a contract save: drop records for vanished or edited examples. */
export function gcProvenance(store: ProvenanceStore, examples: ReadonlyArray<{ id: string; surface?: unknown }>): Promise<void> {
  return serialized(store.key, async () => {
    const map = store.load();
    if (Object.keys(map).length === 0) return;
    store.save(await pruneProvenance(map, examples));
  });
}

/** On import: keep only what the bundled sidecars can vouch for. */
export function importProvenance(store: ProvenanceStore, raw: unknown): Promise<void> {
  return serialized(store.key, async () => {
    const sidecars = await sidecarsLoaded();
    store.save(parseProvenance(raw, sidecars));
  });
}

export function exportProvenance(store: ProvenanceStore): Record<string, unknown> {
  return store.load();
}

// ---------------------------------------------------------------------------
// The beta's Catalog export: the per-surface action manifest (§7, H2).

/** Every packaged reference, as loaded (B0 and H1 applied), with the base contract and profile its surfaces emit under. */
async function manifestReferences(): Promise<ManifestReference[]> {
  return Promise.all(
    Object.keys(SIDECARS).map(async (referenceId) => ({
      loaded: await loadedFor(referenceId),
      contract: REFERENCES[referenceId]!.contract as Json,
      profile: baseProfile(referenceId).parsed,
    })),
  );
}

/**
 * The Catalog export with its action manifest, placed before exportedAt;
 * everything else in the bundle is untouched. A surface binds a block only
 * when it verifiably is that block's expansion (composer-core actionManifest),
 * whatever the switch says now: the manifest states what a surface is, and a
 * host decides what to grant.
 */
export async function withActionManifest(
  bundle: CatalogBundle,
  input: {
    surfaces: ReadonlyArray<{ name: string; messages?: unknown[] }>;
    examples: ReadonlyArray<{ id?: unknown; surface?: unknown }>;
    provenance: Record<string, unknown>;
  },
): Promise<Omit<CatalogBundle, "exportedAt"> & { actionManifest: ActionManifest; exportedAt: string }> {
  const manifest = await actionManifest({ ...input, references: await manifestReferences() });
  const { exportedAt, ...rest } = bundle;
  return { ...rest, actionManifest: manifest, exportedAt };
}

// ---------------------------------------------------------------------------
// Status for Settings.

export interface ReferenceBlockStatus {
  referenceId: string;
  label: string;
  binding: LoadedBlocks["binding"];
  usable: Array<{ id: string; name: string; status: string }>;
  disabled: Array<{ block: string; issues: string[] }>;
  issues: string[];
}

export async function experimentalStatus(): Promise<ReferenceBlockStatus[]> {
  const out: ReferenceBlockStatus[] = [];
  for (const referenceId of Object.keys(SIDECARS)) {
    const loaded = await loadedFor(referenceId);
    out.push({
      referenceId,
      label: String((REFERENCES[referenceId] as Json).label ?? REFERENCES[referenceId]!.contract.name ?? referenceId),
      binding: loaded.binding,
      usable: loaded.usable.map((b) => ({ id: b.id, name: b.name, status: b.status })),
      disabled: loaded.disabled,
      issues: loaded.issues,
    });
  }
  return out;
}
