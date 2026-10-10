/**
 * The hosted gateway boundary (Phase 0.5): what the browser sends, and what it
 * records about every model call it caused.
 *
 * 1. The real call-site oracle. `fetch` is stubbed and the bodies that
 *    planGoal, planFlow and streamHostedBuild (fresh and refine) actually send
 *    are hashed against the Phase 0 request goldens in
 *    packages/block-bench/results.json. Accounting must not move one byte of
 *    what the model receives, and a default request never carries maxCalls.
 * 2. Error kinds. Every gateway failure is a GatewayError (an
 *    AdapterOutputError, so the pipeline records `failed-adapter` rather than
 *    crashing) tagged provider | output | policy.
 * 3. The recorder. Every request is recorded, successful or thrown, one record
 *    per provider call the Worker reports, and the recorder's totals agree with
 *    the audit report's.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterOutputError } from "@aestheticfunction/dspack-gen/adapter-types";
import {
  aggregateUsage,
  createCallRecorder,
  foldBuildEvents,
  reconcileGenerationUsage,
  refinementConversation,
  type CallRecorder,
} from "@dspack-studio/composer-core";
import shadcnContract from "../shadcn-v3-project/shadcn-ui.dspack.json";
import shadcnProfile from "../shadcn-v3-project/shadcn-v3.profile.json";
import astryxContract from "../astryx-project/astryx.dspack.json";
import astryxProfile from "../astryx-project/astryx.profile.json";
import { GatewayError, gatewayAdapter, runGatewayRequest, streamHostedBuild } from "./hosted-build";
import { planFlow, planGoal } from "./planning";

type Json = Record<string, any>;

const results = JSON.parse(readFileSync(new URL("../../../packages/block-bench/results.json", import.meta.url), "utf8")) as Json;
const REFERENCES: Array<{ id: string; contract: Json; profile: Json }> = [
  { id: "shadcn-v3", contract: shadcnContract as Json, profile: shadcnProfile as Json },
  { id: "astryx", contract: astryxContract as Json, profile: astryxProfile as Json },
];
const goldensFor = (id: string) => results.references.find((r: Json) => r.reference === id).requests as Json;
const sha256 = (body: string) => createHash("sha256").update(body, "utf8").digest("hex");

/** A fetch stub that keeps every body it is sent and answers with `reply`. */
function stubFetch(reply: (body: string, n: number) => Response | Promise<Response>) {
  const bodies: string[] = [];
  const fetch = vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(init.body);
    return reply(init.body, bodies.length - 1);
  });
  vi.stubGlobal("fetch", fetch);
  return { bodies, fetch };
}

const reply = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The Worker's 502 for a provider failure, before any usable output. */
const providerDown = () => reply(502, { error: "provider-unavailable", cause: "provider", message: "down", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 5 }] });

