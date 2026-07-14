/**
 * Catalog `Badge` -> shadcn/ui Badge. The catalog's fourteen Astryx variants
 * project onto shadcn's four treatments by meaning: error/red -> destructive,
 * neutral/gray tones -> secondary, everything colorful -> outline with the
 * label verbatim (shadcn badges are token-colored, not rainbow-colored).
 */
import type { FC } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors w-fit",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground shadow",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

const VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  neutral: "secondary",
  info: "default",
  success: "default",
  warning: "outline",
  error: "destructive",
  red: "destructive",
  blue: "outline",
  cyan: "outline",
  green: "outline",
  orange: "outline",
  pink: "outline",
  purple: "outline",
  teal: "outline",
  yellow: "outline",
};

export const BadgeRender: FC<any> = ({ props }) => (
  <span className={cn(badgeVariants({ variant: VARIANT[props.variant as string] ?? "default" }))}>
    {String(props.label ?? "")}
  </span>
);
