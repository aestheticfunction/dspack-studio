/**
 * The theme dial (FM-5): every prebuilt Astryx theme, importable as built
 * theme objects for runtime switching via <Theme theme={...} mode={...}>.
 * Each theme's generated CSS (scoped by [data-astryx-theme="<name>"]) must be
 * imported by the app alongside these objects. The surface's structure never
 * changes when the theme does — that is the point being demonstrated.
 */
import { butterTheme } from "@astryxdesign/theme-butter/built";
import { chocolateTheme } from "@astryxdesign/theme-chocolate/built";
import { gothicTheme } from "@astryxdesign/theme-gothic/built";
import { matchaTheme } from "@astryxdesign/theme-matcha/built";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { stoneTheme } from "@astryxdesign/theme-stone/built";
import { y2kTheme } from "@astryxdesign/theme-y2k/built";

export const themes = {
  default: null, // core styles without an override theme
  neutral: neutralTheme,
  stone: stoneTheme,
  butter: butterTheme,
  chocolate: chocolateTheme,
  matcha: matchaTheme,
  gothic: gothicTheme,
  y2k: y2kTheme,
} as const;

export type ThemeName = keyof typeof themes;
export const themeNames = Object.keys(themes) as ThemeName[];
