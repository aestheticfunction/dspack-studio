/**
 * Experimental workspace storage (M1 Slice A; owner decision 14: separate storage keys for the experimental
 * application).
 *
 * Every key lives under one namespace, `composer.experimental.workspace.`, and only this module reads or
 * writes it. This directory is aliased to nothing in a default build (next.config.mjs), so the default
 * application cannot read, write or migrate these keys, and it never touches them by enumeration either
 * (it reads and writes its own keys by name). Production project data (`composer.projects.v1` and the keys
 * beside it) is never read or written here.
 *
 * Each record is an envelope `{ schema, version, data }`, validated field by field on read:
 *
 *   missing       no record: the default, nothing written;
 *   ok            valid at this version;
 *   malformed     not JSON, or not this schema's shape: the default is used, and the record is left where it
 *                 is. Before anything overwrites it, it is copied once to `<key>.preserved`;
 *   incompatible  a version this build does not know (a newer build wrote it): the default is used, and this
 *                 build never overwrites it;
 *   unavailable   storage cannot be read (blocked, private mode): the default, in memory only.
 *
 * Writes that fail (quota, blocked) report it and change nothing stored.
 *
 * What may be stored is closed by the shapes below: the Library's selection and panel, whether the first-run
 * guide was put away, whether the Library was the view on screen, versions approved on this device and
 * packaged drafts discarded here, the workspace appearance (a closed-enum proposal, never token values), approval records
 * (pins and scenario outcomes, which are evidence, never authorizations: see versions.ts), and drafts. None
 * of them has room for a typed input value, an action event, a session or surface id, a commitment or
 * renderer state (Part B decisions; checked by storage.test.ts).
 */
import { parseCompositionsSidecar, type ApprovalRecord, type CompositionDefinition } from "@dspack-studio/composer-core/compositions";
import { BASES, CUSTOM_ENUMS, WORKSPACE_ENUMS, type AppearanceRecord } from "./appearance-enums";

export const NAMESPACE = "composer.experimental.workspace.";
export const KEYS = {
  library: `${NAMESPACE}library`,
  approvals: `${NAMESPACE}approvals`,
  drafts: `${NAMESPACE}drafts`,
  onboarding: `${NAMESPACE}onboarding`,
  view: `${NAMESPACE}view`,
  versions: `${NAMESPACE}versions`,
  appearance: `${NAMESPACE}appearance`,
  authorization: `${NAMESPACE}authorization`,
  promotions: `${NAMESPACE}promotions`,
} as const;
export type RecordKind = keyof typeof KEYS;

/** The schema version this build reads and writes, per record. */
export const VERSIONS: Record<RecordKind, number> = { library: 1, approvals: 1, drafts: 1, onboarding: 1, view: 1, versions: 1, appearance: 1, authorization: 1, promotions: 1 };

export interface LibraryPrefs {
  composition: string | null;
  version: number | null;
  scenario: string | null;
  state: string | null;
  /** Which side panel was open: the rest of the layout follows the viewport. */
  panel: "library" | "inspector";
}

export const DEFAULT_PREFS: LibraryPrefs = { composition: null, version: null, scenario: null, state: null, panel: "library" };

export interface StoredApprovals {
  records: ApprovalRecord[];
}

export interface StoredDrafts {
  drafts: CompositionDefinition[];
}

/** Whether the first-run guide was put away (D0). */
export interface Onboarding {
  dismissed: boolean;
}

/**
 * The device's own changes to the version list (M1 authoring): versions a person approved here, and packaged
 * drafts discarded here (by `<id>@<version>`). Approved versions are written only after their re-check
 * passed, in one write, so a version is either fully approved on this device or not at all.
 */
export interface DeviceVersions {
  approved: CompositionDefinition[];
  retired: string[];
}

