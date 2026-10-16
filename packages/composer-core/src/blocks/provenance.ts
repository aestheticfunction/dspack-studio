/**
 * Interface blocks (experimental): provenance (ADR-B5, RFC section 6).
 *
 * An accepted block surface remembers how it was made: the binding, the
 * block, the intent, the named call and the expansion digest. It is PROJECT
 * data, keyed by the accepted example id, never part of a contract file or
 * an example entry. The call validates against the block's B1 schema, which
 * has no slot for an entered value, a default, a credential or runtime
 * state. An entry is written only when the accepted surface is exactly the
 * expansion; on import, anything that cannot be trusted is reduced to an
 * inert {block, version, status, reason} and the surface renders as an
 * ordinary one.
 *
 * What a surface's provenance means is the verdict (provenanceVerdict): a
 * surface is "made with block X vN" only by exact expansion identity, and a
 * verdict says what a surface is, never what anyone may do with it.
 */
import { checkConstraints, validateCall } from "./call";
import { expandBlock, expansionDigest } from "./expand";
import type { LoadedBlocks } from "./load";
import type { BlockTrace } from "./phase";
import type { BlocksSidecar } from "./schema";

type Json = Record<string, unknown>;

export const PROVENANCE_MAX_BYTES = 16384;

export interface BlockProvenanceEntry {
  v: 1;
  reference: { name: string; dspack: string; version: string };
  baseSha256: string;
  block: string;
  version: number;
  intent: string;
  blockSchemaSha256: string;
  encoding: "named";
  call: Json;
  expansionDigest: string;
}

/**
 * Why provenance is inert. Trust: the record names a reference this build
 * does not bundle (or that is not the project's own), another base contract,
 * a block or a version this build does not have, or fails validation (B1,
 * constraints, intent, encoding). Identity: its call does not expand to the
 * digest it recorded, or the surface is no longer that expansion (edited; the
 * next save drops it). Offer: this build does not offer the block (draft, or
 * disabled at load). Stored: it was reduced to inert before, without a
 * reason this build can read.
 */
export const INERT_REASONS = ["reference", "base", "block", "version", "validation", "expansion", "edited", "not-offered", "stored"] as const;
export type InertReason = (typeof INERT_REASONS)[number];
/** Why verified provenance still cannot refine: the project is not a reference project. */
export type UnavailableReason = "imported" | "repository";

export interface InertProvenance {
  block: string;
  version: number;
  status: "inert";
  reason?: InertReason;
}

export type ProvenanceRecord = BlockProvenanceEntry | InertProvenance;

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

export async function buildProvenanceEntry(
  trace: BlockTrace,
  accepted: unknown,
  binding: { reference: { name: string; dspack: string; version: string }; baseSha256: string },
): Promise<BlockProvenanceEntry | null> {
  if (trace.outcome !== "block" || typeof trace.expansionDigest !== "string") return null;
  const call = trace.attempts[trace.expansionAttemptIndex ?? -1]?.call;
  if (!isObject(call) || !isObject(accepted)) return null;
  if ((await expansionDigest(accepted)) !== trace.expansionDigest) return null;
  const entry: BlockProvenanceEntry = {
    v: 1,
    reference: binding.reference,
    baseSha256: binding.baseSha256,
    block: trace.selected.id,
    version: trace.selected.version,
    intent: trace.selected.intent,
    blockSchemaSha256: trace.blockSchemaSha256,
    encoding: "named",
    call,
    expansionDigest: trace.expansionDigest,
  };
  if (new TextEncoder().encode(JSON.stringify(entry)).length > PROVENANCE_MAX_BYTES) return null;
  return entry;
}

function sameReference(a: Json | undefined, b: { name: string; dspack: string; version: string }): boolean {
  return !!a && a.name === b.name && a.dspack === b.dspack && a.version === b.version;
}

/**
 * Validate one stored record against the bundled sidecars: its binding, block
 * and version, intent, encoding, and a call that passes B1 and the block's
 * constraints. Null when anything cannot be trusted. It never checks the
 * record's digest against a surface; the action manifest re-expands the call
 * for that (manifest.ts).
 */
