/**
 * The arms over the real pipeline, linter and emitter, on the scripted
 * provider: no model, no network. The fault schedule draws every failure
 * shape ADR-B4 classifies, and each must take the path the table names.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { planDeterministic } from "@dspack-studio/composer-core";
import { runCell, type CellInput } from "./arms";
import { promptsFor, readCorpus, type Corpus } from "./corpus";
import { createScriptedProvider, faultFor, type Fault } from "./providers/scripted";
import type { Provider } from "./providers/types";
import { loadReference, type LoadedReference } from "./references";
import type { Arm, Condition, PriorResult } from "./types";

type Json = Record<string, any>;

let corpus: Corpus;
let astryx: LoadedReference;
beforeAll(async () => {
  corpus = readCorpus();
  astryx = await loadReference("astryx");
}, 60_000);
afterEach(() => vi.unstubAllGlobals());

const promptById = (id: string) => promptsFor(corpus, "astryx").find((p) => p.id === id)!;
/**
 * A block prompt that draws the fault AND that the deterministic planner
 * routes to its expected intent (the scripted run selects deterministically,
 * so a prompt the keyword planner misroutes takes today's path instead).
 * The schedule is a hash of the goal, so the test looks one up rather than
 * assuming.
 */
const promptWithFault = (fault: Fault) => {
  const found = promptsFor(corpus, "astryx").find((p) => p.block !== null && faultFor(p.goal, true) === fault && planDeterministic(p.goal, astryx.contract).intent === p.expectedIntent);
  if (!found) throw new Error(`no block prompt draws ${fault}`);
  return found;
};
const cell = (overrides: Partial<CellInput> & { arm: Arm; condition?: Condition; promptId?: string; faults?: boolean; prior?: PriorResult }) =>
  runCell({
    reference: astryx,
    provider: createScriptedProvider({ faults: overrides.faults ?? false }),
    arm: overrides.arm,
    condition: overrides.condition ?? "fresh",
    prompt: overrides.prompt ?? promptById(overrides.promptId ?? "rt-01"),
    corpus,
    ...(overrides.prior ? { prior: overrides.prior } : {}),
    clock: () => "2026-10-10T00:00:00.000Z",
  });

describe("fresh builds", () => {
  it("block arm: a block prompt is selected deterministically, expands at attempt 0 and passes with no model call; the trace rides the record", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("no network in the dry run"))));
    const { record, prior } = await cell({ arm: "block" });
    expect(record).toMatchObject({ status: "completed", outcome: "passed", passed: true, attempts: 1, path: "block", selection: { chosen: "records-table", source: "deterministic", correct: true } });
    expect(record.plan?.block?.id).toBe("records-table");
    expect(record.tokens).toMatchObject({ providerCalls: 0, unreportedCalls: 0 });
    expect(record.tokens.modelFreeCalls).toBe(1);
    expect((record.trace as { outcome: string }).outcome).toBe("block");
    expect(record.parity?.satisfied).toContain("component:table");
    expect(record.timings.blockPhaseMs).toBeGreaterThanOrEqual(0);
    expect(prior?.plan.block?.id).toBe("records-table");
  });

  it("block arm: a null prompt takes today's path, with the selector's reason on the plan", async () => {
    const { record } = await cell({ arm: "block", promptId: "nb-01" });
    expect(record).toMatchObject({ path: "primitive", passed: true, selection: { chosen: null, correct: true } });
    expect(record.plan?.block?.source).toBe("deterministic");
  });

  it("capped and production arms replay the worked example at attempt 0 and carry no selection", async () => {
    for (const arm of ["capped", "production"] as const) {
      const { record } = await cell({ arm });
      expect(record).toMatchObject({ arm, path: "primitive", passed: true, attempts: 1 });
      expect(record.selection).toBeUndefined();
      expect(record.plan?.block).toBeUndefined();
    }
  });
});

