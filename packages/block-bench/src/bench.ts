/**
 * The interface-blocks bench (docs/BLOCKS.md, Phase 0). Offline and
 * deterministic: no network, no model calls, no clocks. Everything it
 * measures is produced by the REAL code paths, never a re-implementation:
 *
 *   requests  The exact hosted generation and planning requests, captured by
 *             running dspack-gen's real runPipeline (as hosted-build.ts does)
 *             with a capture adapter, serialized by composer-core's
 *             proposeBody and formatted by the Worker's own guidedSystem.
 *             Their sha256 values are the flag-off byte-identity oracle.
 *   outputs   Every worked example: surface JSON vs emitted A2UI vs json-render.
 *   leak      Recorded live attempts that fail S3 while the protocol-level
 *             structural checks (A1-A3, J2/J3) pass.
 *   drafts    Draft block calls (named, positional) vs their hand-expanded
 *             goldens, plus the projected selected-block schema size.
 *   parity    B0's ported generation view vs the real generation schema.
 *
 * Token counts use js-tiktoken o200k_base: an OFFLINE ESTIMATE (the encoding
 * the external research used), not Claude's tokenizer and never mixed with
 * provider-reported usage. Bytes are UTF-8 and exact.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runPipeline } from "@aestheticfunction/dspack-gen/browser";
import { lintSurface, type Contract } from "@aestheticfunction/dspack-gen/core";
import { AdapterOutputError } from "@aestheticfunction/dspack-gen/adapter-types";
import {
  buildCatalogModel,
  emitJsonRenderSpec,
  emitSurface,
  loadProfile,
  transformFromJson,
  validateSpecAgainstModel,
  type A2uiVersion,
  type Profile,
} from "@aestheticfunction/dspack-emit";
import { buildFlowPlanRequest, buildPlanRequest, proposeBody, refinementConversation } from "@dspack-studio/composer-core";
import {
  callJsonSchema,
  encodeCall,
  generationView,
  parseBlocksSidecar,
  sha256Hex,
  type BlocksSidecar,
} from "@dspack-studio/composer-core/blocks";
import { getEncoding } from "js-tiktoken";
// The Worker module is dependency-free; this is the exact function it uses.
import { guidedSystem } from "../../../apps/composer/worker/propose.mjs";

type Json = Record<string, any>;

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string): Json => JSON.parse(readFileSync(`${REPO}${rel}`, "utf8"));

export const REFERENCES = [
  {
    id: "shadcn-v3",
    contract: "apps/composer/shadcn-v3-project/shadcn-ui.dspack.json",
    profile: "apps/composer/shadcn-v3-project/shadcn-v3.profile.json",
    sidecar: "apps/composer/experimental/blocks/shadcn-v3.blocks.json",
  },
  {
    id: "astryx",
    contract: "apps/composer/astryx-project/astryx.dspack.json",
    profile: "apps/composer/astryx-project/astryx.profile.json",
    sidecar: "apps/composer/experimental/blocks/astryx.blocks.json",
  },
] as const;

/** Fixed planning goals (one per draft block family) and one flow goal. */
export const PLAN_GOALS = [
  "a queue of open support tickets with status and priority",
  "a sign-in form with email and password",
  "a recipe for tomato pasta for two with ingredients and steps",
] as const;
export const FLOW_GOAL = "onboard a new customer: sign up, review the plan, then confirm";
/** The refinement instruction every refine capture uses. */
export const REFINE_INSTRUCTION = "make the title clearer";

const A2UI_VERSIONS: A2uiVersion[] = ["0.9.1", "1.0"];

const encoder = getEncoding("o200k_base");
const tokenCache = new Map<string, number>();
export function tokens(text: string): number {
  let n = tokenCache.get(text);
  if (n === undefined) {
    n = encoder.encode(text).length;
    tokenCache.set(text, n);
  }
  return n;
}
const bytes = (text: string) => new TextEncoder().encode(text).length;
const size = (text: string) => ({ bytes: bytes(text), tokens: tokens(text) });

// ---------------------------------------------------------------------------

interface Captured {
  system: string;
  messages: Array<{ role: string; content: string }>;
  jsonSchema: Json;
}

/** Run the real pipeline with an adapter that records the request and stops. */
async function captureRequest(contract: Json, profile: Profile, intent: string, prompt: string, conversation?: Captured["messages"]): Promise<Captured> {
  let captured: Captured | undefined;
  const adapter = {
    id: "bench-capture",
    async generate(request: Captured) {
      captured = request;
      throw new AdapterOutputError("bench-capture", "request captured");
    },
  };
  // Exactly the options hosted-build.ts streamHostedBuild passes.
  await runPipeline({
    contract: contract as Contract,
    intent,
    prompt,
    adapter: adapter as never,
    maxRepairs: 2,
    emitProfile: profile,
    ...(conversation && conversation.length > 0 ? { conversation: conversation as never } : {}),
    now: () => new Date(0),
  });
  if (!captured) throw new Error(`no request captured for ${intent}`);
  return captured;
}

