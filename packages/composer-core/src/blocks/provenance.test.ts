/**
 * Provenance (Phase 1A, commit 4; ADR-B5): what an accepted block surface
 * remembers about how it was made. Project data, never contract data; a call
 * with no slot for entered values; written only when the accepted surface is
 * exactly the expansion; reduced to inert when it cannot be trusted.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProfile, type Profile } from "@aestheticfunction/dspack-emit";
import {
  budgetedInner,
  buildProvenanceEntry,
  createBudget,
  encodeCall,
  expandBlock,
  expansionDigest,
  parseBlocksSidecar,
  parseProvenance,
  provenanceStatus,
  pruneProvenance,
  PROVENANCE_MAX_BYTES,
  runBlockPhase,
  validateCall,
  type BlockProvenanceEntry,
  type BlockTrace,
  type CallEncoding,
  type ErrorKind,
  type StructuralAdapter,
} from "./index";

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
const binding = { reference: sidecar.reference, baseSha256: sidecar.baseSha256 };

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

describe("buildProvenanceEntry", () => {
  it("records the binding, the block, the intent, the named call and the digest", async () => {
    const entry = await buildProvenanceEntry(await trace(), surface, binding);
    expect(entry).toEqual({
      v: 1,
      reference: sidecar.reference,
      baseSha256: sidecar.baseSha256,
      block: "auth-form",
      version: 1,
      intent: example.intent,
      blockSchemaSha256: "a".repeat(64),
      encoding: "named",
      call: example.call,
      expansionDigest: await expansionDigest(surface),
    });
  });

  it("is written only when the accepted surface IS the expansion", async () => {
    const edited = structuredClone(surface);
    (edited.root as Json).children[0].text = "Edited";
    expect(await buildProvenanceEntry(await trace(), edited, binding)).toBeNull();
    expect(await buildProvenanceEntry(await trace({ outcome: "fallback" }), surface, binding)).toBeNull();
  });

  it("never exceeds the size cap", async () => {
    const huge = { ...example.call, title: "x".repeat(PROVENANCE_MAX_BYTES) };
    const big = await trace({ attempts: [{ index: 0, call: huge, b1: [], b2: [], outcome: "ok" }] });
    expect(await buildProvenanceEntry(big, surface, binding)).toBeNull();
  });

  it("the call has no slot for entered values, defaults, credentials or runtime state: only declared B1 props", async () => {
    const entry = (await buildProvenanceEntry(await trace(), surface, binding))!;
    const declared = new Set(["block", "version", ...authForm.props.map((p) => p.name)]);
    for (const key of Object.keys(entry.call)) expect(declared.has(key), key).toBe(true);
    expect(validateCall(authForm, entry.call)).toEqual([]);
    expect(JSON.stringify(entry).toLowerCase()).not.toMatch(/"value"|"default"|"secret"|"token"/);
  });
});

describe("parseProvenance", () => {
  const valid = async (): Promise<BlockProvenanceEntry> => (await buildProvenanceEntry(await trace(), surface, binding))!;

  it("keeps a valid entry, validated against the matching bundled sidecar", async () => {
    const entry = await valid();
    expect(parseProvenance({ "ex.chat-1": entry }, [sidecar])).toEqual({ "ex.chat-1": entry });
  });

  it("an unknown block version keeps only {block, version, status: inert} and why: the call is stripped", async () => {
    const entry = { ...(await valid()), version: 7 };
    expect(parseProvenance({ "ex.chat-1": entry }, [sidecar])).toEqual({ "ex.chat-1": { block: "auth-form", version: 7, status: "inert", reason: "version" } });
  });

  it("a binding to another base, or a call that fails B1, is inert too", async () => {
    const other = { ...(await valid()), baseSha256: "0".repeat(64) };
    const broken = { ...(await valid()), call: { ...example.call, mode: "sign-ip" } };
    expect(parseProvenance({ a: other, b: broken }, [sidecar])).toEqual({
      a: { block: "auth-form", version: 1, status: "inert", reason: "base" },
      b: { block: "auth-form", version: 1, status: "inert", reason: "validation" },
    });
  });

  it("garbage is dropped, and a non-object is an empty map", async () => {
    expect(parseProvenance({ a: "nope", b: 1, c: { block: "x" } }, [sidecar])).toEqual({});
    expect(parseProvenance("x", [sidecar])).toEqual({});
    expect(parseProvenance(null, [sidecar])).toEqual({});
  });
});

describe("provenanceStatus", () => {
  it("refinable for a known entry on a reference project; inert for an inert entry; unavailable for imported and repository projects", async () => {
    const entry = (await buildProvenanceEntry(await trace(), surface, binding))!;
    expect(provenanceStatus(entry, { sidecars: [sidecar], projectKind: "reference" })).toBe("refinable");
    expect(provenanceStatus({ block: "auth-form", version: 7, status: "inert" }, { sidecars: [sidecar], projectKind: "reference" })).toBe("inert");
    expect(provenanceStatus(entry, { sidecars: [sidecar], projectKind: "imported" })).toBe("unavailable");
    expect(provenanceStatus(entry, { sidecars: [sidecar], projectKind: "agent" })).toBe("unavailable");
    expect(provenanceStatus(entry, { sidecars: [], projectKind: "reference" })).toBe("inert");
  });
});

describe("pruneProvenance", () => {
  it("drops entries whose example vanished or whose surface was hand-edited; keeps the rest", async () => {
    const entry = (await buildProvenanceEntry(await trace(), surface, binding))!;
    const edited = structuredClone(surface);
    (edited.root as Json).children[0].text = "Edited";
    const pruned = await pruneProvenance({ keep: entry, gone: entry, changed: entry, inert: { block: "auth-form", version: 7, status: "inert" } }, [
      { id: "keep", surface },
      { id: "changed", surface: edited },
      { id: "inert", surface },
    ]);
    expect(Object.keys(pruned).sort()).toEqual(["inert", "keep"]);
  });
});

/** The app's one durable block record, against a trace that saw an invalid answer before the valid one. */
describe("provenance holds the validated named call only", () => {
  const recordsTable = sidecar.blocks.find((b) => b.id === "records-table")!;
  const triage = recordsTable.examples[0]!;
  const contract = json("apps/composer/astryx-project/astryx.dspack.json");
  const profile = loadProfile(json("apps/composer/astryx-project/astryx.profile.json") as never) as Profile;
  const deps = {
    classify: (): ErrorKind => "provider",
    makeError: (_kind: string, message: string) => new Error(message),
    lint: () => ({ pass: true, gates: ["S1", "S2", "S3"].map((gate) => ({ gate, status: "PASS", errors: [] })) }),
  };
  const MARK = "INVALID-ANSWER ";
  const answers: Record<CallEncoding, Json[]> = {
    named: [{ block: "records-table", version: 1, title: MARK.repeat(10) }, triage.call],
    positional: [{ b: "records-table", v: 1, p: [MARK.repeat(10)] }, encodeCall(recordsTable, triage.call)],
  };

  it("never an earlier invalid answer or any literal model text, whichever encoding answered", async () => {
    for (const encoding of ["named", "positional"] as const) {
      const queue = [...answers[encoding]];
      const inner: StructuralAdapter = { id: "test", generate: async () => {
        const answer = queue.shift();
        return { json: answer, raw: JSON.stringify(answer), model: "test-model" };
      } };
      const budget = createBudget(3);
      const result = await runBlockPhase({ block: recordsTable, intent: triage.intent, goal: triage.prompt, reference: sidecar.reference, contract, profile, inner: budgetedInner(inner, budget, deps), budget, deps, encoding });
      if (result.kind !== "expanded") throw new Error(result.kind);
      expect(result.trace.attempts[0]!.rawText, encoding).toContain(MARK);
      const entry = await buildProvenanceEntry(result.trace, result.surface, binding);
      const text = JSON.stringify(entry);
      expect(text, encoding).not.toContain(MARK);
      expect(text, encoding).not.toMatch(/rawText|rawBlockText/);
      expect(entry?.call, encoding).toEqual(triage.call);
      expect(entry?.encoding, encoding).toBe("named");
    }
  });
});

