/**
 * The shipped reference projects (honest magic: real files, pre-emitted at
 * build time by scripts/demo-assets.mjs — the same published dspack-emit APIs
 * the agent runs).
 *
 * The hosted composer starts from a governed design system and builds with its
 * vocabulary through ONE goal-first pipeline. Two references are packaged, and
 * both traverse that same pipeline with no design-system-specific code path:
 *
 *   - shadcn/ui v3 — the default first experience. The production v3 contract
 *     (34 components) through a v1-language profile (T1-T4 + A0); 27 A2UI
 *     components, 14 worked surfaces that emit 11 and refuse 3 on *declared
 *     casualties* (breadcrumb, pagination, tooltip), surfaced as acknowledged.
 *     Rendered natively where a shadcn visual exists (incl. Select/Alert), else
 *     wireframe.
 *   - Astryx — the second reference, proving the pipeline is design-system
 *     agnostic. The Astryx contract (12 components, 6 governed intents) through
 *     its authored profile; the 12-name catalog renders fully through
 *     @astryxdesign/core with runtime themes.
 *
 * Live authoring — connecting your own React library, saving edits, and AI
 * generation on real files — still requires the local agent (`pnpm --filter
 * agent dev`); the hosted app states that plainly.
 */
import shadcnContract from "../shadcn-v3-project/shadcn-ui.dspack.json";
import shadcnProfile from "../shadcn-v3-project/shadcn-v3.profile.json";
import shadcnManifest from "../shadcn-v3-project/project.json";
import shadcnEmit from "./demo/generated/emit.shadcn.json";
import astryxContract from "../astryx-project/astryx.dspack.json";
import astryxProfile from "../astryx-project/astryx.profile.json";
import astryxManifest from "../astryx-project/project.json";
import astryxEmit from "./demo/generated/emit.astryx.json";

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
  emit: Record<string, any>;
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
    emit: shadcnEmit as unknown as Record<string, any>,
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
    emit: astryxEmit as unknown as Record<string, any>,
    extraSurfaces: [],
  },
};

/** The design system a fresh hosted visitor starts on. */
export const DEFAULT_REFERENCE = "shadcn";

export const REFERENCE_LIST: Reference[] = Object.values(REFERENCES);

// Back-compat: the default reference, still exported as DEMO_* for the single
// consumers that predate reference selection (state.loadDemo, hosted-build).
// Reference selection generalizes these onto REFERENCES.
export const DEMO_CONTRACT = REFERENCES.shadcn.contract;
export const DEMO_PROFILE = REFERENCES.shadcn.profile;
export const DEMO_MANIFEST = REFERENCES.shadcn.manifest;
export const DEMO_EMIT = REFERENCES.shadcn.emit;
export const DEMO_EXTRA_SURFACES = REFERENCES.shadcn.extraSurfaces;
