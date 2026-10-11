/**
 * What a block trace may leave behind. The trace is a turn-level, in-memory
 * record and keeps the model's literal text for the live receipt. Durable
 * state keeps the validated named call and safe diagnostics only: provenance
 * stores the expansion's validated call, and anything that persists a trace
 * stores durableTrace(trace), with hashes and byte counts in place of literal
 * text, the call of validated attempts only, and no sentinel reason.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProfile, type Profile } from "@aestheticfunction/dspack-emit";
import {
  budgetedInner,
  createBudget,
  decideRefinement,
  durableTrace,
  encodeCall,
  parseBlocksSidecar,
  runBlockPhase,
  sha256Hex,
  type CallEncoding,
  type ErrorKind,
  type StructuralAdapter,
} from "./index";

type Json = Record<string, any>;
const repo = (rel: string) => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(repo(rel), "utf8")) as Json;
const contract = read("apps/composer/astryx-project/astryx.dspack.json");
const profile = loadProfile(read("apps/composer/astryx-project/astryx.profile.json") as never) as Profile;
const parsed = parseBlocksSidecar(read("apps/composer/experimental/blocks/astryx.blocks.json"));
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
const sidecar = parsed.sidecar;
const recordsTable = sidecar.blocks.find((b) => b.id === "records-table")!;
const triage = recordsTable.examples[0]!;
const bytes = (text: string) => new TextEncoder().encode(text).length;

const deps = {
  classify: (): ErrorKind => "provider",
  makeError: (_kind: string, message: string) => new Error(message),
  lint: () => ({ pass: true, gates: ["S1", "S2", "S3"].map((gate) => ({ gate, status: "PASS", errors: [] })) }),
};
const scripted = (answers: unknown[]): StructuralAdapter => {
  let cursor = 0;
  return {
    id: "test:scripted",
    async generate() {
      const answer = answers[cursor++];
      return { json: answer, raw: JSON.stringify(answer), model: "test-model", usage: { inputTokens: 100, outputTokens: 10 } };
    },
  };
};
async function run(answers: unknown[], options: { encoding?: CallEncoding; seed?: { priorGoal: string; priorCall: Json }; goal?: string } = {}) {
  const budget = createBudget(3);
  return runBlockPhase({
    block: recordsTable,
    intent: triage.intent,
    goal: options.goal ?? triage.prompt,
    reference: sidecar.reference,
    contract,
    profile,
    inner: budgetedInner(scripted(answers), budget, deps),
    budget,
    deps,
    ...(options.encoding ? { encoding: options.encoding } : {}),
    ...(options.seed ? { seed: options.seed } : {}),
  });
}

const MARK = "INVALID-ANSWER ";
const invalid: Record<CallEncoding, Json> = {
  named: { block: "records-table", version: 1, title: MARK.repeat(10) },
  positional: { b: "records-table", v: 1, p: [MARK.repeat(10)] },
};
const valid: Record<CallEncoding, Json> = { named: triage.call, positional: encodeCall(recordsTable, triage.call) };

describe("durableTrace: what a persisted trace may hold", () => {
  it("keeps the validated named call, hashes, byte counts and issue paths, and drops every literal answer and invalid call, in both encodings", async () => {
    for (const encoding of ["named", "positional"] as const) {
      const result = await run([invalid[encoding], valid[encoding]], { encoding });
      expect(result.kind, encoding).toBe("expanded");
      // The in-memory trace keeps the literal text for the live receipt.
      expect(result.trace.attempts[0]!.rawText, encoding).toContain(MARK);
      const durable = await durableTrace(result.trace);
      const text = JSON.stringify(durable);
      expect(text, encoding).not.toContain(MARK);
      expect(text, encoding).not.toMatch(/"rawText"|"rawBlockText"/);
      expect(durable.attempts.map((a) => a.outcome), encoding).toEqual(["invalid", "ok"]);
      expect(durable.attempts[0], encoding).not.toHaveProperty("call");
      expect(durable.attempts[0]!.b1.length, encoding).toBeGreaterThan(0);
      expect(durable.attempts[0]!.rawSha256, encoding).toBe(await sha256Hex(JSON.stringify(invalid[encoding])));
      expect(durable.attempts[0]!.rawBytes, encoding).toBe(bytes(JSON.stringify(invalid[encoding])));
      expect(durable.attempts[1]!.call, encoding).toEqual(triage.call);
      expect(durable.rawBlockSha256, encoding).toBe(await sha256Hex(JSON.stringify(valid[encoding])));
      expect(durable.rawBlockBytes, encoding).toBe(bytes(JSON.stringify(valid[encoding])));
      expect(durable).toMatchObject({ outcome: "block", encoding, expansionDigest: result.trace.expansionDigest, expansionAttemptIndex: 1, providerCalls: 2 });
    }
  });

  it("keeps an unsupported refinement's classification and drops the sentinel's own words", async () => {
    const seed = { priorGoal: triage.prompt, priorCall: triage.call };
    const result = await run([{ unsupported: true, reason: "SENTINEL-WORDS tabs are not a prop" }], { encoding: "positional", seed, goal: "Split it into two tabs." });
    expect(result.trace.fallback?.reason).toContain("SENTINEL-WORDS");
    const durable = await durableTrace(result.trace);
    expect(JSON.stringify(durable)).not.toContain("SENTINEL-WORDS");
    expect(durable.fallback).toEqual({ classification: "unsupported-refinement", reason: "the model answered that this block cannot express the change" });
    expect(durable.attempts).toHaveLength(1);
    expect(durable.attempts[0]).toMatchObject({ outcome: "unsupported", rawSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(durable.attempts[0]).not.toHaveProperty("call");
  });

  it("is enough to seed the next refinement exactly as the in-memory trace does", async () => {
    const result = await run([valid.positional], { encoding: "positional" });
    if (result.kind !== "expanded") throw new Error(result.kind);
    const progress = (block: unknown) => ({ block, outcome: "passed", report: { attempts: [{}] }, surface: result.surface });
    const fromMemory = await decideRefinement({ prompt: "x", progress: progress(result.trace) }, sidecar.blocks);
    const fromDisk = await decideRefinement({ prompt: "x", progress: progress(await durableTrace(result.trace)) }, sidecar.blocks);
    expect(fromDisk).toEqual(fromMemory);
    expect(fromDisk).toMatchObject({ mode: "compact", seed: { call: triage.call } });
  });
});
