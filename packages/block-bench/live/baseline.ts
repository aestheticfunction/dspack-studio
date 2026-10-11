/**
 * Record the production baseline the evaluation compares against:
 *
 *   pnpm --filter @dspack-studio/block-bench baseline [--base-url <origin>] [--out <file>]
 *
 * It fetches the deployed Composer's build id (confirmed against that build's
 * static manifest), probes the Worker's reply shape at zero cost, lists the
 * hosted models, and summarizes the sidecars this checkout would offer. No
 * provider call is made: every request is a static asset, the Worker's
 * refusal of an empty body, or the model list. --out is resolved against the
 * directory the command was typed in (pnpm runs the script in the package
 * directory), and the record is written only when it is whole: a Phase 0.5
 * Worker, a confirmed build id and the model list. docs/blocks/BASELINE.md
 * cites it.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { preflight } from "./preflight";
import { REFERENCE_IDS, loadReference } from "./references";

const VALUE_FLAGS = ["--base-url", "--out"];

export async function main(argv: readonly string[]): Promise<number> {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    // pnpm forwards the "--" separator of `pnpm ... baseline -- --out ...` to the script.
    if (token === "--") continue;
    if (!VALUE_FLAGS.includes(token)) {
      console.error(`unknown option '${token}'; use --base-url <origin> and --out <file>`);
      return 2;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error(`${token} needs a value`);
      return 2;
    }
    values.set(token, value);
    i += 1;
  }
  const baseUrl = values.get("--base-url") ?? process.env.COMPOSER_PROD_URL ?? "https://composer.aesthetic-function.com";
  const out = values.has("--out") ? resolve(process.env.INIT_CWD ?? process.cwd(), values.get("--out")!) : undefined;

  const references = await Promise.all(REFERENCE_IDS.map((id) => loadReference(id)));
  const result = await preflight({ references, baseUrl });
  const text = JSON.stringify(result, null, 2);
  console.log(text);
  // Recorded only as observed: an incomplete record is never written as the baseline.
  const missing = [
    ...(result.worker?.shape === "phase-0.5" ? [] : [`the Worker at ${baseUrl} is ${result.worker?.shape ?? "not probed"}${result.worker?.detail ? ` (${result.worker.detail})` : ""}, and Phase 1B needs the Phase 0.5 Worker (calls[] on every reply)`]),
    ...(result.buildId ? [] : [`no build id could be read and confirmed at ${baseUrl}`]),
    ...(result.models ? [] : [`the hosted model list could not be read at ${baseUrl}`]),
  ];
  if (missing.length > 0) {
    console.error(`baseline${out ? " not written" : ""}: ${missing.join("; ")}`);
    return 1;
  }
  if (out) {
    writeFileSync(out, `${text}\n`);
    console.log(`baseline: wrote ${out}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
