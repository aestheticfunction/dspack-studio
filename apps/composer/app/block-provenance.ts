/**
 * Interface blocks (experimental): the per-project provenance store.
 *
 * The flows.ts idiom: one localStorage key per project, a quota-honest
 * boolean save, and an empty map REMOVES the key. This module holds OPAQUE
 * data and imports no block code, so it may live in the default bundle;
 * what the data means is read and validated only by experimental builds
 * (docs/BLOCKS.md, ADR-B5). Repository projects never have any: the agent
 * owns their files.
 */

const KEY_PREFIX = "composer.project.blocks.";

export const blockProvenanceKey = (projectId: string): string => `${KEY_PREFIX}${projectId}`;

/** localStorage is absent during static prerender and in locked-down browsers. */
function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadBlockProvenance(projectId: string): Record<string, unknown> {
  const s = storage();
  if (!s) return {};
  try {
    const raw = s.getItem(blockProvenanceKey(projectId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function saveBlockProvenance(projectId: string, map: Record<string, unknown>): boolean {
  const s = storage();
  if (!s) return false;
  try {
    if (Object.keys(map).length === 0) {
      s.removeItem(blockProvenanceKey(projectId));
      return true;
    }
    s.setItem(blockProvenanceKey(projectId), JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

export function removeBlockProvenance(projectId: string): void {
  try {
    storage()?.removeItem(blockProvenanceKey(projectId));
  } catch {
    /* nothing to remove */
  }
}
