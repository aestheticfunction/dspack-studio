/**
 * One invocation of a synthetic multi-window run, as one CLI process makes it (live/run.ts): its own pacer, preflight
 * and invocation id, through the real harness (runEvaluation, the hosted provider, the pacer, the ledger and the lock)
 * and the real Worker (apps/composer/worker/propose.mjs), whose model binding is scripted. Nothing leaves the process
 * and no provider is called.
 *
 *   tsx invocation.mts <config.json>
 *
 * The binding answers a plan with the prompt's own intent and no block, so every arm routes to primitive generation,
 * and a surface request with the reference's worked example (a refinement edits its prior's first text, as the app's
 * scripted twin does). Each reply names Claude Haiku 4.5 and reports usage, so it settles at what it reported. The n-th
 * request this invocation sends can instead meet one of these events (config.events, keyed by n):
 *   busy      the gateway turns the call away with HTTP 429 and a message that names no busy word, so only the status
 *             decides: the Worker answers 503 busy, a refusal that cost nothing, which the paced harness releases and
 *             retries after a backoff
 *   zone429   the Worker's own limiter refuses it before any provider call (429 rate-limited, calls [])
 *   garble    the first output is not JSON: the Worker asks again inside the request (two calls in one request)
 *   no-usage  the reply reports no usage: the harness raises the request to its worst case and halts (exit 3)
 *   kill      the process is killed while the request is open (SIGKILL): no settlement and no pacing entry
 * With config.killAtSpacingAfter = n, the process is killed at its first spacing wait after the n-th request: an
 * operator monitor stopping the run between cells (SIGKILL, so nothing is written on the way out). With
 * config.sleepScale, the pacer's waits are slept for real at that fraction, so a monitor can watch the run as it goes.
 * With config.loseLockBefore = n, the run's lock is deleted in the spacing wait before the n-th request: the harness
 * puts that request's line on the record, finds the lock no longer its own, and stops (LockLost, exit 1) unsent.
 * With config.killAfterPreflight, the process is killed (SIGKILL) as soon as its preflight is on the disk: an invocation
 * that dies before it raises a request an earlier one left open (the harness raises it after writing the preflight).
 *
 * The exit code is the CLI's (live/run.ts stopNotice): 0 complete or a cap, 3 a call the run cannot trust, 1 an error.
 */
import fs, { readFileSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Json = Record<string, any>;
const config = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as {
  root: string;
  dir: string;
  runId: string;
  promptIds: string[];
  resume: boolean;
  rerunFailed?: boolean;
  maxRequests: number;
  spacingMs: number;
  maxTotalRequests?: number;
  maxTotalUsd?: number;
  baseUrl: string;
  buildId: string;
  events?: Record<string, "busy" | "zone429" | "garble" | "no-usage" | "kill">;
  killAtSpacingAfter?: number;
  /** Real sleeps at this fraction of the pacer's (0.02: a 12 s spacing takes 240 ms), so a monitor can watch the run. */
  sleepScale?: number;
  /** The run's lock is deleted in the spacing wait before the n-th request: its line is written, then LockLost (exit 1). */
  loseLockBefore?: number;
  /** Killed as soon as the invocation's preflight is written, before it raises anything. */
  killAfterPreflight?: boolean;
};

if (config.killAfterPreflight) {
  // The harness writes its preflight with writeFileSync (live/evaluate.ts writeJson); its named import follows this.
  const write = fs.writeFileSync;
  (fs as { writeFileSync: typeof write }).writeFileSync = ((file: Parameters<typeof write>[0], ...rest: unknown[]) => {
    (write as (...args: unknown[]) => void)(file, ...rest);
    if (/preflight(\.resume-\d+)?\.json$/.test(String(file))) process.kill(process.pid, "SIGKILL");
  }) as typeof write;
  syncBuiltinESMExports();
}

const load = (path: string) => import(pathToFileURL(join(config.root, path)).href);
const { handlePropose, handleModels } = await load("apps/composer/worker/propose.mjs");
const { exampleFor } = await load("packages/block-bench/live/arms.ts");
const { readCorpusVersion } = await load("packages/block-bench/live/corpus.ts");
const { runEvaluation } = await load("packages/block-bench/live/evaluate.ts");
const { DEFAULT_BACKOFF_MS, createPacer } = await load("packages/block-bench/live/pacing.ts");
const { preflight } = await load("packages/block-bench/live/preflight.ts");
const { createHostedProvider } = await load("packages/block-bench/live/providers/hosted.ts");
const { loadReference } = await load("packages/block-bench/live/references.ts");
const { stopNotice } = await load("packages/block-bench/live/run.ts");

const MODEL = "claude-haiku-4-5-20251001";
const corpus = readCorpusVersion(2);
const astryx = await loadReference("astryx");

/** The corpus prompt a request is about: the one whose goal its messages carry. */
const promptOf = (body: Json): Json | undefined => {
  const text = JSON.stringify(body.messages ?? []);
  return corpus.prompts.find((p: Json) => text.includes(JSON.stringify(p.goal).slice(1, -1)));
};

/** The app's scripted twin: the first text node gains "(refined)", then "(refined N)". */
function refined(prior: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(prior)) as Json;
  const first = (node: unknown): Json | null => {
    if (!node || typeof node !== "object") return null;
    const record = node as Json;
    if (typeof record.text === "string") return record;
    for (const value of Object.values(record)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        const found = first(child);
        if (found) return found;
      }
    }
    return null;
  };
  const node = first(copy.root ?? copy);
  if (node) {
    const existing = /^(.*?)(?: \(refined(?: (\d+))?\))$/.exec(node.text as string);
    node.text = existing ? `${existing[1]} (refined ${Number(existing[2] ?? 1) + 1})` : `${node.text} (refined)`;
  }
  return copy;
}

