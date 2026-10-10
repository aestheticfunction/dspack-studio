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
 *
 * Every option is validated before any preflight or provider call: an
 * unknown arm, condition, provider or option, or a count that is not a
 * whole number, is refused with its name.
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
import { ARMS, CONDITIONS, type Arm, type Condition } from "./types";

export interface CliOptions {
  provider: "hosted" | "scripted" | "scripted:faults" | { ollama: string };
  baseUrl: string;
  ollamaHost?: string;
  references: string[];
  arms?: Arm[];
  conditions?: Condition[];
  prompts?: string[];
  blocks?: string[];
  limit?: number;
  maxRequests: number;
  spacingMs: number;
  out?: string;
  resume?: string;
  rerunFailed: boolean;
  allowDrafts: boolean;
  force: boolean;
}

const VALUE_FLAGS = ["--provider", "--base-url", "--ollama-host", "--reference", "--arms", "--conditions", "--prompts", "--blocks", "--limit", "--max-requests", "--spacing-ms", "--out", "--resume"] as const;
const SWITCHES = ["--allow-drafts", "--rerun-failed", "--force"] as const;

export function parseOptions(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    // pnpm forwards the "--" separator of `pnpm ... eval:live -- --provider ...` to the script.
    if (token === "--") continue;
    if ((SWITCHES as readonly string[]).includes(token)) {
      switches.add(token);
    } else if ((VALUE_FLAGS as readonly string[]).includes(token)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${token} needs a value`);
      values.set(token, value);
      i += 1;
    } else {
      throw new Error(`unknown option '${token}'`);
    }
  }
  const list = (flag: string): string[] | undefined => values.get(flag)?.split(",").map((s) => s.trim()).filter(Boolean);
  const count = (flag: string, minimum: number, fallback?: number): number | undefined => {
    const raw = values.get(flag);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < minimum) throw new Error(`${flag} must be a whole number of at least ${minimum}, not '${raw}'`);
    return n;
  };

  const providerArg = values.get("--provider") ?? "scripted";
  let provider: CliOptions["provider"];
  if (providerArg === "hosted" || providerArg === "scripted" || providerArg === "scripted:faults") provider = providerArg;
  else if (providerArg.startsWith("ollama:") && providerArg.length > "ollama:".length) provider = { ollama: providerArg.slice("ollama:".length) };
  else throw new Error(`unknown provider '${providerArg}'; use hosted, ollama:<model>, scripted or scripted:faults`);

  const arms = list("--arms") as Arm[] | undefined;
  for (const arm of arms ?? []) if (!ARMS.includes(arm)) throw new Error(`unknown arm '${arm}'; use ${ARMS.join(", ")}`);
  const conditions = list("--conditions") as Condition[] | undefined;
  for (const condition of conditions ?? []) if (!CONDITIONS.includes(condition)) throw new Error(`unknown condition '${condition}'; use ${CONDITIONS.join(", ")}`);

  return {
    provider,
    baseUrl: values.get("--base-url") ?? process.env.COMPOSER_PROD_URL ?? "https://composer.aesthetic-function.com",
    ...(values.has("--ollama-host") ? { ollamaHost: values.get("--ollama-host")! } : {}),
    references: list("--reference") ?? [...REFERENCE_IDS],
    ...(arms ? { arms } : {}),
    ...(conditions ? { conditions } : {}),
    ...(list("--prompts") ? { prompts: list("--prompts")! } : {}),
    ...(list("--blocks") ? { blocks: list("--blocks")! } : {}),
    ...(count("--limit", 1) !== undefined ? { limit: count("--limit", 1)! } : {}),
    maxRequests: count("--max-requests", 1, 300)!,
    spacingMs: count("--spacing-ms", 0, 3000)!,
    ...(values.has("--out") ? { out: values.get("--out")! } : {}),
    ...(values.has("--resume") ? { resume: values.get("--resume")! } : {}),
    rerunFailed: switches.has("--rerun-failed"),
    allowDrafts: switches.has("--allow-drafts"),
    force: switches.has("--force"),
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  let o: CliOptions;
  try {
    o = parseOptions(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const references = await Promise.all(o.references.map((id) => loadReference(id)));
  const corpus = readCorpus();

  let provider: Provider;
  if (o.provider === "hosted") provider = createHostedProvider({ baseUrl: o.baseUrl, pacer: createPacer({ maxRequests: o.maxRequests, spacingMs: o.spacingMs }) });
  else if (typeof o.provider === "object") provider = createOllamaProvider({ model: o.provider.ollama, ...(o.ollamaHost ? { host: o.ollamaHost } : {}) });
  else provider = createScriptedProvider({ faults: o.provider === "scripted:faults" });

  const pre = await preflight({ references, ...(provider.kind === "hosted" ? { baseUrl: o.baseUrl } : {}) });
  console.log(JSON.stringify(pre, null, 2));
  if (provider.kind === "hosted" && pre.worker?.shape !== "phase-0.5" && !o.force) {
    console.error(`the Worker at ${o.baseUrl} is ${pre.worker?.shape}; Phase 1B needs the Phase 0.5 Worker. Pass --force to proceed anyway.`);
    return 1;
  }
  if (pre.drafts && !o.allowDrafts) {
    console.error("the sidecars in use are drafts; pass --allow-drafts for a provisional run (ADR-B3 counts approved sidecars only)");
    return 1;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = provider.descriptor.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const outDir = o.resume ?? o.out ?? fileURLToPath(new URL(`./runs/${stamp}-${slug}`, import.meta.url));
  let result;
  try {
    result = await runEvaluation({
      runId: `${stamp}-${slug}`,
      provider,
      references,
      corpus,
      preflight: pre,
      allowDrafts: o.allowDrafts,
      ...(o.arms ? { arms: o.arms } : {}),
      ...(o.conditions ? { conditions: o.conditions } : {}),
      ...(o.prompts ? { promptIds: o.prompts } : {}),
      ...(o.blocks ? { blocks: o.blocks } : {}),
      ...(o.limit !== undefined ? { limit: o.limit } : {}),
      outDir,
      resume: !!o.resume,
      rerunFailed: o.rerunFailed,
      log: (line) => console.log(line),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  console.log(`\nrun ${result.runId}: ${result.cells.done} of ${result.cells.total} cells (${result.cells.reused} reused); report at ${outDir}/REPORT.md`);
  for (const d of result.summary.decisions) console.log(`${d.reference} on ${d.provider}: ${d.verdict}\n  ${d.reasons.join("\n  ")}`);
  if (result.stopped) console.log(`stopped: ${result.stopped.message}${result.stopped.reason === "cap" ? `\nresume with: --resume ${outDir}` : ""}`);
  return result.stopped?.reason === "error" ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
