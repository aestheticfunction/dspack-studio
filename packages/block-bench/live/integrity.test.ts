/**
 * Benchmark integrity for a hosted run (live/integrity.ts): a call that reached the provider must report its complete
 * usage and, on its own calls[] entry, the model that served it (Option B: a reply's top-level model is never a call's),
 * that model must be Claude Haiku 4.5, and it must stay the model the run's first metered call reported, which the
 * manifest records once and every resume holds to. Anything else stops the run cleanly, apart from arm results, and the
 * run stays resumable. Refusals that reached no model are exempt.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createCallRecorder } from "@dspack-studio/composer-core";
import { handlePropose } from "../../../apps/composer/worker/propose.mjs";
import { exampleFor } from "./arms";
import { readCorpus, type Corpus } from "./corpus";
import { runEvaluation } from "./evaluate";
import { PRICED_MODEL } from "./cost";
import { MODEL_FAMILY, RunHalted } from "./integrity";
import { createPacer } from "./pacing";
import { preflight } from "./preflight";
import { createHostedProvider } from "./providers/hosted";
import { createOllamaProvider } from "./providers/ollama";
import { createMeter } from "./providers/types";
import { loadReference, type LoadedReference } from "./references";

const HAIKU = "claude-haiku-4-5-20251001";
const request = { system: "s", messages: [{ role: "user" as const, content: "u" }], jsonSchema: { type: "object" } };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const plan = { intent: "record-collection", feasible: true, restated: "A table.", reason: "fits", block: "records-table", blockReason: "it is a table" };

let corpus: Corpus;
let astryx: LoadedReference;
beforeAll(async () => {
  corpus = readCorpus();
  astryx = await loadReference("astryx");
}, 60_000);

/**
 * The REAL Worker module, its provider answering every call with valid JSON, full usage and the model `modelOf` names
 * for the cell the call belongs to (counted by its planning calls: the first cell is 1).
 */
function worker(modelOf: (cell: number) => string | undefined) {
  let cell = 0;
  let posted = 0;
  const env = {
    HOSTED_AI: "on",
    AI: {
      run: async (_m: string, input: { system: string }) => {
        const kind = input.system.includes("routing step") ? "plan" : input.system.includes("Interface block") || input.system.includes("named call") ? "block" : "surface";
        if (kind === "plan") cell += 1;
        const json = kind === "plan" ? plan : kind === "block" ? { block: "records-table", version: 1 } : exampleFor(astryx, "record-collection");
        return { content: [{ type: "text", text: JSON.stringify(json) }], usage: { input_tokens: 100, output_tokens: 10 }, model: modelOf(cell) };
      },
    },
  };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    posted += 1;
    return handlePropose(new Request(url, init), env);
  }) as typeof fetch;
  return { fetchImpl, posted: () => posted };
}

/** One invocation of a hosted run in `dir`, as one CLI process makes it. */
async function invocation(dir: string, fetchImpl: typeof fetch) {
  return runEvaluation({
    runId: "integrity",
    provider: createHostedProvider({ baseUrl: "https://example.test", fetchImpl, pacer: createPacer({ maxRequests: 300, spacingMs: 0, backoffMs: [0], now: () => 0, sleep: async () => undefined }) }),
    references: [astryx],
    corpus,
    preflight: await preflight({ references: [astryx] }),
    allowDrafts: true,
    promptIds: ["rt-01"],
    conditions: ["fresh"],
    outDir: dir,
    resume: existsSync(join(dir, "manifest.json")),
    maxTotalRequests: 1000,
    maxTotalUsd: 1000,
  });
}

