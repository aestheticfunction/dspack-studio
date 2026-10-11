/**
 * The positional encoding (ADR-B2: the named call is the contract, the
 * compact positional call a wire projection that Phase 1B benchmarks against
 * it). Asked for it, the block phase requests the compact call, decodes the
 * answer to the named call before B1, B2 and expansion, and spends the same
 * budget. Named stays the default, its requests byte for byte as before.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProfile, type Profile } from "@aestheticfunction/dspack-emit";
import {
  budgetedInner,
  callJsonSchema,
  createBudget,
  decideRefinement,
  encodeCall,
  parseBlocksSidecar,
  runBlockPhase,
  sha256Hex,
  wireIndex,
  type BlockDefinition,
  type BlockPhaseResult,
  type BlocksSidecar,
  type CallEncoding,
  type ErrorKind,
  type GenerateRequest,
  type StructuralAdapter,
} from "./index";

type Json = Record<string, any>;
const repo = (rel: string) => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(repo(rel), "utf8")) as Json;

interface Reference {
  id: string;
  contract: Json;
  profile: Profile;
  sidecar: BlocksSidecar;
}
const reference = (id: string, contract: string, profile: string): Reference => {
  const parsed = parseBlocksSidecar(read(`apps/composer/experimental/blocks/${id}.blocks.json`));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return { id, contract: read(contract), profile: loadProfile(read(profile) as never) as Profile, sidecar: parsed.sidecar };
};
const REFERENCES = [
  reference("shadcn-v3", "apps/composer/shadcn-v3-project/shadcn-ui.dspack.json", "apps/composer/shadcn-v3-project/shadcn-v3.profile.json"),
  reference("astryx", "apps/composer/astryx-project/astryx.dspack.json", "apps/composer/astryx-project/astryx.profile.json"),
];
const EXAMPLES = REFERENCES.flatMap((ref) => ref.sidecar.blocks.flatMap((block) => block.examples.map((example) => ({ ref, block, example }))));
const astryx = REFERENCES[1]!;
const recordsTable = astryx.sidecar.blocks.find((b) => b.id === "records-table")!;
const triage = recordsTable.examples[0]!;

class TestAdapterError extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(message);
  }
}
const deps = {
  classify: (error: unknown): ErrorKind => (error instanceof TestAdapterError ? (error.kind as ErrorKind) : "unknown"),
  makeError: (kind: string, message: string, cause?: unknown) => (cause instanceof TestAdapterError ? cause : new TestAdapterError(kind, message)),
  lint: () => ({ pass: true, gates: ["S1", "S2", "S3"].map((gate) => ({ gate, status: "PASS", errors: [] })) }),
};

/** Plays a script of answers (or errors to throw), recording every request. */
function scripted(answers: unknown[], requests: GenerateRequest[]): StructuralAdapter {
  let cursor = 0;
  return {
    id: "test:scripted",
    async generate(request) {
      requests.push(request);
      const answer = answers[cursor++];
      if (answer instanceof Error) throw answer;
      return { json: answer, raw: JSON.stringify(answer), model: "test-model", usage: { inputTokens: 100, outputTokens: 10 } };
    },
  };
}

interface Run {
  result: BlockPhaseResult;
  requests: GenerateRequest[];
  used: number;
}
async function run(
  ref: Reference,
  block: BlockDefinition,
  intent: string,
  goal: string,
  answers: unknown[],
  options: { encoding?: CallEncoding; seed?: { priorGoal: string; priorCall: Json }; limit?: number } = {},
): Promise<Run> {
  const requests: GenerateRequest[] = [];
  const budget = createBudget(options.limit ?? 3);
  const result = await runBlockPhase({
    block,
    intent,
    goal,
    reference: ref.sidecar.reference,
    contract: ref.contract,
    profile: ref.profile,
    inner: budgetedInner(scripted(answers, requests), budget, deps),
    budget,
    deps,
    ...(options.encoding ? { encoding: options.encoding } : {}),
    ...(options.seed ? { seed: options.seed } : {}),
  });
  return { result, requests, used: budget.used };
}

