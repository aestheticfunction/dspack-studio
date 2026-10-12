/**
 * The whole harness end to end on the scripted provider: the loop, the log,
 * the resume, the re-run of failures, the summary and the report, with no
 * network at all.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { planDeterministic, proposeBody } from "@dspack-studio/composer-core";
import { selectBlockDeterministic, type StructuralAdapter } from "@dspack-studio/composer-core/blocks";
import { exampleFor } from "./arms";
import { promptsFor, readCorpus, type Corpus } from "./corpus";
import { SCRIPTED_ID, faultFor } from "./providers/scripted";
import { manifestFor, manifestMismatches, planCells, readRecords, runEvaluation } from "./evaluate";
import { codeIdentity, sourceDigest } from "./identity";
import { preflight, readOllamaModel, type Preflight } from "./preflight";
import { createScriptedProvider } from "./providers/scripted";
import { HarnessError, requestBytes, type Provider } from "./providers/types";
import { loadReference, type LoadedReference } from "./references";
import { decide } from "./metrics";
import { PacingCapReached } from "./pacing";
import { renderReport } from "./report";
import { ARMS, type Arm, type Condition } from "./types";

let corpus: Corpus;
let references: LoadedReference[];
let pre: Preflight;
let dir: string;
beforeAll(async () => {
  corpus = readCorpus();
  references = await Promise.all(["astryx", "shadcn-v3"].map((id) => loadReference(id)));
  pre = await preflight({ references });
  dir = mkdtempSync(join(tmpdir(), "block-bench-dry-"));
}, 120_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

describe("dry run", () => {
  it("runs on the approved sidecars with no allowance, and refuses a draft sidecar or block unless allowed, marking that run provisional", async () => {
    expect(pre.drafts).toBe(false);
    const fresh = { promptIds: ["rt-01"], conditions: ["fresh"] as Condition[] };
    await expect(runEvaluation({ runId: "approved", provider: createScriptedProvider(), references: [references[0]!], corpus, preflight: pre, ...fresh })).resolves.toMatchObject({ cells: { done: ARMS.length } });
    const ref = references[0]!;
    const draftSidecar = { ...ref, sidecar: { ...ref.sidecar!, status: "draft" as const } };
    const draftBlock = { ...ref, blocks: ref.blocks.map((b, i) => (i === 0 ? { ...b, status: "draft" as const } : b)) };
    for (const draft of [draftSidecar, draftBlock]) {
      const draftPre = await preflight({ references: [draft] });
      expect(draftPre.drafts).toBe(true);
      await expect(runEvaluation({ runId: "x", provider: createScriptedProvider(), references: [draft], corpus, preflight: draftPre, ...fresh })).rejects.toThrow(/approved sidecars only/);
    }
    const out = join(dir, "run-draft");
    await runEvaluation({ runId: "draft", provider: createScriptedProvider(), references: [draftSidecar], corpus, preflight: await preflight({ references: [draftSidecar] }), allowDrafts: true, outDir: out, ...fresh });
    expect(readFileSync(join(out, "REPORT.md"), "utf8")).toContain("**Provisional.**");
  });

  it("runs every cell prompt-major, logs each record, writes the summary and the report, and never touches the network", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("no network in the dry run"))));
    const out = join(dir, "run-1");
    const promptIds = ["rt-01", "af-01", "gs-01", "nb-01"];
    const result = await runEvaluation({ runId: "dry-1", provider: createScriptedProvider(), references, corpus, preflight: pre, allowDrafts: true, promptIds, outDir: out, clock: () => "2026-10-10T00:00:00.000Z" });
    const cells = planCells({ references, corpus, promptIds });
    expect(ARMS).toContain("block-positional");
    expect(cells.length).toBe(2 * 4 * ARMS.length * 5);
    expect(result.cells).toEqual({ total: cells.length, done: cells.length, reused: 0 });
    expect(result.stopped).toBeUndefined();
    expect(readRecords(join(out, "runs.jsonl"))).toHaveLength(cells.length);
    expect(result.records.slice(0, 5).map((r) => `${r.arm}/${r.condition}`)).toEqual(["block/fresh", "block/refine-content", "block/refine-add", "block/refine-remove", "block/refine-structural"]);
    // The scripted twin replays the planned intent's LAST worked example, as the app's does: a context with
    // none cannot pass and says so; an example the emitter refuses (shadcn's record-collection carries a
    // pagination casualty) fails the gates in both primitive arms alike; a selected block expands and passes.
    const fresh = result.records.filter((x) => x.condition === "fresh");
    for (const r of fresh) {
      const reference = references.find((ref) => ref.id === r.reference)!;
      const intent = planDeterministic(promptsFor(corpus, r.reference).find((p) => p.id === r.prompt)!.goal, reference.contract).intent;
      const label = `${r.reference} ${r.arm} ${r.prompt}`;
      if (exampleFor(reference, intent) === undefined && r.path === "primitive") expect(r, label).toMatchObject({ passed: false, outcome: "failed-adapter", failure: { kind: "unknown", rerunEligible: false } });
      else if (r.arm === "block" && r.selection?.chosen) expect(r, label).toMatchObject({ passed: true, path: "block" });
      else expect(["passed", "failed-gate", "failed-lint-exhausted"], label).toContain(r.outcome);
      if (r.arm === "capped") expect(r.passed, label).toBe(fresh.find((x) => x.reference === r.reference && x.prompt === r.prompt && x.arm === "production")!.passed);
    }
    expect(fresh.filter((r) => r.passed).length).toBeGreaterThanOrEqual(12);
    // Exactly the prompts the deterministic planner routes to a block's intent take the block path (the dry run's selection is the selector's).
    let expectedBlockPaths = 0;
    for (const reference of references) {
      for (const p of promptsFor(corpus, reference.id).filter((x) => promptIds.includes(x.id))) {
        if (selectBlockDeterministic(p.goal, planDeterministic(p.goal, reference.contract).intent, reference.blocks).id !== null) expectedBlockPaths += 1;
      }
    }
    expect(fresh.filter((r) => r.arm === "block" && r.path === "block").length).toBe(expectedBlockPaths);
    expect(expectedBlockPaths).toBeGreaterThanOrEqual(3);
    const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
    expect(summary.summary.decisions.map((d: { verdict: string }) => d.verdict)).toEqual(["insufficient", "insufficient"]);
    expect(existsSync(join(out, "preflight.json"))).toBe(true);
    const report = readFileSync(join(out, "REPORT.md"), "utf8");
    expect(report).toContain("# Interface-blocks live evaluation (Phase 1B): run dry-1");
    expect(report).toContain("**Dry run.**");
    expect(report).not.toContain("**Provisional.**");
    expect(report).toContain("### Selection accuracy (block arm, fresh)");
    expect(report).toMatch(/\| refine-content \| block \| \d+ \| \d+ \| \d+ \|/);
    expect(report).toContain("### Add and remove refinements, by block");
    // The scripted twin answers an add or a remove by rewriting a text node: every one passes the gates without adding or
    // removing anything, the defect the add and remove check exists to show (live/operation.ts).
    const operations = result.records.filter((r) => (r.condition === "refine-add" || r.condition === "refine-remove") && r.passed);
    expect(operations.length).toBeGreaterThan(0);
    for (const r of operations) expect(r.operation, `${r.reference} ${r.arm} ${r.prompt} ${r.condition}`).toMatchObject({ requested: r.condition === "refine-add" ? "add" : "remove", observed: "none" });
    expect(result.records.filter((r) => r.operation !== undefined && !operations.includes(r))).toEqual([]);
    expect(report).toMatch(/\| refine-add \| block \| [^\n]*\| 0\.0% \(0\/\d+\); 0 mixed, \d+ missed \|/);
    expect(fetch).not.toHaveBeenCalled();

    // Resume: every cell is reused from the log, and refinements still find their priors there.
    const again = await runEvaluation({ runId: "dry-1", provider: createScriptedProvider(), references, corpus, preflight: pre, allowDrafts: true, promptIds, outDir: out, resume: true });
    expect(again.cells).toEqual({ total: cells.length, done: cells.length, reused: cells.length });
    expect(readRecords(join(out, "runs.jsonl"))).toHaveLength(cells.length);
    await expect(runEvaluation({ runId: "dry-1", provider: createScriptedProvider(), references, corpus, preflight: pre, allowDrafts: true, promptIds, outDir: out })).rejects.toThrow(/pass resume/);
  }, 300_000);

  it("a resume keeps the original run id and preflight, and refuses a run whose provider, corpus, sidecars, deployment or selection changed", async () => {
    const out = join(dir, "run-manifest");
    const base = { provider: createScriptedProvider(), references: [references[0]!], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01"], conditions: ["fresh"] as const };
    const first = await runEvaluation({ ...base, runId: "original", outDir: out });
    expect(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"))).toMatchObject({ runId: "original", provider: "fake:scripted", corpus: { id: "blocks-1b" } });
    const resumed = await runEvaluation({ ...base, runId: "later", outDir: out, resume: true, preflight: { ...pre, at: "2026-11-01T00:00:00.000Z" } });
    expect(resumed.runId).toBe("original");
    expect(resumed.preflight.at).toBe(pre.at);
    expect(resumed.cells.reused).toBe(first.records.length);
    expect(existsSync(join(out, "preflight.resume-1.json"))).toBe(true);
    await expect(runEvaluation({ ...base, runId: "x", outDir: out, resume: true, corpus: { ...corpus, frozenAt: "2026-12-01" } })).rejects.toThrow(/corpus/);
    await expect(runEvaluation({ ...base, runId: "x", outDir: out, resume: true, preflight: { ...pre, buildId: "deadbeef" } })).rejects.toThrow(/build id/);
    await expect(runEvaluation({ ...base, runId: "x", outDir: out, resume: true, provider: createScriptedProvider({ faults: true }) })).rejects.toThrow(/provider/);
    await expect(runEvaluation({ ...base, runId: "x", outDir: out, resume: true, conditions: ["fresh", "refine-content"] })).rejects.toThrow(/conditions/);
  });

  it("with faults, provider failures are re-run on request and the log stays one record per cell", async () => {
    const out = join(dir, "run-faults");
    const provider = createScriptedProvider({ faults: true });
    // The schedule is a hash of the goal: pick the block prompts that draw a provider failure, plus two that draw none.
    const drawing = promptsFor(corpus, "astryx").filter((p) => p.block !== null && faultFor(p.goal, true) === "provider-failure").map((p) => p.id);
    const quiet = promptsFor(corpus, "astryx").filter((p) => p.block !== null && faultFor(p.goal, true) === "none").slice(0, 2).map((p) => p.id);
    const promptIds = [...drawing, ...quiet];
    expect(drawing.length).toBeGreaterThan(0);
    const first = await runEvaluation({ runId: "dry-faults", provider, references: [references[0]!], corpus, preflight: pre, allowDrafts: true, promptIds, conditions: ["fresh"], outDir: out });
    const failed = first.records.filter((r) => r.failure?.rerunEligible);
    expect(failed.length).toBeGreaterThan(0);
    // A provider failure is reported separately in every arm; in the block arm it is the block call's when a block was selected, else today's path's.
    for (const arm of ["block", "capped", "production"] as const) expect(first.summary.arms.find((a) => a.arm === arm)!.rerunEligible).toBe(failed.filter((r) => r.arm === arm).length);
    expect(first.records.some((r) => r.arm === "block" && r.path === "provider-failure")).toBe(true);
    const rerun = await runEvaluation({ runId: "dry-faults", provider, references: [references[0]!], corpus, preflight: pre, allowDrafts: true, promptIds, conditions: ["fresh"], outDir: out, resume: true, rerunFailed: true });
    expect(rerun.cells.reused).toBe(first.records.length - failed.length);
    expect(readRecords(join(out, "runs.jsonl"))).toHaveLength(first.records.length);
    // The same deterministic faults fail again: honest, not retried into a pass.
    expect(rerun.records.filter((r) => r.failure?.rerunEligible)).toHaveLength(failed.length);
  }, 300_000);
});

/** The scripted provider with a transient, metered provider failure on every fresh generation while `failing.on`. */
function transient(failing: { on: boolean }): Provider {
  const inner = createScriptedProvider();
  const wrap = (adapter: StructuralAdapter, opts: { recorder: { record(call: never): void }; meter: { bytes: number; requests: number }; refinement: boolean }): StructuralAdapter => ({
    id: adapter.id,
    async generate(request, context) {
      if (failing.on && !opts.refinement) {
        opts.meter.bytes += requestBytes(proposeBody(request));
        opts.meter.requests += 1;
        opts.recorder.record({ operation: "generate", source: "provider", inputTokens: 1000, outputTokens: 0, durationMs: 1, outcome: "provider-error" } as never);
        throw new HarnessError(SCRIPTED_ID, "transient: the provider is unavailable", "provider", 502, "provider");
      }
      return adapter.generate(request, context);
    },
  });
  return { ...inner, surfaceAdapter: (opts) => wrap(inner.surfaceAdapter(opts), opts), blockAdapter: (opts) => wrap(inner.blockAdapter(opts), opts) };
}