const manifestOf = (dir: string) => JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const logged = (dir: string) => (existsSync(join(dir, "runs.jsonl")) ? readFileSync(join(dir, "runs.jsonl"), "utf8").trim().split("\n").filter(Boolean) : []);
const ledger = (dir: string) => readFileSync(join(dir, "requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { usd?: number; adjust?: number; servedModel?: string });

describe("the model a hosted run measures", () => {
  it("is recorded once, from the run's first metered call, and every later call that reports it continues", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-integrity-"));
    try {
      const w = worker(() => HAIKU);
      const result = await invocation(dir, w.fetchImpl);
      expect(result.stopped).toBeUndefined();
      expect(result.records).toHaveLength(4);
      expect(manifestOf(dir).servedModel).toMatchObject({ id: HAIKU });
      expect(typeof manifestOf(dir).servedModel.at).toBe("string");
      const report = readFileSync(join(dir, "REPORT.md"), "utf8");
      expect(report).toContain(`Served model: \`${HAIKU}\``);
      expect(report).not.toMatch(/confirms no snapshot/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("records the configured id when the provider names it, and the report says it confirms no snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-integrity-"));
    try {
      const result = await invocation(dir, worker(() => PRICED_MODEL).fetchImpl);
      expect(result.stopped).toBeUndefined();
      expect(manifestOf(dir).servedModel).toMatchObject({ id: PRICED_MODEL });
      const report = readFileSync(join(dir, "REPORT.md"), "utf8");
      expect(report).toContain(`Served model: \`${PRICED_MODEL}\``);
      expect(report).toMatch(/confirms no snapshot/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("stops the run cleanly when the model changes, logs no record for the cell in flight but keeps what it spent, and a resume holds to the recorded model", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-integrity-"));
    try {
      // The first cell is served by Haiku 4.5; from the second cell's planning call, another snapshot answers.
      const changed = worker((cell) => (cell < 2 ? HAIKU : "claude-haiku-4-5-20260301"));
      const first = await invocation(dir, changed.fetchImpl);
      expect(first.stopped).toMatchObject({ reason: "integrity" });
      expect(first.stopped?.message).toMatch(/model-changed/);
      expect(first.stopped?.message).toContain(HAIKU);
      expect(first.stopped?.message).toContain("claude-haiku-4-5-20260301");
      expect(logged(dir)).toHaveLength(1);
      expect(manifestOf(dir).servedModel).toMatchObject({ id: HAIKU });
      // The request that revealed the change was settled like any other: its spend is on the record.
      const lines = ledger(dir);
      expect(lines.filter((l) => l.adjust === undefined).length).toBe(lines.filter((l) => l.adjust !== undefined).length);
      // A resume holds to the recorded model: the same change stops it again at its first reply.
      const again = await invocation(dir, worker(() => "claude-haiku-4-5-20260301").fetchImpl);
      expect(again.stopped).toMatchObject({ reason: "integrity" });
      expect(logged(dir)).toHaveLength(1);
      // Served by the recorded model again, the run continues where it stopped, and the record never changes.
      const resumed = await invocation(dir, worker(() => HAIKU).fetchImpl);
      expect(resumed.stopped).toBeUndefined();
      expect(logged(dir)).toHaveLength(4);
      expect(manifestOf(dir).servedModel).toMatchObject({ id: HAIKU });
      // The finished run keeps both stops on the record, in its summary and its report: a cell that stopped ran again.
      const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) as { invocations: Array<{ stopped?: { reason: string } }> };
      expect(summary.invocations.filter((i) => i.stopped?.reason === "integrity")).toHaveLength(2);
      const report = readFileSync(join(dir, "REPORT.md"), "utf8");
      expect(report).toMatch(/Integrity stops: 2/);
      expect(report.match(/model-changed: /g)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("reports the stop apart from arm results, in the summary and the report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-integrity-"));
    try {
      await invocation(dir, worker((cell) => (cell < 2 ? HAIKU : "claude-haiku-4-5-20260301")).fetchImpl);
      expect(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")).stopped).toMatchObject({ reason: "integrity" });
      expect(readFileSync(join(dir, "REPORT.md"), "utf8")).toMatch(/Stopped: integrity: model-changed/);
      // Written before any resume, the report says what a resume does, never that one ran.
      expect(readFileSync(join(dir, "REPORT.md"), "utf8")).toContain("a resume runs the cell again from its start");
      expect(readFileSync(join(dir, "REPORT.md"), "utf8")).not.toMatch(/resume ran/);
      // The completed cell is an arm result; the stop is not one.
      expect(logged(dir).map((l) => JSON.parse(l).failure)).toEqual([undefined]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("a resume holds to the model the run measured, whatever its manifest now says", () => {
  const OTHER = "claude-haiku-4-5-20260301";
  /** A run whose first cell was measured on Haiku 4.5, stopped when the next cell was served by another snapshot. */
  const measured = async (dir: string) => {
    const first = await invocation(dir, worker((cell) => (cell < 2 ? HAIKU : OTHER)).fetchImpl);
    expect(first.stopped?.message).toMatch(/^model-changed: /);
    expect(logged(dir)).toHaveLength(1);
    return readFileSync(join(dir, "manifest.json"), "utf8");
  };
  /** Rewrites the run's manifest by hand, its served model replaced, or removed when `servedModel` is undefined. */
  const tamper = (dir: string, servedModel: unknown) => {
    const manifest = manifestOf(dir);
    if (servedModel === undefined) delete manifest.servedModel;
    else manifest.servedModel = servedModel;
    writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  };

  it("refuses a resume whose manifest records a malformed served model, before anything is sent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-integrity-"));
    try {
      const original = await measured(dir);
      const at = manifestOf(dir).servedModel.at;
      // Its id and the time it was recorded, and nothing else: an id of another family, a time that is not the one the
      // run wrote, or a field it never writes, is a record the run did not make.
      for (const servedModel of [{}, HAIKU, null, { id: null, at }, { id: 42, at }, { id: HAIKU }, { id: "claude-opus-4-1-20250805", at }, { id: HAIKU, at: "" }, { id: HAIKU, at: "not a date" }, { id: HAIKU, at: at.slice(0, 10) }, { id: HAIKU, at, restored: "by hand" }, [HAIKU, at], { id: [HAIKU], at }]) {
        tamper(dir, servedModel);
        const w = worker(() => OTHER);
        await expect(invocation(dir, w.fetchImpl), JSON.stringify(servedModel)).rejects.toThrow(/^resume refused: .*servedModel/s);
        expect(w.posted(), JSON.stringify(servedModel)).toBe(0);
        expect(logged(dir)).toHaveLength(1);
        writeFileSync(join(dir, "manifest.json"), original);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses a resume whose manifest no longer names the model its records show it measured, or names another, even with its ledger gone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-integrity-"));
    try {
      const original = await measured(dir);
      // Each settlement made once the model was recorded carries it, so the ledger shows what the run measured; so do
      // the provider calls of the cell it logged.
      const settled = ledger(dir).filter((l) => l.adjust !== undefined);
      expect(settled.length).toBeGreaterThan(0);
      expect(new Set(settled.map((l) => l.servedModel))).toEqual(new Set([HAIKU]));
      const requests = readFileSync(join(dir, "requests.jsonl"), "utf8");
      const runs = readFileSync(join(dir, "runs.jsonl"), "utf8");
      // With the ledger deleted, the logged cell still names the model, even when its line lost only its newline: the
      // run reads that line as a whole record (readLog), so it counts as measured here too.
      for (const ledgerGone of [false, "deleted", "deleted, the log's newline lost"] as const) {
        for (const servedModel of [undefined, { id: OTHER, at: manifestOf(dir).servedModel.at }]) {
          const what = `${JSON.stringify(servedModel)}${ledgerGone ? `, ledger ${ledgerGone}` : ""}`;
          tamper(dir, servedModel);
          if (ledgerGone) rmSync(join(dir, "requests.jsonl"));
          if (ledgerGone === "deleted, the log's newline lost") writeFileSync(join(dir, "runs.jsonl"), runs.trimEnd());
          const w = worker(() => OTHER);
          await expect(invocation(dir, w.fetchImpl), what).rejects.toThrow(new RegExp(`^resume refused: .*${HAIKU}`, "s"));
          expect(w.posted(), what).toBe(0);
          expect(logged(dir)).toHaveLength(1);
          writeFileSync(join(dir, "manifest.json"), original);
          writeFileSync(join(dir, "requests.jsonl"), requests);
          writeFileSync(join(dir, "runs.jsonl"), runs);
        }
      }
      // With its manifest as it was, the run resumes, held to the model it measured.
      const resumed = await invocation(dir, worker(() => HAIKU).fetchImpl);
      expect(resumed.stopped).toBeUndefined();
      expect(logged(dir)).toHaveLength(4);
      expect(manifestOf(dir).servedModel).toMatchObject({ id: HAIKU });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  /** A run directory measured on Haiku 4.5 (as `measured`), its files then changed by `change`; deleted afterwards. */
  const withMeasured = async (change: (dir: string) => void, body: (dir: string) => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-integrity-"));
    try {
      await measured(dir);
      change(dir);
      await body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const loseLedger = (dir: string) => rmSync(join(dir, "requests.jsonl"));

  it("holds a resume to the model a logged cell names, even with its ledger deleted and the log's last newline lost, so no result mixes two models", async () => {
    // A whole record whose newline was lost is a logged result (readLog keeps it), so it counts as measured.
    await withMeasured(
      (dir) => {
        loseLedger(dir);
        writeFileSync(join(dir, "runs.jsonl"), readFileSync(join(dir, "runs.jsonl"), "utf8").trimEnd());
      },
      async (dir) => {
        const resumed = await invocation(dir, worker(() => OTHER).fetchImpl);
        expect(resumed.stopped?.message).toMatch(/^model-changed: /);
        expect(logged(dir)).toHaveLength(1);
        expect(manifestOf(dir).servedModel).toMatchObject({ id: HAIKU });
        expect(manifestOf(dir).setAside).toBeUndefined();
      },
    );
  }, 60_000);

  it("reads a cell a re-run replaced as measured too, its newline lost or not", async () => {
    // Right after --rerun-failed moves a record aside, only runs.superseded.jsonl names the model it was measured on.
    for (const newline of [true, false]) {
      await withMeasured(
        (dir) => {
          loseLedger(dir);
          const line = readFileSync(join(dir, "runs.jsonl"), "utf8");
          writeFileSync(join(dir, "runs.superseded.jsonl"), newline ? line : line.trimEnd());
          writeFileSync(join(dir, "runs.jsonl"), "");
        },
        async (dir) => {
          tamper(dir, undefined);
          const w = worker(() => OTHER);
          await expect(invocation(dir, w.fetchImpl), String(newline)).rejects.toThrow(new RegExp(`^resume refused: .*${HAIKU}`, "s"));
          expect(w.posted(), String(newline)).toBe(0);
        },
      );
    }
  }, 60_000);

  it("refuses an unreadable run log before it writes anything to the manifest", async () => {
    // The ledger gone and the logged cell's line damaged: the resume stops on the log as it would later, with the
    // manifest as it was, so a repaired log resumes held to the model it names.
    await withMeasured(
      (dir) => {
        loseLedger(dir);
        writeFileSync(join(dir, "runs.jsonl"), readFileSync(join(dir, "runs.jsonl"), "utf8").replace("{", "X"));
      },
      async (dir) => {
        const before = readFileSync(join(dir, "manifest.json"), "utf8");
        const w = worker(() => OTHER);
        await expect(invocation(dir, w.fetchImpl)).rejects.toThrow(/runs\.jsonl:1: not a JSON line/);
        expect(w.posted()).toBe(0);
        expect(readFileSync(join(dir, "manifest.json"), "utf8")).toBe(before);
      },
    );
  }, 60_000);

  it("refuses a run whose records show two models, whatever its manifest names", async () => {
    await withMeasured(
      (dir) => writeFileSync(join(dir, "runs.jsonl"), readFileSync(join(dir, "runs.jsonl"), "utf8").replaceAll(HAIKU, OTHER)),
      async (dir) => {
        for (const servedModel of [{ id: HAIKU, at: manifestOf(dir).servedModel.at }, { id: OTHER, at: manifestOf(dir).servedModel.at }, undefined]) {
          tamper(dir, servedModel);
          const w = worker(() => HAIKU);
          await expect(invocation(dir, w.fetchImpl), JSON.stringify(servedModel)).rejects.toThrow(/^resume refused: .*cannot be held to one model/s);
          expect(w.posted()).toBe(0);
        }
      },
    );
  }, 60_000);

  it("sets aside a cut-off last line of the run log, which names no model, and resumes", async () => {
    await withMeasured(
      (dir) => writeFileSync(join(dir, "runs.jsonl"), `${readFileSync(join(dir, "runs.jsonl"), "utf8")}{"calls":[{"source":"provider","model":"claude-haiku`),
      async (dir) => {
        const resumed = await invocation(dir, worker(() => HAIKU).fetchImpl);
        expect(resumed.stopped).toBeUndefined();
        expect(logged(dir)).toHaveLength(4);
        expect(readFileSync(join(dir, "runs.torn.jsonl"), "utf8")).toContain('"model":"claude-haiku');
      },
    );
  }, 60_000);

  it("leaves a local model's run alone: its resume is never held to the models its calls name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-integrity-"));
    try {
      const host = "http://127.0.0.1:9";
      const ollama = (async (url: string) =>
        String(url).endsWith("/api/tags")
          ? new Response(JSON.stringify({ models: [{ name: "gpt-oss:latest", digest: "sha256:0123" }] }))
          : new Response(JSON.stringify({ model: "gpt-oss:latest", message: { role: "assistant", content: "not json" }, done: true, prompt_eval_count: 10, eval_count: 5 }))) as unknown as typeof fetch;
      const pre = await preflight({ references: [astryx], ollama: { host, model: "gpt-oss:latest" }, fetchImpl: ollama });
      const run = (resume: boolean) =>
        runEvaluation({ runId: "local", provider: createOllamaProvider({ model: "gpt-oss:latest", host, fetchImpl: ollama }), references: [astryx], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01"], arms: ["production"], conditions: ["fresh"], outDir: dir, resume });
      await run(false);
      expect(logged(dir)).toHaveLength(1);
      expect(logged(dir)[0]).toContain('"model":"gpt-oss:latest"');
      await expect(run(true)).resolves.toMatchObject({ cells: { done: 1, reused: 1 } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("lets a fresh run, or one stopped before any model could be recorded, establish its first served model", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-integrity-"));
    try {
      // The plan's first call is served by a provider that names no model: the run stops at its first reply, before any
      // model is recorded, though a provider call was made and paid for.
      let calls = 0;
      const env = {
        HOSTED_AI: "on",
        AI: { run: async () => ({ content: [{ type: "text", text: JSON.stringify(plan) }], usage: { input_tokens: 100, output_tokens: 10 }, ...(calls++ === 0 ? {} : { model: HAIKU }) }) },
      };
      const first = await invocation(dir, (async (url: string, init: RequestInit) => handlePropose(new Request(url, init), env)) as typeof fetch);
      expect(first.stopped).toMatchObject({ reason: "integrity" });
      expect(first.stopped?.message).toMatch(/^model-missing: /);
      expect(manifestOf(dir).servedModel).toBeUndefined();
      expect(ledger(dir).filter((l) => l.adjust !== undefined)).toHaveLength(1);
      expect(ledger(dir).some((l) => l.servedModel !== undefined)).toBe(false);
      // Its resume, like a fresh run, records the first model a reply that holds reports, and runs to the end.
      const resumed = await invocation(dir, worker(() => OTHER).fetchImpl);
      expect(resumed.stopped).toBeUndefined();
      expect(manifestOf(dir).servedModel).toMatchObject({ id: OTHER });
      expect(logged(dir)).toHaveLength(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("a call that reached the provider stops the run unless it can be trusted", () => {
  /** A pacer bound, as the runner binds it, to a served-model record held in memory. */
  const bound = (id?: string) => {
    const pacer = createPacer({ maxRequests: 100, spacingMs: 0, backoffMs: [0], now: () => 0, sleep: async () => undefined });
    const served = { id, recorded: [] as string[] };
    pacer.served = {
      get id() {
        return served.id;
      },
      record(model: string) {
        served.id = model;
        served.recorded.push(model);
      },
    };
    return { pacer, served };
  };
  /** A calls[] entry as the Worker writes it since Option B: usage and the model that served the call. */
  const call = (fields: Record<string, unknown>) => ({ inputTokens: 10, outputTokens: 2, model: HAIKU, outcome: "ok", durationMs: 1, ...fields });
  const served = (calls: unknown[], extra: Record<string, unknown> = { model: HAIKU }) => reply(200, { json: { a: 1 }, raw: "{}", ...extra, calls });
  const generate = (answer: () => Response | Promise<Response>, pacer: ReturnType<typeof createPacer>) =>
    createHostedProvider({ baseUrl: "https://example.test", fetchImpl: (async () => answer()) as typeof fetch, pacer }).surfaceAdapter({ recorder: createCallRecorder(), meter: createMeter(), refinement: false }).generate(request);

  it("stops on a call without a whole count of both usage figures, on one that names no model, and on a model outside Claude Haiku 4.5", async () => {
    for (const [name, answer, condition] of [
      ["no output count", () => served([call({ outputTokens: null })]), "usage-missing"],
      ["no usage at all", () => served([call({ inputTokens: null, outputTokens: null })]), "usage-missing"],
      ["a negative count", () => served([call({ outputTokens: -1 })]), "usage-missing"],
      ["a count that is not a whole number", () => served([call({ inputTokens: 10.5 })]), "usage-missing"],
      ["no input tokens, which no call that reached the model can report", () => served([call({ inputTokens: 0, outputTokens: 0 })]), "usage-missing"],
      ["an answer that does not itemize its calls, as a Worker before Phase 0.5 answers", () => served(undefined as never, { model: HAIKU, usage: { inputTokens: 10, outputTokens: 2 } }), "usage-missing"],
      ["a refusal that is not the Worker's, which cannot show no model ran", () => new Response("<html>forbidden</html>", { status: 403 }), "usage-missing"],
      ["a provider failure that reports nothing", () => reply(502, { error: "provider-unavailable", cause: "provider", message: "down", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 1 }] }), "usage-missing"],
      ["an answer that reports no provider call", () => served([]), "usage-missing"],
      // The Worker answers this way when its own reply fails after a billed call: calls: [] proves no model ran only on
      // one of its refusals made before any call.
      ["a 502 that reports no call", () => reply(502, { error: "provider-unavailable", cause: "provider", message: "down", usage: null, calls: [] }), "usage-missing"],
      ["an answer that reports no calls at all", () => served(undefined as never, { model: HAIKU, usage: null }), "usage-missing"],
      // Usage stated two ways cannot be metered: the app reads a figure's first spelling, and the Worker's total is the
      // sum of its calls.
      ["a figure stated under two spellings that disagree", () => served([call({ input_tokens: 1000 })]), "usage-missing"],
      ["a total that is not its calls' sum", () => served([call({})], { model: HAIKU, usage: { inputTokens: 1000, outputTokens: 2 } }), "usage-missing"],
      ["no model named", () => served([call({ model: undefined })], {}), "model-missing"],
      // Each call is held to the model its own entry names, never to the reply's: the shape of the Worker before
      // Option B, which named one model per reply, fails closed on every call that names none of its own.
      ["a success whose call names no model of its own, beside the reply's", () => served([call({ model: undefined })]), "model-missing"],
      ["a parse retry in the Worker's shape before Option B, the reply's model on neither call", () => served([call({ outcome: "unusable-output", model: undefined }), call({ model: undefined })]), "model-missing"],
      ["an unusable output in the Worker's shape before Option B, which names no model", () => reply(502, { error: "provider-unavailable", cause: "unusable-output", message: "no usable output", usage: { inputTokens: 10, outputTokens: 2 }, calls: [call({ outcome: "unusable-output", model: undefined })] }), "model-missing"],
      ["another model family on the call", () => served([call({ model: "claude-sonnet-4-5-20250929" })], { model: "claude-sonnet-4-5-20250929" }), "model-family"],
      ["another model family at the reply's top", () => served([call({})], { model: "claude-sonnet-4-5-20250929" }), "model-family"],
      ["a later Haiku generation on the call", () => served([call({ model: "claude-haiku-5-5" })], { model: "claude-haiku-5-5" }), "model-family"],
    ] as const) {
      const { pacer, served: record } = bound();
      await expect(generate(answer, pacer), name).rejects.toMatchObject({ name: "RunHalted", condition });
      expect(record.recorded, name).toEqual([]);
    }
  });

  it("knows Claude Haiku 4.5 only by the whole ids this deployment can return: the configured id, its unprefixed catalog name, Anthropic's alias and its dated snapshots", () => {
    for (const id of [PRICED_MODEL, "claude-haiku-4.5", "claude-haiku-4-5", HAIKU, "claude-haiku-4-5-20260301"]) expect(MODEL_FAMILY.test(id), id).toBe(true);
    const others = ["claude-haiku-4-50", "claude-haiku-4-5.1", "claude-haiku-45", "xclaude-haiku-4-5", "claude-3-5-haiku-20241022", "claude-haiku-5-5", "claude-sonnet-4-5-20250929", "anthropic/claude-haiku-4"];
    // Ids that merely contain one, or spell it another provider's way: any of them stops the run, until it is added here.
    const contained = ["evil/claude-haiku-4-5/other", "claude-haiku-4-5-sonnet", "claude-haiku-4-5-2025100", "anthropic/claude-haiku-4-5", "ANTHROPIC/CLAUDE-HAIKU-4.5", "anthropic.claude-haiku-4-5-20251001-v1:0", "claude-haiku-4-5@20251001", " claude-haiku-4-5"];
    for (const id of [...others, ...contained]) expect(MODEL_FAMILY.test(id), id).toBe(false);
  });

  it("records the first metered model, accepts it again, and stops on any other", async () => {
    const { pacer, served: record } = bound();
    await generate(() => served([call({})]), pacer);
    await generate(() => served([call({})]), pacer);
    expect(record.recorded).toEqual([HAIKU]);
    // A later call served by another snapshot stops the run, its reply naming that snapshot at its top as the Worker does.
    await expect(generate(() => served([call({ model: "claude-haiku-4-5-20260301" })], { model: "claude-haiku-4-5-20260301" }), pacer)).rejects.toMatchObject({ name: "RunHalted", condition: "model-changed" });
    // Resumed with a model already recorded, a call must report that model.
    const resumed = bound(HAIKU);
    await generate(() => served([call({})]), resumed.pacer);
    await expect(generate(() => served([call({ model: "anthropic/claude-haiku-4.5" })], { model: "anthropic/claude-haiku-4.5" }), resumed.pacer)).rejects.toMatchObject({ condition: "model-changed" });
    // So must every call of a parse retry: the first call another snapshot served stops the run, though the final call
    // and the reply's top name the recorded model.
    await expect(generate(() => served([call({ outcome: "unusable-output", model: "claude-haiku-4-5-20260301" }), call({})]), resumed.pacer)).rejects.toMatchObject({ condition: "model-changed" });
    expect(resumed.served.recorded).toEqual([]);
  });

  it("never stops on a refusal that reached no model: it is backed off and retried as before", async () => {
    const { pacer, served: record } = bound();
    let refused = 0;
    // The zone limiter's 429 (no calls) and the busy gateway's 503 (one unspent call), each then served.
    const answers = [
      () => reply(429, { error: "rate-limited", message: "slow down", calls: [] }),
      () => served([call({})]),
      () => reply(503, { error: "busy", message: "busy", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 1 }] }),
      () => served([call({})]),
      // The Worker's own refusal before any provider call is never retried: a policy failure, never a stop.
      () => reply(400, { error: "invalid-request", message: "Expected { system, messages, jsonSchema }.", calls: [] }),
    ];
    const provider = createHostedProvider({ baseUrl: "https://example.test", fetchImpl: (async () => (refused++, answers[refused - 1]!())) as typeof fetch, pacer });
    const adapter = provider.surfaceAdapter({ recorder: createCallRecorder(), meter: createMeter(), refinement: false });
    await expect(adapter.generate(request)).resolves.toMatchObject({ model: HAIKU });
    await expect(adapter.generate(request)).resolves.toMatchObject({ model: HAIKU });
    await expect(adapter.generate(request)).rejects.toMatchObject({ name: "HarnessError", kind: "policy" });
    expect(refused).toBe(5);
    expect(record.recorded).toEqual([HAIKU]);
  });
});
