/**
 * Serialize the canonical Astryx mapping profile (authored in TypeScript at
 * src/astryx-profile.ts) to the JSON form a composer reference project loads.
 *
 * The contracts build consumes `astryxProfile` as a live object; the composer
 * loads a profile as JSON via loadProfile(). This emits that JSON from the one
 * source of truth so the two never drift, adds the `profileVersion` the loader
 * dispatches on, and asserts the result actually loads before writing it.
 *
 *   pnpm --filter @dspack-studio/contracts exec tsx scripts/serialize-astryx-profile.ts <out.json>
 */
import { writeFileSync } from "node:fs";
import { loadProfile } from "@aestheticfunction/dspack-emit";
import { astryxProfile } from "../src/astryx-profile.js";

const out = process.argv[2];
if (!out) {
  console.error("usage: serialize-astryx-profile.ts <out.json>");
  process.exit(2);
}

// The authored profile is plain data (v1-language surfacePlan spellings that
// loadProfile desugars). Round-trip through JSON to drop any non-enumerable
// bits, then find the profileVersion the loader accepts.
const plain = JSON.parse(JSON.stringify(astryxProfile));
let wrote = false;
for (const profileVersion of ["2", "1"] as const) {
  const candidate = { profileVersion, ...plain };
  try {
    const loaded = loadProfile(candidate);
    const n = Object.keys((loaded as { components?: Record<string, unknown> }).components ?? {}).length;
    writeFileSync(out, JSON.stringify(candidate, null, 2) + "\n");
    console.log(`profileVersion ${profileVersion}: loadProfile OK (${n} components) — wrote ${out}`);
    wrote = true;
    break;
  } catch (e) {
    console.log(`profileVersion ${profileVersion}: ${(e as Error).message.slice(0, 140)}`);
  }
}
process.exit(wrote ? 0 : 1);
