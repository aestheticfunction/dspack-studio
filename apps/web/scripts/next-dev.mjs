/**
 * Version-safe Next dev launcher.
 *
 * Node ≥ 25 ships a stub server-side `localStorage` global whose methods are
 * undefined unless backed by `--localstorage-file` — dependencies' `typeof
 * localStorage` guards then pass and crash Next dev SSR (docs/
 * IMPLEMENTATION_LOG.md). But the flag only EXISTS from Node 22.4, and our
 * engines floor is 22: putting it inline in NODE_OPTIONS made `pnpm dev`
 * die with exit 9 ("not allowed in NODE_OPTIONS") on Node 22.0–22.3 before
 * Next ever started. So probe what THIS Node permits and pass the flag only
 * where it exists — the protection stays wherever the hazard exists (they
 * ship together), and the quick-start works on every supported Node.
 * Twin: apps/composer/scripts/next-dev.mjs.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const STORAGE_FILE = "/tmp/dspack-studio-dev-localstorage";

/** Pure env builder: add the flag only when this Node allows it. */
export function webstorageEnv(baseEnv, allowedFlags, file = STORAGE_FILE) {
  if (!allowedFlags.has("--localstorage-file")) return { ...baseEnv };
  const flag = `--localstorage-file=${file}`;
  const prior = baseEnv.NODE_OPTIONS;
  return { ...baseEnv, NODE_OPTIONS: prior ? `${prior} ${flag}` : flag };
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").at(-1));
if (invokedDirectly) {
  const require = createRequire(import.meta.url);
  const nextBin = require.resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: webstorageEnv(process.env, process.allowedNodeEnvironmentFlags),
  });
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