export function trustedProvenance(value: Json, sidecars: readonly BlocksSidecar[]): BlockProvenanceEntry | null {
  const sidecar = sidecars.find((s) => sameReference(value.reference as Json | undefined, s.reference) && s.baseSha256 === value.baseSha256);
  const block = sidecar?.blocks.find((b) => b.id === value.block && b.version === value.version);
  if (!sidecar || !block) return null;
  if (value.v !== 1 || value.encoding !== "named") return null;
  if (typeof value.expansionDigest !== "string" || typeof value.blockSchemaSha256 !== "string") return null;
  if (typeof value.intent !== "string" || !block.intents.includes(value.intent)) return null;
  if (!isObject(value.call) || validateCall(block, value.call).length > 0 || checkConstraints(block, value.call).length > 0) return null;
  return {
    v: 1,
    reference: sidecar.reference,
    baseSha256: sidecar.baseSha256,
    block: block.id,
    version: block.version,
    intent: value.intent,
    blockSchemaSha256: value.blockSchemaSha256,
    encoding: "named",
    call: value.call,
    expansionDigest: value.expansionDigest,
  };
}

/** A reason as stored, kept only when it is one this build knows. */
const knownReason = (value: unknown): InertReason | undefined => (INERT_REASONS as readonly unknown[]).includes(value) ? (value as InertReason) : undefined;

/** Why a record cannot be trusted against the bundled sidecars, or null when it can (trustedProvenance). */
function untrustedReason(value: Json, sidecars: readonly BlocksSidecar[]): Extract<InertReason, "reference" | "base" | "block" | "version" | "validation"> | null {
  const sameRef = sidecars.filter((s) => sameReference(value.reference as Json | undefined, s.reference));
  if (sameRef.length === 0) return "reference";
  const sidecar = sameRef.find((s) => s.baseSha256 === value.baseSha256);
  if (!sidecar) return "base";
  const versions = sidecar.blocks.filter((b) => b.id === value.block);
  if (versions.length === 0) return "block";
  if (!versions.some((b) => b.version === value.version)) return "version";
  return trustedProvenance(value, [sidecar]) ? null : "validation";
}

/** Stored or imported provenance, each record kept only as far as it can be trusted, and an inert one with why. */
export function parseProvenance(raw: unknown, sidecars: readonly BlocksSidecar[]): Record<string, ProvenanceRecord> {
  if (!isObject(raw)) return {};
  const out: Record<string, ProvenanceRecord> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isObject(value) || typeof value.block !== "string" || !Number.isInteger(value.version)) continue;
    const inert = (reason: InertReason | undefined): InertProvenance => ({ block: value.block as string, version: value.version as number, status: "inert", ...(reason ? { reason } : {}) });
    if (value.status === "inert") {
      out[id] = inert(knownReason(value.reason));
      continue;
    }
    out[id] = trustedProvenance(value, sidecars) ?? inert(untrustedReason(value, sidecars) ?? "validation");
  }
  return out;
}

export type ProvenanceStatus = "refinable" | "inert" | "unavailable";

/** Imported and repository projects never refine from provenance, whatever they carry. */
export function provenanceStatus(
  record: ProvenanceRecord,
  context: { sidecars: readonly BlocksSidecar[]; projectKind: "reference" | "imported" | "agent" },
): ProvenanceStatus {
  if (context.projectKind !== "reference") return "unavailable";
  if ("status" in record) return "inert";
  return trustedProvenance(record as unknown as Json, context.sidecars) ? "refinable" : "inert";
}

/**
 * What a surface's provenance means here (docs/blocks/PHASE-2-RELEASE-PLAN.md,
 * §8). `madeWith` is the label "made with block X vN", and only exact
 * expansion identity earns it. The record must be trusted against a bundled
 * sidecar that binds to this build's base contract. Its call must re-expand
 * to the digest it recorded. The surface must be that expansion. Then it
 * is refinable on a reference project whose build offers the block,
 * unavailable on an imported or repository project, and inert, with its
 * label, when this build does not offer the block. Anything less is inert
 * with no label, and the surface renders as an ordinary one. A verdict says
 * what a surface is; it never carries an action, a declaration or a grant.
 */
