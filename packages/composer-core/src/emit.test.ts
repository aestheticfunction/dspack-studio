/**
 * THE EMIT SEAM, and the divergence it exists to end.
 *
 * The same governed project used to get a different validation truth depending
 * on which door it came through. `apps/agent/src/project.ts` emit() validated
 * the emitted surface against A2UI 0.9.1 AND 1.0; the browser's
 * `apps/composer/app/validation.ts` browserEmit() validated 0.9.1 only. The
 * canonical answer is BOTH, and it is not a matter of taste: dspack-gen's
 * `runPipeline` — the generator both the agent and the hosted browser BUILD
 * run — defaults to `a2uiVersions: ["0.9.1", "1.0"]`, the agent's emit matched
 * it, and so does the composer's build-time reference bake
 * (apps/composer/scripts/demo-assets.mjs). Three of the four twins already
 * said both; the browser's emit was the outlier, so it is the one that moved.
 *
 * These tests pin the seam itself. The equivalence of the two CALL SITES is
 * proven where each one lives: apps/agent/src/project.test.ts (the agent route
 * adds file writing and nothing else) and apps/composer/app/validation.test.ts
 * (the browser adds surface selection and nothing else).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { A2UI_VERSIONS, projectEmit } from "./emit";

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

/** The shipped demo project: a REAL non-canonical contract bootstrapped by
 *  dspack-export and human-enriched, with a JSON profile and a surface whose
 *  emit refuses on an authored casualty. */
const contract = read("../../../apps/composer/demo-project/acme-ui.dspack.json") as Record<string, unknown>;
const profileJson = read("../../../apps/composer/demo-project/acme.profile.json") as Record<string, unknown>;
const surfaces = ((contract.examples as Array<{ id?: string; surface?: unknown }>) ?? [])
  .filter((e) => e.surface)
  .map((e) => ({ name: e.id ?? "example", surface: e.surface }));

describe("projectEmit — one emit loop, one validation truth", () => {
  it("validates every canonical A2UI version, not just the first", () => {
    // The divergence, made observable: the result names the versions it
    // actually validated, so "which versions did this verdict come from" is
    // answerable rather than assumed.
    expect(A2UI_VERSIONS).toEqual(["0.9.1", "1.0"]);
    const result = projectEmit(contract, profileJson, surfaces);
    expect(result.runs.map((r) => r.version)).toEqual(["0.9.1", "1.0"]);
    for (const run of result.runs) {
      expect(run.catalog).toBeTruthy();
      expect(run.report).toBeTruthy();
    }
  });

  it("`ok` is the conjunction over versions, not the first version's verdict", () => {
    const result = projectEmit(contract, profileJson, surfaces);
    expect(result.ok).toBe(result.runs.every((r) => r.pass));
    // The shipped demo passes both; asserting the CONJUNCTION rather than the
    // value is what stops a one-version verdict from creeping back in.
    expect(result.runs.every((r) => r.pass)).toBe(true);
  });

  it("reports the primary catalog and the emitted surfaces alongside the findings", () => {
    const result = projectEmit(contract, profileJson, surfaces);
    expect(result.catalog).toBe(result.runs[0].catalog);
    expect(result.surfaces.map((s) => s.name)).toEqual(surfaces.map((s) => s.name));
    for (const surface of result.surfaces) {
      expect(surface.error === undefined ? Array.isArray(surface.messages) : true).toBe(true);
    }
  });

  it("refuses a schema-invalid profile with pathed findings and emits nothing", () => {
    const result = projectEmit(contract, { ...profileJson, components: "not an array" }, surfaces);
    expect(result.ok).toBe(false);
    expect(result.runs).toEqual([]);
    expect(result.surfaces).toEqual([]);
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) expect(f.gate).toBe("profile");
  });

  it("classifies an authored casualty refusal instead of reporting it as unfinished work", () => {
    // The demo project's `uses-casualty` surface refuses because the profile
    // declares mini-stepper a casualty WITH a written reason. The seam must
    // carry that classification, or the agent and browser would disagree about
    // whether a project is done.
    const casualtySurface = read("../../../apps/composer/demo-project/surfaces/uses-casualty.dsurface.json");
    const result = projectEmit(contract, profileJson, [
      ...surfaces,
      { name: "uses-casualty", surface: casualtySurface },
    ]);
    const refusal = result.findings.find((f) => f.gate === "A3" && f.code === "emit-surface");
    expect(refusal?.target).toBe("uses-casualty");
    expect(refusal?.severity).toBe("error");
    expect(refusal?.acknowledged?.componentId).toBe("mini-stepper");
    expect(refusal?.acknowledged?.reason).toContain("steps is an array prop");
  });
});
