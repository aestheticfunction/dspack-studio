/**
 * Contract build: compile the Astryx dspack contract into A2UI catalogs
 * (v0.9.1 and v1.0) behind the emitter's validation gates, and emit the
 * contract's worked-example surface as A2UI messages.
 *
 * Outputs (out/):
 *   catalog.v0_9_1.json / catalog.v1_0.json   — gated A2UI catalogs
 *   report.v0_9_1.json  / report.v1_0.json    — fidelity + warnings + gate results
 *   delete-project-confirmation.surface.json  — worked example as A2UI messages
 *
 * Exit codes: 0 clean, 1 catalog gate failure, 4 surface emission failure
 * (matching dspack-emit's CLI conventions).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  transform,
  emitSurface,
  shadcnProfile,
  EmitSurfaceError,
  type A2uiVersion,
  type DspackDoc,
  type DspackSurface,
} from "@aestheticfunction/dspack-emit";
import { astryxProfile } from "./astryx-profile.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "out");
mkdirSync(outDir, { recursive: true });

const doc = JSON.parse(readFileSync(join(root, "astryx.dspack.json"), "utf8")) as DspackDoc;

// The worked example doubles as the sample surface for the A3 instance gate.
const example = (doc as any).examples?.[0];
if (!example?.surface) {
  console.error("contract has no worked example surface; A3 would be vacuous");
  process.exit(1);
}

// 1) Emit the worked-example surface first (it feeds A3 as sample instances).
let surfaceMessages: unknown = { messages: [] };
try {
  const emitted = emitSurface(example.surface as DspackSurface, doc, { profile: astryxProfile });
  surfaceMessages = { messages: emitted.messages };
  writeFileSync(
    join(outDir, "delete-project-confirmation.surface.json"),
    JSON.stringify({ messages: emitted.messages, warnings: emitted.warnings }, null, 2),
  );
  for (const w of emitted.warnings) console.log(`  [surface warn] ${w.code}: ${w.message}`);
} catch (err) {
  if (err instanceof EmitSurfaceError) {
    console.error(`surface emission failed: ${err.message}`);
    process.exit(4);
  }
  throw err;
}

// 1b) Emit every authored scenario surface in surfaces/ (deterministic,
// contract-governed structure; unscoped rules apply at lint time; intents
// without contract governance stay deterministic-only until owner-authored).
for (const file of readdirSync(join(root, "surfaces"))) {
  if (!file.endsWith(".dsurface.json")) continue;
  const name = file.replace(".dsurface.json", "");
  const scenarioSurface = JSON.parse(readFileSync(join(root, "surfaces", file), "utf8")) as DspackSurface;
  const emitted = emitSurface(scenarioSurface, doc, { profile: astryxProfile });
  writeFileSync(
    join(outDir, `${name}.surface.json`),
    JSON.stringify({ messages: emitted.messages, warnings: emitted.warnings }, null, 2),
  );
  for (const w of emitted.warnings) console.log(`  [${name} warn] ${w.code}: ${w.message}`);
}

// 2) Compile + gate both catalog versions.
const fileTag = (v: A2uiVersion) => (v === "0.9.1" ? "0_9_1" : "1_0");
let failed = false;
for (const version of ["0.9.1", "1.0"] as A2uiVersion[]) {
  const { catalog, validation, report } = transform(doc, version, surfaceMessages, astryxProfile);
  writeFileSync(join(outDir, `catalog.v${fileTag(version)}.json`), JSON.stringify(catalog, null, 2));
  writeFileSync(join(outDir, `report.v${fileTag(version)}.json`), JSON.stringify(report, null, 2));

  console.log(`A2UI ${version}:`);
  for (const gate of validation.gates) {
    console.log(`  [${gate.pass ? "PASS" : "FAIL"}] ${gate.name} — ${gate.detail}`);
    if (!gate.pass && gate.errors) for (const e of gate.errors) console.log(`      ${e}`);
  }
  if (!validation.pass) failed = true;
}

// 3) The second design system's contract (FM-10 groundwork): the shadcn
// dspack contract, byte-synced with dspack main like the Astryx one, gated
// through dspack-emit's own shadcn profile. Its worked example feeds A3.
// The studio's scenario coverage under this contract waits on the
// owner-authored upstream extension (intents beyond destructive-action);
// the catalog emission and gates run today.
const shadcnDoc = JSON.parse(readFileSync(join(root, "shadcn-ui.dspack.json"), "utf8")) as DspackDoc;
const shadcnExamples = ((shadcnDoc as any).examples ?? []) as Array<{ id: string; surface: unknown }>;
if (shadcnExamples.length === 0 || !shadcnExamples[0]?.surface) {
  console.error("shadcn contract has no worked example surface; A3 would be vacuous");
  process.exit(1);
}
// EVERY worked example must emit (P1.E): the example set is the contract's
// own definition of "expressible", and a nominally-mapped component whose
// sub-family refuses only surfaces when its example is actually emitted.
// examples[0] additionally feeds the A3 instance gate below.
let shadcnSurfaceMessages: unknown = { messages: [] };
for (const [i, example] of shadcnExamples.entries()) {
  try {
    const emitted = emitSurface(example.surface as DspackSurface, shadcnDoc, { profile: shadcnProfile });
    if (i === 0) shadcnSurfaceMessages = { messages: emitted.messages };
    for (const w of emitted.warnings) console.log(`  [shadcn surface warn] ${example.id} ${w.code}: ${w.message}`);
  } catch (err) {
    if (err instanceof EmitSurfaceError) {
      console.error(`shadcn surface emission failed (${example.id}): ${err.message}`);
      process.exit(4);
    }
    throw err;
  }
}
for (const version of ["0.9.1", "1.0"] as A2uiVersion[]) {
  const { catalog, validation, report } = transform(shadcnDoc, version, shadcnSurfaceMessages, shadcnProfile);
  writeFileSync(join(outDir, `catalog.shadcn.v${fileTag(version)}.json`), JSON.stringify(catalog, null, 2));
  writeFileSync(join(outDir, `report.shadcn.v${fileTag(version)}.json`), JSON.stringify(report, null, 2));

  console.log(`A2UI ${version} (shadcn contract):`);
  for (const gate of validation.gates) {
    console.log(`  [${gate.pass ? "PASS" : "FAIL"}] ${gate.name} — ${gate.detail}`);
    if (!gate.pass && gate.errors) for (const e of gate.errors) console.log(`      ${e}`);
  }
  if (!validation.pass) failed = true;
}

if (failed) {
  console.error("catalog gate failure");
  process.exit(1);
}
console.log("contracts build clean");