/** What the scripted model answers a request: a plan, or a surface. */
function answer(body: Json): string {
  const prompt = promptOf(body);
  const intent = (prompt?.intent?.astryx as string | undefined) ?? "record-collection";
  const schema = body.jsonSchema as Json | undefined;
  if (schema?.properties?.feasible) {
    const plan: Json = { intent, feasible: true, restated: String(prompt?.goal ?? "the goal"), reason: "the goal fits the intent" };
    if (schema.properties.block) Object.assign(plan, { block: null, blockReason: "the scripted model routes every goal to primitive generation" });
    return JSON.stringify(plan);
  }
  const prior = [...((body.messages as Json[] | undefined) ?? [])].reverse().find((m) => m.role === "assistant");
  if (prior) {
    try {
      const surface = JSON.parse(String(prior.content));
      if (surface && typeof surface === "object" && surface.root) return JSON.stringify(refined(surface));
    } catch {
      /* not a prior surface: answer fresh */
    }
  }
  return JSON.stringify(exampleFor(astryx, intent));
}

const tokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));
let current: { n: number; event?: string; calls: number; body: Json } = { n: 0, calls: 0, body: {} };
const env: Json = {
  HOSTED_AI: "on",
  AI: {
    lastRequestHttpStatusCode: null as number | null,
    async run(_model: string, input: unknown) {
      current.calls += 1;
      if (current.event === "kill") {
        process.kill(process.pid, "SIGKILL");
        await new Promise(() => undefined);
      }
      if (current.event === "busy") {
        this.lastRequestHttpStatusCode = 429;
        const error = new Error("the gateway refused the request");
        error.name = "AiError";
        throw error;
      }
      this.lastRequestHttpStatusCode = 200;
      const text = current.event === "garble" && current.calls === 1 ? "Here is the surface you asked for." : answer(current.body);
      const usage = { input_tokens: tokens(JSON.stringify(input)), output_tokens: tokens(text) + 5 };
      return { content: [{ type: "text", text }], model: MODEL, ...(current.event === "no-usage" ? {} : { usage }) };
    },
  },
};

let armed = false;
const fetchImpl = (async (url: string, init: RequestInit) => {
  const n = current.n + 1;
  current = { n, calls: 0, body: JSON.parse(String(init.body)), ...(config.events?.[String(n)] ? { event: config.events[String(n)] } : {}) };
  if (current.event === "zone429") env.PROPOSE_RATE_LIMIT = { limit: async () => ({ success: false }) };
  else delete env.PROPOSE_RATE_LIMIT;
  const res = await handlePropose(new Request(url, init), env);
  if (config.killAtSpacingAfter !== undefined && n >= config.killAtSpacingAfter) armed = true;
  return res;
}) as typeof fetch;

/** The deployment the preflight reads: the Worker's own probe and models answers, and a build id it serves. */
const probe = (async (url: string, init?: RequestInit) => {
  const { pathname } = new URL(url);
  if (pathname === "/api/propose") return handlePropose(new Request(url, init), { ...env, AI: { run: async () => ({}) } });
  if (pathname === "/api/models") return handleModels(env);
  if (pathname === "/") return new Response(`<script src="/_next/static/${config.buildId}/_buildManifest.js"></script>`, { headers: { "content-type": "text/html" } });
  if (pathname === `/_next/static/${config.buildId}/_buildManifest.js`) return new Response("self.__BUILD_MANIFEST={}");
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const pacer = createPacer({
  maxRequests: config.maxRequests,
  spacingMs: config.spacingMs,
  backoffMs: DEFAULT_BACKOFF_MS,
  now: () => 0,
  sleep: async (ms: number) => {
    if (armed && ms === config.spacingMs) process.kill(process.pid, "SIGKILL");
    if (config.loseLockBefore !== undefined && current.n === config.loseLockBefore - 1 && ms === config.spacingMs) rmSync(join(config.dir, "run.lock"), { force: true });
    if (config.sleepScale) await new Promise((r) => setTimeout(r, ms * config.sleepScale!));
  },
});

let code = 0;
try {
  const result = await runEvaluation({
    runId: config.runId,
    provider: createHostedProvider({ baseUrl: config.baseUrl, fetchImpl, pacer }),
    references: [astryx],
    corpus,
    preflight: await preflight({ references: [astryx], baseUrl: config.baseUrl, fetchImpl: probe }),
    promptIds: config.promptIds,
    outDir: config.dir,
    resume: config.resume,
    rerunFailed: !!config.rerunFailed,
    ...(config.maxTotalRequests !== undefined ? { maxTotalRequests: config.maxTotalRequests } : {}),
    ...(config.maxTotalUsd !== undefined ? { maxTotalUsd: config.maxTotalUsd } : {}),
    log: (line: string) => console.log(line),
  });
  console.log(`\nrun ${result.runId}: ${result.cells.done} of ${result.cells.total} cells (${result.cells.reused} reused)`);
  if (result.stopped) {
    const notice = stopNotice(result.stopped, config.dir);
    console.log(notice.text);
    code = notice.code;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  code = 1;
}
process.exit(code);
