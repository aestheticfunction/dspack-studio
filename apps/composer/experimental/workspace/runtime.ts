/**
 * The experimental workspace's composition runtime: the R1a pipeline and host from composer-core, wired to
 * the packaged Astryx reference. Nothing here is a second schema or a second pipeline: the Library loads the
 * packaged sidecar with loadCompositions, holds its versions with createLibrary, approves each version with
 * recheck and instantiates through a host (packages/composer-core/src/compositions).
 *
 * This directory exists only in an experimental build (next.config.mjs aliases it to nothing otherwise).
 */
import { lintSurface } from "@aestheticfunction/dspack-gen/core";
import {
  approvalRecord,
  approvalStatus,
  createGovernor,
  createHost,
  createLibrary,
  loadCompositions,
  promotionIssues,
  recheck,
  requiredSidecarVersion,
  type Approval,
  type ApprovalState,
  type CompositionDefinition,
  type CompositionLibrary,
  type Governor,
  type Host,
  type LintReport,
  type ScenarioResult,
  type Toolchain,
  versionKey,
} from "@dspack-studio/composer-core/compositions";
import contractDoc from "../../astryx-project/astryx.dspack.json";
import profileDoc from "../../astryx-project/astryx.profile.json";
import { loadBlocks, type BlockDefinition } from "@dspack-studio/composer-core/blocks";
import blocksSidecar from "../blocks/astryx.blocks.json";
import sidecar from "../compositions/astryx.compositions.json";
import { readRecord, withApproval, writeRecord, type KeyValueStore, type Promotion, type ReadResult } from "./storage";

type Json = Record<string, any>;

/** The lint and emitter versions, given to the experimental build by next.config.mjs. Fails closed without them. */
export function buildToolchain(): Toolchain {
  const raw = process.env.NEXT_PUBLIC_COMPOSER_TOOLCHAIN;
  if (!raw) throw new Error("the experimental build was made without its toolchain versions (NEXT_PUBLIC_COMPOSER_TOOLCHAIN)");
  return JSON.parse(raw) as Toolchain;
}

export const lint = (surface: unknown, contract: Json) => lintSurface(surface, contract as never) as unknown as LintReport;

/** The contract as packaged, or with one rule edited for a session-only what-if. Never stored. */
export function contractFor(whatIf: "none" | "four-options"): Json {
  const doc = structuredClone(contractDoc) as Json;
  if (whatIf === "four-options") {
    const rule = (doc.rules as Json[]).find((r) => r.id === "rule.review-offers-alternatives");
    if (rule) rule.requiredSubComponents[0].min = 4;
  }
  return doc;
}

export async function governorFor(whatIf: "none" | "four-options" = "none", toolchain: Toolchain = buildToolchain()): Promise<Governor> {
  return createGovernor({ contract: contractFor(whatIf), profileJson: profileDoc as Json, lintSurface: lint, toolchain });
}

export interface LoadedLibrary {
  library: CompositionLibrary;
  /** Anything the loader or the version rules left out, as reasons. */
  issues: string[];
  /** Where each version comes from: the packaged sample, or this device (authoring). Keyed `<id>@<version>`. */
  origin: Map<string, "packaged" | "device">;
  /** The packaged versions as loaded, before this device's changes. */
  packaged: CompositionDefinition[];
  /** What the two authoring records held when read, and how they read. */
  stored: { drafts: CompositionDefinition[]; approved: CompositionDefinition[]; retired: string[]; promotions?: Promotion[]; status: { drafts: ReadResult<unknown>["status"]; versions: ReadResult<unknown>["status"] } };
}

/**
 * The blocks a designer can promote (slice D): the packaged Astryx blocks the blocks loader accepts against
 * the same contract the compositions are bound to. Read only; a promotion works on a copy.
 */
let blocksCache: Promise<BlockDefinition[]> | null = null;
export function promotableBlocks(): Promise<BlockDefinition[]> {
  blocksCache ??= loadBlocks(blocksSidecar, { baseContract: contractDoc as Json }).then((l) => (l.binding === "ok" ? [...l.usable] : []));
  return blocksCache;
}

/** The block a composition was promoted from on this device, if any. */
export function promotionOf(loaded: LoadedLibrary, id: string): Promotion | undefined {
  return loaded.stored.promotions?.find((p) => p.composition === id);
}

/**
 * What still blocks approving a promoted composition: each block action its elements emit must be declared,
 * and no element may have an id computed from data (composer-core promotion.ts). Empty for a composition that
 * was not promoted, or once everything is resolved. If the block can no longer be found, approval stays
 * blocked rather than passing unchecked.
 */
export async function promotionBlockers(loaded: LoadedLibrary, definition: CompositionDefinition): Promise<string[]> {
  const p = promotionOf(loaded, definition.id);
  if (!p) return [];
  const block = (await promotableBlocks()).find((b) => b.id === p.block && b.version === p.version);
  if (!block) return [`The block it was promoted from (${p.block} v${p.version}) is not available, so its actions cannot be checked.`];
  return promotionIssues(definition, block.actions ?? [], block.constraints);
}

