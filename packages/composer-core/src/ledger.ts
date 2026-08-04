/**
 * Reading the dspack-export `metadata["x-bootstrap"]` ownership ledger.
 *
 * The ledger's semantics belong to dspack-export (src/emit/bootstrap.ts):
 * `generated` maps each tool-generated section to
 * sha256(JSON.stringify(section)); `awaitingAuthorship` lists what the tool
 * never writes. This module only READS that contract — a section whose
 * recorded hash still matches is tool-owned; a mismatch means a human edited
 * it (permanently human-owned, per the refusal table); sections without a
 * recorded hash are human-authored or absent.
 *
 * Hashing uses WebCrypto (crypto.subtle), available in browsers and Node 20+,
 * so the same code runs in the composer app and the agent. Fidelity to
 * dspack-export's sectionHash is pinned by test against a real dspack-export
 * output fixture.
 */

export type SectionState =
  | "tool-owned" // recorded hash matches current content
  | "human-owned" // recorded hash no longer matches (edited after bootstrap)
  | "human-authored" // present with no recorded hash (authored, never generated)
  | "absent"; // not in the document

export interface SectionStatus {
  section: string;
  state: SectionState;
}

/**
 * Ledger v2 (dspack-export 0.5.0): ownership of the components section is
 * tracked per entry. The three additional states have no section-level
 * analogue: an ORPHANED record is deletion memory (the entry was hand-
 * deleted; rediscovery skips it and asks), a TOMBSTONED id must never be
 * re-added, and an UNATTRIBUTED entry is present with no record (human-
 * owned; the post-migration form of enrichment).
 */
export type ComponentEntryState =
  | "tool-owned"
  | "human-owned" // stale recorded hash: edited after bootstrap
  | "unattributed" // present, no recorded hash: human-owned, migration form
  | "orphaned" // recorded hash, entry absent: deletion awaiting a decision
  | "tombstoned"; // listed in doNotRediscover, entry absent

export interface ComponentEntryStatus {
  id: string;
  state: ComponentEntryState;
  /** A present entry can ALSO be tombstoned (suppressedButPresent interop). */
  alsoTombstoned?: boolean;
}

export interface LedgerStatus {
  /** True when metadata["x-bootstrap"] exists (bootstrap provenance available). */
  hasLedger: boolean;
  /** True when the ledger tracks components per entry (ledger v2). */
  entryLevel: boolean;
  sections: SectionStatus[];
  /** Per-entry component states; empty on v1 ledgers (section-level only). */
  componentEntries: ComponentEntryStatus[];
  /** The authorship todo list, verbatim from the ledger. */
  awaitingAuthorship: string[];
}

interface BootstrapLedger {
  ledger?: string;
  spec?: string;
  generated?: Record<string, string>;
  components?: Record<string, string>;
  doNotRediscover?: string[];
  awaitingAuthorship?: string[];
}

/** The ledger version whose entry-level semantics this module reads. */
export const LEDGER_V2 = "2";

/** sha256 hex of JSON.stringify(value) — dspack-export's sectionHash, on WebCrypto. */
export async function sectionHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sections the ledger can record plus the governance sections it never will. */
const REPORTED_SECTIONS = [
  "tokens",
  "components",
  "frameworkBindings",
  "themes",
  "layout",
  "categories",
  "intents",
  "rules",
  "examples",
  "patterns",
  "antiPatterns",
];

function ledgerOf(doc: Record<string, unknown>): BootstrapLedger | undefined {
  const metadata = (doc.metadata ?? {}) as Record<string, unknown>;
  return (metadata["x-bootstrap"] ?? undefined) as BootstrapLedger | undefined;
}

/** Entry-level component states. Empty on v1 ledgers (no per-entry map). */
export async function componentEntryStatuses(doc: Record<string, unknown>): Promise<ComponentEntryStatus[]> {
  const ledger = ledgerOf(doc);
  if (ledger?.ledger !== LEDGER_V2 || ledger.components === undefined) return [];
  const entries = (doc.components ?? {}) as Record<string, unknown>;
  const recorded = ledger.components;
  const tombstones = new Set(ledger.doNotRediscover ?? []);

  const statuses: ComponentEntryStatus[] = [];
  for (const [id, entry] of Object.entries(entries)) {
    const hash = recorded[id];
    const state: ComponentEntryState =
      hash === undefined ? "unattributed" : (await sectionHash(entry)) === hash ? "tool-owned" : "human-owned";
    statuses.push(tombstones.has(id) ? { id, state, alsoTombstoned: true } : { id, state });
  }
  for (const id of Object.keys(recorded)) {
    if (!(id in entries)) statuses.push({ id, state: "orphaned" });
  }
  for (const id of tombstones) {
    if (!(id in entries)) statuses.push({ id, state: "tombstoned" });
  }
  return statuses;
}