/** Run streamHostedBuild to completion and return its events. */
function runHosted(input: Json, reference: { contract: Json; profile: Json }, options: { recorder?: CallRecorder } = {}) {
  return new Promise<{ events: Json[]; errors: string[] }>((resolve) => {
    const events: Json[] = [];
    const errors: string[] = [];
    streamHostedBuild(
      { path: "test", modelRef: "hosted-ai", ...input } as never,
      { onEvent: (e) => events.push(e), onError: (m) => errors.push(m), onComplete: () => resolve({ events, errors }) },
      reference as never,
      options,
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the real call sites send the Phase 0 request bytes", () => {
  for (const ref of REFERENCES) {
    const goldens = goldensFor(ref.id);

    it(`${ref.id}: planGoal and planFlow post exactly the planning goldens`, async () => {
      const { bodies } = stubFetch(() => providerDown());
      for (const golden of goldens.planning) {
        if (golden.kind === "plan") await planGoal(golden.goal, "hosted-ai", ref.contract);
        else await planFlow(golden.goal, "hosted-ai", ref.contract);
      }
      expect(bodies.map(sha256)).toEqual(goldens.planning.map((g: Json) => g.bodySha256));
      for (const body of bodies) expect(JSON.parse(body)).not.toHaveProperty("maxCalls");
    });

    it(`${ref.id}: streamHostedBuild posts exactly the generation goldens, fresh and refine`, async () => {
      const { bodies } = stubFetch(() => providerDown());
      const examples = (ref.contract.examples ?? []) as Json[];
      for (const golden of goldens.generation) {
        const conversation =
          golden.mode === "refine"
            ? (() => {
                const prior = examples.find((e) => e.id === golden.priorExample)!;
                return refinementConversation(prior.prompt, prior.surface);
              })()
            : undefined;
        await runHosted({ prompt: golden.prompt, intent: golden.intent, ...(conversation ? { conversation } : {}) }, ref);
      }
      expect(bodies).toHaveLength(goldens.generation.length);
      expect(bodies.map(sha256)).toEqual(goldens.generation.map((g: Json) => g.bodySha256));
      for (const body of bodies) expect(JSON.parse(body)).not.toHaveProperty("maxCalls");
    }, 60_000);
  }
});

const REQUEST = { system: "sys", messages: [{ role: "user", content: "x" }], jsonSchema: { type: "object" } };

describe("GatewayError: every failure is typed, never a plain Error", () => {
  const cases: Array<[string, () => Response | Promise<Response>, "provider" | "output" | "policy", number | undefined]> = [
    ["429 rate-limited is policy", () => reply(429, { error: "rate-limited", message: "slow down", calls: [] }), "policy", 429],
    ["503 busy is provider", () => reply(503, { error: "busy", message: "busy", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 3 }] }), "provider", 503],
    ["503 unavailable is provider", () => reply(503, { error: "unavailable", message: "off", calls: [] }), "provider", 503],
    ["502 with cause unusable-output is output", () => reply(502, { error: "provider-unavailable", cause: "unusable-output", message: "m", usage: { inputTokens: 10, outputTokens: 2 }, calls: [{ inputTokens: 10, outputTokens: 2, outcome: "unusable-output", durationMs: 1 }] }), "output", 502],
    ["502 with cause provider is provider", () => providerDown(), "provider", 502],
    ["502 from a Worker that predates cause is provider", () => reply(502, { error: "provider-unavailable", message: "m" }), "provider", 502],
    ["a 200 whose body is not JSON is provider", () => new Response("<html>gateway error</html>", { status: 200 }), "provider", 200],
  ];

  for (const [name, respond, kind, status] of cases) {
    it(name, async () => {
      stubFetch(() => respond());
      const error = await gatewayAdapter().generate(REQUEST).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GatewayError);
      expect(error).toBeInstanceOf(AdapterOutputError);
      expect((error as GatewayError).kind).toBe(kind);
      expect((error as GatewayError).status).toBe(status);
    });
  }

  it("a fetch that throws (offline, DNS, CORS) is provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const error = (await gatewayAdapter().generate(REQUEST).catch((e: unknown) => e)) as GatewayError;
    expect(error).toBeInstanceOf(GatewayError);
    expect(error.kind).toBe("provider");
    expect(error.status).toBeUndefined();
    expect(error.message).toMatch(/hosted AI request failed: Failed to fetch/);
  });

  it("an error reply keeps the Worker's message and carries its usage and calls", async () => {
    stubFetch(() =>
      reply(503, {
        error: "busy",
        message: "The shared generation gateway is busy right now.",
        usage: { inputTokens: 700, outputTokens: 30 },
        calls: [
          { inputTokens: 700, outputTokens: 30, outcome: "unusable-output", durationMs: 900 },
          { inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 40 },
        ],
      }),
    );
    const error = (await gatewayAdapter().generate(REQUEST).catch((e: unknown) => e)) as GatewayError;
    expect(error.message).toContain("The shared generation gateway is busy right now.");
    expect(error.usage).toEqual({ inputTokens: 700, outputTokens: 30 });
    expect(error.calls.map((c) => c.outcome)).toEqual(["unusable-output", "provider-error"]);
  });
});

