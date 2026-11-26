/**
 * Compositions: version coexistence (R0-REVIEW A10, R1A-REVIEW F4, owner decision 15).
 *
 * A composition is identified by its id AND its version. Several versions of one id may be loaded together:
 *   - an approved version is immutable: nothing here changes one, and editing one forks a draft;
 *   - at most one draft per id, numbered above every approved version of that id, so "the newer draft" is
 *     always unambiguous;
 *   - editing a draft replaces it (same version), never an approved version.
 *
 * Approvals stay what host.ts makes them: issued only by recheck, for one definition, under pins that name
 * the exact version, the composition's hash and the contract, profile and toolchain. ApprovalRecord is
 * their PLAIN, persistable form, for showing an approval's history across sessions. It is evidence, not an
 * authorization: a host accepts only an approval recheck issued in the same session (host.ts, L4), so a
 * stored record can never stand in for a re-check, and approvalStatus says whether it still matches the
 * current rules.
 *
 * Proportionate to M1: no branching, merging, collaboration or history beyond the versions present.
 */
import { deepFreeze, type Governor } from "./governance";
import type { Approval, ScenarioResult } from "./host";
import { compositionPins, PIN_FIELDS, pinsWith, type Pins } from "./instantiate";
import type { CompositionDefinition } from "./schema";

/** `<id>@<version>`: the one key a composition version is known by. */
export const versionKey = (id: string, version: number) => `${id}@${version}`;

export interface VersionIssue {
  key: string;
  message: string;
}

/** The rules a set of versions must keep. Each issue names the version it disables. */
export function versionIssues(definitions: readonly CompositionDefinition[]): VersionIssue[] {
  const issues: VersionIssue[] = [];
  const seen = new Set<string>();
  const byId = new Map<string, CompositionDefinition[]>();
  for (const c of definitions) {
    const key = versionKey(c.id, c.version);
    if (seen.has(key)) issues.push({ key, message: `${key} is given twice` });
    seen.add(key);
    byId.set(c.id, [...(byId.get(c.id) ?? []), c]);
  }
  for (const [id, versions] of byId) {
    const drafts = versions.filter((v) => v.status === "draft");
    const topApproved = Math.max(0, ...versions.filter((v) => v.status === "approved").map((v) => v.version));
    if (drafts.length > 1) {
      for (const d of drafts.slice(1)) issues.push({ key: versionKey(id, d.version), message: `${id} has more than one draft (v${drafts.map((x) => x.version).join(", v")}); one draft per composition` });
    }
    for (const d of drafts) {
      if (d.version <= topApproved) issues.push({ key: versionKey(id, d.version), message: `draft v${d.version} of ${id} is not newer than approved v${topApproved}; a draft is numbered above every approved version` });
    }
  }
  return issues;
}

export interface LibraryEntry {
  id: string;
  /** Every version, oldest first. Each is frozen. */
  versions: readonly CompositionDefinition[];
  /** The newest approved version, if any. */
  approved: CompositionDefinition | null;
  /** The draft, if any: always newer than `approved`. */
  draft: CompositionDefinition | null;
}

export interface CompositionLibrary {
  readonly entries: readonly LibraryEntry[];
  get(id: string, version: number): CompositionDefinition | undefined;
  entry(id: string): LibraryEntry | undefined;
}

/**
 * A library of versions. Definitions are frozen copies, so a caller's later edit to its own objects changes
 * nothing here. Versions that break the rules above are left out and reported.
 */