export async function ledgerStatus(doc: Record<string, unknown>): Promise<LedgerStatus> {
  const ledger = ledgerOf(doc);
  const generated = ledger?.generated ?? {};
  const componentEntries = await componentEntryStatuses(doc);
  const entryLevel = componentEntries.length > 0 || (ledger?.ledger === LEDGER_V2 && ledger.components !== undefined);

  const sections: SectionStatus[] = [];
  for (const section of REPORTED_SECTIONS) {
    const value = doc[section];
    const recorded = generated[section];
    if (section === "components" && entryLevel && value !== undefined) {
      // v2: the whole-section signal is deliberately omitted whenever any
      // entry is human-owned or any tombstone/orphan exists (so pre-v2
      // tools fail closed). Derive the section state from the entries.
      const allToolOwned =
        componentEntries.length > 0 && componentEntries.every((e) => e.state === "tool-owned" && !e.alsoTombstoned);
      sections.push({ section, state: allToolOwned ? "tool-owned" : "human-owned" });
      continue;
    }
    if (value === undefined) {
      sections.push({ section, state: "absent" });
    } else if (recorded === undefined) {
      sections.push({ section, state: "human-authored" });
    } else {
      const current = await sectionHash(value);
      sections.push({ section, state: current === recorded ? "tool-owned" : "human-owned" });
    }
  }

  return {
    hasLedger: ledger !== undefined,
    entryLevel,
    sections,
    componentEntries,
    awaitingAuthorship: [...(ledger?.awaitingAuthorship ?? [])],
  };
}

/**
 * Guard for saves: a write may never DROP the ledger, and on v2 ledgers it
 * may never WHOLESALE-DROP deletion memory (the per-entry hash map or a
 * non-empty tombstone list). Granular changes are fine — the explicit
 * actions below remove individual records while keeping the structures
 * present; a save that loses the structures entirely is destruction, not
 * a decision. (Editing content is fine — that is how an entry becomes
 * human-owned; deleting provenance is not.)
 */