/**
 * Whether one definition is a valid composition of the packaged reference: the same loader, contract and
 * checks a packaged composition goes through (loadCompositions), so authoring adds no second validator.
 */
export async function definitionIssues(definition: CompositionDefinition): Promise<string[]> {
  const r = await validated(definition);
  return r.ok ? [] : r.issues;
}

/**
 * The definition as the loader reads it back, or why it is not valid. The document version is the oldest that
 * can hold it (0.2 unless it uses a 0.3 field), so a 0.2 definition is judged exactly as before.
 */
export async function validated(definition: CompositionDefinition): Promise<{ ok: true; definition: CompositionDefinition } | { ok: false; issues: string[] }> {
  const probe = { compositionsSidecar: requiredSidecarVersion(definition), status: definition.status, reference: sidecar.reference, baseSha256: sidecar.baseSha256, blocks: [], compositions: [definition] };
  const loaded = await loadCompositions(probe, { baseContract: contractDoc as Json });
  if (loaded.usable.length === 1) return { ok: true, definition: loaded.usable[0]! };
  return { ok: false, issues: [...loaded.issues, ...loaded.disabled.flatMap((d) => d.issues)] };
}

/**
 * The packaged versions, with this device's authoring applied: versions approved here, drafts kept here (a
 * draft created here, or an edited copy of a packaged draft), and packaged drafts discarded here. A stored
 * version that no longer validates is left out and reported; the packaged versions are never changed.
 */
export async function loadLibrary(store: KeyValueStore | null = null): Promise<LoadedLibrary> {
  const loaded = await loadCompositions(sidecar, { baseContract: contractDoc as Json });
  const drafts = readRecord("drafts", store);
  const versions = readRecord("versions", store);
  const promotions = readRecord("promotions", store);
  const issues = [...loaded.issues, ...loaded.disabled.map((d) => `${d.composition}: ${d.issues.join("; ")}`)];
  const valid = async (list: CompositionDefinition[], what: string) => {
    const kept: CompositionDefinition[] = [];
    for (const c of list) {
      const found = await definitionIssues(c);
      if (found.length === 0) kept.push(c);
      else issues.push(`${what} ${versionKey(c.id, c.version)} on this device was left out: ${found[0]}`);
    }
    return kept;
  };
  const approved = await valid(versions.value.approved, "approved version");
  const approvedKeys = new Set(approved.map((c) => versionKey(c.id, c.version)));
  // A draft left behind by an approval whose cleanup did not finish is superseded by the approved version.
  const storedDrafts = (await valid(drafts.value.drafts, "draft")).filter((c) => !approvedKeys.has(versionKey(c.id, c.version)));
  const replaced = new Set([...approvedKeys, ...storedDrafts.map((c) => versionKey(c.id, c.version)), ...versions.value.retired]);
  const packaged = loaded.usable.filter((c) => !replaced.has(versionKey(c.id, c.version)));
  const { library, issues: versionRules } = createLibrary([...packaged, ...approved, ...storedDrafts]);
  const origin = new Map<string, "packaged" | "device">();
  for (const c of packaged) origin.set(versionKey(c.id, c.version), "packaged");
  for (const c of [...approved, ...storedDrafts]) origin.set(versionKey(c.id, c.version), "device");
  return {
    library,
    issues: [...issues, ...versionRules.map((i) => `${i.key}: ${i.message}`)],
    origin,
    packaged: loaded.usable,
    stored: { drafts: storedDrafts, approved, retired: versions.value.retired, promotions: promotions.value.promoted, status: { drafts: drafts.status, versions: versions.status } },
  };
}

export interface VersionCheck {
  definition: CompositionDefinition;
  /** Present when every scenario behaves as declared under the current governor. */
  approval: Approval | null;
  scenarios: ScenarioResult[];
  /** What the record stored on this device said before this check: current, or made under other pins. */
  previous: ApprovalState;
}

/**
 * Re-check one version under the governor. The stored record is read for comparison only. It is replaced
 * only when this re-check passes; a failed re-check leaves the last valid record as it was.
 */
export async function checkVersion(governor: Governor, definition: CompositionDefinition, store?: KeyValueStore | null): Promise<VersionCheck> {
  const stored = readRecord("approvals", store);
  const record = stored.value.records.find((r) => r.composition === definition.id && r.version === definition.version);
  const previous = await approvalStatus(record, governor, definition);
  const r = await recheck(governor, definition);
  if (r.approval && stored.status !== "incompatible") writeRecord("approvals", withApproval(stored.value, approvalRecord(r.approval)), store);
  return { definition, approval: r.approval ?? null, scenarios: r.scenarios, previous };
}

/** A host for one version, approved by its re-check. A session id is generated by the host itself. */
export async function hostFor(governor: Governor, check: VersionCheck): Promise<Host> {
  const host = await createHost({ governor, compositions: [check.definition] });
  if (check.approval) host.approve(check.definition.id, check.approval);
  return host;
}
