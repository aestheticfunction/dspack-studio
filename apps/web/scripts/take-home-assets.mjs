#!/usr/bin/env node
/**
 * Build-time copy of the byte-synced contract into public/ so the take-home
 * view's "download the contract" link serves the EXACT bytes of
 * packages/contracts/astryx.dspack.json (a JSON re-stringify would not).
 * Generated, not committed (.gitignore); runs before dev and build.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(webRoot, "..", "..", "packages", "contracts", "astryx.dspack.json");
const dest = join(webRoot, "public", "take-home", "astryx.dspack.json");
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(source, dest);
console.log(`take-home assets: copied astryx.dspack.json -> ${dest}`);
