/**
 * Catalog `Card` -> Astryx Card. The catalog's variant vocabulary is carried
 * verbatim from the contract (Astryx v0.1.4: default/muted plus the color
 * variants), so the projection is identity with a safe fallback.
 */
import type { FC } from "react";
import { Card } from "@astryxdesign/core/Card";

const VARIANTS = new Set([
  "default", "muted",
  "blue", "cyan", "gray", "green", "orange", "pink", "purple", "red", "teal", "yellow",
]);

export const CardRender: FC<any> = ({ props, buildChild }) => (
  <Card variant={VARIANTS.has(props.variant as string) ? (props.variant as any) : "default"}>
    {props.child ? buildChild(props.child) : null}
  </Card>
);