/**
 * Approvals withdrawn on this device (decision 34): an authorization-lifecycle decision, never a change to the
 * approved definition, which stays exactly as it is, nor to its recorded check evidence. Each entry names the
 * exact definition it withdraws (its sha256), so it cannot apply to any other. A packaged approval is withdrawn
 * here by this local record alone: the packaged definition is never changed.
 */
export interface Withdrawal {
  composition: string;
  version: number;
  compositionSha256: string;
  origin: "packaged" | "device";
}
export interface StoredAuthorization {
  withdrawn: Withdrawal[];
}

/**
 * Compositions promoted from a block on this device (slice D): where each came from. Provenance only: it never
 * changes the composition or the block, and approval reads it to know which block actions must be resolved.
 */
export interface Promotion {
  composition: string;
  block: string;
  version: number;
  reference: string;
}
export interface StoredPromotions {
  promoted: Promotion[];
}

/** Whether the Library was the view on screen, so a reload returns to it (D0.1). */
export interface ViewRecord {
  library: boolean;
}

interface Shapes {
  library: LibraryPrefs;
  approvals: StoredApprovals;
  drafts: StoredDrafts;
  onboarding: Onboarding;
  view: ViewRecord;
  versions: DeviceVersions;
  appearance: AppearanceRecord;
  authorization: StoredAuthorization;
  promotions: StoredPromotions;
}

const DEFAULTS: { [K in RecordKind]: Shapes[K] } = {
  library: DEFAULT_PREFS,
  approvals: { records: [] },
  drafts: { drafts: [] },
  onboarding: { dismissed: false },
  view: { library: false },
  versions: { approved: [], retired: [] },
  authorization: { withdrawn: [] },
  promotions: { promoted: [] },
  // Never used as such: a missing appearance record starts from the default build's preference (appearance.ts).
  appearance: {
    base: "default",
    custom: { scheme: "dark", surfaceHue: "sky", tint: "whisper", depth: "dim", warmth: "neutral", contrast: "standard", accentHue: "teal", chroma: "clear", presence: "balance", weight: "medium", elevation: "soft" },
    workspace: { density: "comfortable", textScale: "standard", labelCase: "sentence", display: "brand", surround: "workspace" },
  },
};

export type ReadResult<T> =
  | { status: "ok"; value: T }
  | { status: "missing"; value: T }
  | { status: "malformed"; value: T; reason: string }
  | { status: "incompatible"; value: T; found: unknown }
  | { status: "unavailable"; value: T };

export type WriteResult = { ok: true } | { ok: false; reason: string };

