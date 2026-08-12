/**
 * Catalog `Button` -> shadcn/ui Button (vendored button variants, new-york
 * style). The catalog's Astryx-flavored variant vocabulary projects onto
 * shadcn's nearest treatment — the same inverse-mapping duty the Astryx
 * TextRender performs for typography.
 *
 * TWO CATALOGS, TWO ANATOMIES FOR THE CONTENT. The Astryx/neutral catalog
 * carries the button's words in a required `label` string. shadcn/ui v3
 * carries them the way shadcn's own Button does — a required `child`
 * ComponentId pointing at a Text the surface defines separately. Reading only
 * `label` rendered every shadcn/ui v3 button with no text at all, including
 * the "Cancel" on the flagship delete-confirmation surface. Both are honored:
 * a literal label when the catalog gives one, the built child otherwise.
 */
import type { FC } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

/** Catalog variant -> shadcn variant. */
const VARIANT: Record<string, "default" | "secondary" | "ghost" | "destructive"> = {
  primary: "default",
  secondary: "secondary",
  ghost: "ghost",
  destructive: "destructive",
};
const SIZE: Record<string, "default" | "sm" | "lg"> = { sm: "sm", md: "default", lg: "lg" };

export const ButtonRender: FC<any> = ({ props, buildChild }) => (
  <button
    type="button"
    className={cn(buttonVariants({ variant: VARIANT[props.variant as string] ?? "default", size: SIZE[props.size as string] ?? "default" }))}
    disabled={Boolean(props.isDisabled)}
    title={props.tooltip}
    onClick={() => props.action?.()}
  >
    {props.label != null
      ? String(props.label)
      : typeof props.child === "string"
        ? buildChild?.(props.child)
        : null}
  </button>
);
