/**
 * Semantic parity (ADR-B3): a committed per-prompt structural checklist
 * scored identically for every arm. Labels are case-insensitive substrings
 * that must appear in the surface's text (text nodes, string props, and the
 * strings arrays hold); components are contract component names that must
 * appear.
 */
import type { ParityResult } from "./types";

type Json = Record<string, any>;

/** Keys whose strings name structure, not content: never read. */
const STRUCTURE_KEYS = new Set(["component", "id", "dspackSurface", "system", "intent"]);

/** Every string the surface shows: its text nodes, its string props, and the strings an array holds (an Astryx
    table's column labels and row cells), each read under the key its array is under. */
export function surfaceTexts(surface: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown, key?: string) => {
    if (typeof node === "string") {
      if (key === undefined || !STRUCTURE_KEYS.has(key)) out.push(node);
      return;
    }
    if (Array.isArray(node)) return node.forEach((item) => walk(item, key));
    if (!node || typeof node !== "object") return;
    const record = node as Json;
    if (typeof record.text === "string") out.push(record.text);
    for (const [k, value] of Object.entries(record)) {
      if (k !== "text") walk(value, k);
    }
  };
  walk((surface as Json)?.root ?? surface);
  return out;
}

export function surfaceComponents(surface: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const record = node as Json;
    if (typeof record.component === "string") out.add(record.component);
    for (const value of Object.values(record)) if (value && typeof value === "object") walk(value);
  };
  walk((surface as Json)?.root ?? surface);
  return out;
}

export function checkParity(surface: unknown, checklist: { labels: readonly string[]; components: readonly string[] }): ParityResult {
  const haystack = surfaceTexts(surface).join("\n").toLowerCase();
  const components = surfaceComponents(surface);
  const satisfied: string[] = [];
  const missing: string[] = [];
  for (const label of checklist.labels) (haystack.includes(label.toLowerCase()) ? satisfied : missing).push(`label:${label}`);
  for (const c of checklist.components) (components.has(c) ? satisfied : missing).push(`component:${c}`);
  const total = satisfied.length + missing.length;
  return { score: total === 0 ? 1 : satisfied.length / total, satisfied, missing };
}
