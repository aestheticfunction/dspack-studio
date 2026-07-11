/**
 * Shared chrome styling helpers. The AF button/link language lives as CSS
 * classes in globals.css (hover and focus need real pseudo-classes); these
 * helpers keep call sites one-attribute swaps from the old inline factories.
 */
import type { CSSProperties } from "react";

export const btnClass = (active = false, dashed = false): string =>
  ["st-btn", active && "st-btn--active", dashed && "st-btn--dashed"].filter(Boolean).join(" ");

export const linkClass = "st-link";

export const mono: CSSProperties = { fontFamily: "var(--mono)", fontSize: 12 };
