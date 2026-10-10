/**
 * Interface blocks (experimental): the opt-in preference.
 *
 * `composer.experimental.v1 = { blocks: boolean }`, default false, in the
 * providers.ts storage idiom. Both functions do nothing unless this is an
 * experimental build: the literal check is what Next folds away, so a
 * default build never reads the key, and a seeded key changes nothing there.
 */

export interface ExperimentalPreferences {
  blocks: boolean;
}

const KEY = "composer.experimental.v1";
export const DEFAULT_EXPERIMENTAL: ExperimentalPreferences = { blocks: false };

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadExperimental(): ExperimentalPreferences {
  if (process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL !== "1") return DEFAULT_EXPERIMENTAL;
  const s = storage();
  if (!s) return DEFAULT_EXPERIMENTAL;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return DEFAULT_EXPERIMENTAL;
    const parsed = JSON.parse(raw) as Partial<ExperimentalPreferences> | null;
    return { blocks: parsed?.blocks === true };
  } catch {
    return DEFAULT_EXPERIMENTAL;
  }
}

export function saveExperimental(next: ExperimentalPreferences): void {
  if (process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL !== "1") return;
  try {
    storage()?.setItem(KEY, JSON.stringify({ blocks: next.blocks === true }));
  } catch {
    /* quota or locked-down storage: the preference is session-only */
  }
}
