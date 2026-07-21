"use client";

/**
 * FM-10: the design system is a plug-in, selected at the shell level. The
 * canvas everywhere (replay, live, break, restyle) renders through the
 * selected registry; the catalog, the events, the gates, and the receipt
 * are untouched by the choice — that invariance is asserted by e2e
 * (receipt hash identical across design systems).
 *
 * `wrapperProps` scopes each design system's theming to the canvas: the
 * shadcn styles are CSS-variable-scoped under [data-design-system="shadcn"]
 * and never leak into the studio shell.
 */
import { createContext, useContext } from "react";
import type { Registry } from "@dspack-studio/a2ui-ingest";
import { astryxRegistry } from "@dspack-studio/astryx-renderers";
import { shadcnRegistry } from "@dspack-studio/shadcn-renderers";
import "@dspack-studio/shadcn-renderers/styles.css";

export type DesignSystemId = "astryx" | "shadcn";

export interface DesignSystemDef {
  id: DesignSystemId;
  label: string;
  registry: Registry;
  /** One honest sentence about this system's coverage. */
  note: string;
}

export const DESIGN_SYSTEMS: Record<DesignSystemId, DesignSystemDef> = {
  astryx: {
    id: "astryx",
    label: "Astryx",
    registry: astryxRegistry,
    note: "All 12 catalog components render through @astryxdesign/core, with 8 runtime themes.",
  },
  shadcn: {
    id: "shadcn",
    label: "shadcn/ui",
    registry: shadcnRegistry,
    note: "11 of 12 catalog components render through vendored shadcn/ui visuals; Dialog shows the unimplemented placeholder (incremental adoption, stated plainly).",
  },
};

export const designSystemIds = Object.keys(DESIGN_SYSTEMS) as DesignSystemId[];

export const DesignSystemContext = createContext<DesignSystemId>("astryx");
export const useDesignSystem = (): DesignSystemDef => DESIGN_SYSTEMS[useContext(DesignSystemContext)];

/** Attributes for the canvas wrapper so the active system's theming applies. */
export function canvasScopeProps(id: DesignSystemId, mode: "light" | "dark" = "light") {
  return id === "shadcn" ? { "data-design-system": "shadcn", "data-mode": mode } : {};
}