describe("the recorder sees every request", () => {
  it("success: one record per Worker call, usage normalized, attempt and sub-call kept", async () => {
    stubFetch(() =>
      reply(200, {
        json: { ok: true },
        raw: '{"ok":true}',
        model: "claude-haiku-4.5",
        usage: { inputTokens: 2000, outputTokens: 130 },
        calls: [
          { inputTokens: 1000, outputTokens: 40, outcome: "unusable-output", durationMs: 800 },
          { inputTokens: 1000, outputTokens: 90, outcome: "ok", durationMs: 900 },
        ],
      }),
    );
    const recorder = createCallRecorder();
    const out = await gatewayAdapter({ recorder }).generate(REQUEST);
    expect(out.usage).toEqual({ inputTokens: 2000, outputTokens: 130 });
    expect(recorder.calls).toEqual([
      expect.objectContaining({ operation: "generate", attempt: 0, subCall: 0, source: "provider", inputTokens: 1000, outputTokens: 40, outcome: "unusable-output", durationMs: 800 }),
      expect.objectContaining({ operation: "generate", attempt: 0, subCall: 1, source: "provider", inputTokens: 1000, outputTokens: 90, outcome: "ok", durationMs: 900 }),
    ]);
  });

  it("a Worker deployed before Phase 0.5 ({in, out}, no calls) still accounts as one call", async () => {
    stubFetch(() => reply(200, { json: { ok: true }, raw: "{}", model: "m", usage: { in: 1500, out: 60 } }));
    const recorder = createCallRecorder();
    const out = await gatewayAdapter({ recorder }).generate(REQUEST);
    expect(out.usage).toEqual({ inputTokens: 1500, outputTokens: 60 });
    expect(recorder.calls).toEqual([expect.objectContaining({ operation: "generate", attempt: 0, source: "provider", inputTokens: 1500, outputTokens: 60, outcome: "ok" })]);
  });

  it("a refusal before any provider call is recorded as reaching no model", async () => {
    stubFetch(() => reply(429, { error: "rate-limited", message: "slow down", calls: [] }));
    const recorder = createCallRecorder();
    await gatewayAdapter({ recorder }).generate(REQUEST).catch(() => undefined);
    expect(recorder.calls).toEqual([expect.objectContaining({ operation: "generate", source: "none", outcome: "refused" })]);
    expect(aggregateUsage(recorder.calls).provider.calls).toBe(0);
  });

  it("a thrown fetch is recorded as an unmetered provider call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const recorder = createCallRecorder();
    await gatewayAdapter({ recorder }).generate(REQUEST).catch(() => undefined);
    expect(recorder.calls).toEqual([expect.objectContaining({ operation: "generate", source: "provider", outcome: "provider-error" })]);
    expect(aggregateUsage(recorder.calls).unreported).toBe(1);
  });

  it("a Worker that predates calls[] and refused before any provider call (503 unavailable) reached no model", async () => {
    stubFetch(() => reply(503, { error: "unavailable", message: "Hosted AI generation is unavailable." }));
    const recorder = createCallRecorder();
    await gatewayAdapter({ recorder }).generate(REQUEST).catch(() => undefined);
    expect(recorder.calls).toEqual([expect.objectContaining({ source: "none", outcome: "refused" })]);
  });

  it("a reply whose body fails mid-read keeps its HTTP status and kind", async () => {
    const broken = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("connection reset"));
          },
        }),
        { status: 429 },
      );
    stubFetch(() => broken());
    const recorder = createCallRecorder();
    const error = (await gatewayAdapter({ recorder }).generate(REQUEST).catch((e: unknown) => e)) as GatewayError;
    expect(error).toBeInstanceOf(GatewayError);
    expect(error.status).toBe(429);
    expect(error.kind).toBe("policy");
    expect(recorder.calls).toEqual([expect.objectContaining({ source: "none", outcome: "refused" })]);
  });

  it("maxCalls rides the body only when asked for", async () => {
    const { bodies } = stubFetch(() => reply(200, { json: {}, calls: [] }));
    await gatewayAdapter().generate(REQUEST);
    await gatewayAdapter({ maxCalls: 1 }).generate(REQUEST);
    expect(JSON.parse(bodies[0]!)).not.toHaveProperty("maxCalls");
    expect(JSON.parse(bodies[1]!).maxCalls).toBe(1);
  });

  it("runGatewayRequest returns the json with this request's usage, calls and duration", async () => {
    stubFetch(() =>
      reply(200, { json: { intent: "x" }, usage: { inputTokens: 1900, outputTokens: 40 }, calls: [{ inputTokens: 1900, outputTokens: 40, outcome: "ok", durationMs: 600 }] }),
    );
    const out = await runGatewayRequest(REQUEST, { operation: "plan" });
    expect(out.json).toEqual({ intent: "x" });
    expect(out.usage).toEqual({ inputTokens: 1900, outputTokens: 40 });
    expect(out.calls).toEqual([expect.objectContaining({ operation: "plan", source: "provider", inputTokens: 1900, outcome: "ok" })]);
    expect(typeof out.durationMs).toBe("number");
  });
});

