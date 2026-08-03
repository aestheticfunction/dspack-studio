/**
 * The shipped demo project (honest magic: real files, pre-emitted at build
 * time by scripts/demo-assets.mjs — the same published APIs the agent runs).
 */
import demoContract from "../demo-project/acme-ui.dspack.json";
import demoProfile from "../demo-project/acme.profile.json";
import demoManifest from "../demo-project/project.json";
import demoEmit from "./demo/generated/emit.json";
import usesCasualty from "../demo-project/surfaces/uses-casualty.dsurface.json";

export const DEMO_CONTRACT = demoContract as unknown as Record<string, any>;
export const DEMO_PROFILE = demoProfile as unknown as Record<string, any>;
export const DEMO_MANIFEST = demoManifest as unknown as Record<string, any>;
export const DEMO_EMIT = demoEmit as unknown as Record<string, any>;
export const DEMO_EXTRA_SURFACES = [{ name: "uses-casualty", surface: usesCasualty as unknown }];
