/**
 * The Phase 1B live evaluation (docs/BLOCKS.md). The owner runs it:
 *
 *   pnpm --filter @dspack-studio/block-bench eval:live -- --provider hosted [options]
 *
 * Providers: hosted (the deployed Worker; paced for the shared gateway),
 * ollama:<model> (a local model), scripted or scripted:faults (the dry run).
 *
 * Options:
 *   --base-url <origin>       hosted: the origin (default https://composer.aesthetic-function.com)
 *   --ollama-host <url>       ollama: the host (default OLLAMA_HOST or http://localhost:11434)
 *   --reference <id,...>      references to run (default: all packaged references)
 *   --arms <a,...>            block, capped, production (default: all)
 *   --conditions <c,...>      fresh, refine-content, refine-add, refine-remove, refine-structural (default: all)
 *   --prompts <id,...>        prompt ids; --blocks <id,...|null> expected-block filter; --limit <n> prompts per reference
 *   --allow-drafts            run on draft sidecars (results are provisional)
 *   --max-requests <n>        hosted: requests this invocation may send (default 300, at least 20, one cell's worst
 *                             case); the run stops cleanly before a cell the cap cannot cover, and can resume
 *   --spacing-ms <n>          hosted: minimum gap between requests (default 3000)
 *   --out <dir>               run directory (default live/runs/<time>-<provider>); not with --resume
 *   --resume <dir>            continue a run directory; with it, --rerun-failed re-runs provider and policy failures
 *   --force                   hosted: proceed although the Worker probe is not phase-0.5
 *
 * Every option is validated, and the cells planned, before any preflight or
 * provider call: an unknown arm, condition, provider, reference, prompt,
 * block or option, an empty list, a count that is not a whole number, an
 * option the chosen provider would ignore, a hosted cap too small to admit
 * a cell, and a selection that plans no cells are each refused by name.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { frozenMismatches, readCorpus, type Corpus } from "./corpus";
import { planCells, runEvaluation } from "./evaluate";
import { DEFAULT_BACKOFF_MS, createPacer } from "./pacing";
import { preflight } from "./preflight";
import { CELL_REQUESTS, cellRequestBound, createHostedProvider } from "./providers/hosted";
import { createOllamaProvider, ollamaHost } from "./providers/ollama";
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
  const list = (flag: string): string[] | undefined => {
    const raw = values.get(flag);
    if (raw === undefined) return undefined;
    const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) throw new Error(`${flag} needs at least one value`);
    return items;
  };
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
  const references = list("--reference") ?? [...REFERENCE_IDS];
  for (const reference of references) if (!REFERENCE_IDS.includes(reference)) throw new Error(`unknown reference '${reference}'; use ${REFERENCE_IDS.join(", ")}`);
  const prompts = list("--prompts");
  const blocks = list("--blocks");
  const limit = count("--limit", 1);
  const maxRequests = count("--max-requests", 1, 300)!;
  const spacingMs = count("--spacing-ms", 0, 3000)!;

  // An option the chosen provider would ignore is refused, never dropped.
  const hosted = provider === "hosted";
  for (const flag of ["--max-requests", "--spacing-ms", "--base-url"]) if (values.has(flag) && !hosted) throw new Error(`${flag} applies to the hosted provider only`);
  if (switches.has("--force") && !hosted) throw new Error("--force applies to the hosted provider only");
  if (values.has("--ollama-host") && typeof provider !== "object") throw new Error("--ollama-host applies to an ollama provider only");
  // The pacer admits a cell only when the cap covers its worst case, so a smaller cap could never run one.
  const bound = cellRequestBound(DEFAULT_BACKOFF_MS.length);
  if (hosted && maxRequests < bound) {
    throw new Error(`--max-requests must be at least ${bound} for the hosted provider: a cell is admitted only when the cap covers its worst case, ${CELL_REQUESTS} requests each retried up to ${DEFAULT_BACKOFF_MS.length} times`);
  }
  if (switches.has("--rerun-failed") && !values.has("--resume")) throw new Error("--rerun-failed needs --resume <dir>: it re-runs the failures of an existing run");
  if (values.has("--out") && values.has("--resume")) throw new Error("--out does not apply to --resume, which continues the run in its own directory");

  return {
    provider,
    baseUrl: values.get("--base-url") ?? process.env.COMPOSER_PROD_URL ?? "https://composer.aesthetic-function.com",
    ...(values.has("--ollama-host") ? { ollamaHost: values.get("--ollama-host")! } : {}),
    references,
    ...(arms ? { arms } : {}),
    ...(conditions ? { conditions } : {}),
    ...(prompts ? { prompts } : {}),
    ...(blocks ? { blocks } : {}),
    ...(limit !== undefined ? { limit } : {}),
    maxRequests,
    spacingMs,
    ...(values.has("--out") ? { out: values.get("--out")! } : {}),
    ...(values.has("--resume") ? { resume: values.get("--resume")! } : {}),
    rerunFailed: switches.has("--rerun-failed"),
    allowDrafts: switches.has("--allow-drafts"),
    force: switches.has("--force"),
  };
}

/** Prompt and block ids must be ones the corpus holds for the selected references: a typo is refused, never run as nothing. */
export function validateSelection(o: CliOptions, corpus: Corpus): void {
  for (const id of o.prompts ?? []) {
    const prompt = corpus.prompts.find((p) => p.id === id);
    if (!prompt) throw new Error(`unknown prompt '${id}' in corpus ${corpus.corpus}`);
    if (!o.references.some((reference) => typeof prompt.intent[reference] === "string")) throw new Error(`prompt '${id}' does not apply to ${o.references.join(" or ")}`);
  }
  const known = [...new Set(corpus.prompts.map((p) => p.block).filter((b): b is string => b !== null))].sort();
  for (const block of o.blocks ?? []) if (block !== "null" && !known.includes(block)) throw new Error(`unknown block '${block}'; use ${known.join(", ")} or null`);
}

