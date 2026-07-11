/**
 * The Aesthetic Function type set (matches af-site/assets/af.css): Oswald
 * for headlines, IBM Plex Sans for body, IBM Plex Mono for labels and
 * buttons, Jost for the wordmark. next/font downloads at build time and
 * self-hosts under _next/static/media — no runtime request to Google, so
 * the production smoke suite's clean-network check is unaffected.
 */
import { IBM_Plex_Mono, IBM_Plex_Sans, Jost, Oswald } from "next/font/google";

export const oswald = Oswald({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-oswald",
  display: "swap",
});

export const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const jost = Jost({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-jost",
  display: "swap",
});

export const fontVariables = [
  oswald.variable,
  plexSans.variable,
  plexMono.variable,
  jost.variable,
].join(" ");
