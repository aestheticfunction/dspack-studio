/**
 * The Appearance preference (af-site CANON §2c): a choice of governed themes,
 * named as a preference, never as a demo. Composer ships the Aesthetic Function
 * appearance; Ember and Slate are the other governed themes, all dark-scheme so
 * the rendered design-system canvases are never re-tinted. Persisted so the
 * choice survives a reload; applied to <html data-theme>.
 */
export const THEMES = [
  { id: "default", label: "Aesthetic Function" },
  { id: "ember", label: "Ember" },
  { id: "slate", label: "Slate" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const KEY = "composer.appearance.v1";

export function getStoredTheme(): ThemeId {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v && THEMES.some((t) => t.id === v)) return v as ThemeId;
  } catch {
    /* no storage: the default appearance */
  }
  return "default";
}

export function applyTheme(id: ThemeId): void {
  try {
    const root = document.documentElement;
    if (id === "default") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", id);
    window.localStorage.setItem(KEY, id);
  } catch {
    /* presentation-only; never a correctness dependency */
  }
}
