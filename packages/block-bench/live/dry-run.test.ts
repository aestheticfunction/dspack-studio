/**
 * The whole harness end to end on the scripted provider: the loop, the log,
 * the resume, the re-run of failures, the summary and the report, with no
 * network at all.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { planDeterministic } from "@dspack-studio/composer-core";
import { selectBlockDeterministic } from "@dspack-studio/composer-core/blocks";
import { exampleFor } from "./arms";
import { promptsFor, readCorpus, type Corpus } from "./corpus";
import { faultFor } from "./providers/scripted";
import { planCells, readRecords, runEvaluation } from "./evaluate";
import { preflight, type Preflight } from "./preflight";
import { createScriptedProvider } from "./providers/scripted";
import { loadReference, type LoadedReference } from "./references";

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
  it("refuses drafts unless allowed, and names why", async () => {
    expect(pre.drafts).toBe(true);
    await expect(runEvaluation({ runId: "x", provider: createScriptedProvider(), references, corpus, preflight: pre })).rejects.toThrow(/approved sidecars only/);
  });

  it("runs every cell prompt-major, logs each record, writes the summary and the report, and never touches the network", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("no network in the dry run"))));
    const out = join(dir, "run-1");
    const promptIds = ["rt-01", "af-01", "gs-01", "nb-01"];
    const result = await runEvaluation({ runId: "dry-1", provider: createScriptedProvider(), references, corpus, preflight: pre, allowDrafts: true, promptIds, outDir: out, clock: () => "2026-10-10T00:00:00.000Z" });
    const cells = planCells({ references, corpus, promptIds });
    expect(cells.length).toBe(2 * 4 * 3 * 5);
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
    expect(report).toContain("**Provisional.**");
    expect(report).toContain("### Selection accuracy (block arm, fresh)");
    expect(report).toContain("| refine-content | block |");
    expect(fetch).not.toHaveBeenCalled();

    // Resume: every cell is reused from the log, and refinements still find their priors there.
    const again = await runEvaluation({ runId: "dry-1", provider: createScriptedProvider(), references, corpus, preflight: pre, allowDrafts: true, promptIds, outDir: out, resume: true });
    expect(again.cells).toEqual({ total: cells.length, done: cells.length, reused: cells.length });
    expect(readRecords(join(out, "runs.jsonl"))).toHaveLength(cells.length);
    await expect(runEvaluation({ runId: "dry-1", provider: createScriptedProvider(), references, corpus, preflight: pre, allowDrafts: true, promptIds, outDir: out })).rejects.toThrow(/pass resume/);
  }, 300_000);

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
