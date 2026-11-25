/**
 * The live pilot's command line (docs/repositioning/LIVE-PILOT-RUNBOOK.md). Three commands, and no way to choose
 * prompts, references, models or a higher ceiling:
 *
 *   pilot check  [--base URL]                          the access preflight, no model call
 *   pilot run    --out DIR [--base URL] [--max-usd N]  the twelve runs, resumable; N may only lower the $5 ceiling
 *   pilot status --out DIR                             what the ledger and state say
 *
 * The Access service token is read from PILOT_ACCESS_CLIENT_ID and PILOT_ACCESS_CLIENT_SECRET and never printed.
 * To stop a running pilot: create a file named STOP in the run directory (it stops before the next request), or
 * interrupt it; a request in flight is then counted at the most it could cost.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkAccess, tokenFromEnv, withToken } from "./access";
import { readPilotLedger } from "./ledger";
import { runPilot } from "./pilot";
import { PILOT_CEILING_USD, PILOT_RUNS } from "./runs";

export const DEFAULT_BASE = "https://composer.aesthetic-function.com";

export interface ParsedArgs {
  command: "check" | "run" | "status";
  base: string;
  out?: string;
  maxUsd?: number;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (command !== "check" && command !== "run" && command !== "status") throw new Error("usage: pilot check | pilot run --out DIR [--max-usd N] | pilot status --out DIR");
  const parsed: ParsedArgs = { command, base: DEFAULT_BASE };
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--out") parsed.out = value;
    else if (flag === "--base") {
      if (!/^https:\/\//.test(value)) throw new Error("--base must be an https origin");
      parsed.base = value;
    } else if (flag === "--max-usd") {
      const n = Number(value);
      if (!(n > 0 && n <= PILOT_CEILING_USD)) throw new Error(`--max-usd may only lower the pilot's $${PILOT_CEILING_USD} ceiling`);
      parsed.maxUsd = n;
    } else throw new Error(`unknown option ${flag}: the pilot's prompts, reference, model and ceiling are fixed`);
  }
  if (command !== "check" && !parsed.out) throw new Error(`pilot ${command} needs --out DIR`);
  return parsed;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.command === "status") {
    const ledger = readPilotLedger(join(args.out!, "requests.jsonl"));
    const stateFile = join(args.out!, "state.json");
    const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { completed: [] };
    const stopped = state.stopped ? `; stopped (${state.stopped.reason}): ${state.stopped.message}` : "";
    console.log(`completed ${state.completed.length} of ${PILOT_RUNS.length} runs; committed $${(ledger.nanos / 1e9).toFixed(4)} over ${ledger.sent} requests; served model ${state.servedModel ?? "none"}${stopped}`);
    return 0;
  }
  const token = tokenFromEnv();
  const access = await checkAccess(args.base, token);
  for (const line of access.lines) console.log(line);
  if (!access.ok) {
    console.log("The access preflight failed, so nothing was sent.");
    return 2;
  }
  if (args.command === "check") return 0;
  const result = await runPilot({ baseUrl: args.base, outDir: args.out!, fetchImpl: withToken(token!), ...(args.maxUsd !== undefined ? { maxUsd: args.maxUsd } : {}) });
  console.log(`committed $${result.usd.toFixed(4)} over ${result.requests} requests; ${result.completed.length} of ${PILOT_RUNS.length} runs complete`);
  return result.stopped ? 3 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
