/**
 * Benchmark integrity for a hosted run (live/integrity.ts): a call that reached the provider must report its complete
 * usage and the model that served it, that model must be Claude Haiku 4.5, and it must stay the model the run's first
 * metered call reported, which the manifest records once and every resume holds to. Anything else stops the run
 * cleanly, apart from arm results, and the run stays resumable. Refusals that reached no model are exempt.
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

  it("records the configured id the Worker echoes when the provider names no model, and the report says it confirms no snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-integrity-"));
    try {
      const result = await invocation(dir, worker(() => undefined).fetchImpl);
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
      for (const servedModel of [{}, HAIKU, null, { id: null, at }, { id: 42, at }, { id: HAIKU }, { id: "claude-opus-4-1-20250805", at }]) {
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

  it("refuses a resume whose manifest no longer names the model its ledger shows it measured, or names another", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-integrity-"));
    try {
      const original = await measured(dir);
      // Each settlement made once the model was recorded carries it, so the ledger shows what the run measured.
      const settled = ledger(dir).filter((l) => l.adjust !== undefined);
      expect(settled.length).toBeGreaterThan(0);
      expect(new Set(settled.map((l) => l.servedModel))).toEqual(new Set([HAIKU]));
      for (const servedModel of [undefined, { id: OTHER, at: manifestOf(dir).servedModel.at }]) {
        tamper(dir, servedModel);
        const w = worker(() => OTHER);
        await expect(invocation(dir, w.fetchImpl), JSON.stringify(servedModel)).rejects.toThrow(new RegExp(`^resume refused: .*${HAIKU}`, "s"));
        expect(w.posted()).toBe(0);
        expect(logged(dir)).toHaveLength(1);
        writeFileSync(join(dir, "manifest.json"), original);
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

  it("lets a fresh run, or one stopped before any model could be recorded, establish its first served model", async () => {
    const dir = mkdtempSync(join(tmpdir(), "block-bench-integrity-"));
    try {
      // The plan's first call is an unusable output, which names no model of its own: the run stops at its first reply,
      // before any model is recorded, though a provider call was made and paid for.
      let calls = 0;
      const env = {
        HOSTED_AI: "on",
        AI: { run: async () => ({ content: [{ type: "text", text: calls++ === 0 ? "not json" : JSON.stringify(plan) }], usage: { input_tokens: 100, output_tokens: 10 }, model: HAIKU }) },
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
  const call = (fields: Record<string, unknown>) => ({ inputTokens: 10, outputTokens: 2, outcome: "ok", durationMs: 1, ...fields });
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
      ["no model named", () => served([call({})], {}), "model-missing"],
      // The Worker names one model per reply, the one its final, successful call reported: the first call of its parse
      // retry names none of its own, and is not given the reply's.
      ["a parse retry, whose first call the reply's model does not name", () => served([call({ outcome: "unusable-output" }), call({})]), "model-missing"],
      ["an unusable output, which names no model", () => reply(502, { error: "provider-unavailable", cause: "unusable-output", message: "no usable output", usage: { inputTokens: 10, outputTokens: 2 }, calls: [call({ outcome: "unusable-output" })] }), "model-missing"],
      ["another model family", () => served([call({})], { model: "claude-sonnet-4-5-20250929" }), "model-family"],
      ["a later Haiku generation", () => served([call({})], { model: "claude-haiku-5-5" }), "model-family"],
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
    await expect(generate(() => served([call({})], { model: "claude-haiku-4-5-20260301" }), pacer)).rejects.toBeInstanceOf(RunHalted);
    // Resumed with a model already recorded, a call must report that model.
    const resumed = bound(HAIKU);
    await generate(() => served([call({})]), resumed.pacer);
    await expect(generate(() => served([call({})], { model: "anthropic/claude-haiku-4.5" }), resumed.pacer)).rejects.toMatchObject({ condition: "model-changed" });
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
