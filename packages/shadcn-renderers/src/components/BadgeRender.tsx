/**
 * Catalog `Badge` -> shadcn/ui Badge.
 *
 * The catalog carries fourteen variants: five status meanings plus nine
 * categorical colors. shadcn ships four badge treatments, so the projection is
 * shadcn's four canonical variants for the meanings that map onto them, plus
 * shadcn's documented "badge with an explicit color class" idiom for the rest.
 * Every catalog value keeps a treatment of its own: collapsing `success` onto
 * `info`, or the nine colors onto one outline, would accept the vocabulary and
 * then discard the distinction the surface was emitted to carry.
 *
 * Alpha tints (`/15`, `/40`) rather than fixed 50/950 steps: this package's
 * theme switches on `[data-mode="dark"]`, not Tailwind's `dark:` variant, and
 * a tint reads correctly under both modes from one rule.
 */
import type { FC } from "react";
import { cn } from "../cn";

const BASE =
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors w-fit";

/** Catalog variant -> shadcn treatment. Catalog default: neutral. */
const VARIANT: Record<string, string> = {
  // Status meanings: shadcn's own filled treatments.
  neutral: "border-transparent bg-secondary text-secondary-foreground",
  info: "border-transparent bg-primary text-primary-foreground shadow",
  success: "border-transparent bg-emerald-600 text-white shadow",
  warning: "border-transparent bg-amber-500 text-zinc-950 shadow",
  error: "border-transparent bg-destructive text-destructive-foreground shadow",
  // Categorical colors: outline treatment, tinted per color.
  blue: "border-blue-500/40 bg-blue-500/15 text-blue-700",
  cyan: "border-cyan-500/40 bg-cyan-500/15 text-cyan-700",
  green: "border-green-500/40 bg-green-500/15 text-green-700",
  orange: "border-orange-500/40 bg-orange-500/15 text-orange-700",
  pink: "border-pink-500/40 bg-pink-500/15 text-pink-700",
  purple: "border-purple-500/40 bg-purple-500/15 text-purple-700",
  red: "border-red-500/40 bg-red-500/15 text-red-700",
  teal: "border-teal-500/40 bg-teal-500/15 text-teal-700",
  yellow: "border-yellow-500/40 bg-yellow-500/15 text-yellow-700",
};

export const BadgeRender: FC<any> = ({ props }) => (
  <span className={cn(BASE, VARIANT[props.variant as string] ?? VARIANT.neutral)}>
    {String(props.label ?? "")}
  </span>
);