/** The named block-phase requests on main before the encoding option existed: sha256 of JSON.stringify(request). */
const NAMED_REQUESTS: Record<string, string> = {
  "shadcn-v3/records-table/blk.support-queue/fresh": "db98345adfcc2add2bdf81c566ae9eedb48488381a5abead6a0ac3bb4923f3fb",
  "shadcn-v3/records-table/blk.support-queue/refine": "66ebca3d56e5e49a346bde8685bf66634ae323f024e9f87172e25ba36a2604a7",
  "shadcn-v3/records-table/blk.support-queue/repair": "1bd04b045694926f025f413c84ada8ea3dbb03c8c525a157d3ab189b80b5a17d",
  "shadcn-v3/auth-form/blk.sign-in/fresh": "f97b225c64b8a8b975530294a094e73f680222096e537c281e139ad360d98bd0",
  "shadcn-v3/auth-form/blk.sign-in/refine": "63449803d3ea2904ac358a8f16ec267ac9470f64cab08c0c89f8e42b8923a07a",
  "shadcn-v3/auth-form/blk.sign-in/repair": "14e4be48c5e1172fc93ee523039b3d36c1215fbeb89c4e1aff6e2eef63ee95d2",
  "shadcn-v3/guide-steps/blk.tomato-pasta/fresh": "f5b008a291453299060b8465359d80b9287642332a941d0bb9249b1a3bd364a8",
  "shadcn-v3/guide-steps/blk.tomato-pasta/refine": "ebba7fd290374cce3e74d9768b088d6c9ef958f25fb281e1fef147de9857327b",
  "shadcn-v3/guide-steps/blk.tomato-pasta/repair": "b1de7f5830dfb1a823a6eba545a78255ffc3bc3a61aea0495d9d85656525a5e5",
  "astryx/records-table/blk.support-triage/fresh": "05b4d813eb053ae945d322248446531713bf8eff640cd12dd8efbdf7e527ad55",
  "astryx/records-table/blk.support-triage/refine": "59c958c271ebd7a19a6a906b0c20c344160b58cf9bc9bbcf7441613de6cdfe74",
  "astryx/records-table/blk.support-triage/repair": "cfe389d098289d9e5b09e3c8bd8f52304d2ceac6b581a173065e9e888ae37c34",
  "astryx/auth-form/blk.sign-up/fresh": "f2aa833939571d8194b9193fde74c0fc5e4c7a865bca0661d6a5577063e64c77",
  "astryx/auth-form/blk.sign-up/refine": "f8f83a9aa1731db9a816d267781286b14bcfcfa5e941801846bc4a229e4c5eab",
  "astryx/auth-form/blk.sign-up/repair": "94be32d738df2590ac04eacc0e7538e32eeb4263cbe097d680e4d57e4544b78d",
  "astryx/guide-steps/blk.weeknight-pasta/fresh": "24dd2d7676447d7e6f15515ca32e308aae7706b8da8f442c6b4f61ac08165034",
  "astryx/guide-steps/blk.weeknight-pasta/refine": "b8bb4d2391c53543b10b8a6caef566b921cc45b82a88002fc5317f890f7e1335",
  "astryx/guide-steps/blk.weeknight-pasta/repair": "3074d54bd8614a54dcce73b28eb06b0becc2bbd43c4d694b3731d839b2643755",
};
const REFINE_GOAL = 'Change the title to "Open items".';

describe("named stays the default, byte for byte", () => {
  it("every named request (fresh, refinement, repair) hashes as it did before the encoding option, given no encoding or named", async () => {
    expect(Object.keys(NAMED_REQUESTS)).toHaveLength(3 * EXAMPLES.length);
    for (const { ref, block, example } of EXAMPLES) {
      for (const encoding of [undefined, "named"] as const) {
        const at = (kind: string) => `${ref.id}/${block.id}/${example.id}/${kind}`;
        const fresh = await run(ref, block, example.intent, example.prompt, [example.call], { ...(encoding ? { encoding } : {}) });
        expect(await sha256Hex(JSON.stringify(fresh.requests[0])), at("fresh")).toBe(NAMED_REQUESTS[at("fresh")]);
        const seed = { priorGoal: example.prompt, priorCall: example.call };
        const refine = await run(ref, block, example.intent, REFINE_GOAL, [example.call], { seed, ...(encoding ? { encoding } : {}) });
        expect(await sha256Hex(JSON.stringify(refine.requests[0])), at("refine")).toBe(NAMED_REQUESTS[at("refine")]);
        const repair = await run(ref, block, example.intent, example.prompt, [{ block: block.id, version: block.version }, example.call], { ...(encoding ? { encoding } : {}) });
        expect(await sha256Hex(JSON.stringify(repair.requests[1])), at("repair")).toBe(NAMED_REQUESTS[at("repair")]);
        expect(fresh.result.trace.encoding).toBe("named");
      }
    }
  });
});