export function preservesLedger(existing: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
  const had = ledgerOf(existing);
  if (had === undefined) return true;
  const kept = ledgerOf(incoming);
  if (kept === undefined) return false;
  if (had.ledger === LEDGER_V2) {
    if (kept.ledger !== LEDGER_V2) return false;
    if (had.components !== undefined && kept.components === undefined) return false;
    if ((had.doNotRediscover?.length ?? 0) > 0 && kept.doNotRediscover === undefined) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Explicit v2 decisions. Each returns a NEW document; nothing here    */
/* runs without a person clicking the action that names it.            */
/* ------------------------------------------------------------------ */

export type LedgerActionResult = { ok: true; document: Record<string, unknown> } | { ok: false; reason: string };

function withV2Ledger(
  doc: Record<string, unknown>,
  mutate: (ledger: BootstrapLedger) => string | undefined,
): LedgerActionResult {
  const next = structuredClone(doc);
  const ledger = ledgerOf(next);
  if (ledger?.ledger !== LEDGER_V2 || ledger.components === undefined) {
    return { ok: false, reason: "entry-level decisions need a ledger-v2 document (rediscover with dspack-export ≥ 0.5.0 first)" };
  }
  const reason = mutate(ledger);
  return reason === undefined ? { ok: true, document: next } : { ok: false, reason };
}

/**
 * Resolve a deletion by RESTORING: forget the orphaned hash so the next
 * rediscovery re-adds the component as newly discovered, tool-owned. The
 * entry itself comes back from fresh extraction — this tool never invents
 * content, it only clears the memory that was blocking restoration.
 */
export function restoreComponent(doc: Record<string, unknown>, id: string): LedgerActionResult {
  return withV2Ledger(doc, (ledger) => {
    const entries = (doc.components ?? {}) as Record<string, unknown>;
    if (id in entries) return `'${id}' is present in the document; there is no deletion to resolve`;
    if (ledger.components![id] === undefined) return `'${id}' has no orphaned ledger record`;
    delete ledger.components![id];
    return undefined;
  });
}

/**
 * Resolve a deletion by SUPPRESSING: tombstone the id so rediscovery never
 * re-adds it, and retire the orphaned hash (the decision is made).
 */
export function addTombstone(doc: Record<string, unknown>, id: string): LedgerActionResult {
  return withV2Ledger(doc, (ledger) => {
    const list = (ledger.doNotRediscover ??= []);
    if (!list.includes(id)) list.push(id);
    const entries = (doc.components ?? {}) as Record<string, unknown>;
    if (!(id in entries)) delete ledger.components![id];
    return undefined;
  });
}

/** Remove a tombstone: the next rediscovery may re-add the component. */
export function removeTombstone(doc: Record<string, unknown>, id: string): LedgerActionResult {
  return withV2Ledger(doc, (ledger) => {
    const list = ledger.doNotRediscover ?? [];
    const at = list.indexOf(id);
    if (at === -1) return `'${id}' is not tombstoned`;
    list.splice(at, 1);
    return undefined;
  });
}

/* ------------------------------------------------------------------ */
/* freshDelta acceptance. The report's fresh-side facts are review     */
/* information; ACCEPTING one writes it into the human-owned entry.    */
/* Only the two ratified shapes apply: a scalar leaf, or a pure        */
/* addition. Anything else is refused — author the change by hand.     */
/* ------------------------------------------------------------------ */

/** One fresh-side fact from dspack-export's RegenerateReport (shape owned there). */
export interface FreshFact {
  path: string;
  fresh: unknown;
}

const isScalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

/**
 * Apply one accepted fact to a component entry. Supported paths mirror
 * computeFreshDelta in dspack-export:
 *   /name /description /status            scalar leaf replacement
 *   /props/<prop>                          pure addition (descriptor object)
 *   /props/<prop>/values                   pure addition (append new values)
 *   /props/<prop>/(type|default|required)  scalar leaf replacement
 */
export function applyFreshFact(doc: Record<string, unknown>, componentId: string, fact: FreshFact): LedgerActionResult {
  const next = structuredClone(doc);
  const entry = ((next.components ?? {}) as Record<string, Record<string, unknown>>)[componentId];
  if (!entry) return { ok: false, reason: `component '${componentId}' is not in the document` };

  const segments = fact.path.split("/").filter(Boolean);
  if (segments.length === 1 && ["name", "description", "status"].includes(segments[0])) {
    if (!isScalar(fact.fresh)) return { ok: false, reason: `'${fact.path}' is not a scalar leaf` };
    entry[segments[0]] = fact.fresh;
    return { ok: true, document: next };
  }
  if (segments[0] === "props" && segments.length === 2) {
    const props = ((entry.props ??= {}) as Record<string, unknown>);
    if (segments[1] in props) {
      return { ok: false, reason: `prop '${segments[1]}' already exists; accepting would overwrite authored data` };
    }
    props[segments[1]] = fact.fresh;
    return { ok: true, document: next };
  }
  if (segments[0] === "props" && segments.length === 3) {
    const props = (entry.props ?? {}) as Record<string, Record<string, unknown>>;
    const descriptor = props[segments[1]];
    if (!descriptor) return { ok: false, reason: `prop '${segments[1]}' is not in the entry` };
    if (segments[2] === "values") {
      if (!Array.isArray(fact.fresh)) return { ok: false, reason: "a values fact must be a list of added values" };
      if (descriptor.values !== undefined && !Array.isArray(descriptor.values)) {
        return { ok: false, reason: `authored values on '${segments[1]}' is not a list; accepting would replace it — author this change by hand` };
      }
      const current = Array.isArray(descriptor.values) ? descriptor.values : [];
      const known = new Set(current.map((v) => JSON.stringify(v)));
      descriptor.values = [...current, ...fact.fresh.filter((v) => !known.has(JSON.stringify(v)))];
      return { ok: true, document: next };
    }
    if (["type", "default", "required"].includes(segments[2])) {
      if (!isScalar(fact.fresh)) return { ok: false, reason: `'${fact.path}' is not a scalar leaf` };
      descriptor[segments[2]] = fact.fresh;
      return { ok: true, document: next };
    }
  }
  return { ok: false, reason: `unsupported fact path '${fact.path}' — author this change by hand` };
}