export interface ProvenanceVerdict {
  block: string;
  version: number;
  madeWith: boolean;
  status: ProvenanceStatus;
  /** Why it is inert or unavailable; absent when refinable. */
  reason?: InertReason | UnavailableReason;
}

/** Plain words for every reason, as Preview shows them. */
export const PROVENANCE_REASON_TEXT: Record<InertReason | UnavailableReason, string> = {
  reference: "it names a design-system reference that is not this project's, or not in this build",
  base: "it was bound to another version of the reference's base contract",
  block: "it names a block this build does not have",
  version: "it names a block version this build does not have",
  validation: "its call does not pass the block's checks",
  expansion: "its call does not expand to this surface",
  edited: "this surface was changed after it was accepted, and the next save drops the record",
  "not-offered": "this build does not offer the block: it is a draft, or disabled at load",
  stored: "it was reduced to inert when it was stored or imported",
  imported: "imported projects never refine from provenance",
  repository: "repository projects never refine from provenance",
};

export async function provenanceVerdict(input: {
  /** The stored record, as the project holds it. */
  record: unknown;
  /** The surface the record's example holds now. */
  surface: unknown;
  /** Every bundled sidecar, as loaded (B0 and H1 applied). */
  loaded: readonly LoadedBlocks[];
  /** A reference project names its packaged reference; an imported or repository project does not. */
  project: { kind: "reference" | "imported" | "agent"; reference?: { name: string; dspack: string; version: string } };
}): Promise<ProvenanceVerdict | null> {
  const { record, project } = input;
  if (!isObject(record) || typeof record.block !== "string" || !Number.isInteger(record.version)) return null;
  const named = { block: record.block, version: record.version as number };
  const inert = (reason: InertReason, madeWith = false): ProvenanceVerdict => ({ ...named, madeWith, status: "inert", reason });
  if (record.status === "inert") return inert(knownReason(record.reason) ?? "stored");
  try {
    if (project.kind === "reference" && project.reference && !sameReference(record.reference as Json | undefined, project.reference)) return inert("reference");
    const sidecars = input.loaded.flatMap((l) => (l.sidecar ? [l.sidecar] : []));
    const untrusted = untrustedReason(record, sidecars);
    if (untrusted) return inert(untrusted);
    const loaded = input.loaded.find((l) => l.sidecar && sameReference(record.reference as Json | undefined, l.sidecar.reference) && l.sidecar.baseSha256 === record.baseSha256)!;
    const sidecar = loaded.sidecar!;
    if (loaded.binding !== "ok") return inert("base");
    const entry = trustedProvenance(record, [sidecar])!;
    const block = sidecar.blocks.find((b) => b.id === entry.block && b.version === entry.version)!;

    // The proof: the trusted call re-expands to the digest it recorded, and the surface is that expansion.
    const expanded = expandBlock(block, entry.call, { reference: sidecar.reference, intent: entry.intent });
    if (!expanded.ok || (await expansionDigest(expanded.surface)) !== entry.expansionDigest) return inert("expansion");
    if (!isObject(input.surface) || (await expansionDigest(input.surface)) !== entry.expansionDigest) return inert("edited");

    if (project.kind !== "reference") return { ...named, madeWith: true, status: "unavailable", reason: project.kind === "imported" ? "imported" : "repository" };
    const offered = sidecar.status === "approved" && block.status === "approved" && loaded.usable.some((b) => b.id === block.id && b.version === block.version);
    return offered ? { ...named, madeWith: true, status: "refinable" } : inert("not-offered", true);
  } catch {
    return inert("validation");
  }
}

/** Drop records whose example vanished or whose surface no longer equals the expansion. */
export async function pruneProvenance(
  map: Record<string, unknown>,
  examples: ReadonlyArray<{ id: string; surface?: unknown }>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [id, record] of Object.entries(map)) {
    const example = examples.find((e) => e.id === id);
    if (!example || !isObject(record)) continue;
    if (record.status === "inert") {
      out[id] = record;
      continue;
    }
    if (typeof record.expansionDigest !== "string" || !isObject(example.surface)) continue;
    if ((await expansionDigest(example.surface)) === record.expansionDigest) out[id] = record;
  }
  return out;
}
