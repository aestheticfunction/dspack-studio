import type { Metadata } from "next";
import type { ReactNode } from "react";
// shadcn canvas styles are Tailwind-compiled and scoped under
// [data-design-system="shadcn"]; Astryx's @astryxdesign/core styles are @layer'd
// (like apps/web), so the AF brand layer (globals.css, shared transcription with
// apps/web) — imported LAST and unlayered — wins over both and styles the
// composer chrome only. Each design system's visuals reach only its own
// preview canvas.
import "@dspack-studio/shadcn-renderers/styles.css";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "./globals.css";
import { fontVariables } from "./fonts";

export const metadata: Metadata = {
  title: "Catalog Composer · Aesthetic Function Studio",
  description:
    "Create and maintain a project-specific A2UI component catalog: connect a project, enrich its discovered contract, map it through a data profile, preview the emitted catalog, and validate the governed artifacts.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