/** The storage the module uses: localStorage in the browser, injected in tests. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export function browserStore(): KeyValueStore | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const HEX64 = /^[0-9a-f]{64}$/;
const KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*@[1-9][0-9]*$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const onlyKeys = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k));
const nullableId = (v: unknown) => v === null || (typeof v === "string" && ID.test(v));
const nullableVersion = (v: unknown) => v === null || (Number.isSafeInteger(v) && (v as number) >= 1);

/** Each validator returns the value, rebuilt from the fields it allows, or a reason. Unknown fields are refused. */
const VALIDATE: { [K in RecordKind]: (data: unknown) => { ok: true; value: Shapes[K] } | { ok: false; reason: string } } = {
  library(data) {
    if (!isObject(data) || !onlyKeys(data, ["composition", "version", "scenario", "state", "panel"])) return { ok: false, reason: "library: not the preferences shape" };
    if (!nullableId(data.composition) || !nullableVersion(data.version) || !nullableId(data.scenario) || !nullableId(data.state)) return { ok: false, reason: "library: a selection field is invalid" };
    if (data.panel !== "library" && data.panel !== "inspector") return { ok: false, reason: "library: panel is invalid" };
    return { ok: true, value: { composition: data.composition as string | null, version: data.version as number | null, scenario: data.scenario as string | null, state: data.state as string | null, panel: data.panel } };
  },
  approvals(data) {
    if (!isObject(data) || !onlyKeys(data, ["records"]) || !Array.isArray(data.records)) return { ok: false, reason: "approvals: not the records shape" };
    const records: ApprovalRecord[] = [];
    for (const [i, r] of data.records.entries()) {
      const pins = isObject(r) ? r.pins : undefined;
      const ok =
        isObject(r) &&
        onlyKeys(r, ["composition", "version", "compositionSha256", "pins", "scenarios"]) &&
        typeof r.composition === "string" && ID.test(r.composition) &&
        nullableVersion(r.version) && r.version !== null &&
        typeof r.compositionSha256 === "string" && HEX64.test(r.compositionSha256) &&
        isObject(pins) &&
        onlyKeys(pins, ["contractSha256", "profileSha256", "toolchainSha256", "interactionSha256", "compositionSha256", "composition", "version"]) &&
        ["contractSha256", "profileSha256", "toolchainSha256", "interactionSha256", "compositionSha256"].every((k) => typeof pins[k] === "string" && HEX64.test(pins[k] as string)) &&
        pins.composition === r.composition && pins.version === r.version && pins.compositionSha256 === r.compositionSha256 &&
        Array.isArray(r.scenarios) &&
        r.scenarios.every(
          (s) =>
            isObject(s) &&
            onlyKeys(s, ["id", "expect", "outcome", "matches", "refusedBy"]) &&
            typeof s.id === "string" && ID.test(s.id) &&
            (s.expect === "ok" || s.expect === "refused") &&
            (s.outcome === "ok" || s.outcome === "refused") &&
            typeof s.matches === "boolean" &&
            (s.refusedBy === undefined || typeof s.refusedBy === "string"),
        );
      if (!ok) return { ok: false, reason: `approvals: record ${i} is invalid` };
      records.push(structuredClone(r) as unknown as ApprovalRecord);
    }
    return { ok: true, value: { records } };
  },
  versions(data) {
    if (!isObject(data) || !onlyKeys(data, ["approved", "retired"]) || !Array.isArray(data.approved) || !Array.isArray(data.retired)) return { ok: false, reason: "versions: not the versions shape" };
    if (!data.retired.every((k) => typeof k === "string" && KEY.test(k))) return { ok: false, reason: "versions: a retired version is not <id>@<version>" };
    let approved: CompositionDefinition[] = [];
    if (data.approved.length > 0) {
      // The one composition language: an approved version is checked by the 0.2 parser, as a packaged one is.
      const probe = parseCompositionsSidecar({ compositionsSidecar: "0.2", status: "approved", reference: { name: "probe", dspack: "0", version: "0" }, baseSha256: "0".repeat(64), blocks: [], compositions: data.approved });
      if (!probe.ok) return { ok: false, reason: `versions: ${probe.issues[0]?.path}: ${probe.issues[0]?.message}` };
      if (probe.sidecar.compositions.some((c) => c.status !== "approved")) return { ok: false, reason: "versions: only approved versions are kept here; drafts have their own record" };
      approved = probe.sidecar.compositions;
    }
    return { ok: true, value: { approved, retired: [...data.retired] as string[] } };
  },
  authorization(data) {
    if (!isObject(data) || !onlyKeys(data, ["withdrawn"]) || !Array.isArray(data.withdrawn)) return { ok: false, reason: "authorization: not the authorization shape" };
    const seen = new Set<string>();
    for (const w of data.withdrawn) {
      if (!isObject(w) || !onlyKeys(w, ["composition", "version", "compositionSha256", "origin"])) return { ok: false, reason: "authorization: a withdrawal has unknown fields" };
      if (typeof w.composition !== "string" || !Number.isInteger(w.version) || (w.version as number) < 1) return { ok: false, reason: "authorization: a withdrawal does not name a version" };
      if (typeof w.compositionSha256 !== "string" || !/^[0-9a-f]{64}$/.test(w.compositionSha256)) return { ok: false, reason: "authorization: a withdrawal does not name its exact definition" };
      if (w.origin !== "packaged" && w.origin !== "device") return { ok: false, reason: "authorization: a withdrawal's origin is packaged or device" };
      const k = `${w.composition}@${w.version}`;
      if (seen.has(k)) return { ok: false, reason: `authorization: ${k} is withdrawn twice` };
      seen.add(k);
    }
    return { ok: true, value: { withdrawn: structuredClone(data.withdrawn) as Withdrawal[] } };
  },
  promotions(data) {
    if (!isObject(data) || !onlyKeys(data, ["promoted"]) || !Array.isArray(data.promoted)) return { ok: false, reason: "promotions: not the promotions shape" };
    const seen = new Set<string>();
    for (const p of data.promoted) {
      if (!isObject(p) || !onlyKeys(p, ["composition", "block", "version", "reference"])) return { ok: false, reason: "promotions: a promotion has unknown fields" };
      if (typeof p.composition !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(p.composition)) return { ok: false, reason: "promotions: a promotion does not name a composition" };
      if (typeof p.block !== "string" || !Number.isInteger(p.version) || (p.version as number) < 1 || typeof p.reference !== "string") return { ok: false, reason: "promotions: a promotion does not name its block" };
      if (seen.has(p.composition)) return { ok: false, reason: `promotions: ${p.composition} is listed twice` };
      seen.add(p.composition);
    }
    return { ok: true, value: { promoted: structuredClone(data.promoted) as Promotion[] } };
  },
  appearance(data) {
    // A workspace appearance is a closed-enum proposal, never token values (T4): every field is checked here, and
    // the compiler checks it again before anything is applied.
    if (!isObject(data) || !onlyKeys(data, ["base", "custom", "workspace"])) return { ok: false, reason: "appearance: not the appearance shape" };
    if (!(BASES as readonly unknown[]).includes(data.base)) return { ok: false, reason: "appearance: unknown base appearance" };
    const custom = data.custom;
    if (!isObject(custom) || !onlyKeys(custom, Object.keys(CUSTOM_ENUMS)) || Object.keys(custom).length !== Object.keys(CUSTOM_ENUMS).length) return { ok: false, reason: "appearance: the custom direction is incomplete or has unknown fields" };
    for (const [k, allowed] of Object.entries(CUSTOM_ENUMS)) if (!(allowed as readonly unknown[]).includes(custom[k])) return { ok: false, reason: `appearance: custom ${k} is not one of the compiler's choices` };
    const ws = data.workspace;
    if (!isObject(ws) || !onlyKeys(ws, Object.keys(WORKSPACE_ENUMS)) || Object.keys(ws).length !== Object.keys(WORKSPACE_ENUMS).length) return { ok: false, reason: "appearance: the workspace choices are incomplete or have unknown fields" };
    for (const [k, allowed] of Object.entries(WORKSPACE_ENUMS)) if (!(allowed as readonly unknown[]).includes(ws[k])) return { ok: false, reason: `appearance: workspace ${k} is not one of its choices` };
    return { ok: true, value: structuredClone(data) as unknown as AppearanceRecord };
  },
  view(data) {
    if (!isObject(data) || !onlyKeys(data, ["library"]) || typeof data.library !== "boolean") return { ok: false, reason: "view: not the view shape" };
    return { ok: true, value: { library: data.library } };
  },
  onboarding(data) {
    if (!isObject(data) || !onlyKeys(data, ["dismissed"]) || typeof data.dismissed !== "boolean") return { ok: false, reason: "onboarding: not the onboarding shape" };
    return { ok: true, value: { dismissed: data.dismissed } };
  },
  drafts(data) {
    if (!isObject(data) || !onlyKeys(data, ["drafts"]) || !Array.isArray(data.drafts)) return { ok: false, reason: "drafts: not the drafts shape" };
    if (data.drafts.length === 0) return { ok: true, value: { drafts: [] } };
    // The one composition language: a draft is checked by the 0.2 parser, as a packaged composition is.
    const probe = parseCompositionsSidecar({ compositionsSidecar: "0.2", status: "draft", reference: { name: "probe", dspack: "0", version: "0" }, baseSha256: "0".repeat(64), blocks: [], compositions: data.drafts });
    if (!probe.ok) return { ok: false, reason: `drafts: ${probe.issues[0]?.path}: ${probe.issues[0]?.message}` };
    if (probe.sidecar.compositions.some((c) => c.status !== "draft")) return { ok: false, reason: "drafts: only drafts are stored here; approved versions are packaged and immutable" };
    return { ok: true, value: { drafts: probe.sidecar.compositions } };
  },
};

