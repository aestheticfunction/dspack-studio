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
 * inert {block, version, status} and the surface renders as an ordinary one.
 */
import { checkConstraints, validateCall } from "./call";
import { expansionDigest } from "./expand";
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

export interface InertProvenance {
  block: string;
  version: number;
  status: "inert";
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

/** Validate one stored record against the bundled sidecars; anything untrusted is inert. */
function trusted(value: Json, sidecars: readonly BlocksSidecar[]): BlockProvenanceEntry | null {
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

/** Stored or imported provenance, each record kept only as far as it can be trusted. */
export function parseProvenance(raw: unknown, sidecars: readonly BlocksSidecar[]): Record<string, ProvenanceRecord> {
  if (!isObject(raw)) return {};
  const out: Record<string, ProvenanceRecord> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isObject(value) || typeof value.block !== "string" || !Number.isInteger(value.version)) continue;
    const inert: InertProvenance = { block: value.block, version: value.version as number, status: "inert" };
    out[id] = value.status === "inert" ? inert : (trusted(value, sidecars) ?? inert);
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
  return trusted(record as unknown as Json, context.sidecars) ? "refinable" : "inert";
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
