/**
 * The live pilot's controls, with no network and no model: a fake Worker answers in propose.mjs's reply shape.
 * Budget (the cumulative ceiling, reservation before dispatch, accounting for planning, generation and repairs,
 * cross-invocation totals), identity and usage checks, early termination, the fixed scope, and the access preflight.
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exampleFor } from "../arms";
import { absoluteUsd, REQUEST_USD_BOUND, toNanos } from "../cost";
import { PacingCapReached } from "../pacing";
import { HarnessError } from "../providers/types";
import { loadReference, type LoadedReference } from "../references";
import { checkAccess, tokenFromEnv, withToken } from "./access";
import { parseArgs } from "./cli";
import { openPilotLedger, readPilotLedger } from "./ledger";
import { createMonitor, PilotStop } from "./monitor";
import { runPilot } from "./pilot";
import { goalFor, HOTEL_GOAL, loadCorpus, PILOT_CEILING_USD, PILOT_RUNS } from "./runs";

const HAIKU = "claude-haiku-4-5-20251001";
const BASE = "https://composer.test";
type Json = Record<string, any>;

let astryx: LoadedReference;
let dir: string;
beforeAll(async () => {
  astryx = await loadReference("astryx");
  dir = mkdtempSync(join(tmpdir(), "live-pilot-"));
}, 120_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const kindOf = (body: Json) => ("$defs" in (body.jsonSchema ?? {}) ? "generation" : body.jsonSchema?.properties?.steps ? "flow plan" : "goal plan");
const goalOf = (body: Json) => String(body.messages?.at(-1)?.content ?? "");
const ok = (json: unknown, usage = { inputTokens: 1000, outputTokens: 200 }, model: unknown = HAIKU) =>
  reply(200, { json, raw: JSON.stringify(json), model, usage, calls: [{ ...usage, model, outcome: "ok", durationMs: 5 }] });

interface FakeOptions {
  /** What a generation request answers with (default: the Astryx example for transactional-review, which passes). */
  generation?: () => unknown;
  usage?: { inputTokens: number; outputTokens: number };
  /** Replaces the reply entirely for the n-th request (0-based). */
  override?: (n: number, body: Json) => Response | undefined;
  /** Called before each reply, with the request number. */
  onRequest?: (n: number) => void;
}

/** A fake Composer Worker behind Access: it answers only requests that carry the service token. */
function fakeWorker(options: FakeOptions = {}) {
  const posted: Array<{ url: string; kind: string }> = [];
  const surface = exampleFor(astryx, "transactional-review");
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const n = posted.length;
    const body = JSON.parse(String(init.body ?? "{}")) as Json;
    posted.push({ url, kind: kindOf(body) });
    options.onRequest?.(n);
    const overridden = options.override?.(n, body);
    if (overridden) return overridden;
    const kind = kindOf(body);
    if (kind === "goal plan") return ok({ intent: "transactional-review", restated: `A screen for: ${goalOf(body).slice(0, 60)}`, feasible: true, reason: "fits" }, options.usage);
    if (kind === "flow plan")
      return ok(
        {
          name: "A flow",
          steps: [
            { title: "Choose", goal: `Choose an option for ${goalOf(body).slice(0, 30)}`, intent: "transactional-review" },
            { title: "Review", goal: "Review the choice", intent: "transactional-review" },
          ],
        },
        options.usage,
      );
    return ok(options.generation ? options.generation() : surface, options.usage);
  }) as unknown as typeof fetch;
  return { posted, fetchImpl };
}

const quiet = { log: () => undefined, spacingMs: 0, sleep: async () => undefined };
const freshDir = (name: string) => join(dir, name);

