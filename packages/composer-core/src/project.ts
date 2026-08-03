/**
 * The composer project manifest (`project.json` in the user's repository).
 *
 * A project is FILES in the user's repo; this manifest only binds them
 * together and names the adapter. Paths are relative to the manifest's
 * directory. The contract and profile stay the governed editable sources;
 * everything under `out` is derived and regenerated.
 */
import { z } from "zod";

export const PROJECT_VERSION = "0.1";

export const projectManifestSchema = z
  .object({
    composerProject: z.literal(PROJECT_VERSION),
    name: z.string().min(1),
    /** ComposerAdapter id (see adapters.ts): "react-generic" | "astryx" | "shadcn". */
    adapter: z.string().min(1),
    /** Catalog identity root; becomes the profile's catalogIdBase. */
    catalogIdBase: z.string().url().startsWith("https://"),
    contractPath: z.string().min(1),
    profilePath: z.string().min(1),
    /** dspack-export config used by discovery; absent = project was imported, not bootstrapped. */
    exportConfigPath: z.string().min(1).optional(),
    /** Directory of authored .dsurface.json scenarios (in addition to contract examples). */
    surfacesDir: z.string().min(1).optional(),
    /** Derived-artifact directory (catalogs, reports, emitted surfaces). */
    outDir: z.string().min(1).default("out"),
    /** Preview registry choice; the app maps ids to real registries. */
    previewRegistry: z.enum(["wireframe", "astryx", "shadcn"]).default("wireframe"),
  })
  .strict();

export type ProjectManifest = z.infer<typeof projectManifestSchema>;

export interface ManifestIssue {
  path: string;
  message: string;
}

export type ParseManifestResult =
  | { ok: true; manifest: ProjectManifest }
  | { ok: false; issues: ManifestIssue[] };

export function parseProjectManifest(json: unknown): ParseManifestResult {
  const result = projectManifestSchema.safeParse(json);
  if (result.success) return { ok: true, manifest: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}
