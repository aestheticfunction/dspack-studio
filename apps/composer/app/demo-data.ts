/**
 * The packaged reference design systems — the governed vocabularies a project
 * can start from, and the material behind the hub's Examples section.
 *
 * A user project takes a reference as its BASE (contract + profile + worked
 * examples as internal generation/teaching context) and owns its authored
 * delta on top; the canonical reference is never mutated. Both references
 * traverse ONE goal-first pipeline with no design-system-specific code path:
 *
 *   - shadcn/ui v3 — the default. The production v3 contract (34 components)
 *     through a v1-language profile; 27 A2UI components, 14 worked examples.
 *     Rendered natively where a shadcn visual exists, else the per-component
 *     wireframe fallback (registries.ts).
 *   - Astryx — proving the pipeline is design-system agnostic: 12 components,
 *     6 governed intents, full native coverage via @astryxdesign/core.
 *
 * Live authoring on real files still requires the local agent; the app states
 * that plainly wherever it applies.
 */
import shadcnContract from "../shadcn-v3-project/shadcn-ui.dspack.json";
import shadcnProfile from "../shadcn-v3-project/shadcn-v3.profile.json";
import shadcnManifest from "../shadcn-v3-project/project.json";
import astryxContract from "../astryx-project/astryx.dspack.json";
import astryxProfile from "../astryx-project/astryx.profile.json";
import astryxManifest from "../astryx-project/project.json";

/** One packaged governed design system the composer can start a project from. */
export interface Reference {
  /** Stable id the composer loads the reference by. */
  id: string;
  /** Human label for the design-system source picker. */
  label: string;
  /** One line describing the vocabulary, for the picker. */
  blurb: string;
  contract: Record<string, any>;
  profile: Record<string, any>;
  manifest: Record<string, any>;
  /** Authored surfaces beyond the contract's own worked examples (usually none). */
  extraSurfaces: Array<{ name: string; surface: unknown }>;
}

export const REFERENCES: Record<string, Reference> = {
  shadcn: {
    id: "shadcn",
    label: "shadcn/ui",
    blurb: "The production shadcn/ui v3 catalog — 27 components, native React visuals.",
    contract: shadcnContract as unknown as Record<string, any>,
    profile: shadcnProfile as unknown as Record<string, any>,
    manifest: shadcnManifest as unknown as Record<string, any>,
    // The v3 contract's 14 examples ARE the worked surfaces; no extras.
    extraSurfaces: [],
  },
  astryx: {
    id: "astryx",
    label: "Astryx",
    blurb: "The Astryx design system — 12 components with 6 governed intents and runtime themes.",
    contract: astryxContract as unknown as Record<string, any>,
    profile: astryxProfile as unknown as Record<string, any>,
    manifest: astryxManifest as unknown as Record<string, any>,
    extraSurfaces: [],
  },
};

/** The design system a fresh hosted visitor starts on. */
export const DEFAULT_REFERENCE = "shadcn";

export const REFERENCE_LIST: Reference[] = Object.values(REFERENCES);