const schemaName = (kind: RecordKind) => `composer.experimental.workspace/${kind}`;

/** Read and validate one record. Never writes. */
export function readRecord<K extends RecordKind>(kind: K, store: KeyValueStore | null = browserStore()): ReadResult<Shapes[K]> {
  const fallback = structuredClone(DEFAULTS[kind]) as Shapes[K];
  if (!store) return { status: "unavailable", value: fallback };
  let raw: string | null;
  try {
    raw = store.getItem(KEYS[kind]);
  } catch {
    return { status: "unavailable", value: fallback };
  }
  if (raw === null) return { status: "missing", value: fallback };
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return { status: "malformed", value: fallback, reason: "not JSON" };
  }
  if (!isObject(envelope) || envelope.schema !== schemaName(kind) || !Number.isSafeInteger(envelope.version) || !onlyKeys(envelope, ["schema", "version", "data"])) {
    return { status: "malformed", value: fallback, reason: "not a workspace record envelope" };
  }
  if (envelope.version !== VERSIONS[kind]) return { status: "incompatible", value: fallback, found: envelope.version };
  const checked = VALIDATE[kind](envelope.data);
  return checked.ok ? { status: "ok", value: checked.value as Shapes[K] } : { status: "malformed", value: fallback, reason: checked.reason };
}

