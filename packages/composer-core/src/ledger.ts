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

export interface LedgerStatus {
  /** True when metadata["x-bootstrap"] exists (bootstrap provenance available). */
  hasLedger: boolean;
  sections: SectionStatus[];
  /** The authorship todo list, verbatim from the ledger. */
  awaitingAuthorship: string[];
}

interface BootstrapLedger {
  spec?: string;
  generated?: Record<string, string>;
  awaitingAuthorship?: string[];
}

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

export async function ledgerStatus(doc: Record<string, unknown>): Promise<LedgerStatus> {
  const metadata = (doc.metadata ?? {}) as Record<string, unknown>;
  const ledger = (metadata["x-bootstrap"] ?? undefined) as BootstrapLedger | undefined;
  const generated = ledger?.generated ?? {};

  const sections: SectionStatus[] = [];
  for (const section of REPORTED_SECTIONS) {
    const value = doc[section];
    const recorded = generated[section];
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
    sections,
    awaitingAuthorship: [...(ledger?.awaitingAuthorship ?? [])],
  };
}

/**
 * Guard for saves: a write may never DROP the ledger. (Editing content is
 * fine — that is how a section becomes human-owned; deleting the provenance
 * record is not.)
 */
export function preservesLedger(existing: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
  const had = ((existing.metadata ?? {}) as Record<string, unknown>)["x-bootstrap"] !== undefined;
  if (!had) return true;
  return ((incoming.metadata ?? {}) as Record<string, unknown>)["x-bootstrap"] !== undefined;
}
