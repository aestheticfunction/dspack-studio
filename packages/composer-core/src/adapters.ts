/**
 * ComposerAdapter manifests: one adapter = REFERENCES across the three seams
 * that already exist in the ecosystem — discovery (dspack-export
 * FrameworkAdapter), mapping (dspack-emit Profile), rendering (a2ui-ingest
 * Registry). The composer binds; it never re-implements a seam.
 *
 * Manifests are pure data. Rendering names a registry by id — the APP maps
 * ids to real registry modules (dynamic import), preserving the import-
 * isolation rule (design-system imports only in their own renderer package;
 * nothing here may import one).
 */

export interface ComposerAdapter {
  id: string;
  displayName: string;
  /** Absent = the project was imported with an existing contract, not bootstrapped. */
  discovery?: DiscoveryRef;
  mapping: MappingRef;
  /** Absent = wireframe-only preview (the Vue door: catalog, validation, and export are unaffected). */
  rendering?: RenderingRef;
  drift?: DriftRef;
}

export interface DiscoveryRef {
  /** dspack-export FrameworkAdapter id (resolved by its own resolveAdapter). */
  frameworkAdapterId: "react" | "vue";
  /** Discovery runs Babel + react-docgen: Node-only, never in the browser. */
  runtime: "agent";
}

export interface MappingRef {
  /**
   * "scaffold" = mechanical draft via dspack-emit scaffoldProfile;
   * a registry id string = clone a known profile as the seed.
   */
  seed: "scaffold" | "astryx-profile" | "shadcn-profile";
}

export interface RenderingRef {
  kind: "registry";
  /** Declared data so a future "vue" is a value, not a refactor. */
  target: "react";
  /** Registry id the app resolves: "astryx" | "shadcn" ("wireframe" is the universal fallback). */
  registryId: "astryx" | "shadcn";
}

export interface DriftRef {
  /** Command template run by the agent (e.g. ["npx", "astryx", "component", "--json"]). */
  command: string[];
  runtime: "agent";
}

export const COMPOSER_ADAPTERS: Record<string, ComposerAdapter> = {
  "react-generic": {
    id: "react-generic",
    displayName: "React (generic)",
    discovery: { frameworkAdapterId: "react", runtime: "agent" },
    mapping: { seed: "scaffold" },
    // No rendering ref: an arbitrary React library previews as wireframe.
  },
  astryx: {
    id: "astryx",
    displayName: "Astryx",
    discovery: { frameworkAdapterId: "react", runtime: "agent" },
    mapping: { seed: "astryx-profile" },
    rendering: { kind: "registry", target: "react", registryId: "astryx" },
    drift: { command: ["npx", "astryx", "component", "--json"], runtime: "agent" },
  },
  shadcn: {
    id: "shadcn",
    displayName: "shadcn/ui",
    discovery: { frameworkAdapterId: "react", runtime: "agent" },
    mapping: { seed: "shadcn-profile" },
    rendering: { kind: "registry", target: "react", registryId: "shadcn" },
  },
};

export function composerAdapter(id: string): ComposerAdapter | undefined {
  return COMPOSER_ADAPTERS[id];
}
