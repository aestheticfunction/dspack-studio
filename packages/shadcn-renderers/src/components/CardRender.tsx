/**
 * Catalog `Card` -> shadcn/ui Card markup. shadcn cards are token-neutral, so
 * the catalog's color variants are projected onto shadcn's accented-surface
 * idiom (token card plus a Tailwind color tint) in `surface-variants.ts` —
 * every catalog value keeps its own treatment rather than collapsing onto the
 * default background.
 */
import type { FC } from "react";
import { cn } from "../cn";
import { surfaceVariant } from "../surface-variants";

export const CardRender: FC<any> = ({ props, buildChild }) => (
  <div
    className={cn(
      "rounded-xl border text-card-foreground shadow p-6",
      surfaceVariant(props.variant),
    )}
  >
    {props.child ? buildChild(props.child) : null}
  </div>
);
