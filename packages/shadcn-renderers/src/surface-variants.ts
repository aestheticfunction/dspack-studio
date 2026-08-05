/**
 * The catalog's surface-background vocabulary (Card and SelectableCard share
 * it) projected onto shadcn/ui's idiom.
 *
 * shadcn's own cards are token-neutral, so the color variants are expressed
 * the way shadcn's docs express an accented surface: the token card
 * background plus an explicit Tailwind color tint. Alpha tints (`/10`, `/30`)
 * are used rather than fixed 50/950 steps because this package's theme is
 * switched by `[data-mode="dark"]`, not by Tailwind's `dark:` variant — a
 * tint reads correctly under both modes without a second rule.
 *
 * Every catalog value gets its OWN treatment. Collapsing the color variants
 * onto the default background would accept the vocabulary and then throw the
 * distinction away, which is exactly the drift `emitted-prop-parity.test.tsx`
 * exists to catch.
 */
export const SURFACE_VARIANT: Record<string, string> = {
  default: "bg-card",
  muted: "bg-secondary",
  transparent: "bg-transparent shadow-none",
  gray: "bg-zinc-500/10 border-zinc-500/30",
  blue: "bg-blue-500/10 border-blue-500/30",
  cyan: "bg-cyan-500/10 border-cyan-500/30",
  green: "bg-green-500/10 border-green-500/30",
  orange: "bg-orange-500/10 border-orange-500/30",
  pink: "bg-pink-500/10 border-pink-500/30",
  purple: "bg-purple-500/10 border-purple-500/30",
  red: "bg-red-500/10 border-red-500/30",
  teal: "bg-teal-500/10 border-teal-500/30",
  yellow: "bg-yellow-500/10 border-yellow-500/30",
};

/** Catalog default for both components' `variant` is `default`. */
export const surfaceVariant = (variant: unknown): string =>
  SURFACE_VARIANT[variant as string] ?? SURFACE_VARIANT.default;