describe("planning reports the calls it made, including a failed one", () => {
  const contract = shadcnContract as Json;

  it("a failed planning call falls back to the deterministic plan AND is recorded", async () => {
    stubFetch(() => reply(502, { error: "provider-unavailable", cause: "unusable-output", message: "m", usage: { inputTokens: 3800, outputTokens: 20 }, calls: [{ inputTokens: 1900, outputTokens: 10, outcome: "unusable-output", durationMs: 1 }, { inputTokens: 1900, outputTokens: 10, outcome: "unusable-output", durationMs: 1 }] }));
    const { plan, calls } = await planGoal("a sign-in form with email and password", "hosted-ai", contract);
    expect(plan.source).toBe("scripted");
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.operation === "plan")).toBe(true);
    expect(aggregateUsage(calls).provider).toEqual({ inputTokens: 3800, outputTokens: 20, calls: 2 });
  });

  it("scripted planning makes no model call", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await planGoal("a sign-in form", "scripted", contract)).calls).toEqual([]);
    expect((await planFlow("sign up then confirm", "scripted", contract)).calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("flow planning is its own operation", async () => {
    stubFetch(() => providerDown());
    const { calls } = await planFlow("onboard a new customer: sign up, review the plan, then confirm", "hosted-ai", contract);
    expect(calls).toEqual([expect.objectContaining({ operation: "flow-plan", source: "provider", outcome: "provider-error" })]);
  });
});

describe("a hosted build's recorder against its audit report", () => {
  const ref = REFERENCES[1]!; // Astryx: small enough to emit quickly
  const example = (ref.contract.examples as Json[]).find((e) => e.intent === "data-collection")!;

  it("a passing run with a Worker retry: the recorder's calls reconcile with the report", async () => {
    stubFetch(() =>
      reply(200, {
        json: example.surface,
        raw: JSON.stringify(example.surface),
        model: "claude-haiku-4.5",
        usage: { inputTokens: 18000, outputTokens: 610 },
        calls: [
          { inputTokens: 9000, outputTokens: 20, outcome: "unusable-output", durationMs: 700 },
          { inputTokens: 9000, outputTokens: 590, outcome: "ok", durationMs: 2100 },
        ],
      }),
    );
    const recorder = createCallRecorder();
    const { events } = await runHosted({ prompt: example.prompt, intent: example.intent }, ref, { recorder });
    const progress = foldBuildEvents(events);
    expect(progress.outcome).toBe("passed");
    expect(progress.report?.attempts?.[0]?.usage).toEqual({ inputTokens: 18000, outputTokens: 610 });
    expect(recorder.calls).toHaveLength(2);
    expect(reconcileGenerationUsage(recorder.calls, progress.report)).toEqual({ consistent: true, mismatches: [] });
  }, 30_000);

  it("a failed-adapter turn still shows what the failed request cost", async () => {
    stubFetch(() =>
      reply(502, {
        error: "provider-unavailable",
        cause: "unusable-output",
        message: "Hosted generation did not return a usable proposal.",
        usage: { inputTokens: 18000, outputTokens: 40 },
        calls: [
          { inputTokens: 9000, outputTokens: 20, outcome: "unusable-output", durationMs: 700 },
          { inputTokens: 9000, outputTokens: 20, outcome: "unusable-output", durationMs: 650 },
        ],
      }),
    );
    const recorder = createCallRecorder();
    const { events } = await runHosted({ prompt: example.prompt, intent: example.intent }, ref, { recorder });
    expect(foldBuildEvents(events).outcome).toBe("failed-adapter");
    expect(aggregateUsage(recorder.calls).provider).toEqual({ inputTokens: 18000, outputTokens: 40, calls: 2 });
  }, 30_000);

  it("a scripted in-browser run records its attempts as reaching no model", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const recorder = createCallRecorder();
    const { events } = await runHosted({ prompt: example.prompt, intent: example.intent, modelRef: "scripted" }, ref, { recorder });
    expect(foldBuildEvents(events).outcome).toBe("passed");
    // The scripted twin's first attempt deliberately violates S1; repair passes.
    expect(recorder.calls.map((c) => [c.operation, c.source])).toEqual([
      ["generate", "none"],
      ["repair", "none"],
    ]);
  }, 30_000);
});
