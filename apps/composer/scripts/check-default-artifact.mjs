/**
 * The deploy artifact never carries interface-block code (docs/BLOCKS.md).
 *
 * Runs after `pnpm --filter composer build` on both deploy paths (the
 * build:deploy:composer script, which Workers Builds and the deploy workflow
 * run). It scans every file under apps/composer/out for the sidecar envelope
 * key and every draft block id read from the sidecars themselves, so a new
 * block is covered the moment it is drafted. The composer smoke suite runs
 * the same scan over the served chunks.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const composer = fileURLToPath(new URL("..", import.meta.url));
const out = join(composer, "out");
const sidecars = join(composer, "experimental", "blocks");

// The sidecar envelope key, a template directive, the beta switch's reasons
// (packages/composer-core/src/blocks/beta.ts), and step 4's Blocks catalog and
// Preview provenance line with the runtime call behind them.
const markers = new Set([
  "blocksSidecar",
  "disable-actions-until-complete",
  "reference-not-in-beta",
  "beta-switch-",
  "blocks-catalog",
  "preview-provenance",
  "preview-host-owned",
  "provenanceVerdicts",
  // Step 5: the beta receipt, the diagnostics export and the operation header.
  "build-beta-receipt",
  "diagnostics-export",
  "composer-beta-diagnostics",
  "x-composer-operation",
  // M1: the experimental workspace (the composition runtime, its storage namespace and the Library).
  "composer.experimental.workspace.",
  "compositionsSidecar",
  "composition-library",
  "NEXT_PUBLIC_COMPOSER_TOOLCHAIN",
  // D0.1: the hub's pointer to the Library.
  "projects-library-entry",
  // M1 authoring (A1 to A4): the draft's authoring bar and its Create draft action.
  "authoring-bar",
  "create-draft",
  // T4: the shared theme compiler and the workspace appearance are experimental only.
  "theme-direction-compiler@",
  "workspace-appearance@",
  "composer-workspace-appearance",
  // Advanced authoring: Structure, canvas selection and the element inspector are experimental only.
  "structure-panel",
  "element-inspector",
  "select-layer",
  // Approval withdrawal (decision 34) is experimental only.
  "withdraw-confirm",
  "approval-withdrawn",
  // Visual template editing is experimental only.
  "template-tools",
  "content-editor",
  "identity-editor",
  // The authoring review's corrections: edit results and scoped undo are experimental only.
  "edit-announce",
  "tt-status",
  "the elements changed another way since",
  // The authoring refinement: Structure rows, picker, version menu and paired panels are experimental only.
  "cl-picker",
  "structure-keys",
  "version-menu",
  "panels-both",
  "draft-run-checks",
  // Block promotion (slice D) is experimental only.
  "promotion-details",
  "promote-confirm",
  "block-list",
  // Transition intent is experimental only.
  "action-flow-intent-note",
  // State, transition and dialog authoring are experimental only.
  "states-editor",
  "action-flow",
  "edit-states",
]);
for (const file of readdirSync(sidecars).filter((f) => f.endsWith(".blocks.json"))) {
  const doc = JSON.parse(readFileSync(join(sidecars, file), "utf8"));
  for (const block of doc.blocks ?? []) markers.add(block.id);
}

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
};
try {
  walk(out);
} catch {
  console.error(`check-default-artifact: ${out} is missing; run pnpm --filter composer build first`);
  process.exit(1);
}
if (!files.some((f) => f.endsWith("index.html"))) {
  console.error("check-default-artifact: out/index.html is missing");
  process.exit(1);
}
const offenders = [];
for (const file of files) {
  if (!/\.(js|html|json|txt|css)$/.test(file)) continue;
  const body = readFileSync(file, "utf8");
  for (const marker of markers) if (body.includes(marker)) offenders.push(`${file.slice(composer.length)} contains ${marker}`);
}
if (offenders.length > 0) {
  console.error(`check-default-artifact: the default build carries interface-block code:\n  ${offenders.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-default-artifact: ${files.length} files clean of ${markers.size} markers`);