describe("a run directory stays whole across resumes", () => {
  const fresh: Condition[] = ["fresh"];
  /** These tests are about the run directory, not the arm set: the three ADR-B4 arms keep their counts fixed. */
  const arms: Arm[] = ["block", "capped", "production"];

  it("re-running a failed fresh cell re-runs the refinements skipped for want of it, and keeps what the failed attempt spent", async () => {
    const out = join(dir, "run-dependents");
    const failing = { on: true };
    const base = { runId: "dependents", provider: transient(failing), references: [references[0]!], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01"], arms, outDir: out };
    const first = await runEvaluation(base);
    const firstFresh = first.records.filter((r) => r.condition === "fresh");
    expect(firstFresh.map((r) => r.failure?.rerunEligible)).toEqual([true, true, true]);
    expect(first.records.filter((r) => r.condition !== "fresh").map((r) => r.status)).toEqual(new Array(12).fill("skipped"));

    failing.on = false;
    const rerun = await runEvaluation({ ...base, resume: true, rerunFailed: true });
    expect(rerun.records.filter((r) => r.condition === "fresh").map((r) => r.passed)).toEqual([true, true, true]);
    expect(rerun.records.filter((r) => r.condition !== "fresh").map((r) => r.status)).toEqual(new Array(12).fill("completed"));
    expect(readRecords(join(out, "runs.jsonl"))).toHaveLength(15);
    // The superseded attempts leave the log, never the record of what they spent.
    expect(readRecords(join(out, "runs.superseded.jsonl"))).toHaveLength(15);
    const spent = { providerCalls: 3, inputTokens: 3000, requestBytes: firstFresh.reduce((a, r) => a + r.requestBytes, 0) };
    expect(spent.requestBytes).toBeGreaterThan(0);
    expect(rerun.superseded).toMatchObject({ records: 15, ...spent });
    expect(JSON.parse(readFileSync(join(out, "summary.json"), "utf8")).superseded).toMatchObject({ records: 15, ...spent });
    expect(readFileSync(join(out, "REPORT.md"), "utf8")).toContain("Superseded by re-runs: 15 records, 3 provider calls, 3000 input and 0 output tokens");
  }, 120_000);

  it("a torn last line (an append cut off) is set aside and its cell runs again; a corrupt line elsewhere is refused with its file and line", async () => {
    const out = join(dir, "run-torn");
    const base = { runId: "torn", provider: createScriptedProvider(), references: [references[0]!], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01"], conditions: fresh, arms, outDir: out };
    await runEvaluation(base);
    const log = join(out, "runs.jsonl");
    const lines = readFileSync(log, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    const torn = lines[2]!.slice(0, 200);
    writeFileSync(log, `${lines[0]}\n${lines[1]}\n${torn}`);
    const resumed = await runEvaluation({ ...base, resume: true });
    expect(resumed.cells).toMatchObject({ done: 3, reused: 2 });
    expect(readRecords(log)).toHaveLength(3);
    expect(readFileSync(join(out, "runs.torn.jsonl"), "utf8")).toBe(`${torn}\n`);
    // The side logs are made whole the same way, before any cell runs.
    const cut = lines[1]!.slice(0, 50);
    writeFileSync(join(out, "runs.superseded.jsonl"), `${lines[0]}\n${cut}`);
    const again = await runEvaluation({ ...base, resume: true });
    expect(again.superseded.records).toBe(1);
    expect(readFileSync(join(out, "runs.superseded.jsonl"), "utf8")).toBe(`${lines[0]}\n`);
    expect(readFileSync(join(out, "runs.torn.jsonl"), "utf8")).toBe(`${torn}\n${cut}\n`);
    writeFileSync(log, `${lines[0]}\n{"broken\n${lines[2]}\n`);
    await expect(runEvaluation({ ...base, resume: true })).rejects.toThrow(/runs\.jsonl:2/);
  }, 120_000);

  it("keeps every invocation's pacing and waits, and the report states them all", async () => {
    const out = join(dir, "run-pacing");
    const paced = (pacing: Record<string, unknown>): Provider => ({ ...createScriptedProvider(), telemetry: () => ({ pacing }) });
    const one = { maxRequests: 5, spacingMs: 3000, backoffMs: [30_000], sent: 4, waits: [{ atMs: 10, ms: 3000, reason: "spacing" }, { atMs: 20, ms: 30_000, reason: "503 busy" }] };
    const two = { maxRequests: 300, spacingMs: 0, backoffMs: [], sent: 0, waits: [] };
    const base = { runId: "paced", references: [references[0]!], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01"], conditions: fresh, outDir: out };
    await runEvaluation({ ...base, provider: paced(one) });
    const resumed = await runEvaluation({ ...base, provider: paced(two), resume: true, preflight: { ...pre, at: "2026-11-01T00:00:00.000Z" } });
    expect(resumed.invocations.map((i) => (i.telemetry.pacing as { maxRequests: number }).maxRequests)).toEqual([5, 300]);
    expect(readFileSync(join(out, "pacing.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(out, "summary.json"), "utf8")).invocations).toHaveLength(2);
    const report = readFileSync(join(out, "REPORT.md"), "utf8");
    expect(report).toContain(`Invocation 1 (${pre.at}): a cap of 5 requests, 3000 ms between requests, backoff 30s; 4 requests sent; waits: 1 for spacing (3s), 1 for 503 busy (30s).`);
    expect(report).toContain("Invocation 2 (2026-11-01T00:00:00.000Z): a cap of 300 requests, 0 ms between requests, backoff none; 0 requests sent; waits: none.");
  }, 120_000);

  it("refuses a resume when a sidecar's content, the emit profile, the code or the local model changed, even under the same ids and versions", async () => {
    const out = join(dir, "run-identity");
    const ref = references[0]!;
    const base = { runId: "identity", provider: createScriptedProvider(), references: [ref], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01"], conditions: fresh, arms, outDir: out };
    await runEvaluation(base);
    const sidecar = ref.sidecar!;
    const edited = { ...ref, sidecar: { ...sidecar, blocks: sidecar.blocks.map((b, i) => (i === 0 ? { ...b, summary: `${b.summary} Edited.` } : b)) } };
    await expect(runEvaluation({ ...base, resume: true, references: [edited] })).rejects.toThrow(/sidecar content/);
    await expect(runEvaluation({ ...base, resume: true, references: [{ ...ref, profileRaw: { ...ref.profileRaw, edited: true } }] })).rejects.toThrow(/emit profile/);
    await expect(runEvaluation({ ...base, resume: true, preflight: { ...pre, model: { name: "gpt-oss:latest", digest: "sha256:another-pull" } } })).rejects.toThrow(/model/);
    const recorded = await manifestFor(base);
    expect(manifestMismatches(recorded, { ...recorded, code: { ...recorded.code, sha256: "0".repeat(64) } })).toEqual([expect.stringMatching(/^code: /)]);
    expect(manifestMismatches(recorded, { ...recorded, code: { ...recorded.code, packages: { ...recorded.code.packages, "@aestheticfunction/dspack-gen": "9.9.9" } } })).toEqual([expect.stringMatching(/^code: .*dspack-gen/)]);
    await expect(runEvaluation({ ...base, resume: true })).resolves.toMatchObject({ cells: { reused: 3 } });
  }, 120_000);

  it("the code identity is a digest of the harness and composer-core sources, tests excluded, plus the dspack package versions", () => {
    const tmp = mkdtempSync(join(tmpdir(), "block-bench-src-"));
    try {
      writeFileSync(join(tmp, "a.ts"), "export const a = 1;\n");
      const before = sourceDigest([tmp]);
      writeFileSync(join(tmp, "a.test.ts"), "it('x', () => {});\n");
      writeFileSync(join(tmp, "notes.md"), "prose\n");
      expect(sourceDigest([tmp])).toBe(before);
      writeFileSync(join(tmp, "a.ts"), "export const a = 2;\n");
      expect(sourceDigest([tmp])).not.toBe(before);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    const code = codeIdentity();
    expect(code.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(code.packages).sort()).toEqual(["@aestheticfunction/dspack-emit", "@aestheticfunction/dspack-gen"]);
    for (const version of Object.values(code.packages)) expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("an Ollama run is identified by the digest Ollama reports for the tag", async () => {
    const tags = (async () => new Response(JSON.stringify({ models: [{ name: "gpt-oss:latest", model: "gpt-oss:latest", digest: "sha256:aaa" }] }))) as unknown as typeof fetch;
    expect(await readOllamaModel("http://localhost:11434", "gpt-oss:latest", tags)).toEqual({ name: "gpt-oss:latest", digest: "sha256:aaa" });
    expect(await readOllamaModel("http://localhost:11434", "gpt-oss", tags)).toEqual({ name: "gpt-oss:latest", digest: "sha256:aaa" });
    expect(await readOllamaModel("http://localhost:11434", "qwen3:8b", tags)).toMatchObject({ name: "qwen3:8b", digest: null });
    const p = await preflight({ references: [references[0]!], ollama: { host: "http://localhost:11434", model: "gpt-oss" }, fetchImpl: tags });
    expect(p.model).toEqual({ name: "gpt-oss:latest", digest: "sha256:aaa" });
  });
});

describe("named against positional in the report (ADR-B2)", () => {
  it("sets the two encodings side by side per condition, and the ADR-B3 decision is the same with or without the positional arm", async () => {
    const out = join(dir, "run-positional");
    const result = await runEvaluation({ runId: "positional", provider: createScriptedProvider(), references: [references[0]!], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01", "af-01", "nb-01"], outDir: out });
    expect([...new Set(result.records.map((r) => r.arm))].sort()).toEqual(["block", "block-positional", "capped", "production"]);
    const report = readFileSync(join(out, "REPORT.md"), "utf8");
    expect(report).toContain("### Named vs positional encoding (ADR-B2)");
    for (const condition of ["all", "fresh", "refine-content"]) {
      expect(report).toMatch(new RegExp(`\\| ${condition} \\| named \\|`));
      expect(report).toMatch(new RegExp(`\\| ${condition} \\| positional \\|`));
    }
    expect(report).not.toContain("the block phase takes the named encoding only");
    // The rule reads the named block arm against the primitive arms; the positional arm informs ADR-B2 and decides nothing.
    expect(decide(result.records)).toEqual(decide(result.records.filter((r) => r.arm !== "block-positional")));
    expect(report.split("## Decision (ADR-B3)")[1]!.split("\n## ")[0]).not.toContain("positional");
    const without = await runEvaluation({ runId: "named-only", provider: createScriptedProvider(), references: [references[0]!], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01"], arms: ["block", "capped", "production"] });
    const named = renderReport(without, { providerId: "fake:scripted", corpus });
    expect(named).not.toContain("### Named vs positional encoding (ADR-B2)");
    expect(named).toContain("Named vs positional encoding: the block-positional arm was not in this run's selection.");
  }, 120_000);

  it("tells an arm left out of the selection from one the run stopped before reaching", async () => {
    let admitted = 0;
    // A cap that admits the named block arm's five cells of the first prompt, then stops the run.
    const stopping: Provider = { ...createScriptedProvider(), beforeCell: () => {
      if (++admitted > 5) throw new PacingCapReached(5);
    } };
    const stopped = await runEvaluation({ runId: "stopped", provider: stopping, references: [references[0]!], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01"] });
    expect(stopped.stopped?.reason).toBe("cap");
    expect(stopped.records.map((r) => r.arm)).toEqual(new Array(5).fill("block"));
    const report = renderReport(stopped, { providerId: "fake:scripted", corpus });
    expect(report).not.toContain("was not in this run's selection");
    expect(report).not.toContain("### Named vs positional encoding (ADR-B2)");
    expect(report).toContain("Named vs positional encoding: the block-positional arm is selected, but the run stopped before any of its cells ran; resume the run to reach it.");
  }, 120_000);
});

describe("the run log keeps no raw model output", () => {
  it("leaves out invalid answers, repair text, literal positional answers and the sentinel's words, and keeps validated calls, hashes and issue paths", async () => {
    const astryx = references[0]!;
    // A block prompt that draws an invalid first block call, and that the deterministic planner routes to its block.
    const prompt = promptsFor(corpus, "astryx").find((p) => p.block !== null && faultFor(p.goal, true) === "invalid-block-call" && planDeterministic(p.goal, astryx.contract).intent === p.expectedIntent)!;
    const faulty = join(dir, "run-durable-faults");
    await runEvaluation({ runId: "durable-faults", provider: createScriptedProvider({ faults: true }), references: [astryx], corpus, preflight: pre, allowDrafts: true, promptIds: [prompt.id], arms: ["block", "block-positional"], conditions: ["fresh"], outDir: faulty });
    const sentinel = join(dir, "run-durable-sentinel");
    await runEvaluation({ runId: "durable-sentinel", provider: createScriptedProvider(), references: [astryx], corpus, preflight: pre, allowDrafts: true, promptIds: ["rt-01"], arms: ["block", "block-positional"], conditions: ["fresh", "refine-structural"], outDir: sentinel });
    const log = readFileSync(join(faulty, "runs.jsonl"), "utf8") + readFileSync(join(sentinel, "runs.jsonl"), "utf8");
    const records = [...readRecords(join(faulty, "runs.jsonl")), ...readRecords(join(sentinel, "runs.jsonl"))];
    const attempts = records.flatMap((r) => ((r.trace as { attempts?: Array<Record<string, unknown>> } | undefined)?.attempts ?? []));
    // The paths really ran: an invalid answer, its repair, compact answers and the sentinel.
    expect(attempts.filter((a) => a.outcome === "invalid")).toHaveLength(2);
    expect(attempts.filter((a) => a.outcome === "unsupported")).toHaveLength(2);
    expect(records.filter((r) => (r.trace as { encoding?: string } | undefined)?.encoding === "positional").length).toBeGreaterThan(0);
    // None of their literal text reaches the log.
    expect(log).not.toMatch(/"rawText"|"rawBlockText"/);
    expect(log).not.toContain(JSON.stringify({ block: prompt.block, version: 1 }));
    expect(log).not.toContain(JSON.stringify({ b: prompt.block, v: 1, p: [] }));
    expect(log).not.toContain('"p":[');
    expect(log).not.toContain("changes the block's structure");
    // What stays: the validated named call, hashes, byte counts, issue paths and classifications.
    for (const a of attempts) {
      expect(a.rawSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.rawBytes).toBeGreaterThan(0);
      if (a.outcome === "ok") expect(a.call).toMatchObject({ block: expect.any(String), version: 1 });
      else expect(a).not.toHaveProperty("call");
    }
    expect(attempts.filter((a) => a.outcome === "invalid").every((a) => (a.b1 as unknown[]).length > 0)).toBe(true);
    const fellBack = records.filter((r) => r.condition === "refine-structural");
    expect(fellBack.map((r) => r.refinement?.reason)).toEqual(new Array(2).fill("the model answered that this block cannot express the change"));
  }, 120_000);
});

