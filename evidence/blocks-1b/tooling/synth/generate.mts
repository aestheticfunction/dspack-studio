/**
 * Generates a synthetic multi-window run directory from a scenario, offline: each invocation in its own process
 * (invocation.mts, through the real harness and the real Worker with a scripted model binding), a copy of the run
 * directory after every invocation but the last (snapshots/after-<k>, as an operator keeps each window's evidence),
 * each invocation's output (logs/invocation-<k>.log), and invocations.txt in the Astryx run's format. A launch the
 * harness refuses (`refused`: it writes no preflight, so it is no invocation) is logged as logs/refused-<k>.log and
 * recorded in invocations.txt as a "refused launch" line, which the verifier does not read as an invocation.
 *
 *   tsx generate.mts <scenario.json> <out dir> [dspack-studio checkout, default /home/user/dspack-studio]
 *
 * The out directory must not exist. Run with the checkout's own tsx (packages/block-bench/node_modules/.bin/tsx).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [scenarioPath, outArg, rootArg] = process.argv.slice(2);
if (!scenarioPath || !outArg) throw new Error("usage: generate.mts <scenario.json> <out dir> [checkout]");
const root = resolve(rootArg ?? "/home/user/dspack-studio");
const out = resolve(outArg);
if (existsSync(out)) throw new Error(`${out} exists; generate into a new directory`);
const here = dirname(fileURLToPath(import.meta.url));
const scenario = JSON.parse(readFileSync(scenarioPath, "utf8")) as {
  name: string;
  runId: string;
  promptIds: string[];
  spacingMs: number;
  maxTotalRequests: number;
  maxTotalUsd: number;
  baseUrl: string;
  buildId: string;
  invocations: Array<{ note: string; maxRequests: number; rerunFailed?: boolean; events?: Record<string, string>; killAtSpacingAfter?: number; loseLockBefore?: number; maxTotalRequests?: number; refused?: boolean }>;
};

const tsx = join(root, "packages/block-bench/node_modules/.bin/tsx");
const run = join(out, "run");
mkdirSync(join(out, "logs"), { recursive: true });
mkdirSync(join(out, "configs"), { recursive: true });
writeFileSync(join(out, "scenario.json"), `${JSON.stringify(scenario, null, 2)}\n`);
const { codeIdentity } = await import(pathToFileURL(join(root, "packages/block-bench/live/identity.ts")).href);
const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
writeFileSync(join(out, "generated.json"), `${JSON.stringify({ checkout: head, code: codeIdentity(), node: process.version, at: new Date().toISOString() }, null, 2)}\n`);

const windows = scenario.invocations.filter((inv) => !inv.refused).length;
let k = 0;
for (const inv of scenario.invocations) {
  const window = inv.refused ? k : k + 1;
  const config = {
    root,
    dir: run,
    runId: scenario.runId,
    promptIds: scenario.promptIds,
    resume: window > 1 || !!inv.refused,
    rerunFailed: !!inv.rerunFailed,
    maxRequests: inv.maxRequests,
    spacingMs: scenario.spacingMs,
    ...(window === 1 && !inv.refused ? { maxTotalRequests: scenario.maxTotalRequests, maxTotalUsd: scenario.maxTotalUsd } : {}),
    ...(inv.maxTotalRequests !== undefined ? { maxTotalRequests: inv.maxTotalRequests } : {}),
    baseUrl: scenario.baseUrl,
    buildId: scenario.buildId,
    ...(inv.events ? { events: inv.events } : {}),
    ...(inv.killAtSpacingAfter !== undefined ? { killAtSpacingAfter: inv.killAtSpacingAfter } : {}),
    ...(inv.loseLockBefore !== undefined ? { loseLockBefore: inv.loseLockBefore } : {}),
  };
  const name = inv.refused ? `refused-${window}` : `invocation-${window}`;
  const configPath = join(out, "configs", `${name}.json`);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  // Invocations never overlap, and each starts on a later millisecond than anything the one before it wrote.
  await new Promise((r) => setTimeout(r, 20));
  const started = new Date().toISOString();
  if (!inv.refused) appendFileSync(join(out, "invocations.txt"), `invocation ${window} start ${started}\n`);
  const log = openSync(join(out, "logs", `${name}.log`), "w");
  const child = spawnSync(tsx, [join(here, "invocation.mts"), configPath], { stdio: ["ignore", log, log], cwd: join(root, "packages/block-bench") });
  closeSync(log);
  const ended = child.signal ? `signal ${child.signal}` : `exit ${child.status}`;
  appendFileSync(join(out, "invocations.txt"), inv.refused ? `refused launch after invocation ${window}: ${started} to ${new Date().toISOString()} ${ended}\n` : `invocation ${window} end ${new Date().toISOString()} ${ended}\n`);
  console.log(`${inv.refused ? "refused launch" : `invocation ${window}`} (${inv.note}): ${ended}`);
  if (inv.refused) continue;
  k = window;
  if (k < windows) {
    // The window's evidence: the run directory as the invocation left it, the lock aside (it names this machine).
    cpSync(run, join(out, "snapshots", `after-${k}`), { recursive: true, filter: (src) => !/run\.lock/.test(src.slice(run.length)) });
  }
}
console.log(`files: ${readdirSync(run).sort().join(", ")}`);