describe("the positional encoding", () => {
  it("asks for the compact call: the positional schema, a prompt naming every prop's wire index, and a trace that records the encoding", async () => {
    const { result, requests } = await run(astryx, recordsTable, triage.intent, triage.prompt, [encodeCall(recordsTable, triage.call)], { encoding: "positional" });
    const schema = callJsonSchema(recordsTable, "positional");
    expect(requests[0]!.jsonSchema).toEqual(schema);
    for (const prop of recordsTable.props) expect(requests[0]!.system).toContain(`${wireIndex(recordsTable, prop.name)} ${prop.name}`);
    expect(requests[0]!.system).toContain('"p"');
    expect(result.trace.encoding).toBe("positional");
    expect(result.trace.blockSchemaSha256).toBe(await sha256Hex(JSON.stringify(schema)));
    expect(result.trace.blockSystemSha256).toBe(await sha256Hex(requests[0]!.system));
    // The named prompt carries no wire order.
    const named = await run(astryx, recordsTable, triage.intent, triage.prompt, [triage.call]);
    expect(named.requests[0]!.system).not.toContain('"p"');
  });

  it("decodes the compact answer to the named call: B1, B2 and the expansion read it, and the trace stores it beside the model's literal text", async () => {
    const compact = encodeCall(recordsTable, triage.call);
    const { result } = await run(astryx, recordsTable, triage.intent, triage.prompt, [compact], { encoding: "positional" });
    expect(result.kind).toBe("expanded");
    expect(result.trace.attempts[0]).toMatchObject({ outcome: "ok", call: triage.call, rawText: JSON.stringify(compact) });
    expect(result.trace.rawBlockText).toBe(JSON.stringify(compact));
  });

  it("expands every example on both references to the byte-identical surface the named call expands to", async () => {
    expect(EXAMPLES).toHaveLength(6);
    for (const { ref, block, example } of EXAMPLES) {
      const named = await run(ref, block, example.intent, example.prompt, [example.call]);
      const positional = await run(ref, block, example.intent, example.prompt, [encodeCall(block, example.call)], { encoding: "positional" });
      const label = `${ref.id} ${block.id}`;
      expect(named.result.kind, label).toBe("expanded");
      expect(positional.result.kind, label).toBe("expanded");
      if (named.result.kind !== "expanded" || positional.result.kind !== "expanded") continue;
      expect(JSON.stringify(positional.result.surface), label).toBe(JSON.stringify(named.result.surface));
      expect(positional.result.trace.expansionDigest, label).toBe(named.result.trace.expansionDigest);
    }
  });

  it("refuses an answer that does not decode, or decodes to an invalid call: one repair with pathed feedback, and nothing invalid is expanded", async () => {
    const compact = encodeCall(recordsTable, triage.call) as { b: string; v: number; p: unknown[] };
    const longTitle = "x".repeat(81);
    const invalid: Array<[string, unknown, RegExp]> = [
      ["a named answer", triage.call, /\$\.block: unknown key 'block'/],
      ["another block's id", { ...compact, b: "auth-form" }, /\$\.b: expected block 'records-table'/],
      ["more values than props", { ...compact, p: [...compact.p, null, null, null, null, null] }, /\$\.p: \d+ positional values for 7 declared fields/],
      ["a row given as a named object", { ...compact, p: compact.p.map((v, i) => (i === 3 ? (triage.call.rows as Json[]) : v)) }, /\$\.p\.3\.0: expected a positional array/],
      ["a title past its bound (B1)", { ...compact, p: [longTitle, ...compact.p.slice(1)] }, /\$\.title: longer than 80/],
      ["cells that do not match the columns (B2)", { ...compact, p: compact.p.map((v, i) => (i === 2 ? ["Only one column"] : v)) }, /'columns' and 'rows\.\*\.cells' differ in length/],
    ];
    for (const [label, answer, issue] of invalid) {
      const repaired = await run(astryx, recordsTable, triage.intent, triage.prompt, [answer, compact], { encoding: "positional" });
      expect(repaired.result.kind, label).toBe("expanded");
      expect(repaired.result.trace.attempts.map((a) => a.outcome), label).toEqual(["invalid", "ok"]);
      expect(repaired.result.trace.expansionAttemptIndex, label).toBe(1);
      expect(repaired.requests[1]!.messages.at(-1)!.content, label).toMatch(issue);
      const twice = await run(astryx, recordsTable, triage.intent, triage.prompt, [answer, answer], { encoding: "positional" });
      expect(twice.result, label).toMatchObject({ kind: "fallback", classification: "invalid-call" });
    }
  });

  it("spends exactly what the named encoding spends on the same answers, under the one budget", async () => {
    const valid = { named: triage.call, positional: encodeCall(recordsTable, triage.call) };
    const broken = { named: { block: "records-table", version: 1 }, positional: { b: "records-table", v: 1, p: [] } };
    const scenarios: Array<{ label: string; answers: (e: CallEncoding) => unknown[]; limit?: number }> = [
      { label: "valid at once", answers: (e) => [valid[e]] },
      { label: "repaired", answers: (e) => [broken[e], valid[e]] },
      { label: "invalid twice", answers: (e) => [broken[e], broken[e]] },
      { label: "unusable output, re-issued", answers: (e) => [new TestAdapterError("output", "prose"), valid[e]] },
      { label: "no budget for a repair", answers: (e) => [broken[e], valid[e]], limit: 1 },
      { label: "provider failure", answers: () => [new TestAdapterError("provider", "down")] },
    ];
    for (const { label, answers, limit } of scenarios) {
      const outcome = async (encoding: CallEncoding) => {
        const r = await run(astryx, recordsTable, triage.intent, triage.prompt, answers(encoding), { encoding, ...(limit ? { limit } : {}) });
        return { kind: r.result.kind, providerCalls: r.result.trace.providerCalls, used: r.used, requests: r.requests.length };
      };
      expect(await outcome("positional"), label).toEqual(await outcome("named"));
    }
  });

  it("refines in the compact form: the prior call goes out encoded, the revision is decoded, the sentinel still falls back, and the next refinement seeds from the named call", async () => {
    const seed = { priorGoal: triage.prompt, priorCall: triage.call };
    const revised = { ...triage.call, title: "Open items" };
    const { result, requests } = await run(astryx, recordsTable, triage.intent, REFINE_GOAL, [encodeCall(recordsTable, revised)], { encoding: "positional", seed });
    expect(requests[0]!.messages).toEqual([
      { role: "user", content: triage.prompt },
      { role: "assistant", content: JSON.stringify(encodeCall(recordsTable, triage.call)) },
      { role: "user", content: REFINE_GOAL },
    ]);
    expect((requests[0]!.jsonSchema as Json).anyOf[0]).toEqual(callJsonSchema(recordsTable, "positional"));
    expect(result.kind).toBe("expanded");
    if (result.kind !== "expanded") return;
    expect(result.trace.attempts[0]!.call).toEqual(revised);
    const progress = { block: result.trace, outcome: "passed", report: { attempts: [{}] }, surface: result.surface };
    const decision = await decideRefinement({ prompt: REFINE_GOAL, progress }, astryx.sidecar.blocks);
    expect(decision).toMatchObject({ mode: "compact", seed: { call: revised } });
    const unsupported = await run(astryx, recordsTable, triage.intent, "Split it into two tabs.", [{ unsupported: true, reason: "tabs are not a prop" }], { encoding: "positional", seed });
    expect(unsupported.result).toMatchObject({ kind: "fallback", classification: "unsupported-refinement" });
  });
});
