/**
 * Catalog `Card` -> shadcn/ui Card markup. The catalog's Astryx color
 * variants have no shadcn equivalent (shadcn cards are token-neutral); the
 * projection keeps `muted` (secondary background) and renders every color
 * variant on the token background — vocabulary accepted, treatment native
 * to this design system.
 */
import type { FC } from "react";
import { cn } from "../cn";

export const CardRender: FC<any> = ({ props, buildChild }) => (
  <div className={cn("rounded-xl border bg-card text-card-foreground shadow p-6", props.variant === "muted" && "bg-secondary")}>
    {props.child ? buildChild(props.child) : null}
  </div>
);
