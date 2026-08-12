/**
 * The Aesthetic Function type set (matches af-site/assets/af.css): Oswald
 * for headlines, IBM Plex Sans for body, IBM Plex Mono for labels and
 * buttons, Jost for the wordmark.
 *
 * These were `next/font/google` declarations. Next self-hosted the result, so
 * nothing was fetched at runtime — but the BUILD downloaded every face from
 * fonts.gstatic.com, so a CDN hiccup failed the build outright and blocked
 * merges and deploys. The faces now come from committed .woff2 files in
 * packages/fonts, which no build has to go to the network for.
 *
 * The files there are the exact bytes Google was already serving this repo, and
 * the descriptors below reproduce the @font-face rules those declarations
 * generated — same weights, same styles, same font-display, same CSS variable
 * names. See packages/fonts/README.md for provenance, subset and licensing.
 *
 * `adjustFontFallback: false` + an explicit `fallback` is not a change of
 * fallback, it is what keeps the fallback the same: next/font/local would
 * recompute the metric-matched face from our subset files and land on slightly
 * different numbers. packages/fonts/fallbacks.css pins the faces at the values
 * next/font/google emitted, and is imported here so the declarations and the
 * faces they name travel together.
 */
import localFont from "next/font/local";

import "../../../packages/fonts/fallbacks.css";

export const oswald = localFont({
  src: [{ path: "../../../packages/fonts/files/oswald-600-latin.woff2", weight: "600", style: "normal" }],
  variable: "--font-oswald",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Oswald Fallback"],
});

// One variable file (wght 100..700) serves all three weights, exactly as the
// single file Google served for all three did.
export const plexSans = localFont({
  src: [
    { path: "../../../packages/fonts/files/ibm-plex-sans-variable-latin.woff2", weight: "400", style: "normal" },
    { path: "../../../packages/fonts/files/ibm-plex-sans-variable-latin.woff2", weight: "500", style: "normal" },
    { path: "../../../packages/fonts/files/ibm-plex-sans-variable-latin.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["IBM Plex Sans Fallback"],
});

export const plexMono = localFont({
  src: [
    { path: "../../../packages/fonts/files/ibm-plex-mono-400-latin.woff2", weight: "400", style: "normal" },
    { path: "../../../packages/fonts/files/ibm-plex-mono-500-latin.woff2", weight: "500", style: "normal" },
    { path: "../../../packages/fonts/files/ibm-plex-mono-600-latin.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["IBM Plex Mono Fallback"],
});

export const jost = localFont({
  src: [{ path: "../../../packages/fonts/files/jost-400-latin.woff2", weight: "400", style: "normal" }],
  variable: "--font-jost",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Jost Fallback"],
});

export const fontVariables = [
  oswald.variable,
  plexSans.variable,
  plexMono.variable,
  jost.variable,
].join(" ");
