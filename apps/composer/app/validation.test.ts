/**
 * A3/A4 EQUIVALENCE, browser half.
 *
 * The measured divergence this closes: the browser validated the emitted
 * surface against A2UI 0.9.1 ONLY, while the agent validated 0.9.1 AND 1.0.
 * The same governed project therefore got a different validation truth
 * depending on whether it was browser-backed or repository-backed — and
 * nothing in the result said which versions had run, so nobody could tell.
 *
 * The canonical answer is BOTH. dspack-gen's `runPipeline` — the generator
 * behind both the agent's and the hosted browser's BUILD — defaults to
 * `a2uiVersions: ["0.9.1", "1.0"]`; the agent's emit matched it; so does the
 * composer's build-time reference bake. The browser's emit was the only
 * dissenter, so the browser is what moved. No version was deleted to make
 * outputs agree.
 *
 * This half asserts browserEmit is the shared seam plus SURFACE SELECTION and
 * nothing else. The agent half (apps/agent/src/project.test.ts) asserts the
 * route is the same seam plus FILE WRITING. Chained through the seam, the two
 * doors are equal by construction rather than by coincidence.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { A2UI_VERSIONS, projectEmit } from "@dspack-studio/composer-core";
import { browserEmit, contractSurfaces } from "./validation";

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

/** The shipped demo project — a real bootstrapped-and-enriched contract with a
 *  JSON profile, the same material the agent's route tests run against. */
const contract = read("../demo-project/acme-ui.dspack.json") as Record<string, unknown>;
const profileJson = read("../demo-project/acme.profile.json") as Record<string, unknown>;

describe("browserEmit — the same emit seam the agent runs", () => {
  it("validates BOTH canonical A2UI versions, and says which ones it ran", () => {
    const result = browserEmit(contract, profileJson, contractSurfaces(contract));
    expect(result.runs.map((r) => r.version)).toEqual([...A2UI_VERSIONS]);
    expect(result.ok).toBe(result.runs.every((r) => r.pass));
    // Not just a label: the 1.0 catalog is really compiled and gated. The two
    // A2UI versions are distinguishable in the catalog shape itself — 0.9.1
    // requires `$defs.theme` and forbids `$defs.surfaceProperties`; 1.0 is the
    // exact inverse — so this is proof the second run happened, not a claim.
    const v0_9_1 = result.runs.find((r) => r.version === "0.9.1")!;
    const v1_0 = result.runs.find((r) => r.version === "1.0")!;
    expect(v0_9_1.catalog.$defs.theme).toBeTruthy();
    expect(v0_9_1.catalog.$defs.surfaceProperties).toBeUndefined();
    expect(v1_0.catalog.$defs.surfaceProperties).toBeTruthy();
    expect(v1_0.catalog.$defs.theme).toBeUndefined();
  });

  it("is projectEmit plus surface selection: same verdict, same finding set, same catalog", () => {
    const surfaces = contractSurfaces(contract);
    const browser = browserEmit(contract, profileJson, surfaces);
    const seam = projectEmit(contract, profileJson, surfaces);
    expect(browser.ok).toBe(seam.ok);
    expect(browser.findings).toEqual(seam.findings);
    expect(browser.catalog).toEqual(seam.catalog);
    expect(browser.surfaces).toEqual(seam.surfaces);
  });

  it("selects the contract's worked examples — the surfaces a browser-backed project has", () => {
    // The documented, justified asymmetry with the agent: a repository-backed
    // project also emits its surfacesDir, which the browser has no access to.
    const names = contractSurfaces(contract).map((s) => s.name);
    expect(names).toEqual(
      ((contract.examples as Array<{ id?: string; surface?: unknown }>) ?? [])
        .filter((e) => e.surface)
        .map((e) => e.id ?? "example"),
    );
    expect(names.length).toBeGreaterThan(0);
  });

  it("reports every packaged reference project identically under both versions", () => {
    // The honest impact statement for this change, asserted rather than
    // claimed: on the material the composer actually ships, 1.0 surfaces no
    // finding that 0.9.1 did not. Users see no new noise — they gain the
    // guarantee that a 1.0 failure would now be shown rather than silently
    // passed over.
    for (const dir of ["shadcn-v3-project", "astryx-project"]) {
      const manifest = read(`../${dir}/project.json`) as { contractPath: string; profilePath: string };
      const doc = read(`../${dir}/${manifest.contractPath}`) as Record<string, unknown>;
      const profile = read(`../${dir}/${manifest.profilePath}`) as Record<string, unknown>;
      const result = browserEmit(doc, profile, contractSurfaces(doc));
      expect(result.runs.map((r) => r.version)).toEqual([...A2UI_VERSIONS]);
      const perVersion = new Map<string, string[]>();
      for (const run of result.runs) {
        perVersion.set(
          run.version,
          result.findings.filter((f) => f.target === `a2ui@${run.version}`).map((f) => `${f.gate}/${f.code}: ${f.message}`),
        );
      }
      expect(perVersion.get("1.0")).toEqual(perVersion.get("0.9.1"));
      expect(perVersion.get("1.0")).toEqual([]);
    }
  });
});
