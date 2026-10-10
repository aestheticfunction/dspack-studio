/**
 * The refinement decision (Phase 1A, commit 4): compact refinement is used
 * only when the prior turn's trace is valid for it; every other case switches
 * visibly to primitive refinement over the full prior surface. A digest
 * mismatch is a switch, never an invariant failure.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decideRefinement, expandBlock, expansionDigest, parseBlocksSidecar, type BlockTrace } from "./index";

type Json = Record<string, any>;
const repo = (rel: string) => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));
const json = (rel: string) => JSON.parse(readFileSync(repo(rel), "utf8")) as Json;

const parsed = parseBlocksSidecar(json("apps/composer/experimental/blocks/astryx.blocks.json"));
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
const sidecar = parsed.sidecar;
const authForm = sidecar.blocks.find((b) => b.id === "auth-form")!;
const example = authForm.examples[0]!;
const expanded = expandBlock(authForm, example.call, { reference: sidecar.reference, intent: example.intent });
if (!expanded.ok) throw new Error(expanded.message);
const surface = expanded.surface;

async function trace(overrides: Partial<BlockTrace> = {}): Promise<BlockTrace> {
  return {
    selected: { id: "auth-form", version: 1, intent: example.intent },
    encoding: "named",
    blockSchemaSha256: "a".repeat(64),
    blockSystemSha256: "b".repeat(64),
    attempts: [{ index: 0, rawText: JSON.stringify(example.call), call: example.call, b1: [], b2: [], outcome: "ok" }],
    providerCalls: 1,
    outcome: "block",
    expansionDigest: await expansionDigest(surface),
    expansionAttemptIndex: 0,
    rawIsExpansion: true,
    ...overrides,
  };
}

const prior = (block: BlockTrace | undefined, extra: Json = {}) => ({
  prompt: example.prompt,
  progress: { ...(block ? { block } : {}), outcome: "passed", report: { attempts: [{ index: 0, surface }] }, surface, ...extra },
});

describe("decideRefinement", () => {
  it("no prior trace: primitive refinement, exactly today's", async () => {
    expect(await decideRefinement(prior(undefined), [authForm])).toEqual({ mode: "primitive" });
  });

  it("a valid prior trace: compact, seeded with the accepted call and the prior goal", async () => {
    expect(await decideRefinement(prior(await trace()), [authForm])).toEqual({
      mode: "compact",
      seed: { id: "auth-form", version: 1, intent: example.intent, call: example.call, priorGoal: example.prompt },
    });
  });

  it("the block is no longer available (disabled or ineligible): switch", async () => {
    expect(await decideRefinement(prior(await trace()), [])).toEqual({ mode: "switch", reason: "block-unavailable" });
  });

  it("a prior trace that did not end in block mode: switch", async () => {
    expect(await decideRefinement(prior(await trace({ outcome: "fallback", fallback: { reason: "x", classification: "invalid-call" } })), [authForm])).toEqual({ mode: "switch", reason: "no-valid-seed" });
  });

  it("the prior run passed only after a surface repair (its surface is not the expansion): switch", async () => {
    const repaired = prior(await trace(), { report: { attempts: [{ index: 0, surface }, { index: 1, surface }] } });
    expect(await decideRefinement(repaired, [authForm])).toEqual({ mode: "switch", reason: "repaired-prior" });
  });

  it("the prior surface no longer matches the expansion digest: switch, never an invariant failure", async () => {
    const edited = structuredClone(surface);
    (edited.root as Json).children[0].text = "Edited by hand";
    const mismatch = prior(await trace(), { surface: edited, report: { attempts: [{ index: 0, surface: edited }] } });
    expect(await decideRefinement(mismatch, [authForm])).toEqual({ mode: "switch", reason: "digest-mismatch" });
  });

  it("a trace missing its accepted call: switch", async () => {
    const noCall = await trace({ attempts: [{ index: 0, b1: [], b2: [], outcome: "ok" }] });
    expect(await decideRefinement(prior(noCall), [authForm])).toEqual({ mode: "switch", reason: "no-valid-seed" });
  });
});