/**
 * Validate and write one record. A record this build cannot read is never lost: a malformed one is copied
 * once to `<key>.preserved` first, and an incompatible one is not overwritten at all.
 */
export function writeRecord<K extends RecordKind>(kind: K, value: Shapes[K], store: KeyValueStore | null = browserStore()): WriteResult {
  const checked = VALIDATE[kind](value);
  if (!checked.ok) return { ok: false, reason: `refused before writing: ${checked.reason}` };
  if (!store) return { ok: false, reason: "storage is unavailable; kept for this session only" };
  const current = readRecord(kind, store);
  if (current.status === "incompatible") return { ok: false, reason: `a record written by another version (${String(current.found)}) is kept; this build does not overwrite it` };
  try {
    if (current.status === "malformed") {
      const preserved = `${KEYS[kind]}.preserved`;
      if (store.getItem(preserved) === null) store.setItem(preserved, store.getItem(KEYS[kind]) ?? "");
    }
    store.setItem(KEYS[kind], JSON.stringify({ schema: schemaName(kind), version: VERSIONS[kind], data: checked.value }));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `not saved (${error instanceof Error ? error.name : "storage error"}); kept for this session only` };
  }
}

/**
 * Keep the latest approval record per composition version. A record is replaced only by a newer approval
 * of the same version, which recheck issued and the caller converted with approvalRecord; a failed re-check
 * produces no record, so it never replaces the last valid one.
 */
export function withApproval(stored: StoredApprovals, record: ApprovalRecord): StoredApprovals {
  const others = stored.records.filter((r) => !(r.composition === record.composition && r.version === record.version));
  return { records: [...others, record].sort((a, b) => `${a.composition}@${a.version}`.localeCompare(`${b.composition}@${b.version}`)) };
}
