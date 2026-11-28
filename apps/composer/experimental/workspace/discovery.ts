/**
 * Local agent-facing discovery (experimental, local and synthetic): what a simulated agent on this device can
 * find, and how it resolves an exact composition version.
 *
 * Nothing here is published, and nothing is reachable from outside this page: there is no endpoint. The one
 * authoritative decision is `agentEligibility`; discovery adds no rule of its own. Every call reads the
 * authorization authority as it is at that moment, never state held by the interface, so a withdrawal applies
 * to the next call.
 *
 * What is exposed is the minimum an agent needs to choose and fill a composition: its stable id, exact version
 * and definition hash, its title and purpose, its data declarations, its inputs and actions (names and kinds,
 * never values), its states and their intended transitions, and compatibility pins. Synthetic example data is
 * included only when asked for (local evaluation). Private input values, action payload values, diagnostics
 * and authoring records are never included.
 *
 * Resolution takes an exact reference (composition, version, definition hash). It re-evaluates eligibility,
 * refuses a reference that no longer matches the definition, never substitutes another version, and returns the
 * surface through the existing governed host and pipeline (createHost, show), not a renderer of its own.
 */
import { createHost, describeGuard, pinsFor, requiredSidecarVersion, type CompositionDefinition, type Governor, type Host } from "@dspack-studio/composer-core/compositions";
import type { Authority } from "./authority";
import { agentEligibility, type EligibilityReason } from "./eligibility";
import { promotionBlockers, type LoadedLibrary, type VersionCheck } from "./runtime";
import { shaOf } from "./withdrawal";

type Json = Record<string, any>;

export const DISCOVERY_SCHEMA = "composer.local-discovery/1";

/** An exact composition version: what an agent holds and asks for. */
export interface CompositionReference {
  composition: string;
  version: number;
  definitionSha256: string;
}

export interface DiscoveredComposition {
  reference: CompositionReference;
  title: string;
  purpose: string;
  compatibility: { compositionsSidecar: string; contractSha256: string; profileSha256: string; toolchainSha256: string; interactionSha256: string };
  data: Array<{ name: string; type: string; required: boolean; description?: string }>;
  inputs: Array<{ name: string; kind: string; required: boolean; private: boolean }>;
  actions: Array<{ name: string; sentFrom: string[]; sends: string[]; carriesInputs: string[]; consequential: boolean; intendedNext: string[] }>;
  states: Array<{ id: string; title?: string; description?: string; purpose: string; shownWhen: string }>;
  /** Only when asked for: synthetic data for local evaluation. */
  examples?: Array<{ id: string; title?: string; data: Json; state?: string }>;
}

export interface DiscoveryResult {
  schema: typeof DISCOVERY_SCHEMA;
  scope: "local-synthetic";
  published: false;
  /** The authorization generation this answer was evaluated under. */
  authorizationGeneration: number;
  eligible: DiscoveredComposition[];
  excluded: Array<{ reference: CompositionReference; title: string; status: "draft" | "approved"; reasons: EligibilityReason[] }>;
}

/** What discovery reads, each time it is called. */
export interface DiscoveryContext {
  loaded: LoadedLibrary;
  hosts: Map<string, Host>;
  checks: Map<string, VersionCheck>;
  governor: Governor;
  authority: Authority;
  approvalGen: Map<string, number>;
}

const keyOf = (c: { id: string; version: number }) => `${c.id}@${c.version}`;

async function eligibilityOf(ctx: DiscoveryContext, c: CompositionDefinition, record: Awaited<ReturnType<Authority["read"]>>) {
  const k = keyOf(c);
  return agentEligibility({ definition: c, host: ctx.hosts.get(k), check: ctx.checks.get(k), governor: ctx.governor, authority: ctx.authority, record, approvalGeneration: ctx.approvalGen.get(k), promotionBlockers: await promotionBlockers(ctx.loaded, c) });
}

/** The minimum an agent needs, from the definition alone: names and kinds, never values. */
async function describe(ctx: DiscoveryContext, c: CompositionDefinition, examples: boolean): Promise<DiscoveredComposition> {
  const pins = await pinsFor(ctx.governor, c);
  return {
    reference: { composition: c.id, version: c.version, definitionSha256: pins.compositionSha256 },
    title: c.name,
    purpose: c.summary,
    compatibility: { compositionsSidecar: requiredSidecarVersion(c), contractSha256: pins.contractSha256, profileSha256: pins.profileSha256, toolchainSha256: pins.toolchainSha256, interactionSha256: pins.interactionSha256 },
    data: [...c.parameters, ...c.data].map((p) => {
      const spec = p as Json;
      return { name: String(spec.name), type: String(spec.type), required: !!spec.required, ...(typeof spec.description === "string" ? { description: spec.description } : {}) };
    }),
    inputs: c.inputs.map((i) => ({ name: i.name, kind: i.kind, required: !!i.required, private: !!i.sensitive })),
    actions: c.actions.map((a) => ({ name: a.name, sentFrom: [...a.states], sends: Object.keys(a.payload ?? {}), carriesInputs: [...(a.carries ?? [])], consequential: !!a.consequential, intendedNext: [...(a.leadsTo ?? [])] })),
    states: c.states.map((s) => ({ id: s.id, ...(s.title ? { title: s.title } : {}), ...(s.description ? { description: s.description } : {}), purpose: s.purpose, shownWhen: describeGuard(s.guard) })),
    ...(examples ? { examples: c.scenarios.filter((s) => s.expect === "ok").map((s) => ({ id: s.id, ...(s.title ? { title: s.title } : {}), data: structuredClone(s.data) as Json, ...(s.state ? { state: s.state } : {}) })) } : {}),
  };
}