async function measureRequest(request: Captured) {
  const body = proposeBody(request);
  const guided = guidedSystem(request.system, request.jsonSchema) as string;
  const messages = request.messages.map((m) => m.content).join("\n");
  return {
    bodySha256: await sha256Hex(body),
    bodyBytes: bytes(body),
    modelInput: {
      system: size(request.system),
      schemaText: size(JSON.stringify(request.jsonSchema)),
      messages: size(messages),
      totalTokens: tokens(guided) + tokens(messages),
    },
  };
}

function exampleFor(contract: Json, intent: string, which: "first" | "last"): Json | undefined {
  const matches = ((contract.examples ?? []) as Json[]).filter((e) => e.intent === intent);
  return which === "first" ? matches[0] : matches.at(-1);
}

async function requestGoldens(ref: (typeof REFERENCES)[number], contract: Json, profile: Profile) {
  const generation: Json[] = [];
  for (const intent of (contract.intents as Json[]).map((i) => i.id as string)) {
    const prompt = (exampleFor(contract, intent, "first")?.prompt as string | undefined) ?? `a ${intent} surface`;
    generation.push({ intent, mode: "fresh", prompt, ...(await measureRequest(await captureRequest(contract, profile, intent, prompt))) });
    const prior = exampleFor(contract, intent, "last");
    if (prior) {
      const conversation = refinementConversation(prior.prompt as string, prior.surface);
      generation.push({
        intent,
        mode: "refine",
        prompt: REFINE_INSTRUCTION,
        priorExample: prior.id,
        ...(await measureRequest(await captureRequest(contract, profile, intent, REFINE_INSTRUCTION, conversation))),
      });
    }
  }
  const planning: Json[] = [];
  for (const goal of PLAN_GOALS) planning.push({ kind: "plan", goal, ...(await measureRequest(buildPlanRequest(goal, contract) as Captured)) });
  planning.push({ kind: "flow-plan", goal: FLOW_GOAL, ...(await measureRequest(buildFlowPlanRequest(FLOW_GOAL, contract) as Captured)) });
  return { reference: ref.id, generation, planning };
}

// ---------------------------------------------------------------------------

/** Every emitted A2UI action name (event names) in a message list. */
export function emittedActionNames(messages: unknown): string[] {
  const out = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === "object") {
      const record = value as Json;
      if (record.event && typeof record.event === "object" && typeof record.event.name === "string") out.add(record.event.name);
      Object.values(record).forEach(walk);
    }
  };
  walk(messages);
  return [...out].sort();
}

/** Emit one surface to both protocols and run their structural checks. */
export function protocolChecks(surface: Json, contract: Json, profile: Profile) {
  const result: Json = {};
  try {
    const { messages } = emitSurface(surface as never, contract as never, { profile });
    const text = JSON.stringify(messages);
    result.a2ui = {
      ...size(text),
      gates: Object.fromEntries(
        A2UI_VERSIONS.map((version) => {
          const out = transformFromJson(contract as never, { a2uiVersion: version, surface: { messages }, profile });
          return [version, Object.fromEntries(out.validation.gates.map((g: Json) => [gateId(g.name), g.pass]))];
        }),
      ),
      actions: emittedActionNames(messages),
    };
  } catch (error) {
    result.a2ui = { refusal: firstLine(error) };
  }
  try {
    const { spec } = emitJsonRenderSpec(surface as never, contract as never);
    const text = JSON.stringify(spec);
    const findings = validateSpecAgainstModel(spec, buildCatalogModel(contract as never, {}));
    result.jsonRender = { ...size(text), J2J3: findings.length === 0 };
  } catch (error) {
    result.jsonRender = { refusal: firstLine(error) };
  }
  return result;
}

function gateId(name: string): string {
  return name.startsWith("schema-compile") ? "A1" : name === "catalog-shape" ? "A2" : "A3";
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 240);
}

function lintVerdicts(surface: Json, contract: Json) {
  const report = lintSurface(surface, contract as Contract);
  return Object.fromEntries(report.gates.map((g) => [g.gate, g.status])) as Record<"S1" | "S2" | "S3", string>;
}

function outputSizes(contract: Json, profile: Profile) {
  return ((contract.examples ?? []) as Json[]).map((example) => ({
    example: example.id,
    intent: example.intent,
    surface: size(JSON.stringify(example.surface)),
    ...protocolChecks(example.surface, contract, profile),
  }));
}

// ---------------------------------------------------------------------------

