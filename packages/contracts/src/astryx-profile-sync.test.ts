/**
 * Drift guard: the committed serialized Astryx profile stays in sync with its
 * authored TypeScript source.
 *
 * astryx-profile.ts is the ONE source of truth; astryx.profile.json is its
 * serialized form, which composer reference projects load via loadProfile().
 * scripts/serialize-astryx-profile.ts writes the JSON; this test fails loudly
 * if someone edits the TS and forgets to regenerate the JSON (re-run:
 * `pnpm --filter @dspack-studio/contracts exec tsx scripts/serialize-astryx-profile.ts astryx.profile.json`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadProfile } from "@aestheticfunction/dspack-emit";
import { astryxProfile } from "./astryx-profile.js";

const committed = JSON.parse(
  readFileSync(fileURLToPath(new URL("../astryx.profile.json", import.meta.url)), "utf8"),
);

describe("serialized astryx profile ⟷ authored TS source", () => {
  it("committed astryx.profile.json body equals the serialized astryxProfile", () => {
    const { profileVersion, ...committedBody } = committed;
    expect(profileVersion).toBe("1"); // the schema version this profile serializes under
    expect(committedBody).toEqual(JSON.parse(JSON.stringify(astryxProfile)));
  });

  it("the committed profile loads", () => {
    expect(() => loadProfile(committed)).not.toThrow();
  });
});
