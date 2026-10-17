/**
 * Catalog `Badge` -> Astryx Badge. All fourteen variants carry verbatim.
 *
 * Astryx draws a badge on one line at a fixed height; a long label (a
 * guide's "label: detail" fact) then runs out of its container at 200% zoom
 * and 320 px. Here the label wraps inside the badge (WCAG 1.4.10), and a
 * one-line badge keeps Astryx's height.
 */
import type { CSSProperties, FC } from "react";
import { Badge } from "@astryxdesign/core/Badge";

export const BADGE_WRAP: CSSProperties = {
  whiteSpace: "normal",
  height: "auto",
  minHeight: "var(--spacing-5, 20px)",
  maxWidth: "100%",
  overflowWrap: "anywhere",
};

export const BadgeRender: FC<any> = ({ props }) => (
  <Badge label={String(props.label ?? "")} variant={props.variant} style={BADGE_WRAP} />
);
