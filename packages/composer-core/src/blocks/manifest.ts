/**
 * Interface blocks (experimental): the action manifest, H2
 * (docs/blocks/HOST-ACTIONS.md; docs/blocks/PHASE-2-RELEASE-PLAN.md, §7).
 *
 * The beta's Catalog export carries one entry per exported surface, in the
 * export's order. Each entry binds the actions the surface's messages
 * dispatch by surface and name, recomputed from those messages whenever the
 * catalog is exported, so an edited surface reports what it dispatches now.
 *
 * An action is `declared` only on a surface that verifiably IS its block's
 * expansion. Its provenance must name an approved block of an approved
 * sidecar this build bundles, one that B0 (with H1) accepted at load. The
 * call must pass B1 and the block's constraints. Re-expanded, it must give
 * exactly the stored surface, and that expansion must emit exactly the
 * exported messages, each action declared by the block with an empty
 * context. Only then does the entry carry the block: its id, version,
 * expansion identity, declared actions and streaming policy.
 *
 * Provenance is a claim; the re-expansion is the proof. Forged, stale or
 * misfiled provenance binds nothing, and a surface name plus an action name
 * alone grants nothing. Nothing here throws: whatever cannot be verified
 * binds nothing. Even a binding is a statement for a host to check, never a
 * grant: the host authorizes every effect on its own server.
 */
import { emitSurface, type Profile } from "@aestheticfunction/dspack-emit";
import { actionEvents } from "./actions";
import { expandBlock, expansionDigest } from "./expand";
import type { LoadedBlocks } from "./load";
import { trustedProvenance } from "./provenance";
import type { BlockDefinition } from "./schema";

type Json = Record<string, unknown>;

export const ACTION_MANIFEST_VERSION = 1 as const;

/** The block a surface verifiably is. */
export interface ManifestBlock {
  id: string;
  version: number;
  reference: { name: string; dspack: string; version: string };
  baseSha256: string;
  intent: string;
  /** The expansion identity: sha256 of the surface, which equals the call's expansion. */
  expansionDigest: string;
  /** The block's declared actions, in sidecar order. */
  declaredActions: string[];
  streaming: BlockDefinition["streaming"];
}

export interface ManifestAction {
  name: string;
  /** True only when this surface's verified block declares the name. */
  declared: boolean;
}

export interface ManifestSurface {
  /** The surface's name in the export (its `surfaces[].name`). */
  surface: string;
  /** The A2UI surfaceId its messages create, or null when they do not name exactly one. */
  surfaceId: string | null;
  /** Every action name its messages dispatch, sorted. */
  actions: ManifestAction[];
  /** The block this surface verifiably is, or null. */
  block: ManifestBlock | null;
}

export interface ActionManifest {
  v: typeof ACTION_MANIFEST_VERSION;
  surfaces: ManifestSurface[];
}

/** A packaged reference the build bundles: its sidecar as loaded (B0 and H1 applied), and its base contract and profile. */
export interface ManifestReference {
  loaded: LoadedBlocks;
  contract: Json;
  profile?: Profile;
}

export interface ActionManifestInput {
  /** The emitted surfaces; those without messages are not exported, so not listed. */
  surfaces: ReadonlyArray<{ name: string; messages?: unknown[] }>;
  /** The project's examples, whose ids name its surfaces. */
  examples: ReadonlyArray<{ id?: unknown; surface?: unknown }>;
  /** The project's block provenance, keyed by example id. */
  provenance: Readonly<Record<string, unknown>>;
  references: readonly ManifestReference[];
}

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

const sameReference = (a: unknown, b: { name: string; dspack: string; version: string }) =>
  isObject(a) && a.name === b.name && a.dspack === b.dspack && a.version === b.version;

const emptyContext = (context: unknown) => isObject(context) && Reflect.ownKeys(context).length === 0;

/** The one surfaceId a message stream names, or null. */
function onlySurfaceId(messages: unknown): string | null {
  const ids = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!isObject(value)) return;
    if (typeof value.surfaceId === "string") ids.add(value.surfaceId);
    Object.values(value).forEach(walk);
  };
  walk(messages);
  return ids.size === 1 ? [...ids][0]! : null;
}

/** The block a surface verifiably is, or null. */
async function verifiedBlock(
  name: string,
  messages: unknown[],
  events: ReadonlyArray<{ name: unknown; context: unknown }>,
  input: ActionManifestInput,
): Promise<ManifestBlock | null> {
  const record = Object.hasOwn(input.provenance, name) ? input.provenance[name] : undefined;
  if (!isObject(record)) return null;
  const reference = input.references.find(
    ({ loaded }) => loaded.binding === "ok" && loaded.sidecar?.status === "approved" && sameReference(record.reference, loaded.sidecar.reference) && loaded.sidecar.baseSha256 === record.baseSha256,
  );
  const sidecar = reference?.loaded.sidecar;
  if (!reference || !sidecar) return null;
  const block = reference.loaded.usable.find((b) => b.id === record.block && b.version === record.version);
  if (!block || block.status !== "approved") return null;
  const entry = trustedProvenance(record, [sidecar]);
  if (!entry) return null;

  // The proof: the call re-expands to the stored surface, whose emission is the exported messages.
  const expanded = expandBlock(block, entry.call, { reference: sidecar.reference, intent: entry.intent });
  if (!expanded.ok) return null;
  const digest = await expansionDigest(expanded.surface);
  if (digest !== entry.expansionDigest) return null;
  const stored = input.examples.filter((e) => e.id === name && isObject(e.surface));
  if (stored.length !== 1 || (await expansionDigest(stored[0]!.surface as Json)) !== digest) return null;
  const own = emitSurface(expanded.surface as never, reference.contract as never, reference.profile ? { profile: reference.profile } : {}).messages;
  if (JSON.stringify(own) !== JSON.stringify(messages)) return null;
  if (!events.every((e) => typeof e.name === "string" && block.actions.includes(e.name) && emptyContext(e.context))) return null;

  return {
    id: block.id,
    version: block.version,
    reference: sidecar.reference,
    baseSha256: sidecar.baseSha256,
    intent: entry.intent,
    expansionDigest: digest,
    declaredActions: [...block.actions],
    streaming: block.streaming,
  };
}

/** The action manifest for an export's surfaces. */
export async function actionManifest(input: ActionManifestInput): Promise<ActionManifest> {
  const listed = input.surfaces.filter((s) => s.messages);
  const counts = new Map<string, number>();
  for (const s of listed) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);

  const surfaces: ManifestSurface[] = [];
  for (const s of listed) {
    const messages = s.messages as unknown[];
    const events = actionEvents(messages);
    const names = [...new Set(events.map((e) => e.name).filter((n): n is string => typeof n === "string"))].sort();
    const surfaceId = onlySurfaceId(messages);
    let block: ManifestBlock | null = null;
    // Bound by surface and name: a name the export repeats, or messages naming
    // more than one surface, could not be told apart, so they bind nothing.
    if (counts.get(s.name) === 1 && surfaceId !== null) {
      try {
        block = await verifiedBlock(s.name, messages, events, input);
      } catch {
        block = null;
      }
    }
    surfaces.push({
      surface: s.name,
      surfaceId,
      actions: names.map((name) => ({ name, declared: block !== null && block.declaredActions.includes(name) })),
      block,
    });
  }
  return { v: ACTION_MANIFEST_VERSION, surfaces };
}
