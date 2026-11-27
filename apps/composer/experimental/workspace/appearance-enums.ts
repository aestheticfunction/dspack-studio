/**
 * The closed vocabulary of a stored workspace appearance (experimental; T4), kept apart from the compiler so the
 * storage validator can check a record without loading it. appearance.test.ts holds these lists equal to the
 * shared compiler's own schema and option enums, so the two cannot drift.
 */
export const BASES = ["default", "ember", "slate", "neutral-dark", "neutral-light", "custom"] as const;
export type Base = (typeof BASES)[number];

/** The compiler's own vocabulary for a custom appearance (a subset of theme-direction v1: no hue nudge, voice or tracking choice). */
export const CUSTOM_ENUMS = {
  scheme: ["dark", "light"],
  surfaceHue: ["neutral", "olive", "sage", "green", "teal", "cyan", "sky", "blue", "indigo", "violet", "magenta", "rose", "red", "ember", "amber", "gold"],
  tint: ["none", "whisper", "tinted", "saturated"],
  depth: ["abyss", "deep", "dim", "dusk"],
  warmth: ["cool", "neutral", "warm"],
  contrast: ["soft", "standard", "stark"],
  accentHue: ["olive", "sage", "green", "teal", "cyan", "sky", "blue", "indigo", "violet", "magenta", "rose", "red", "ember", "amber", "gold"],
  chroma: ["muted", "soft", "clear", "vivid", "electric"],
  presence: ["recede", "balance", "carry"],
  weight: ["light", "regular", "medium", "semibold", "bold"],
  elevation: ["flat", "soft", "standard", "dramatic"],
} as const;

type E<K extends keyof typeof CUSTOM_ENUMS> = (typeof CUSTOM_ENUMS)[K][number];
export interface CustomDirection {
  scheme: E<"scheme">;
  surfaceHue: E<"surfaceHue">;
  tint: E<"tint">;
  depth: E<"depth">;
  warmth: E<"warmth">;
  contrast: E<"contrast">;
  accentHue: E<"accentHue">;
  chroma: E<"chroma">;
  presence: E<"presence">;
  weight: E<"weight">;
  elevation: E<"elevation">;
}


export const WORKSPACE_ENUMS = {
  density: ["comfortable", "compact"],
  textScale: ["standard", "large"],
  labelCase: ["sentence", "capitals"],
  display: ["brand", "plain"],
  surround: ["workspace", "light", "dark"],
} as const;

export interface AppearanceRecord {
  base: Base;
  /** The custom direction, kept even while another base is chosen so returning to Custom restores it. */
  custom: CustomDirection;
  workspace: { [K in keyof typeof WORKSPACE_ENUMS]: (typeof WORKSPACE_ENUMS)[K][number] };
}