describe("the pilot's fixed scope", () => {
  it("is exactly the twelve runs the proposal names, on Astryx, under a $5 ceiling", async () => {
    expect(PILOT_CEILING_USD).toBe(5);
    expect(PILOT_RUNS).toHaveLength(12);
    const count = (pred: (r: (typeof PILOT_RUNS)[number]) => boolean) => PILOT_RUNS.filter(pred).length;
    expect(count((r) => r.source === "hotel" && r.kind === "single")).toBe(3);
    expect(count((r) => r.source === "hotel" && r.kind === "flow")).toBe(3);
    expect(count((r) => r.source === "corpus" && r.corpusN === 3 && r.kind === "single")).toBe(2);
    expect(count((r) => r.source === "corpus" && r.corpusN === 10 && r.kind === "single")).toBe(2);
    expect(count((r) => r.source === "corpus" && r.corpusN === 5 && r.kind === "flow")).toBe(2);
  });

  it("reads the corpus prompts from the committed corpus, unchanged", async () => {
    const corpus = await loadCorpus();
    expect(corpus).toHaveLength(12);
    for (const run of PILOT_RUNS) {
      const goal = await goalFor(run);
      if (run.source === "hotel") expect(goal).toBe(HOTEL_GOAL);
      else expect(goal).toBe(corpus.find((p) => p.n === run.corpusN)!.body);
    }
  });

  it("the command line takes no prompt, reference, model or higher ceiling", () => {
    expect(() => parseArgs(["run", "--out", "x", "--prompt", "4"])).toThrow(/fixed/);
    expect(() => parseArgs(["run", "--out", "x", "--max-usd", "6"])).toThrow(/only lower/);
    expect(() => parseArgs(["run", "--out", "x", "--max-usd", "0"])).toThrow(/only lower/);
    expect(() => parseArgs(["run"])).toThrow(/--out/);
    expect(() => parseArgs(["run", "--out", "x", "--base", "http://insecure.test"])).toThrow(/https/);
    expect(() => parseArgs(["baseline", "--out", "x"])).toThrow(/usage/);
    expect(parseArgs(["run", "--out", "x", "--max-usd", "2"])).toMatchObject({ command: "run", out: "x", maxUsd: 2 });
  });
});

