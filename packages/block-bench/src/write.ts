/**
 * Regenerate results.json and RESULTS.md. Run on purpose, review the diff:
 * `pnpm --filter @dspack-studio/block-bench bench`. The drift test then
 * holds every later change to these exact numbers.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeResults } from "./bench";
import { renderMarkdown } from "./report";

const here = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const results = await computeResults();
writeFileSync(here("results.json"), `${JSON.stringify(results, null, 2)}\n`);
writeFileSync(here("RESULTS.md"), renderMarkdown(results));
console.log("block-bench: wrote results.json and RESULTS.md");
