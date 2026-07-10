/**
 * Catalog `Card` -> Astryx Card. The catalog's variant vocabulary
 * (outlined/elevated/filled, from the contract) predates Astryx v0.1.4's
 * Card variants (default/muted/colors) — a drift-check finding. Projection:
 * outlined/elevated -> default, filled -> muted.
 */
import type { FC } from "react";
import { Card } from "@astryxdesign/core/Card";

const VARIANT: Record<string, "default" | "muted"> = {
  outlined: "default",
  elevated: "default",
  filled: "muted",
};

export const CardRender: FC<any> = ({ props, buildChild }) => (
  <Card variant={VARIANT[props.variant as string] ?? "default"}>
    {props.child ? buildChild(props.child) : null}
  </Card>
);
