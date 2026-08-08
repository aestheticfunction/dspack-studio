/**
 * The shipped demo project (honest magic: real files, pre-emitted at build
 * time by scripts/demo-assets.mjs — the same published dspack-emit APIs the
 * agent runs).
 *
 * The hosted demo is the **shadcn/ui v3** reference project: the production
 * v3 contract (34 components) mapped through a v2-language profile (T1-T4 +
 * A0), so composer.aesthetic-function.com demonstrates the representation
 * work actually shipped — the T4 dialog/sheet, T1 label donation, T3 joins,
 * A0 families — rendered through the wireframe registry. Its 14 worked
 * surfaces emit 11 and refuse 3 on *declared casualties* (accordion,
 * breadcrumb, pagination, tooltip), surfaced as acknowledged, not failure.
 *
 * Live authoring — connecting your own React library, saving edits, and AI
 * generation — still requires the local agent (`pnpm --filter agent dev`);
 * the hosted app states that plainly.
 */
import demoContract from "../shadcn-v3-project/shadcn-ui.dspack.json";
import demoProfile from "../shadcn-v3-project/shadcn-v3.profile.json";
import demoManifest from "../shadcn-v3-project/project.json";
import demoEmit from "./demo/generated/emit.json";

export const DEMO_CONTRACT = demoContract as unknown as Record<string, any>;
export const DEMO_PROFILE = demoProfile as unknown as Record<string, any>;
export const DEMO_MANIFEST = demoManifest as unknown as Record<string, any>;
export const DEMO_EMIT = demoEmit as unknown as Record<string, any>;
// The v3 contract's 14 examples ARE the worked surfaces (recomputeEmit emits
// contractSurfaces(doc)); the project carries no extra surfaces beyond them.
export const DEMO_EXTRA_SURFACES: Array<{ name: string; surface: unknown }> = [];
