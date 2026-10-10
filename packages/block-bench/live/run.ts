/**
 * The Phase 1B live evaluation (docs/BLOCKS.md). The owner runs it:
 *
 *   pnpm --filter @dspack-studio/block-bench eval:live -- --provider hosted [options]
 *
 * Providers: hosted (the deployed Worker; paced for the shared gateway),
 * ollama:<model> (a local model), scripted or scripted:faults (the dry run).
 *
 * Options:
 *   --base-url <origin>       hosted origin (default https://composer.aesthetic-function.com)
 *   --ollama-host <url>       Ollama host (default OLLAMA_HOST or http://localhost:11434)
 *   --reference <id,...>      references to run (default: all packaged references)
 *   --arms <a,...>            block, capped, production (default: all)
 *   --conditions <c,...>      fresh, refine-content, refine-add, refine-remove, refine-structural (default: all)
 *   --prompts <id,...>        prompt ids; --blocks <id,...|null> expected-block filter; --limit <n> prompts per reference
 *   --allow-drafts            run on draft sidecars (results are provisional)
 *   --max-requests <n>        requests this invocation may send (default 300); the run stops cleanly and can resume
 *   --spacing-ms <n>          minimum gap between hosted requests (default 3000)
 *   --out <dir>               run directory (default live/runs/<time>-<provider>)
 *   --resume <dir>            continue a run directory; --rerun-failed re-runs provider and policy failures
 *   --force                   proceed although the Worker probe is not phase-0.5
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { readCorpus } from "./corpus";
import { runEvaluation } from "./evaluate";
import { createPacer } from "./pacing";
import { preflight } from "./preflight";
import { createHostedProvider } from "./providers/hosted";
import { createOllamaProvider } from "./providers/ollama";
import { createScriptedProvider } from "./providers/scripted";
import type { Provider } from "./providers/types";
import { REFERENCE_IDS, loadReference } from "./references";
import type { Arm, Condition } from "./types";

export async function main(argv: readonly string[]): Promise<number> {
  const args = [...argv];
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const has = (name: string) => args.includes(name);
  const list = (name: string): string[] | undefined => flag(name)?.split(",").map((s) => s.trim()).filter(Boolean);

  const providerArg = flag("--provider") ?? "scripted";
  const baseUrl = flag("--base-url") ?? process.env.COMPOSER_PROD_URL ?? "https://composer.aesthetic-function.com";
  const referenceIds = list("--reference") ?? REFERENCE_IDS;
  const references = await Promise.all(referenceIds.map((id) => loadReference(id)));
  const corpus = readCorpus();

  let provider: Provider;
  if (providerArg === "hosted") {
    provider = createHostedProvider({
      baseUrl,
      pacer: createPacer({ maxRequests: Number(flag("--max-requests") ?? 300), spacingMs: Number(flag("--spacing-ms") ?? 3000) }),
    });
  } else if (providerArg.startsWith("ollama:")) {
    provider = createOllamaProvider({ model: providerArg.slice("ollama:".length), ...(flag("--ollama-host") ? { host: flag("--ollama-host")! } : {}) });
  } else if (providerArg === "scripted" || providerArg === "scripted:faults") {
    provider = createScriptedProvider({ faults: providerArg === "scripted:faults" });
  } else {
    console.error(`unknown provider ${providerArg}`);
    return 2;
  }

  const pre = await preflight({ references, ...(provider.kind === "hosted" ? { baseUrl } : {}) });
  console.log(JSON.stringify(pre, null, 2));
  if (provider.kind === "hosted" && pre.worker?.shape !== "phase-0.5" && !has("--force")) {
    console.error(`the Worker at ${baseUrl} is ${pre.worker?.shape}; Phase 1B needs the Phase 0.5 Worker. Pass --force to proceed anyway.`);
    return 1;
  }
  if (pre.drafts && !has("--allow-drafts")) {
    console.error("the sidecars in use are drafts; pass --allow-drafts for a provisional run (ADR-B3 counts approved sidecars only)");
    return 1;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = provider.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const resume = flag("--resume");
  const outDir = resume ?? flag("--out") ?? fileURLToPath(new URL(`./runs/${stamp}-${slug}`, import.meta.url));
  const result = await runEvaluation({
    runId: `${stamp}-${slug}`,
    provider,
    references,
    corpus,
    preflight: pre,
    allowDrafts: has("--allow-drafts"),
    ...(list("--arms") ? { arms: list("--arms") as Arm[] } : {}),
    ...(list("--conditions") ? { conditions: list("--conditions") as Condition[] } : {}),
    ...(list("--prompts") ? { promptIds: list("--prompts") } : {}),
    ...(list("--blocks") ? { blocks: list("--blocks") } : {}),
    ...(flag("--limit") ? { limit: Number(flag("--limit")) } : {}),
    outDir,
    resume: !!resume,
    rerunFailed: has("--rerun-failed"),
    log: (line) => console.log(line),
  });
  console.log(`\nrun ${result.runId}: ${result.cells.done} of ${result.cells.total} cells (${result.cells.reused} reused); report at ${outDir}/REPORT.md`);
  for (const d of result.summary.decisions) console.log(`${d.reference} on ${d.provider}: ${d.verdict}\n  ${d.reasons.join("\n  ")}`);
  if (result.stopped) console.log(`stopped: ${result.stopped.message}${result.stopped.reason === "cap" ? `\nresume with: --resume ${outDir}` : ""}`);
  return result.stopped?.reason === "error" ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