function leakTable(contract: Json, profile: Profile) {
  const dir = `${REPO}packages/replay/fixtures`;
  const rows: Json[] = [];
  let liveAttempts = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const fixture = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as Json;
    if (fixture.mode !== "live") continue;
    const events = (fixture.events as Json[]).map((e) => e.event as Json);
    const audit = events.find((e) => e.type === "CUSTOM" && e.name === "dspack.audit")?.value as Json | undefined;
    for (const event of events) {
      if (event.type !== "CUSTOM" || event.name !== "dspack.gates") continue;
      liveAttempts++;
      const value = event.value as Json;
      const recorded = Object.fromEntries((value.gates as Json[]).map((g) => [g.gate, g.status]));
      const recomputed = lintVerdicts(value.surface, contract);
      if (recorded.S3 !== "FAIL" && recomputed.S3 !== "FAIL") continue;
      rows.push({
        fixture: fixture.id,
        attempt: value.index,
        adapterId: fixture.adapterId,
        recordedContractSha256: audit?.report?.request?.contract?.sha256 ?? null,
        recorded,
        recomputed,
        disagree: ["S1", "S2", "S3"].some((g) => recorded[g] !== recomputed[g as "S1"]),
        ...protocolChecks(value.surface, contract, profile),
      });
    }
  }
  const structurallyValid = (row: Json) =>
    !row.a2ui.refusal && Object.values(row.a2ui.gates as Json).every((v: Json) => Object.values(v).every(Boolean)) && !row.jsonRender.refusal && row.jsonRender.J2J3;
  const s3Failing = rows.filter((r) => r.recomputed.S3 === "FAIL");
  return {
    scope: "local models, Astryx, recorded July 2026; not hosted evidence",
    liveAttempts,
    rows,
    summary: {
      s3FailingRecomputed: s3Failing.length,
      s3FailingButStructurallyValid: s3Failing.filter(structurallyValid).length,
      verdictDisagreements: rows.filter((r) => r.disagree).length,
    },
  };
}

// ---------------------------------------------------------------------------

function goldenPath(ref: string, block: string, intent: string): string {
  return `packages/block-bench/goldens/${ref}/${block}.${intent}.dsurface.json`;
}

function drafts(ref: (typeof REFERENCES)[number], sidecar: BlocksSidecar, contract: Json, profile: Profile, generation: Json[]) {
  return sidecar.blocks.flatMap((block) =>
    block.examples.map((example) => {
      const golden = read(goldenPath(ref.id, block.id, example.intent));
      const today = generation.find((g) => g.intent === example.intent && g.mode === "fresh");
      return {
        provisional: true,
        block: block.id,
        status: block.status,
        example: example.id,
        intent: example.intent,
        golden: goldenPath(ref.id, block.id, example.intent),
        namedCall: size(JSON.stringify(example.call)),
        positionalCall: size(JSON.stringify(encodeCall(block, example.call))),
        expandedSurface: size(JSON.stringify(golden)),
        selectedBlockSchema: {
          named: size(JSON.stringify(callJsonSchema(block, "named"))),
          positional: size(JSON.stringify(callJsonSchema(block, "positional"))),
        },
        todaySurfaceSchemaTokens: today?.modelInput.schemaText.tokens ?? null,
        lint: lintVerdicts(golden, contract),
        ...protocolChecks(golden, contract, profile),
        declaredActions: [...block.actions].sort(),
      };
    }),
  );
}

// ---------------------------------------------------------------------------

/** B0 parity: the ported generation view vs the real generation schema. */
function parity(contract: Json, profile: Profile, schema: Json) {
  const branches = (schema.$defs?.node_0?.anyOf ?? []) as Json[];
  const schemaComponents = branches.map((b) => b.properties?.component?.const as string).sort();
  const schemaIdRequired = branches.filter((b) => (b.required as string[] | undefined)?.includes("id")).map((b) => b.properties.component.const as string).sort();
  const view = generationView(contract, profile);
  const viewComponents = [...view.components].sort();
  const viewIdRequired = [...view.joinIdComponents].filter((c) => view.components.has(c)).sort();
  return {
    components: schemaComponents.length,
    idRequired: schemaIdRequired,
    componentsMatch: JSON.stringify(schemaComponents) === JSON.stringify(viewComponents),
    idRequiredMatch: JSON.stringify(schemaIdRequired) === JSON.stringify(viewIdRequired),
  };
}

// ---------------------------------------------------------------------------

export interface BenchInputs {
  contract: Json;
  profile: Profile;
  sidecar: BlocksSidecar;
}

export function loadReference(ref: (typeof REFERENCES)[number]): BenchInputs {
  const parsed = parseBlocksSidecar(read(ref.sidecar));
  if (!parsed.ok) throw new Error(`${ref.sidecar}: ${JSON.stringify(parsed.issues)}`);
  return { contract: read(ref.contract), profile: loadProfile(read(ref.profile)), sidecar: parsed.sidecar };
}

export async function computeResults() {
  const references: Json[] = [];
  for (const ref of REFERENCES) {
    const { contract, profile, sidecar } = loadReference(ref);
    const requests = await requestGoldens(ref, contract, profile);
    const firstIntent = (contract.intents as Json[])[0]!.id as string;
    const schema = (await captureRequest(contract, profile, firstIntent, "parity")).jsonSchema;
    references.push({
      reference: ref.id,
      contract: { name: contract.name, version: contract.version },
      requests,
      outputs: outputSizes(contract, profile),
      drafts: drafts(ref, sidecar, contract, profile, requests.generation),
      parity: parity(contract, profile, schema),
      ...(ref.id === "astryx" ? { leak: leakTable(contract, profile) } : {}),
    });
  }
  return { benchVersion: 1, tokenizer: "js-tiktoken o200k_base (offline estimate; not Claude's tokenizer)", references };
}

export type BenchResults = Awaited<ReturnType<typeof computeResults>>;