describe("the fault schedule takes the path ADR-B4 names (block arm, fresh)", () => {
  it("an invalid first call is repaired once: path block-repair, two block attempts, passed", async () => {
    const { record } = await cell({ arm: "block", prompt: promptWithFault("invalid-block-call"), faults: true });
    expect(record).toMatchObject({ path: "block-repair", passed: true, attempts: 1 });
    expect((record.trace as { attempts: unknown[] }).attempts).toHaveLength(2);
    expect(record.calls.map((c) => c.operation)).toEqual(["block", "block-repair"]);
  });

  it("an unusable output is re-issued once under the budget: path block, two recorded calls, passed", async () => {
    const { record } = await cell({ arm: "block", prompt: promptWithFault("unusable-output"), faults: true });
    expect(record).toMatchObject({ path: "block", passed: true });
    expect(record.calls.map((c) => [c.operation, c.outcome, c.reissue ?? false])).toEqual([["block", "unusable-output", false], ["block", "ok", true]]);
  });

  it("a provider failure on the block call is replayed as today's failed-adapter, classified provider, eligible for a re-run", async () => {
    const { record } = await cell({ arm: "block", prompt: promptWithFault("provider-failure"), faults: true });
    expect(record).toMatchObject({ path: "provider-failure", outcome: "failed-adapter", passed: false, failure: { kind: "provider", rerunEligible: true } });
    expect((record.trace as { outcome: string; providerError: { classification: string } }).providerError.classification).toBe("provider");
  });

  it("an invalid surface from the primitive adapter is the pipeline's own repair: production passes at attempt 1; the block arm never asked for a surface", async () => {
    const prompt = promptWithFault("invalid-surface");
    const production = await cell({ arm: "production", prompt, faults: true });
    expect(production.record).toMatchObject({ passed: true, attempts: 2, path: "primitive" });
    const block = await cell({ arm: "block", prompt, faults: true });
    expect(block.record).toMatchObject({ passed: true, attempts: 1, path: "block" });
  });

  it("the capped arm shares the unusable-output rule; the production arm has no budgeted re-issue, so the same fault ends as failed-adapter there", async () => {
    const prompt = promptWithFault("unusable-output");
    const capped = await cell({ arm: "capped", prompt, faults: true });
    expect(capped.record).toMatchObject({ passed: true, attempts: 1 });
    expect(capped.record.calls.map((c) => c.outcome)).toEqual(["unusable-output", "ok"]);
    const production = await cell({ arm: "production", prompt, faults: true });
    expect(production.record).toMatchObject({ passed: false, outcome: "failed-adapter", failure: { kind: "output", rerunEligible: false } });
  });
});

describe("refinements on each arm's own fresh result", () => {
  it("block arm: a content change is a compact refinement that stays in block mode and changes the surface; a structural change answers the sentinel and falls back", async () => {
    const fresh = await cell({ arm: "block" });
    const content = await cell({ arm: "block", condition: "refine-content", prior: fresh.prior });
    expect(content.record).toMatchObject({ passed: true, path: "block", refinement: { mode: "compact", retained: true }, changed: true });
    expect(content.record.plan).toBeUndefined();
    const structural = await cell({ arm: "block", condition: "refine-structural", prior: fresh.prior });
    expect(structural.record).toMatchObject({ passed: true, path: "fallback", refinement: { mode: "compact", retained: false } });
    expect((structural.record.trace as { fallback: { classification: string } }).fallback.classification).toBe("unsupported-refinement");
    expect(structural.record.budgetRemainingAtFallback).toBe(2);
  });

  it("production and capped arms refine over the full prior surface; a refinement with no passing fresh result is skipped, not failed", async () => {
    const fresh = await cell({ arm: "production" });
    const refined = await cell({ arm: "production", condition: "refine-content", prior: fresh.prior });
    expect(refined.record).toMatchObject({ passed: true, changed: true, path: "primitive" });
    const skipped = await cell({ arm: "capped", condition: "refine-add" });
    expect(skipped.record).toMatchObject({ status: "skipped", passed: false, attempts: 0 });
  });

  it("block arm: a refinement of a null-selected fresh build is today's primitive refinement with no trace", async () => {
    const fresh = await cell({ arm: "block", promptId: "nb-01" });
    const refined = await cell({ arm: "block", condition: "refine-content", promptId: "nb-01", prior: fresh.prior });
    expect(refined.record).toMatchObject({ passed: true, path: "primitive", refinement: { mode: "primitive", retained: false } });
    expect(refined.record.trace).toBeUndefined();
  });
});

