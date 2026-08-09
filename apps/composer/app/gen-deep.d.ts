/**
 * Types for the deep-import specifiers aliased in next.config.mjs. The browser
 * bundle loads runPipeline + ScriptedAdapter straight from dspack-gen's dist
 * files (bypassing its package index, which re-exports Node-only adapters and
 * eval helpers). These ambient declarations re-export the REAL types from the
 * package so TypeScript checks the in-browser pipeline exactly as the agent's.
 */
declare module "@composer/gen-run" {
  export { runPipeline } from "@aestheticfunction/dspack-gen";
}

declare module "@composer/gen-scripted" {
  export { ScriptedAdapter } from "@aestheticfunction/dspack-gen";
}
