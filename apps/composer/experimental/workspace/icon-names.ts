/**
 * The names of the workspace's icons (icons.tsx draws them). Kept apart from the drawings so that coverage can be
 * checked without rendering: every contract component and both structural kinds must have a glyph of their own.
 */
export const ICON_NAMES = [
  // What it is: component types.
  "text", "badge", "button", "text-input", "card", "selectable-card", "list", "table", "metadata-list", "dialog", "alert-dialog", "dropdown-menu", "column", "unknown",
  // How it behaves: structure.
  "repeat", "condition",
  // What it carries: data and interaction.
  "bound", "typed", "private", "sends", "confirms",
  // What a designer can do: editing.
  "add", "up", "down", "move-to", "remove", "undo", "redo", "more", "chevron", "check",
  // The view controls.
  "select", "fit", "panel-left", "panel-right", "panels-both",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** The glyph for a contract component, with a dashed square for anything not yet mapped. */
export function componentIcon(component: string | undefined): IconName {
  return component && (ICON_NAMES as readonly string[]).includes(component) ? (component as IconName) : "unknown";
}