describe("the block-positional arm (ADR-B2: named against positional)", () => {
  it("runs the block path in the compact encoding: the same selection, a positional trace, and the surface the named block arm builds", async () => {
    const named = await cell({ arm: "block" });
    const positional = await cell({ arm: "block-positional" });
    expect(positional.record).toMatchObject({ arm: "block-positional", outcome: "passed", path: "block", attempts: 1, selection: { chosen: "records-table" } });
    expect((positional.record.trace as { encoding: string }).encoding).toBe("positional");
    expect((named.record.trace as { encoding: string }).encoding).toBe("named");
    expect(positional.record.surfaceDigest).toBe(named.record.surfaceDigest);
    expect(positional.record.calls.map((c) => c.operation)).toEqual(["block"]);
  });

  it("refines compactly in the positional encoding, and a structural change falls back as in the named arm", async () => {
    const fresh = await cell({ arm: "block-positional" });
    const content = await cell({ arm: "block-positional", condition: "refine-content", prior: fresh.prior });
    expect(content.record).toMatchObject({ passed: true, path: "block", refinement: { mode: "compact", retained: true }, changed: true });
    expect((content.record.trace as { encoding: string }).encoding).toBe("positional");
    const structural = await cell({ arm: "block-positional", condition: "refine-structural", prior: fresh.prior });
    expect(structural.record).toMatchObject({ passed: true, path: "fallback", refinement: { mode: "compact", retained: false } });
    expect(structural.record.budgetRemainingAtFallback).toBe(2);
  });

  it("spends the same budget as the named arm on the same faults: one repair, one re-issue", async () => {
    for (const fault of ["invalid-block-call", "unusable-output"] as const) {
      const prompt = promptWithFault(fault);
      const named = await cell({ arm: "block", prompt, faults: true });
      const positional = await cell({ arm: "block-positional", prompt, faults: true });
      const shape = (r: typeof named.record) => ({ path: r.path, passed: r.passed, calls: r.calls.map((c) => [c.operation, c.outcome, c.reissue ?? false]) });
      expect(shape(positional.record), fault).toEqual(shape(named.record));
    }
  });
});

describe("add and remove refinements are checked for the operation they ask for (live/operation.ts)", () => {
  const run = (provider: Provider, arm: Arm, condition: Condition, prior?: PriorResult) =>
    runCell({ reference: astryx, provider, arm, condition, prompt: promptById("rt-01"), corpus, ...(prior ? { prior } : {}), clock: () => "2026-10-10T00:00:00.000Z" });
  /** The scripted provider, except that a primitive refinement's answer is edited the way a model that did the operation would edit it. */
  const editing = (edit: (surface: Json) => void): Provider => {
    const base = createScriptedProvider();
    return {
      ...base,
      surfaceAdapter(options) {
        const inner = base.surfaceAdapter(options);
        if (!options.refinement) return inner;
        return {
          id: inner.id,
          async generate(request, context) {
            const result = await inner.generate(request, context);
            const json = structuredClone(result.json) as Json;
            edit(json);
            return { ...result, json, raw: JSON.stringify(json) };
          },
        };
      },
    };
  };
  /** The rows of the surface's table (Astryx keeps them in the table's data prop). */
  const rows = (surface: Json) => (surface.root.children as Json[]).find((c) => c.component === "table")!.props.data as Json[];

  it("the scripted twin answers an add and a remove by rewriting text alone: the gates pass and the surface changed, but the record says no list changed", async () => {
    for (const arm of ["production", "capped", "block"] as const) {
      const fresh = await cell({ arm });
      for (const [condition, requested] of [["refine-add", "add"], ["refine-remove", "remove"]] as const) {
        const { record } = await cell({ arm, condition, prior: fresh.prior });
        expect(record, `${arm} ${condition}`).toMatchObject({ passed: true, changed: true, operation: { requested, observed: "none", deltas: {} } });
      }
    }
  });

  it("a refinement that adds a row, or removes one, is recorded as doing so, on a primitive refinement and on the block arm's fallback alike", async () => {
    const added = editing((s) => void rows(s).push(structuredClone(rows(s).at(-1)!)));
    const dropped = editing((s) => void rows(s).pop());
    for (const arm of ["production", "block"] as const) {
      const fresh = await run(added, arm, "fresh");
      expect(fresh.record.passed, arm).toBe(true);
      const add = await run(added, arm, "refine-add", fresh.prior);
      expect(add.record, `${arm} add`).toMatchObject({ passed: true, operation: { requested: "add", observed: "add", deltas: { "table.props.data": 1 } } });
      const remove = await run(dropped, arm, "refine-remove", fresh.prior);
      expect(remove.record, `${arm} remove`).toMatchObject({ passed: true, operation: { requested: "remove", observed: "remove", deltas: { "table.props.data": -1 } } });
      if (arm === "block") expect([add.record.path, remove.record.path]).toEqual(["fallback", "fallback"]);
    }
  });

  it("checks only add and remove refinements that passed: a content or structural change, and a failed refinement, carry no check", async () => {
    const fresh = await cell({ arm: "production" });
    for (const condition of ["refine-content", "refine-structural"] as const) {
      const { record } = await cell({ arm: "production", condition, prior: fresh.prior });
      expect(record.passed, condition).toBe(true);
      expect(record.operation, condition).toBeUndefined();
    }
    const broken = editing((s) => void (s.root = { component: "no-such-component", id: "x" }));
    const { record } = await run(broken, "production", "refine-add", fresh.prior);
    expect(record.passed).toBe(false);
    expect(record.operation).toBeUndefined();
  });
});
