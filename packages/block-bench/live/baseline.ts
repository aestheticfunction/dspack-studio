/**
 * Record the production baseline the evaluation compares against:
 *
 *   pnpm --filter @dspack-studio/block-bench baseline [--base-url <origin>] [--out <file>]
 *
 * It fetches the deployed Composer's build id, probes the Worker's reply
 * shape at zero cost, lists the hosted models, and summarizes the sidecars
 * this checkout would offer. No provider call is made. With --out the
 * record is written as JSON (docs/blocks/BASELINE.md cites it).
 */
import { writeFileSync } from "node:fs";
import { preflight } from "./preflight";
import { REFERENCE_IDS, loadReference } from "./references";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const baseUrl = flag("--base-url") ?? process.env.COMPOSER_PROD_URL ?? "https://composer.aesthetic-function.com";
const out = flag("--out");

const references = await Promise.all(REFERENCE_IDS.map((id) => loadReference(id)));
const result = await preflight({ references, baseUrl });
const text = JSON.stringify(result, null, 2);
console.log(text);
if (out) {
  writeFileSync(out, `${text}\n`);
  console.log(`baseline: wrote ${out}`);
}
if (result.worker?.shape !== "phase-0.5") {
  console.error(`baseline: the Worker at ${baseUrl} is ${result.worker?.shape ?? "unknown"}; Phase 1B needs the Phase 0.5 Worker (calls[] on every reply)`);
  process.exitCode = 1;
}