export async function main(argv: readonly string[], io: { corpus?: Corpus } = {}): Promise<number> {
  let o: CliOptions;
  const corpus = io.corpus ?? readCorpus();
  try {
    o = parseOptions(argv);
    validateSelection(o, corpus);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  // ADR-B3: the corpus is frozen before any run. An edit re-freezes it deliberately (corpora/frozen.json).
  const unfrozen = await frozenMismatches(corpus);
  if (unfrozen.length > 0) {
    console.error(`the corpus is not the frozen corpus pinned in live/corpora/frozen.json:\n- ${unfrozen.join("\n- ")}\nRe-freeze a deliberate edit (a new frozenAt and digest in the pin, in the same commit) before running.`);
    return 2;
  }
  const references = await Promise.all(o.references.map((id) => loadReference(id)));
  const selection = {
    ...(o.arms ? { arms: o.arms } : {}),
    ...(o.conditions ? { conditions: o.conditions } : {}),
    ...(o.prompts ? { promptIds: o.prompts } : {}),
    ...(o.blocks ? { blocks: o.blocks } : {}),
    ...(o.limit !== undefined ? { limit: o.limit } : {}),
  };
  // Planned before any network call: a selection that plans nothing is refused here, creating nothing.
  if (planCells({ references, corpus, ...selection }).length === 0) {
    console.error("the selection plans no cells: no prompt matches every filter given (--reference, --prompts, --blocks)");
    return 2;
  }

  let provider: Provider;
  if (o.provider === "hosted") provider = createHostedProvider({ baseUrl: o.baseUrl, pacer: createPacer({ maxRequests: o.maxRequests, spacingMs: o.spacingMs }) });
  else if (typeof o.provider === "object") provider = createOllamaProvider({ model: o.provider.ollama, ...(o.ollamaHost ? { host: o.ollamaHost } : {}) });
  else provider = createScriptedProvider({ faults: o.provider === "scripted:faults" });

  const pre = await preflight({
    references,
    ...(provider.kind === "hosted" ? { baseUrl: o.baseUrl } : {}),
    ...(typeof o.provider === "object" ? { ollama: { host: ollamaHost(o.ollamaHost), model: o.provider.ollama } } : {}),
  });
  console.log(JSON.stringify(pre, null, 2));
  if (pre.model && !pre.model.digest) {
    console.error(`Ollama reports no digest for ${pre.model.name} (${pre.model.detail ?? "unknown"}); a run must pin the weights it measures. Pull the model, or check --ollama-host.`);
    return 1;
  }
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
      ...selection,
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
