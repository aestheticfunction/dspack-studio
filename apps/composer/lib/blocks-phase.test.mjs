/**
 * The block phase against the REAL pieces it is injected with in the browser:
 * dspack-gen's lintSurface and runPipeline, dspack-emit under the reference
 * profile, and the typed gateway error. composer-core's own phase tests use
 * stubs (it does not depend on dspack-gen); this is the integration that
 * proves the seams fit, and that no path lets a plain Error reach runPipeline.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProfile } from "@aestheticfunction/dspack-emit";
import { AdapterOutputError } from "@aestheticfunction/dspack-gen/adapter-types";
import { runPipeline } from "@aestheticfunction/dspack-gen/browser";
import { lintSurface } from "@aestheticfunction/dspack-gen/core";
import { budgetedInner, createBudget, parseBlocksSidecar, preloadedAdapter, runBlockPhase } from "@dspack-studio/composer-core/blocks";
import { GatewayError } from "../app/hosted-build";

const json = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const contract = json("../astryx-project/astryx.dspack.json");
const profile = loadProfile(json("../astryx-project/astryx.profile.json"));
const parsed = parseBlocksSidecar(json("../experimental/blocks/astryx.blocks.json"));
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
const sidecar = parsed.sidecar;
const block = sidecar.blocks.find((b) => b.id === "auth-form");
const example = block.examples[0];

/** Exactly the dependencies hosted-build.ts injects. */
const deps = {
  classify: (error) => (error instanceof GatewayError ? error.kind : "unknown"),
  lint: (surface) => lintSurface(surface, contract),
  makeError: (kind, message) => new GatewayError(`${kind}: ${message}`, "provider", []),
};

/** An adapter playing a script of JSON outputs or errors, with the block-mode context recorded. */
function scripted(entries, calls = []) {
  let cursor = 0;
  return {
    id: "hosted-ai:test",
    async generate(request, context) {
      calls.push({ request, context });
      const entry = entries[cursor++];
      if (entry instanceof Error) throw entry;
      return { json: entry, raw: JSON.stringify(entry), model: "test", usage: { inputTokens: 50, outputTokens: 5 } };
    },
  };
}

const phase = (inner, budget, extra = {}) =>
  runBlockPhase({ block, intent: example.intent, goal: example.prompt, reference: sidecar.reference, contract, profile, inner, budget, deps, ...extra });

describe("block phase + runPipeline, with the real linter, emitter and gateway error", () => {
  it("expanded: attempt 0 is the expansion with no call, maxRepairs is 3 - k, and the run passes", async () => {
    const budget = createBudget(3);
    const inner = budgetedInner(scripted([example.call]), budget, deps);
    const result = await phase(inner, budget);
    expect(result.kind).toBe("expanded");
    expect(budget.used).toBe(1);

    const { report } = await runPipeline({
      contract,
      intent: example.intent,
      prompt: example.prompt,
      adapter: preloadedAdapter(result.surface, inner, { outcome: result.trace.outcome, expansionDigest: result.trace.expansionDigest }),
      maxRepairs: 3 - budget.used,
      emitProfile: profile,
      now: () => new Date(0),
    });
    expect(report.outcome).toBe("passed");
    expect(report.generation.maxRepairs).toBe(2);
    expect(report.attempts).toHaveLength(1);
    expect(report.attempts[0].meta).toEqual({ blockTrace: { outcome: "block", expansionDigest: result.trace.expansionDigest } });
    expect(report.attempts[0].surface).toEqual(result.surface);
    expect(budget.used).toBe(1); // the preloaded attempt cost nothing
  });

  it("provider failure on the block repair: the captured GatewayError is replayed into a failed-adapter report shaped like today's", async () => {
    const budget = createBudget(3);
    const bad = { ...example.call, mode: "sign-ip" };
    const gatewayError = new GatewayError("The shared generation gateway is busy right now.", "provider", [], 503);
    const inner = budgetedInner(scripted([bad, gatewayError]), budget, deps);
    const result = await phase(inner, budget);
    expect(result.kind).toBe("provider-failure");
    expect(result.classification).toBe("provider");
    expect(result.trace.providerCalls).toBe(2);

    // Step 5 of the sequence: an adapter that reuses the id and rethrows the captured error.
    const replay = { id: inner.id, generate: async () => Promise.reject(result.error) };
    const { report } = await runPipeline({ contract, intent: example.intent, prompt: example.prompt, adapter: replay, maxRepairs: 0, emitProfile: profile, now: () => new Date(0) });
    expect(report.outcome).toBe("failed-adapter");
    expect(report.generation.adapterId).toBe("hosted-ai:test");
    expect(report.attempts).toEqual([{ index: 0, adapterError: expect.stringContaining("busy right now") }]);
  });

  it("an exhausted budget never throws a plain Error into runPipeline: it ends as failed-adapter", async () => {
    const budget = createBudget(0);
    const inner = budgetedInner(scripted([example.call]), budget, deps);
    const { report } = await runPipeline({ contract, intent: example.intent, prompt: example.prompt, adapter: inner, maxRepairs: 2, emitProfile: profile, now: () => new Date(0) });
    expect(report.outcome).toBe("failed-adapter");
    expect(report.attempts[0].adapterError).toMatch(/budget/);
  });

  it("an unusable output at a surface repair is re-issued once within the budget, and the Worker-style error is an AdapterOutputError", async () => {
    const budget = createBudget(3);
    const unusable = new GatewayError("Hosted generation did not return a usable proposal.", "output", [], 502, "unusable-output");
    expect(unusable).toBeInstanceOf(AdapterOutputError);
    const calls = [];
    const inner = budgetedInner(scripted([unusable, example.call], calls), budget, deps);
    const out = await inner.generate({ system: "s", messages: [], jsonSchema: {} }, { operation: "block" });
    expect(out.json).toEqual(example.call);
    expect(calls.map((c) => c.context)).toEqual([{ operation: "block" }, { operation: "block", reissue: true }]);
    expect(budget.used).toBe(2);
  });

  it("the real linter: an expansion failing S2 is an invariant failure with the linter's words, and no further call", async () => {
    const budget = createBudget(3);
    const defective = { ...block, template: { component: "card", id: "c", children: [{ component: "not-a-component", id: "x" }] } };
    const calls = [];
    const result = await phase(budgetedInner(scripted([example.call, example.call], calls), budget, deps), budget, { block: defective });
    expect(result.kind).toBe("invariant-failure");
    expect(result.reasons.join(" ")).toMatch(/S2 FAIL.*not-a-component/);
    expect(calls).toHaveLength(1);
    expect(budget.used).toBe(1);
  });
});