describe("a complete pilot on a fake Worker", () => {
  it("records every request before it is sent, accounts for planning and generation, and stops at twelve runs", async () => {
    const out = freshDir("complete");
    const ledgerFile = join(out, "requests.jsonl");
    const reservedBeforeSend: boolean[] = [];
    const { posted, fetchImpl } = fakeWorker({
      onRequest: (n) => {
        // The reservation for request n is on disk before the fake answers it.
        const lines = readFileSync(ledgerFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
        reservedBeforeSend.push(lines.filter((l) => typeof l.adjust !== "number").length === n + 1 && typeof lines.at(-1).usd === "number");
      },
    });
    const result = await runPilot({ baseUrl: BASE, outDir: out, fetchImpl, reference: astryx, ...quiet });
    expect(result.stopped).toBeUndefined();
    expect(result.completed).toEqual(PILOT_RUNS.map((r) => r.id));
    expect(reservedBeforeSend.every(Boolean)).toBe(true);
    // Every request went to the Worker's /api/propose, and nowhere else: no scripted provider, no other endpoint.
    expect(new Set(posted.map((p) => p.url))).toEqual(new Set([`${BASE}/api/propose`]));
    // 7 single builds: a goal plan and one passing generation each; 5 flows: a flow plan, then 2 steps of the same.
    expect(posted.filter((p) => p.kind === "goal plan")).toHaveLength(7 + 5 * 2);
    expect(posted.filter((p) => p.kind === "flow plan")).toHaveLength(5);
    expect(posted.filter((p) => p.kind === "generation")).toHaveLength(7 + 5 * 2);
    // Each verified request settles at its reported usage: 1,000 in and 200 out at Haiku 4.5's prices with the 5% fee.
    const perRequest = toNanos((1000 * 1e-6 + 200 * 5e-6) * 1.05);
    expect(readPilotLedger(ledgerFile)).toEqual({ sent: posted.length, nanos: perRequest * posted.length });
    expect(result.requests).toBe(posted.length);
    // Evidence: one file per run, the served model recorded, a summary with unmarked task-fit checklists.
    const state = JSON.parse(readFileSync(join(out, "state.json"), "utf8"));
    expect(state.servedModel).toBe(HAIKU);
    expect(readdirSync(out).filter((f) => /^(hotel|corpus)-.*\.json$/.test(f))).toHaveLength(12);
    const flow = JSON.parse(readFileSync(join(out, "hotel-flow-1.json"), "utf8"));
    expect(flow.flowPlan).toMatchObject({ source: "model", steps: [{ title: "Choose" }, { title: "Review" }] });
    expect(flow.builds[0]).toMatchObject({ step: { index: 1 }, passed: true, firstPass: true, repairs: 0, models: [HAIKU] });
    expect(flow.builds[0].renderer.used.length).toBeGreaterThan(0);
    expect(flow.taskFit).toMatchObject({ marked: false });
    const summary = readFileSync(join(out, "SUMMARY.md"), "utf8");
    expect(summary).toContain("Runs completed: 12 of 12");
    expect(summary).toContain("- [ ] an explicit confirmation");

    // Complete means complete: a second invocation sends nothing, and there is no way to continue into the baseline.
    const again = fakeWorker();
    const second = await runPilot({ baseUrl: BASE, outDir: out, fetchImpl: again.fetchImpl, reference: astryx, ...quiet });
    expect(again.posted).toHaveLength(0);
    expect(second.ran).toEqual([]);
  }, 120_000);

  it("accounts for repairs: a build whose answers fail the gates makes three generation requests, each charged", async () => {
    const out = freshDir("repairs");
    let generations = 0;
    const { posted, fetchImpl } = fakeWorker({
      generation: () => ({ not: "a surface" }),
      onRequest: (n) => {
        if (n === 4) writeFileSync(join(out, "STOP"), ""); // after the first build: a plan and three generations
      },
      override: (_n, body) => {
        if (kindOf(body) === "generation") generations += 1;
        return undefined;
      },
    });
    const result = await runPilot({ baseUrl: BASE, outDir: out, fetchImpl, reference: astryx, ...quiet });
    expect(result.stopped?.reason).toBe("operator");
    expect(posted.slice(0, 4).map((p) => p.kind)).toEqual(["goal plan", "generation", "generation", "generation"]);
    // STOP appeared while the fifth request (the next run's plan) was being answered; nothing after it was sent.
    expect(posted).toHaveLength(5);
    expect(generations).toBe(3);
    const first = JSON.parse(readFileSync(join(out, "hotel-single-1.json"), "utf8"));
    expect(first.builds[0]).toMatchObject({ passed: false, attempts: 3, repairs: 2, firstPass: false });
    expect(first.builds[0].calls.filter((c: Json) => c.operation === "repair")).toHaveLength(2);
  }, 60_000);
});

describe("the ceiling", () => {
  it("stops before the request whose absolute worst case would no longer fit, with verified usage", async () => {
    const out = freshDir("ceiling");
    // Every reply reports verifiable usage near the output cap: 2,000 tokens in, 8,000 out, about $0.044 a request.
    const { posted, fetchImpl } = fakeWorker({ usage: { inputTokens: 2_000, outputTokens: 8_000 } });
    const result = await runPilot({ baseUrl: BASE, outDir: out, fetchImpl, reference: astryx, maxUsd: 1.5, ...quiet });
    expect(result.stopped?.reason).toBe("PacingCapReached");
    const { nanos, sent } = readPilotLedger(join(out, "requests.jsonl"));
    expect(sent).toBe(posted.length);
    expect(nanos).toBeLessThanOrEqual(toNanos(1.5));
    // It stopped because the next request's absolute worst case no longer fitted, not before.
    expect(nanos + toNanos(REQUEST_USD_BOUND)).toBeGreaterThan(toNanos(1.5));
    expect(posted.length).toBeGreaterThan(5);
  }, 120_000);

  it("never commits more than $5 when usage cannot be verified: each such request is charged its absolute worst case", async () => {
    const out = freshDir("ceiling-unverified");
    // Usage past what a planning request can read (one token per byte of its text) proves nothing about its price.
    const { posted, fetchImpl } = fakeWorker({ usage: { inputTokens: 150_000, outputTokens: 8_000 } });
    const result = await runPilot({ baseUrl: BASE, outDir: out, fetchImpl, reference: astryx, ...quiet });
    expect(result.stopped?.reason).toBe("PacingCapReached");
    const { nanos } = readPilotLedger(join(out, "requests.jsonl"));
    expect(nanos).toBeLessThanOrEqual(toNanos(5));
    expect(nanos + toNanos(REQUEST_USD_BOUND)).toBeGreaterThan(toNanos(5));
    expect(posted.length).toBe(Math.floor(5 / REQUEST_USD_BOUND));
  }, 120_000);

  it("holds across invocations: a resume starts from the committed total, and an unsettled request counts at the most a request can cost", async () => {
    const out = freshDir("resume");
    const ledgerFile = join(out, "requests.jsonl");
    const first = fakeWorker({ onRequest: (n) => n === 2 && writeFileSync(join(out, "STOP"), "") });
    await runPilot({ baseUrl: BASE, outDir: out, fetchImpl: first.fetchImpl, reference: astryx, ...quiet });
    const afterFirst = readPilotLedger(ledgerFile);
    // Simulate a process killed after recording a request but before its reply: a reservation with no settlement.
    appendFileSync(ledgerFile, `${JSON.stringify({ request: "killed#1", usd: 0.01 })}\n`);
    const afterKill = readPilotLedger(ledgerFile);
    expect(afterKill.sent).toBe(afterFirst.sent + 1);
    expect(afterKill.nanos).toBe(afterFirst.nanos + toNanos(REQUEST_USD_BOUND));
    // A torn last line (cut off mid-write) is set aside: it was never sent.
    appendFileSync(ledgerFile, `{"request":"torn`);
    expect(readPilotLedger(ledgerFile)).toEqual(afterKill);
    // A resume continues from that total, under the same ceiling, and never below it.
    rmSync(join(out, "STOP"));
    writeFileSync(ledgerFile, `${readFileSync(ledgerFile, "utf8").replace(/\{"request":"torn$/, "")}`);
    const ledger = openPilotLedger(ledgerFile, { cap: 200, capUsd: 5 }, "resume");
    expect(ledger.nanos).toBe(afterKill.nanos);
    expect(ledger.sent).toBe(afterKill.sent);
  }, 60_000);

  it("refuses a ceiling above $5, and admits nothing when even one request's absolute worst case cannot fit", async () => {
    await expect(runPilot({ baseUrl: BASE, outDir: freshDir("high"), fetchImpl: fakeWorker().fetchImpl, reference: astryx, maxUsd: 6, ...quiet })).rejects.toThrow(/at most \$5/);
    const tiny = fakeWorker();
    const result = await runPilot({ baseUrl: BASE, outDir: freshDir("tiny"), fetchImpl: tiny.fetchImpl, reference: astryx, maxUsd: 1, ...quiet });
    expect(absoluteUsd(2)).toBeGreaterThan(1);
    expect(tiny.posted).toHaveLength(0);
    expect(result.stopped?.reason).toBe("PacingCapReached");
  });

  it("the pacer's own refusal names the dollar ceiling", () => {
    expect(new PacingCapReached(5, "usd").message).toMatch(/dollar ceiling of \$5\.00/);
  });
});

describe("model identity and usage", () => {
  const stopsWith = async (name: string, override: FakeOptions["override"]) => {
    const out = freshDir(name);
    const { posted, fetchImpl } = fakeWorker({ override });
    const result = await runPilot({ baseUrl: BASE, outDir: out, fetchImpl, reference: astryx, ...quiet });
    return { result, posted, ledger: readPilotLedger(join(out, "requests.jsonl")) };
  };

  it("stops on a reply served by another model, charging it at the most it could cost", async () => {
    const { result, posted, ledger } = await stopsWith("other-model", (n, body) => (n === 0 ? ok({ intent: "transactional-review", restated: goalOf(body), feasible: true, reason: "x" }, undefined, "claude-sonnet-4-5") : undefined));
    // The integrity check (live/integrity.ts) stops it before the price check would (UnpricedModel): either way, nothing more is sent.
    expect(result.stopped?.reason).toBe("RunHalted");
    expect(result.stopped?.message).toMatch(/model-family: .*claude-sonnet-4-5, not Claude Haiku 4\.5/);
    expect(posted).toHaveLength(1);
    expect(ledger.nanos).toBeGreaterThanOrEqual(toNanos(absoluteUsd(2)));
  });

  it("stops on a reply that reports no usage", async () => {
    const { result, posted } = await stopsWith("no-usage", (n, body) =>
      n === 0 ? reply(200, { json: { intent: "transactional-review", restated: goalOf(body), feasible: true, reason: "x" }, model: HAIKU, calls: [{ model: HAIKU, outcome: "ok", durationMs: 5 }] }) : undefined,
    );
    expect(result.stopped?.reason).toBe("RunHalted");
    expect(result.stopped?.message).toMatch(/usage-missing/);
    expect(posted).toHaveLength(1);
  });

  it("stops when a later call is served by a different Haiku snapshot than the first", async () => {
    const { result } = await stopsWith("changed", (n, body) => (n === 1 ? ok({ x: 1 }, undefined, "claude-haiku-4-5-20990101") : undefined));
    expect(result.stopped?.reason).toBe("RunHalted");
    expect(result.stopped?.message).toMatch(/model-changed/);
  });
});

describe("early termination", () => {
  const providerDown = () => reply(502, { error: "provider-unavailable", cause: "provider", message: "down", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 1 }] });

  it("stops at once on a provider failure that reached the provider but cannot show its usage (Phase 1B's integrity rule)", async () => {
    const { posted, fetchImpl } = fakeWorker({ override: () => providerDown() });
    const out = freshDir("down");
    const result = await runPilot({ baseUrl: BASE, outDir: out, fetchImpl, reference: astryx, ...quiet });
    expect(result.stopped?.reason).toBe("RunHalted");
    expect(result.stopped?.message).toMatch(/usage-missing/);
    expect(posted).toHaveLength(1);
    // Its cost cannot be verified, so it is charged at the most a request can cost.
    expect(readPilotLedger(join(out, "requests.jsonl")).nanos).toBeGreaterThanOrEqual(toNanos(absoluteUsd(2)));
  });

  it("stops after three consecutive provider failures that reached no model (the busy gateway)", async () => {
    const busy = () => reply(503, { error: "busy", message: "busy", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 3 }] });
    const { posted, fetchImpl } = fakeWorker({ override: () => busy() });
    const out = freshDir("busy");
    const result = await runPilot({ baseUrl: BASE, outDir: out, fetchImpl, reference: astryx, ...quiet });
    expect(result.stopped?.reason).toBe("provider-failures");
    expect(posted).toHaveLength(3);
    // Refused before any model ran: released, so nothing is committed.
    expect(readPilotLedger(join(out, "requests.jsonl")).nanos).toBe(0);
  });

  it("a usable answer, or a failure that is not the provider's, between failures resets the count", () => {
    const monitor = createMonitor();
    const down = new HarnessError("h", "down", "provider", 502);
    monitor.failed(down);
    monitor.failed(down);
    monitor.succeeded();
    monitor.failed(down);
    monitor.failed(down);
    monitor.failed(new HarnessError("h", "unusable", "output", 502));
    monitor.failed(down);
    monitor.failed(down);
    expect(() => monitor.failed(down)).toThrow(PilotStop);
  });

  it("stops at the first 429, without retrying it", async () => {
    const limited = () => reply(429, { error: "rate-limited", message: "slow down", calls: [], capabilities: ["per-call-model"] });
    const { posted, fetchImpl } = fakeWorker({ override: (n) => (n === 0 ? limited() : undefined) });
    const result = await runPilot({ baseUrl: BASE, outDir: freshDir("429"), fetchImpl, reference: astryx, ...quiet });
    expect(result.stopped?.reason).toBe("rate-limited");
    expect(posted).toHaveLength(1);
    // A 429 made before any provider call costs nothing.
    expect(readPilotLedger(join(freshDir("429"), "requests.jsonl")).nanos).toBe(0);
  });

  it("stops when every goal plan is identical across three different goals", async () => {
    const same = { intent: "transactional-review", restated: "Always the same screen.", feasible: true, reason: "x" };
    const { fetchImpl } = fakeWorker({ override: (_n, body) => (kindOf(body) === "goal plan" ? ok(same) : undefined) });
    const result = await runPilot({ baseUrl: BASE, outDir: freshDir("same-plans"), fetchImpl, reference: astryx, ...quiet });
    expect(result.stopped?.reason).toBe("unusable-evidence");
    // Hotel single builds share one goal; the third distinct goal is corpus prompt 10, after both prompt 3 runs.
    expect(result.completed).toContain("corpus-03-2");
    expect(result.completed).not.toContain("corpus-10-1");
  }, 120_000);

  it("stops before the next request when the operator creates STOP, and resumes when it is removed", async () => {
    const out = freshDir("operator");
    const first = fakeWorker({ onRequest: (n) => n === 0 && writeFileSync(join(out, "STOP"), "") });
    const stopped = await runPilot({ baseUrl: BASE, outDir: out, fetchImpl: first.fetchImpl, reference: astryx, ...quiet });
    expect(stopped.stopped?.reason).toBe("operator");
    expect(first.posted).toHaveLength(1);
    expect(existsSync(join(out, "hotel-single-1.stopped.json"))).toBe(true);
    rmSync(join(out, "STOP"));
    const second = fakeWorker();
    const resumed = await runPilot({ baseUrl: BASE, outDir: out, fetchImpl: second.fetchImpl, reference: astryx, ...quiet });
    expect(resumed.stopped).toBeUndefined();
    expect(resumed.completed).toHaveLength(12);
  }, 120_000);
});

