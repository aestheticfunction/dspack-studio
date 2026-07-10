import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
// Built themes are class-scoped CSS + a theme object handed to <Theme>; the
// stylesheets must be present for the object to have any effect.
import "@astryxdesign/theme-butter/theme.css";
import "@astryxdesign/theme-chocolate/theme.css";
import "@astryxdesign/theme-gothic/theme.css";
import "@astryxdesign/theme-matcha/theme.css";
import "@astryxdesign/theme-neutral/theme.css";
import "@astryxdesign/theme-stone/theme.css";
import "@astryxdesign/theme-y2k/theme.css";

export const metadata: Metadata = {
  title: "dspack-studio",
  description:
    "Governed generative UI, live: an AI agent builds interfaces under a design-system contract, streamed over AG-UI as A2UI surfaces, rendered with Astryx.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
