/**
 * The workspace's icons (experimental authoring): one 16 × 16 grid, a 1.4 px stroke with round caps and joins,
 * drawn in currentColor so every appearance colours them without a palette of their own. The vocabulary is the
 * independent authoring review's, in four layers that are never mixed:
 *
 * - what an element is (its component type) leads a Structure row;
 * - how it behaves structurally (repeat, condition) replaces the type glyph on those rows;
 * - what it carries (data, typed input, private, sends, confirms) trails the label;
 * - what a designer can do (add, move, remove, undo, ...) lives in the toolbars.
 *
 * Icons are decorative: the control or row they sit in carries the name. They are sized in CSS from the text-size
 * choice (--cl-type), so they grow with the text. No icon dependency.
 */
import type { ReactNode } from "react";
import type { IconName } from "./icon-names";

export { componentIcon, type IconName } from "./icon-names";

const dot = { strokeWidth: 2 } as const;

/** Inner markup per glyph, on a 16 × 16 view box. */
export const GLYPHS = {
  // What it is: component types.
  text: <path d="M3.5 4.4V3.5h9v.9M8 3.5v9M6.4 12.5h3.2" />,
  badge: (
    <>
      <rect x="2" y="5.25" width="12" height="5.5" rx="2.75" />
      <circle cx="5" cy="8" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  button: (
    <>
      <rect x="1.5" y="2.5" width="13" height="6" rx="2" />
      <path d="M9.4 9.8l4.1 1.7-1.7.6-.6 1.7z" />
    </>
  ),
  "text-input": (
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
      <path d="M4.5 6.5v3" />
    </>
  ),
  card: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M4.8 6h6.4M4.8 9h4" />
    </>
  ),
  "selectable-card": (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <circle cx="5.6" cy="8" r="1.7" />
      <path d="M9.2 8h2.4" />
    </>
  ),
  list: (
    <>
      <path d="M6 4h7.5M6 8h7.5M6 12h7.5" />
      <path d="M2.8 4h.01M2.8 8h.01M2.8 12h.01" {...dot} />
    </>
  ),
  table: (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M1.5 6.3h13M6 6.3v7.2" />
    </>
  ),
  "metadata-list": <path d="M2.5 4.5h2.8M7.8 4.5h5.7M2.5 8h2.8M7.8 8h5.7M2.5 11.5h2.8M7.8 11.5h3.6" />,
  dialog: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6.2h12" />
      <path d="M11.4 4.6h.01" strokeWidth={1.8} />
    </>
  ),
  "alert-dialog": (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M8 5.6v3.2" />
      <path d="M8 10.7h.01" strokeWidth={1.8} />
    </>
  ),
  "dropdown-menu": (
    <>
      <rect x="1.5" y="2.5" width="13" height="4.5" rx="1.5" />
      <path d="M10.3 4.2l1.1 1.1 1.1-1.1M3 10h10M3 13h6.5" />
    </>
  ),
  column: (
    <>
      <rect x="3" y="2.5" width="10" height="4.5" rx="1" />
      <rect x="3" y="9" width="10" height="4.5" rx="1" />
    </>
  ),
  unknown: <rect x="3" y="3" width="10" height="10" rx="1.5" strokeDasharray="2 2" />,
  // How it behaves: structure.
  repeat: <path d="M3 7.2A5 5 0 0 1 12 4.6M12.4 2.4v2.4H10M13 8.8A5 5 0 0 1 4 11.4M3.6 13.6v-2.4H6" />,
  condition: <path d="M8 2.2L13.8 8 8 13.8 2.2 8z" />,
  // What it carries: data and interaction.
  bound: <path d="M6.2 2.8c-1.4 0-1.9.6-1.9 1.8v1.5c0 .9-.5 1.5-1.5 1.9 1 .4 1.5 1 1.5 1.9v1.5c0 1.2.5 1.8 1.9 1.8M9.8 2.8c1.4 0 1.9.6 1.9 1.8v1.5c0 .9.5 1.5 1.5 1.9-1 .4-1.5 1-1.5 1.9v1.5c0 1.2-.5 1.8-1.9 1.8" />,
  typed: <path d="M8 3.4v9.2M6 3h4M6 13h4" />,
  private: (
    <>
      <rect x="3.5" y="7.2" width="9" height="6" rx="1.2" />
      <path d="M5.5 7.2V5.6a2.5 2.5 0 0 1 5 0v1.6" />
    </>
  ),
  sends: <path d="M9.2 1.8L3.8 9h3.7l-.7 5.2L12.2 7H8.5z" />,
  confirms: (
    <>
      <path d="M8 1.8l4.8 1.8v3.8c0 2.9-1.9 5.2-4.8 6.4-2.9-1.2-4.8-3.5-4.8-6.4V3.6z" />
      <path d="M5.9 7.8l1.5 1.5 2.7-2.9" />
    </>
  ),
  // What a designer can do: editing.
  add: <path d="M8 3v10M3 8h10" />,
  up: <path d="M8 13V3.4M4 7.2l4-3.8 4 3.8" />,
  down: <path d="M8 3v9.6M4 8.8l4 3.8 4-3.8" />,
  "move-to": <path d="M2 8h7.2M6.6 5.2L9.4 8l-2.8 2.8M11.2 2.8h2.3v10.4h-2.3" />,
  remove: <path d="M2.8 4.4h10.4M6.2 4.4V2.9h3.6v1.5M4.2 4.4l.6 8.7h6.4l.6-8.7M6.7 7v3.8M9.3 7v3.8" />,
  undo: <path d="M5.8 3.6l-3 3 3 3M3 6.6h6.2a3.4 3.4 0 0 1 0 6.8H6.4" />,
  redo: <path d="M10.2 3.6l3 3-3 3M13 6.6H6.8a3.4 3.4 0 0 0 0 6.8h2.8" />,
  more: <path d="M3.4 8h.01M8 8h.01M12.6 8h.01" strokeWidth={2.2} />,
  chevron: <path d="M6 3.8L10.2 8 6 12.2" />,
  check: <path d="M3 8.4l3.2 3.2L13 4.6" />,
  // The view controls the workspace already had.
  select: <path d="M3 2.5l9 5-4 1-2 4.5z" />,
  fit: (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M4 8h8M4 8l2-2M4 8l2 2M12 8l-2-2M12 8l-2 2" />
    </>
  ),
  "panel-left": (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M6 2.5v11" />
    </>
  ),
  "panel-right": (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M10 2.5v11" />
    </>
  ),
  "panels-both": (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M5.5 2.5v11M10.5 2.5v11" />
    </>
  ),
} satisfies Record<IconName, ReactNode>;

/** One icon: decorative, sized by the stylesheet (.cl-icon) so it follows the text-size choice. */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={`cl-icon${className ? ` ${className}` : ""}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon={name}>
      {GLYPHS[name]}
    </svg>
  );
}
