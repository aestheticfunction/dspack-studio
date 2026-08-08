/**
 * Build-time demo assets for the hosted composer (honest-magic posture: the
 * hosted app ships a real, pre-emitted demo project; live re-emission needs
 * the local agent).
 *
 * Runtime twin: apps/agent/src/project.ts emit(). This script is the
 * build-time equivalent over apps/composer/demo-project, written with the
 * same published dspack-emit APIs. Output: app/demo/generated/emit.json
 * (gitignored, regenerated per build — the contracts/out pattern).
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProfile, transformFromJson, emitSurface, EmitSurfaceError } from "@aestheticfunction/dspack-emit";

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, "..", "shadcn-v3-project");
const outDir = join(here, "..", "app", "demo", "generated");

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const contract = read(join(project, "shadcn-ui.dspack.json"));
const profile = loadProfile(read(join(project, "shadcn-v3.profile.json")));

const surfaces = [];
for (const example of contract.examples ?? []) {
  if (example.surface) surfaces.push({ name: example.id ?? "example", surface: example.surface });
}
const surfacesDir = join(project, "surfaces");
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

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "emit.json"),
  JSON.stringify(
    {
      ok: runs.every((r) => r.out.validation.pass),
      catalog: primary.catalog,
      report: primary.report.json,
      surfaces: emitted,
      findings,
    },
    null,
    2,
  ),
);
console.log(`[composer demo] emit.json: ${Object.keys(primary.catalog.components).length} components, ${emitted.length} surfaces, ${findings.length} findings`);