export function createLibrary(definitions: readonly CompositionDefinition[]): { library: CompositionLibrary; issues: VersionIssue[] } {
  const issues = versionIssues(definitions);
  const disabled = new Set(issues.map((i) => i.key));
  const kept = new Map<string, CompositionDefinition>();
  for (const c of definitions) {
    const key = versionKey(c.id, c.version);
    if (!disabled.has(key) && !kept.has(key)) kept.set(key, deepFreeze(structuredClone(c)));
  }
  const byId = new Map<string, CompositionDefinition[]>();
  for (const c of kept.values()) byId.set(c.id, [...(byId.get(c.id) ?? []), c]);
  const entries: LibraryEntry[] = [...byId.entries()]
    .map(([id, versions]) => {
      const sorted = versions.sort((a, b) => a.version - b.version);
      const approved = [...sorted].reverse().find((v) => v.status === "approved") ?? null;
      const draft = sorted.find((v) => v.status === "draft") ?? null;
      return Object.freeze({ id, versions: Object.freeze(sorted), approved, draft });
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    library: Object.freeze({
      entries: Object.freeze(entries),
      get: (id: string, version: number) => kept.get(versionKey(id, version)),
      entry: (id: string) => entries.find((e) => e.id === id),
    }),
    issues,
  };
}

export type EditResult =
  | { ok: true; library: CompositionLibrary; draft: CompositionDefinition; forked: boolean }
  | { ok: false; reason: string };

/**
 * Edit a version. An approved version is never changed: the edit is applied to a new draft, numbered one
 * above the newest version of that id, and the approved version stays as it was. A draft is replaced by its
 * edited copy at the same version. The edit receives a mutable copy and may not change id, version or status.
 * Refused when an approved version is edited while a draft of that id already exists: edit the draft.
 */
export function editComposition(library: CompositionLibrary, id: string, version: number, edit: (draft: CompositionDefinition) => void): EditResult {
  const entry = library.entry(id);
  const target = library.get(id, version);
  if (!entry || !target) return { ok: false, reason: `no version ${versionKey(id, version)}` };
  const forked = target.status === "approved";
  if (forked && entry.draft) return { ok: false, reason: `${id} already has draft v${entry.draft.version}; edit the draft, not approved v${version}` };
  const draft = structuredClone(target) as CompositionDefinition;
  if (forked) {
    draft.version = Math.max(...entry.versions.map((v) => v.version)) + 1;
    draft.status = "draft";
  }
  const fixed = { id: draft.id, version: draft.version, status: draft.status };
  edit(draft);
  if (draft.id !== fixed.id || draft.version !== fixed.version || draft.status !== fixed.status) {
    return { ok: false, reason: "an edit may not change a composition's id, version or status" };
  }
  const others = library.entries.flatMap((e) => e.versions).filter((v) => !(v.id === id && v.version === draft.version));
  const { library: next, issues } = createLibrary([...others, draft]);
  if (issues.length > 0) return { ok: false, reason: issues.map((i) => i.message).join("; ") };
  return { ok: true, library: next, draft: next.get(id, draft.version)!, forked };
}

/** The plain form of an approval, for storage and display. Never accepted by a host (see the module note). */
export interface ApprovalRecord {
  composition: string;
  version: number;
  compositionSha256: string;
  pins: Pins;
  scenarios: Array<{ id: string; expect: "ok" | "refused"; outcome: "ok" | "refused"; matches: boolean; refusedBy?: string }>;
}

export function approvalRecord(approval: Approval): ApprovalRecord {
  const pins = Object.fromEntries(PIN_FIELDS.map((k) => [k, approval.pins[k]])) as unknown as Pins;
  return {
    composition: approval.pins.composition,
    version: approval.pins.version,
    compositionSha256: approval.pins.compositionSha256,
    pins,
    scenarios: approval.scenarios.map((s: ScenarioResult) => ({ id: s.id, expect: s.expect, outcome: s.outcome, matches: s.matches, ...(s.refusedBy ? { refusedBy: s.refusedBy } : {}) })),
  };
}

export type ApprovalState =
  | { status: "none" }
  | { status: "current" }
  /** The record was made under other rules, another toolchain or another definition: a re-check is needed. */
  | { status: "needs-recheck"; changed: Array<"contract" | "profile" | "toolchain" | "composition" | "interaction"> };

/** Whether a stored approval record still matches a version under the current governor. */
export async function approvalStatus(record: ApprovalRecord | undefined, governor: Governor, c: CompositionDefinition): Promise<ApprovalState> {
  if (!record || record.composition !== c.id || record.version !== c.version) return { status: "none" };
  const now = pinsWith(governor, await compositionPins(c));
  const changed: Array<"contract" | "profile" | "toolchain" | "composition" | "interaction"> = [];
  if (record.pins.contractSha256 !== now.contractSha256) changed.push("contract");
  if (record.pins.profileSha256 !== now.profileSha256) changed.push("profile");
  if (record.pins.toolchainSha256 !== now.toolchainSha256) changed.push("toolchain");
  if (record.pins.interactionSha256 !== now.interactionSha256) changed.push("interaction");
  if (record.pins.compositionSha256 !== now.compositionSha256) changed.push("composition");
  return changed.length === 0 ? { status: "current" } : { status: "needs-recheck", changed };
}