/**
 * What a local agent can discover now: every eligible exact version, and every other version with why it is
 * not eligible. Evaluated from the authority as it is at this call.
 */
export async function discover(ctx: DiscoveryContext, options: { examples?: boolean } = {}): Promise<DiscoveryResult> {
  const record = await ctx.authority.read();
  const result: DiscoveryResult = { schema: DISCOVERY_SCHEMA, scope: "local-synthetic", published: false, authorizationGeneration: record.generation, eligible: [], excluded: [] };
  for (const entry of ctx.loaded.library.entries) {
    for (const c of entry.versions) {
      const e = await eligibilityOf(ctx, c, record);
      if (e.eligible) result.eligible.push(await describe(ctx, c, !!options.examples));
      else result.excluded.push({ reference: { composition: c.id, version: c.version, definitionSha256: await shaOf(c) }, title: c.name, status: c.status, reasons: e.reasons });
    }
  }
  return result;
}

export type Resolution =
  | { ok: true; reference: CompositionReference; state: string; surfaceId: string; components: number; messages: Json[] }
  | { ok: false; code: "unknown" | "altered" | "ineligible" | "refused"; reason: string; reasons?: EligibilityReason[] };

/**
 * Resolve an exact reference for a local agent, at this moment: the exact version (never another), only if its
 * definition still hashes as referenced and it is eligible now, rendered through the governed pipeline.
 */
export async function resolve(ctx: DiscoveryContext, ref: CompositionReference, input: { data: Json; state?: string }): Promise<Resolution> {
  const c = ctx.loaded.library.get(ref.composition, ref.version);
  if (!c) return { ok: false, code: "unknown", reason: `there is no ${ref.composition} v${ref.version} here; no other version is used in its place` };
  if ((await shaOf(c)) !== ref.definitionSha256) return { ok: false, code: "altered", reason: `${ref.composition} v${ref.version} here is not the definition this reference names` };
  const record = await ctx.authority.read();
  const e = await eligibilityOf(ctx, c, record);
  if (!e.eligible) return { ok: false, code: "ineligible", reason: `${c.name} v${c.version} is not eligible for agents now`, reasons: e.reasons };
  // A host of its own for this resolution, approved with the version's current check: the Library's canvas is
  // left as it is, and nothing outlives the call.
  const host = await createHost({ governor: ctx.governor, compositions: [c] });
  const approval = ctx.checks.get(keyOf(c))?.approval;
  if (!approval || !host.approve(c.id, approval).approved) return { ok: false, code: "ineligible", reason: "its current check could not authorize it" };
  const shown = await host.show(c.id, { data: input.data, ...(input.state ? { state: input.state } : {}) });
  if (!shown.ok) return { ok: false, code: "refused", reason: (shown.refusal as Json).reason ?? String(shown.refusal.stage) };
  const components = shown.instance.messages.reduce((n, m) => n + (((m as Json).updateComponents?.components ?? []) as unknown[]).length, 0);
  return { ok: true, reference: ref, state: shown.instance.state, surfaceId: shown.instance.surfaceId, components, messages: shown.instance.messages as Json[] };
}

/**
 * A deterministic simulated agent for local evaluation: it discovers with examples, takes the first eligible
 * composition whose purpose matches what it was asked for (or the first eligible one), and resolves it with
 * that composition's first example. No model is involved.
 */
export async function simulatedAgent(ctx: DiscoveryContext, want?: { composition?: string }): Promise<{ discovered: DiscoveryResult; chosen: CompositionReference | null; resolution: Resolution | null }> {
  const discovered = await discover(ctx, { examples: true });
  const pick = discovered.eligible.find((d) => !want?.composition || d.reference.composition === want.composition) ?? null;
  if (!pick || !pick.examples?.length) return { discovered, chosen: pick?.reference ?? null, resolution: null };
  const ex = pick.examples[0]!;
  return { discovered, chosen: pick.reference, resolution: await resolve(ctx, pick.reference, { data: ex.data, ...(ex.state ? { state: ex.state } : {}) }) };
}
