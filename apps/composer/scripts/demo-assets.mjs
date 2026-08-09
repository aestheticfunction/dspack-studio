/**
 * Build-time reference-project assets for the hosted composer (honest-magic
 * posture: the hosted app ships real, pre-emitted reference projects; live
 * re-emission needs the local agent).
 *
 * Runtime twin: apps/agent/src/project.ts emit(). This script is the
 * build-time equivalent, written with the same published dspack-emit APIs,
 * run over EVERY packaged reference project (shadcn/ui v3 and Astryx) so the
 * hosted composer can start from either governed design system through the one
 * goal-first pipeline. Output: app/demo/generated/emit.<id>.json per project
 * (gitignored, regenerated per build — the contracts/out pattern).
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProfile, transformFromJson, emitSurface, EmitSurfaceError } from "@aestheticfunction/dspack-emit";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "app", "demo", "generated");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

// Every packaged reference project, keyed by the id the composer loads it by.
// The shadcn/ui v3 catalog is the default first experience; Astryx proves the
// same pipeline is design-system agnostic (no Astryx-specific code path).
const PROJECTS = [
  { id: "shadcn", dir: "shadcn-v3-project" },
  { id: "astryx", dir: "astryx-project" },
];

/** Emit one reference project exactly as apps/agent's emit() would. */
function bakeProject(projectDir) {
  const manifest = read(join(projectDir, "project.json"));
  const contract = read(join(projectDir, manifest.contractPath));
  const profile = loadProfile(read(join(projectDir, manifest.profilePath)));

  const surfaces = [];
  for (const example of contract.examples ?? []) {
    if (example.surface) surfaces.push({ name: example.id ?? "example", surface: example.surface });
  }
  const surfacesDir = join(projectDir, "surfaces");
  if (existsSync(surfacesDir)) {
    for (const file of readdirSync(surfacesDir).filter((f) => f.endsWith(".dsurface.json")).sort()) {
      surfaces.push({ name: file.replace(/\.dsurface\.json$/, ""), surface: read(join(surfacesDir, file)) });
    }
  }

  const emitted = [];
  const allMessages = [];
  for (const { name, surface } of surfaces) {
    try {
      const r = emitSurface(surface, contract, { profile });
      emitted.push({ name, messages: r.messages, warnings: r.warnings });
      allMessages.push(...r.messages);
    } catch (e) {
      if (e instanceof EmitSurfaceError) {
        emitted.push({ name, warnings: [], error: e.message });
        continue;
      }
      throw e;
    }
  }

  const findings = [];
  const runs = ["0.9.1", "1.0"].map((version) => {
    const out = transformFromJson(contract, { a2uiVersion: version, surface: { messages: allMessages }, profile });
    for (const gate of out.validation.gates) {
      if (!gate.pass) findings.push({ gate: "A1", code: gate.name, severity: "error", target: `a2ui@${version}`, message: gate.name });
    }
    return { version, out };
  });
  const primary = runs[0].out;
  for (const c of primary.mapping.coverage) {
    if (c.disposition === "unclassified") {
      findings.push({ gate: "coverage", code: "unclassified", severity: "error", target: c.id, message: "component is neither mapped, adapted, omitted, nor a declared casualty" });
    }
  }
  for (const f of primary.mapping.fidelity) {
    if (f.class === "lossy" || f.class === "cannot-represent") {
      findings.push({ gate: "fidelity", code: f.class, severity: "warn", target: f.source, message: f.note });
    }
  }
  for (const { name, warnings, error } of emitted) {
    if (error) findings.push({ gate: "A3", code: "emit-surface", severity: "error", target: name, message: error });
    for (const w of warnings ?? []) findings.push({ gate: "A3", code: w.code, severity: "info", target: name, message: w.message });
  }

  return {
    ok: runs.every((r) => r.out.validation.pass),
    catalog: primary.catalog,
    report: primary.report.json,
    surfaces: emitted,
    findings,
  };
}

mkdirSync(outDir, { recursive: true });
for (const { id, dir } of PROJECTS) {
  const emit = bakeProject(join(here, "..", dir));
  writeFileSync(join(outDir, `emit.${id}.json`), JSON.stringify(emit, null, 2));
  const nComp = Object.keys(emit.catalog.components).length;
  console.log(`[composer reference:${id}] emit.${id}.json: ${nComp} components, ${emit.surfaces.length} surfaces, ${emit.findings.length} findings`);
}