describe("access control", () => {
  const token = { clientId: "id.access", clientSecret: "secret-value" };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const accessLogin = () => new Response("", { status: 302, headers: { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login" } });
  const workerRefusal = () => json(400, { error: "invalid-request", message: "empty", calls: [], capabilities: ["per-call-model"] });
  /** A deployment: `restricted` puts Access on /api; `hosted` is the HOSTED_AI switch. */
  const deployment = ({ restricted, hosted }: { restricted: boolean; hosted: boolean }) =>
    (async (input: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      const admitted = headers.get("CF-Access-Client-Id") === token.clientId && headers.get("CF-Access-Client-Secret") === token.clientSecret;
      if (restricted && !admitted) return accessLogin();
      if (String(input).endsWith("/api/models")) return json(200, { models: hosted ? ["scripted", "hosted-ai"] : ["scripted"] });
      return hosted ? workerRefusal() : json(503, { error: "unavailable", message: "off", calls: [], capabilities: ["per-call-model"] });
    }) as unknown as typeof fetch;

  it("passes only when the public cannot generate or see hosted-ai and the token can", async () => {
    const check = await checkAccess(BASE, token, deployment({ restricted: true, hosted: true }));
    expect(check.ok).toBe(true);
    expect(check.lines.join("\n")).not.toContain(token.clientSecret);
  });

  it("refuses an unrestricted endpoint, whether or not hosted AI is on", async () => {
    for (const hosted of [true, false]) {
      const check = await checkAccess(BASE, token, deployment({ restricted: false, hosted }));
      expect(check.ok, `hosted ${hosted}`).toBe(false);
      expect(check.lines.join("\n")).toMatch(/reached the Worker/);
    }
  });

  it("refuses when hosted AI is still off behind Access, or there is no token", async () => {
    expect((await checkAccess(BASE, token, deployment({ restricted: true, hosted: false }))).ok).toBe(false);
    const noToken = await checkAccess(BASE, undefined, deployment({ restricted: true, hosted: true }));
    expect(noToken.ok).toBe(false);
    expect(noToken.lines.join("\n")).toMatch(/no Access service token/);
  });

  it("reads the token from the environment and sends it as Access headers", async () => {
    expect(tokenFromEnv({})).toBeUndefined();
    expect(tokenFromEnv({ PILOT_ACCESS_CLIENT_ID: "a", PILOT_ACCESS_CLIENT_SECRET: "b" })).toEqual({ clientId: "a", clientSecret: "b" });
    let seen: Headers | undefined;
    await withToken(token, (async (_i: string, init: RequestInit) => {
      seen = new Headers(init.headers);
      return json(200, {});
    }) as unknown as typeof fetch)(`${BASE}/api/models`, { headers: { accept: "application/json" } });
    expect(seen?.get("CF-Access-Client-Id")).toBe(token.clientId);
    expect(seen?.get("CF-Access-Client-Secret")).toBe(token.clientSecret);
    expect(seen?.get("accept")).toBe("application/json");
  });
});

describe("pilot pacing", () => {
  it("spaces requests so two calls each stay within the gateway's 5 per minute", async () => {
    const { PILOT_SPACING_MS } = await import("./runs");
    expect(2 * Math.ceil(60_000 / PILOT_SPACING_MS)).toBeLessThanOrEqual(5);
  });
});
