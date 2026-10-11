/**
 * The run's ledger (requests.jsonl) and its lock (run.lock), under the faults the post-merge audit of the dollar
 * ceiling found: a line that cannot be written, settlements that are duplicated, stray, out of order or missing, an
 * invocation's lines lost, a ceiling that floating-point sums cross, a lock taken by two invocations, and a crash of
 * the machine itself. node:fs is wrapped so a test can fail one write or watch how it is made; every request goes to
 * the real Worker module with a stubbed model, and nothing leaves the process.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  write: undefined as undefined | ((file: string, data: string, options: unknown) => void),
  wrote: undefined as undefined | ((path: string, data: string) => void),
  move: undefined as undefined | ((path: string) => void),
  read: undefined as undefined | ((path: string) => void),
  fsync: undefined as undefined | ((path: string) => void),
  link: undefined as undefined | ((from: string, to: string) => void),
  send: undefined as undefined | (() => void),
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const writeFileSync = ((file: string, data: string, options?: unknown) => {
    hooks.write?.(String(file), String(data), options);
    return actual.writeFileSync(file, data, options as never);
  }) as typeof actual.writeFileSync;
  const renameSync = ((from: string, to: string) => {
    hooks.move?.(String(from));
    return actual.renameSync(from, to);
  }) as typeof actual.renameSync;
  const rmSync = ((path: string, options?: unknown) => {
    hooks.move?.(String(path));
    return actual.rmSync(path, options as never);
  }) as typeof actual.rmSync;
  const readFileSync = ((path: string, options?: unknown) => {
    hooks.read?.(String(path));
    return actual.readFileSync(path, options as never);
  }) as typeof actual.readFileSync;
  // Which path each descriptor was opened on, so a test can fail the sync of one directory.
  const opened = new Map<number, string>();
  const openSync = ((path: string, flags?: unknown, mode?: unknown) => {
    const fd = actual.openSync(path, flags as never, mode as never);
    opened.set(fd, String(path));
    return fd;
  }) as typeof actual.openSync;
  const fsyncSync = ((fd: number) => {
    hooks.fsync?.(opened.get(fd) ?? "");
    return actual.fsyncSync(fd);
  }) as typeof actual.fsyncSync;
  const writeSync = ((fd: number, data: unknown, ...rest: unknown[]) => {
    hooks.wrote?.(opened.get(fd) ?? "", Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
    return (actual.writeSync as (...args: unknown[]) => number)(fd, data, ...rest);
  }) as typeof actual.writeSync;
  const linkSync = ((from: string, to: string) => {
    hooks.link?.(String(from), String(to));
    return actual.linkSync(from, to);
  }) as typeof actual.linkSync;
  const fs = { ...actual, writeFileSync, renameSync, rmSync, readFileSync, openSync, fsyncSync, writeSync, linkSync };
  return { ...fs, default: fs };
});

import { handlePropose } from "../../../apps/composer/worker/propose.mjs";
import { exampleFor } from "./arms";
import { readCorpus, type Corpus } from "./corpus";
import { CELL_USD_BOUND, MAX_OUTPUT_TOKENS, REQUEST_USD_BOUND, absoluteUsd, toNanos } from "./cost";
import { lockRun, runEvaluation } from "./evaluate";
import { PacingCapReached, createPacer, type Pacer } from "./pacing";
import { preflight } from "./preflight";
import { createHostedProvider } from "./providers/hosted";
import { loadReference, type LoadedReference } from "./references";

let corpus: Corpus;
let astryx: LoadedReference;
beforeAll(async () => {
  corpus = readCorpus();
  astryx = await loadReference("astryx");
}, 60_000);
afterEach(() => {
  hooks.write = undefined;
  hooks.wrote = undefined;
  hooks.move = undefined;
  hooks.read = undefined;
  hooks.fsync = undefined;
  hooks.link = undefined;
  hooks.send = undefined;
});

const PLAN = JSON.stringify({ intent: "record-collection", feasible: true, restated: "A table.", reason: "fits" });
const BAD = JSON.stringify({ dspackSurface: "0.1", root: { component: "no-such-component" } });

/**
 * The real Worker, its model answering each call in turn from `script`. Each call names Claude Haiku 4.5 and reports
 * whole usage, as the run's integrity conditions require, but more output than the max_tokens the price assumed, so
 * every request is unverified and raised to its absolute worst case: a production cell is its plan and three
 * generation requests.
 */
function worker(script: string[], extra: Record<string, unknown> = {}) {
  let n = 0;
  let posted = 0;
  const env = { HOSTED_AI: "on", AI: { run: async () => ({ content: [{ type: "text", text: script[Math.min(n++, script.length - 1)] }], usage: { input_tokens: 10, output_tokens: MAX_OUTPUT_TOKENS + 1 }, model: "claude-haiku-4-5-20251001" }) }, ...extra };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    posted += 1;
    hooks.send?.();
    return handlePropose(new Request(url, init), env);
  }) as typeof fetch;
  return { fetchImpl, posted: () => posted };
}
const cellScript = () => [PLAN, BAD, BAD, JSON.stringify(exampleFor(astryx, "record-collection"))];

let tick = 0;
/** One invocation of a production run over rt-01, as one CLI process makes it: its own pacer and invocation id. */
async function invocation(dir: string, o: { fetchImpl?: typeof fetch; maxRequests?: number; maxTotalUsd?: number; resume?: boolean; pacer?: Pacer; log?: (line: string) => void }) {
  const fetchImpl = o.fetchImpl ?? worker(cellScript()).fetchImpl;
  return runEvaluation({
    runId: "ledger",
    provider: createHostedProvider({ baseUrl: "https://example.test", fetchImpl, pacer: o.pacer ?? createPacer({ maxRequests: o.maxRequests ?? 1000, spacingMs: 0, now: () => 0, sleep: async () => undefined }) }),
    references: [astryx],
    corpus,
    preflight: await preflight({ references: [astryx], clock: () => new Date(Date.UTC(2026, 9, 11, 0, 0, 0, ++tick)).toISOString() }),
    allowDrafts: true,
    promptIds: ["rt-01"],
    arms: ["production"],
    conditions: ["fresh"],
    outDir: dir,
    resume: o.resume ?? existsSync(join(dir, "manifest.json")),
    ...(o.resume || existsSync(join(dir, "manifest.json")) ? {} : { maxTotalRequests: 100_000 }),
    ...(o.maxTotalUsd !== undefined ? { maxTotalUsd: o.maxTotalUsd } : !existsSync(join(dir, "manifest.json")) ? { maxTotalUsd: 1000 } : {}),
    ...(o.log ? { log: o.log } : {}),
  });
}
/** What the next resume reads from the run directory, sending nothing. */
const totals = async (dir: string) => (await invocation(dir, { maxRequests: 0 })).requests!;
const ledger = (dir: string) => readFileSync(join(dir, "requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { request?: string; usd?: number; adjust?: number; final?: number; reason?: string; servedModel?: string });
const withRun = async (prefix: string, body: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), `block-bench-${prefix}-`));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("a ledger line that cannot be written", () => {
  it("stops the run at a settlement it cannot write, counts a raise it could not write, and the next resume raises the request", async () => {
    await withRun("unwritten-raise", async (dir) => {
      const w = worker(cellScript());
      let failed = false;
      hooks.wrote = (file, data) => {
        if (!failed && file.endsWith("requests.jsonl") && data.includes('"usage not verified"')) {
          failed = true;
          throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
        }
      };
      const first = await invocation(dir, { fetchImpl: w.fetchImpl });
      hooks.wrote = undefined;
      // The plan's reply was unverified and its raise could not be written: the run stops there, never a provider failure.
      expect(first.stopped).toMatchObject({ reason: "error" });
      expect(first.stopped!.message).toMatch(/could not write .*requests\.jsonl/);
      expect(w.posted()).toBe(1);
      expect(first.records).toHaveLength(0);
      // Its total never fell below what the request could have cost, in memory or on the next resume.
      expect(first.requests!.usd).toBeGreaterThanOrEqual(absoluteUsd(2) - 1e-12);
      expect((await totals(dir)).usd).toBeCloseTo(REQUEST_USD_BOUND, 9);
      expect(ledger(dir).map((l) => l.reason ?? "request")).toEqual(["request", "a request whose reply was never read"]);
    });
  }, 60_000);

  it("sends nothing when the request's own line cannot be written, and stops", async () => {
    await withRun("unwritten-request", async (dir) => {
      const w = worker(cellScript());
      hooks.wrote = (file, data) => {
        if (file.endsWith("requests.jsonl") && data.includes('"request"') && !data.includes('"adjust"')) throw Object.assign(new Error("EIO: i/o error, write"), { code: "EIO" });
      };
      const first = await invocation(dir, { fetchImpl: w.fetchImpl });
      expect(first.stopped).toMatchObject({ reason: "error" });
      expect(first.stopped!.message).toMatch(/could not write .*requests\.jsonl/);
      expect(w.posted()).toBe(0);
      expect(first.records).toHaveLength(0);
      // And a ledger it cannot even settle in place at the start refuses the invocation before anything is sent.
      hooks.wrote = undefined;
      hooks.fsync = (file) => {
        if (file.endsWith("requests.jsonl")) throw Object.assign(new Error("EIO: i/o error, fsync"), { code: "EIO" });
      };
      await expect(invocation(dir, { fetchImpl: w.fetchImpl })).rejects.toThrow(/could not write .*requests\.jsonl/);
      expect(w.posted()).toBe(0);
    });
  }, 60_000);
});

describe("a ledger line cut off partway", () => {
  it("is never followed by another: the invocation writes nothing more, and the next resume sets it aside", async () => {
    await withRun("torn", async (dir) => {
      const requests = join(dir, "requests.jsonl");
      // The zone limiter refuses the first request, and the disk fills partway through the line releasing it.
      let limited = 0;
      const w = worker(cellScript(), { PROPOSE_RATE_LIMIT: { limit: async () => ({ success: limited++ > 0 }) } });
      hooks.wrote = (path, data) => {
        if (path === requests && data.includes("refused before any provider call")) {
          appendFileSync(path, data.slice(0, 12));
          throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
        }
      };
      const result = await invocation(dir, { fetchImpl: w.fetchImpl });
      hooks.wrote = undefined;
      expect(w.posted()).toBe(1);
      expect(result.stopped).toMatchObject({ reason: "error" });
      expect(result.stopped!.message).toMatch(/ENOSPC/);
      // The cut-off line is still the ledger's last.
      expect(readFileSync(requests, "utf8").endsWith("\n")).toBe(false);
      // The next resume sets it aside, every line it keeps is whole, and the refused request, its release lost, counts
      // at the most a request can cost.
      const after = await totals(dir);
      for (const line of readFileSync(requests, "utf8").trim().split("\n")) expect(() => JSON.parse(line), line).not.toThrow();
      expect(after.sent).toBe(1);
      expect(toNanos(after.usd)).toBe(toNanos(REQUEST_USD_BOUND));
    });
  });
});

describe("the ledger settles each request by its own id", () => {
  const INVOCATION = "2026-10-01T00:00:00.000Z";
  const request = (id: string, usd: number, invocation = INVOCATION) => JSON.stringify({ at: "2026-10-01T00:00:01.000Z", invocation, request: id, usd });
  const settlement = (id: string, adjust: number, final: number, invocation = INVOCATION) => JSON.stringify({ at: "2026-10-01T00:00:02.000Z", invocation, request: id, adjust, final, reason: "settled at the reported usage" });
  const pacing = (at: string, sent: number) => JSON.stringify({ at, telemetry: { pacing: { maxRequests: 300, spacingMs: 3000, backoffMs: [], sent, waits: [] } } });

  it("whatever the order, duplicates or strays, and raises one never settled wherever it sits", async () => {
    const B = REQUEST_USD_BOUND;
    for (const [name, lines, sent, usd] of [
      ["a duplicated settlement counts once", [request("r1", 0.5), settlement("r1", -0.25, 0.25), settlement("r1", -0.25, 0.25)], 1, 0.25],
      ["a settlement that would take its request below nothing is ignored, and the request raised", [request("r1", 0.5), settlement("r1", -100, -99.5)], 1, B],
      ["a settlement whose request has no line is a request sent, at the most it could cost", [request("r1", 0.5), settlement("r1", -0.25, 0.25), JSON.stringify({ request: "ghost", adjust: -100 })], 2, 0.25 + B],
      ["a request never settled, followed by others, is raised", [request("r1", 0.5), request("r2", 0.5), settlement("r2", -0.4, 0.1)], 2, B + 0.1],
      ["a settlement written before its request still settles it", [settlement("r1", -0.3, 0.2), request("r1", 0.5)], 1, 0.2],
      ["a final amount below its request's price plus its adjustment counts at the larger", [request("r1", 0.5), settlement("r1", 0.618208, 0.118208)], 1, 1.118208],
    ] as const) {
      await withRun("settle", async (dir) => {
        await invocation(dir, { maxRequests: 0 });
        writeFileSync(join(dir, "requests.jsonl"), `${lines.join("\n")}\n`);
        const read = await totals(dir);
        expect(read.sent, name).toBe(sent);
        expect(read.usd, name).toBeCloseTo(usd, 9);
        // Read again, the same: a raise is on the record once, as the request's own settlement.
        expect(await totals(dir), name).toEqual(read);
      });
    }
  }, 60_000);

  it("counts what each earlier invocation reported sending beyond its lines in the ledger, and never less than nothing", async () => {
    for (const [name, report, sent, usd] of [
      ["an invocation whose lines were lost", pacing(INVOCATION, 3), 3, 0.25 + 2 * REQUEST_USD_BOUND],
      ["a report of fewer than nothing", pacing("2026-10-02T00:00:00.000Z", -50), 1, 0.25],
    ] as const) {
      await withRun("pacing", async (dir) => {
        await invocation(dir, { maxRequests: 0 });
        writeFileSync(join(dir, "requests.jsonl"), `${request("r1", 0.5)}\n${settlement("r1", -0.25, 0.25)}\n`);
        writeFileSync(join(dir, "pacing.jsonl"), `${report}\n`);
        const read = await totals(dir);
        expect(read.sent, name).toBe(sent);
        expect(read.usd, name).toBeCloseTo(usd, 9);
      });
    }
  }, 60_000);
});

describe("each invocation is told apart", () => {
  it("even when a caller reuses one preflight for two invocations, so lines lost from one are still counted from its report", async () => {
    await withRun("shared-preflight", async (dir) => {
      const shared = await preflight({ references: [astryx], clock: () => "2026-10-11T00:00:00.000Z" });
      const run = async (pre: typeof shared, maxRequests: number) =>
        runEvaluation({
          runId: "shared",
          provider: createHostedProvider({ baseUrl: "https://example.test", fetchImpl: worker(cellScript()).fetchImpl, pacer: createPacer({ maxRequests, spacingMs: 0, now: () => 0, sleep: async () => undefined }) }),
          references: [astryx],
          corpus,
          preflight: pre,
          allowDrafts: true,
          limit: 2,
          arms: ["production"],
          conditions: ["fresh"],
          outDir: dir,
          resume: existsSync(join(dir, "manifest.json")),
          ...(existsSync(join(dir, "manifest.json")) ? {} : { maxTotalRequests: 100_000, maxTotalUsd: 1000 }),
        });
      // Two invocations with the same preflight, each one cell of four requests (a cell needs room for 20).
      await run(shared, 20);
      await run(shared, 20);
      const lines = readFileSync(join(dir, "requests.jsonl"), "utf8").trim().split("\n");
      expect(lines).toHaveLength(16);
      // The second invocation's eight lines are lost; both reported four requests sent.
      writeFileSync(join(dir, "requests.jsonl"), `${lines.slice(0, 8).join("\n")}\n`);
      const read = (await run(await preflight({ references: [astryx], clock: () => "2026-10-11T01:00:00.000Z" }), 0)).requests!;
      expect(read.sent).toBe(8);
    });
  }, 60_000);
});

describe("admission is exact", () => {
  /** The four priced worst cases of the production cell: the same bytes every time. */
  const probePrices = async () => {
    let priced: number[] = [];
    await withRun("probe", async (dir) => {
      const result = await invocation(dir, {});
      expect(result.records).toHaveLength(1);
      priced = ledger(dir).filter((l) => l.adjust === undefined).map((l) => l.usd!);
    });
    expect(priced).toHaveLength(4);
    return priced;
  };
  /** A committed total at which floating-point admission, as the pacer once summed it, misbehaves as `wanted` says. */
  const edge = (priced: number[], wanted: "cut" | "over") => {
    const A = absoluteUsd(2);
    for (let i = 1; i < 2_000_000; i++) {
      const start = (i * 0.000123456789) % 50;
      const cap = start + CELL_USD_BOUND;
      let u = start;
      let refused = -1;
      for (let k = 0; k < 4; k++) {
        if (!(u + A <= cap)) {
          refused = k;
          break;
        }
        u = u + priced[k]!;
        u = u + (A - priced[k]!);
      }
      if (wanted === "cut" && refused === 3) return start;
      if (wanted === "over" && refused === -1 && u > cap) return start;
    }
    throw new Error("no edge found");
  };

  it("compares the run's exact total with the ceiling, never that total read back through floating-point dollars", async () => {
    // Near the largest ceiling the ledger allows, a total in nanodollars reads back from dollars one off: this one
    // reads back a nanodollar over, so a request that fits the ceiling exactly was refused.
    const nanos = 9_007_195_881_925_500;
    const capUsd = 9_007_197.000_133_5;
    expect(toNanos(nanos / 1e9)).toBe(nanos + 1);
    expect(nanos + toNanos(REQUEST_USD_BOUND)).toBe(toNanos(capUsd));
    const pacer = createPacer({ maxRequests: 10, spacingMs: 0, now: () => 0, sleep: async () => undefined });
    pacer.ledger = { cap: 10, sent: 0, capUsd, nanos, usd: nanos / 1e9, record() {}, adjust() {} };
    await expect(pacer.before(0, REQUEST_USD_BOUND)).resolves.toBeUndefined();
    // And one nanodollar more is refused.
    pacer.ledger = { cap: 10, sent: 0, capUsd, nanos: nanos + 1, usd: (nanos + 1) / 1e9, record() {}, adjust() {} };
    await expect(pacer.before(0, REQUEST_USD_BOUND)).rejects.toBeInstanceOf(PacingCapReached);
  });

  it("never cuts off a cell it admitted, and never commits past the ceiling, where floating-point sums once did", async () => {
    const priced = await probePrices();
    for (const wanted of ["cut", "over"] as const) {
      const start = edge(priced, wanted);
      const ceiling = start + CELL_USD_BOUND;
      await withRun(`exact-${wanted}`, async (dir) => {
        await invocation(dir, { maxRequests: 0, maxTotalUsd: ceiling });
        writeFileSync(join(dir, "requests.jsonl"), `${JSON.stringify({ at: "x", invocation: "earlier", request: "earlier#1", usd: start })}\n${JSON.stringify({ at: "x", invocation: "earlier", request: "earlier#1", adjust: 0, final: start, reason: "settled at the reported usage" })}\n`);
        const w = worker(cellScript());
        const result = await invocation(dir, { fetchImpl: w.fetchImpl });
        // The admitted cell sent all four requests and was logged.
        expect(w.posted(), wanted).toBe(4);
        expect(result.records, wanted).toHaveLength(1);
        // The ceiling covers what was committed, in the ledger's whole nanodollars, so a resume that names the same
        // ceiling is not refused.
        const again = await invocation(dir, { maxRequests: 0, maxTotalUsd: ceiling });
        expect(toNanos(again.requests!.usd), wanted).toBeLessThanOrEqual(toNanos(ceiling));
      });
    }
  }, 120_000);
});

describe("a ceiling the ledger cannot count exactly", () => {
  it("is refused: whole nanodollars are exact only up to the largest safe integer", async () => {
    await withRun("ceiling-exact", async (dir) => {
      const largest = Math.floor(Number.MAX_SAFE_INTEGER / 1e9);
      await expect(invocation(dir, { maxRequests: 0, maxTotalUsd: largest + 1 })).rejects.toThrow(/whole nanodollars/);
      expect(existsSync(join(dir, "manifest.json"))).toBe(false);
      await expect(invocation(dir, { maxRequests: 0, maxTotalUsd: largest })).resolves.toMatchObject({ requests: { capUsd: largest } });
    });
  });
});

describe("one invocation at a time", () => {
  const holder = (fields: Record<string, unknown>) => `${JSON.stringify({ at: "2026-10-01T00:00:00.000Z", ...fields })}\n`;
  const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid!;

  it("removes only its own lock when it ends", async () => {
    await withRun("lock-own", async (dir) => {
      const lock = lockRun(dir);
      const other = holder({ pid: process.pid, host: hostname(), nonce: "another" });
      writeFileSync(join(dir, "run.lock"), other);
      lock.release();
      expect(readFileSync(join(dir, "run.lock"), "utf8")).toBe(other);
    });
  });

  it("never takes over a lock held on another host, which this one cannot check", async () => {
    await withRun("lock-host", async (dir) => {
      writeFileSync(join(dir, "run.lock"), holder({ pid: deadPid(), host: `${hostname()}-elsewhere`, nonce: "elsewhere" }));
      expect(() => lockRun(dir)).toThrow(/another invocation/);
    });
  });

  it("puts back a lock another invocation took between its read and its takeover, and refuses", async () => {
    await withRun("lock-race", async (dir) => {
      const file = join(dir, "run.lock");
      writeFileSync(file, holder({ pid: deadPid(), host: hostname() }));
      // A second invocation replaces the stale lock with its own, just before this one moves it.
      const live = holder({ pid: process.pid, host: hostname(), nonce: "the-other-invocation" });
      let raced = false;
      hooks.move = (path) => {
        if (!raced && path === file) {
          raced = true;
          writeFileSync(file, live);
        }
      };
      expect(() => lockRun(dir)).toThrow(/another invocation/);
      expect(readFileSync(file, "utf8")).toBe(live);
    });
  });

  it("refuses, never takes over, a lock it cannot read for any reason but its being gone", async () => {
    await withRun("lock-unreadable", async (dir) => {
      const file = join(dir, "run.lock");
      const live = holder({ pid: process.pid, host: hostname(), nonce: "unreadable-for-now" });
      writeFileSync(file, live);
      hooks.read = (path) => {
        if (path === file) throw Object.assign(new Error("EIO: i/o error, read"), { code: "EIO" });
      };
      expect(() => lockRun(dir)).toThrow(/EIO/);
      hooks.read = undefined;
      expect(readFileSync(file, "utf8")).toBe(live);
    });
  });

  it("is never seen empty: the lock is written whole, then linked into place", async () => {
    await withRun("lock-whole", async (dir) => {
      const direct: string[] = [];
      hooks.write = (file) => {
        if (file === join(dir, "run.lock")) direct.push(file);
      };
      hooks.wrote = (file) => {
        if (file === join(dir, "run.lock")) direct.push(file);
      };
      lockRun(dir).release();
      expect(direct).toEqual([]);
    });
  });

  it("puts back by name a lock it moved aside when it cannot link it back, and never deletes it", async () => {
    await withRun("lock-putback", async (dir) => {
      const file = join(dir, "run.lock");
      writeFileSync(file, holder({ pid: deadPid(), host: hostname() }));
      const live = holder({ pid: process.pid, host: hostname(), nonce: "the-other-invocation" });
      let raced = false;
      hooks.move = (path) => {
        if (!raced && path === file) {
          raced = true;
          writeFileSync(file, live);
        }
      };
      hooks.link = (from) => {
        if (from.includes(".stale.")) throw Object.assign(new Error("EIO: i/o error, link"), { code: "EIO" });
      };
      expect(() => lockRun(dir)).toThrow(/another invocation/);
      expect(readFileSync(file, "utf8")).toBe(live);
    });
  });

  it("knows when its lock is no longer its own: taken over by another invocation, gone, or unreadable", async () => {
    await withRun("lock-held", async (dir) => {
      const file = join(dir, "run.lock");
      const lock = lockRun(dir);
      const mine = readFileSync(file, "utf8");
      expect(lock.held()).toBe(true);
      // Three invocations racing a stale lock can leave one running without it: a second moved this one's lock aside
      // as stale, and a third took the empty place before it could be put back.
      writeFileSync(file, holder({ pid: process.pid, host: hostname(), nonce: "a-third-invocation" }));
      expect(lock.held()).toBe(false);
      rmSync(file);
      expect(lock.held()).toBe(false);
      writeFileSync(file, mine);
      hooks.read = (path) => {
        if (path === file) throw Object.assign(new Error("EIO: i/o error, read"), { code: "EIO" });
      };
      expect(lock.held()).toBe(false);
      hooks.read = undefined;
      expect(lock.held()).toBe(true);
      lock.release();
      expect(existsSync(file)).toBe(false);
    });
  });

  it("sends nothing once its lock is another invocation's, and the request it had put on the record counts at its worst case", async () => {
    await withRun("lock-lost", async (dir) => {
      const file = join(dir, "run.lock");
      const other = holder({ pid: process.pid, host: hostname(), nonce: "took-it-over" });
      const w = worker(cellScript());
      // Taken over while the first request is in flight.
      hooks.send = () => {
        if (w.posted() === 1) writeFileSync(file, other);
      };
      const result = await invocation(dir, { fetchImpl: w.fetchImpl });
      hooks.send = undefined;
      expect(w.posted()).toBe(1);
      expect(result.stopped).toMatchObject({ reason: "error" });
      expect(result.stopped!.message).toMatch(/no longer names this invocation/);
      expect(readFileSync(file, "utf8")).toBe(other);
      // The second request's line was on the disk before the lock was checked, so an invocation that took the lock
      // and then read the ledger counted it; it was never sent, and the next resume counts it at its worst case.
      const recorded = ledger(dir).filter((l) => l.usd !== undefined);
      expect(recorded).toHaveLength(2);
      rmSync(file);
      const after = await totals(dir);
      expect(after.sent).toBe(2);
      expect(ledger(dir).find((l) => l.request === recorded[1]!.request && l.reason === "a request whose reply was never read")).toMatchObject({ final: Math.max(REQUEST_USD_BOUND, recorded[1]!.usd!) });
    });
  });

  it("never takes over a lock that names no holder on this host, such as one still being written", async () => {
    await withRun("lock-empty", async (dir) => {
      const file = join(dir, "run.lock");
      // Without hard links the lock is created exclusively, and is empty until its holder writes it.
      hooks.link = () => {
        throw Object.assign(new Error("EPERM: operation not permitted, link"), { code: "EPERM" });
      };
      let contender: unknown;
      let raced = false;
      hooks.wrote = (path) => {
        if (raced || path !== file) return;
        raced = true;
        // A second invocation arrives between the first creating its lock and writing it.
        try {
          contender = lockRun(dir);
        } catch (error) {
          contender = error;
        }
      };
      const first = lockRun(dir);
      hooks.wrote = undefined;
      expect(contender).toBeInstanceOf(Error);
      expect((contender as Error).message).toMatch(/another invocation/);
      expect(first.held()).toBe(true);
      first.release();
      hooks.link = undefined;
      // Nor one left malformed, or naming no host or pid: only a holder this host can check is ever judged gone.
      for (const text of ["", "{", "null", holder({ pid: deadPid() }), holder({ host: hostname() })]) {
        writeFileSync(file, text);
        expect(() => lockRun(dir), JSON.stringify(text)).toThrow(/another invocation/);
        expect(readFileSync(file, "utf8"), JSON.stringify(text)).toBe(text);
      }
    });
  });

  it("takes over a stale lock one invocation at a time, so none is left believing it holds a lock another has", async () => {
    await withRun("lock-three", async (dir) => {
      const file = join(dir, "run.lock");
      writeFileSync(file, holder({ pid: deadPid(), host: hostname() }));
      // While one invocation takes over the stale lock, a second tries the same as it moves the lock aside, and a
      // third arrives as anything is linked back into the lock's place.
      const others: unknown[] = [];
      const attempt = () => {
        try {
          others.push(lockRun(dir));
        } catch (error) {
          others.push(error);
        }
      };
      let moved = false;
      let linked = false;
      hooks.move = (path) => {
        if (!moved && path === file) {
          moved = true;
          attempt();
        }
      };
      hooks.link = (from) => {
        if (!linked && from.includes(".stale.")) {
          linked = true;
          attempt();
        }
      };
      let first: unknown;
      try {
        first = lockRun(dir);
      } catch (error) {
        first = error;
      }
      hooks.move = undefined;
      hooks.link = undefined;
      const holders = [first, ...others].filter((x): x is ReturnType<typeof lockRun> => !(x instanceof Error));
      expect(holders).toHaveLength(1);
      expect(holders[0]!.held()).toBe(true);
      for (const refused of [first, ...others].filter((x) => x instanceof Error)) expect((refused as Error).message).toMatch(/another invocation/);
      holders[0]!.release();
      expect(existsSync(file)).toBe(false);
      expect(existsSync(`${file}.takeover`)).toBe(false);
    });
  });

  it("refuses while another invocation is taking over the lock, and names the file to delete if none is", async () => {
    await withRun("lock-takeover", async (dir) => {
      const file = join(dir, "run.lock");
      const stale = holder({ pid: deadPid(), host: hostname() });
      writeFileSync(file, stale);
      writeFileSync(`${file}.takeover`, holder({ pid: process.pid, host: hostname(), nonce: "taking-over" }));
      expect(() => lockRun(dir)).toThrow(/another invocation is taking over .*run\.lock\.takeover/);
      expect(readFileSync(file, "utf8")).toBe(stale);
      expect(existsSync(`${file}.takeover`)).toBe(true);
    });
  });

  it("works on a filesystem without hard links, creating its lock exclusively instead", async () => {
    await withRun("lock-nolinks", async (dir) => {
      hooks.link = () => {
        throw Object.assign(new Error("EPERM: operation not permitted, link"), { code: "EPERM" });
      };
      const lock = lockRun(dir);
      expect(JSON.parse(readFileSync(join(dir, "run.lock"), "utf8"))).toMatchObject({ pid: process.pid });
      expect(() => lockRun(dir)).toThrow(/another invocation/);
      lock.release();
      expect(existsSync(join(dir, "run.lock"))).toBe(false);
    });
  });
});

describe("the model the run measures is on the record before the run goes on", () => {
  const HAIKU = "claude-haiku-4-5-20251001";
  const ENOSPC = () => Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
  const paced = () => createPacer({ maxRequests: 1000, spacingMs: 0, now: () => 0, sleep: async () => undefined });

  it("writes the served model to the disk first, and remembers it only once that write has succeeded", async () => {
    await withRun("served-order", async (dir) => {
      const manifest = join(dir, "manifest.json");
      const pacer = paced();
      // Each step of the write that records the model, and whether the run had already taken the model as its own.
      const steps: string[] = [];
      const taken = () => (pacer.served?.id === undefined ? "not yet taken" : "taken");
      let writing = false;
      hooks.wrote = (path, data) => {
        if (path === `${manifest}.tmp` && data.includes("servedModel")) {
          writing = true;
          steps.push(`write: ${taken()}`);
        }
      };
      hooks.fsync = (path) => {
        if (writing && path === `${manifest}.tmp`) steps.push(`sync: ${taken()}`);
        if (writing && path === dir) {
          steps.push(`sync directory: ${taken()}`);
          writing = false;
        }
      };
      hooks.move = (path) => {
        if (writing && path === `${manifest}.tmp`) steps.push(`rename: ${taken()}`);
      };
      const result = await invocation(dir, { pacer });
      expect(result.stopped).toBeUndefined();
      expect(steps).toEqual(["write: not yet taken", "sync: not yet taken", "rename: not yet taken", "sync directory: not yet taken"]);
      expect(pacer.served?.id).toBe(HAIKU);
      expect(JSON.parse(readFileSync(manifest, "utf8")).servedModel).toMatchObject({ id: HAIKU });
    });
  });

  it("stops the run when the model cannot be written, leaving it uncommitted, and a resume records it afresh", async () => {
    // The write fails at each of its steps: the new file, its sync, the rename, or the sync of the directory after it.
    for (const step of ["write", "sync", "rename", "sync directory"] as const) {
      await withRun(`served-unwritable-${step}`, async (dir) => {
        const manifest = join(dir, "manifest.json");
        const before = () => JSON.parse(readFileSync(manifest, "utf8"));
        const w = worker(cellScript());
        const pacer = paced();
        let writing = false;
        hooks.wrote = (path, data) => {
          if (path !== `${manifest}.tmp` || !data.includes("servedModel")) return;
          writing = true;
          if (step === "write") throw ENOSPC();
        };
        hooks.fsync = (path) => {
          if (writing && step === "sync" && path === `${manifest}.tmp`) throw ENOSPC();
          if (writing && step === "sync directory" && path === dir) throw Object.assign(new Error("EIO: i/o error, fsync"), { code: "EIO" });
        };
        hooks.move = (path) => {
          if (writing && step === "rename" && path === `${manifest}.tmp`) throw ENOSPC();
        };
        const lines: string[] = [];
        const result = await invocation(dir, { fetchImpl: w.fetchImpl, pacer });
        hooks.wrote = undefined;
        hooks.fsync = undefined;
        hooks.move = undefined;
        // Without it, a resume could not hold later calls to the model this one measured: nothing more is sent.
        expect(w.posted(), step).toBe(1);
        expect(result.records, step).toHaveLength(0);
        expect(result.stopped, step).toMatchObject({ reason: "error" });
        expect(result.stopped!.message, step).toMatch(/could not write .*manifest\.json \((ENOSPC|EIO)\)/);
        // Uncommitted: the run never took the model as its own, and its request is settled on the record like any
        // other, claiming no model. Before the rename the manifest is as it was; after it, the manifest names the model,
        // but none of the run's records shows it measured.
        if (step === "sync directory") expect(before().servedModel, step).toMatchObject({ id: HAIKU });
        else expect(before().servedModel, step).toBeUndefined();
        expect(pacer.served?.id, step).toBeUndefined();
        expect(result.servedModel, step).toBeUndefined();
        expect(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")).servedModel, step).toBeNull();
        const settled = ledger(dir).filter((l) => l.adjust !== undefined);
        expect(settled, step).toHaveLength(1);
        expect(settled[0]!.servedModel, step).toBeUndefined();
        // Stopped before any model could be committed, the run records its first served model on the next resume,
        // which sets aside, on its record, a model the manifest names all the same.
        const resumed = await invocation(dir, { log: (l) => lines.push(l) });
        expect(resumed.stopped, step).toBeUndefined();
        expect(resumed.records, step).toHaveLength(1);
        expect(before().servedModel, step).toMatchObject({ id: HAIKU });
        expect(ledger(dir).filter((l) => l.servedModel !== undefined).length, step).toBeGreaterThan(0);
        if (step === "sync directory") {
          expect(resumed.invocations.at(-1)?.setAside, step).toMatchObject({ servedModel: { id: HAIKU } });
          expect(lines.some((l) => l.startsWith(`set aside servedModel ${HAIKU}`)), step).toBe(true);
        } else expect(resumed.invocations.at(-1)?.setAside, step).toBeUndefined();
      });
    }
  });
});

describe("a model none of the run's records shows measured", () => {
  const HAIKU = "claude-haiku-4-5-20251001";
  const OTHER = "claude-haiku-4-5-20260301";
  const servedBy = (model: string) => {
    let n = 0;
    let posted = 0;
    const script = cellScript();
    const env = { HOSTED_AI: "on", AI: { run: async () => ({ content: [{ type: "text", text: script[Math.min(n++, script.length - 1)] }], usage: { input_tokens: 10, output_tokens: MAX_OUTPUT_TOKENS + 1 }, model }) } };
    return { fetchImpl: (async (url: string, init: RequestInit) => (posted++, handlePropose(new Request(url, init), env))) as typeof fetch, posted: () => posted };
  };
  /**
   * The plan's reply holds, so the run writes its model to the manifest; then that reply's settlement, the first line
   * that would claim the model, cannot be written, and the run stops there, having measured nothing.
   */
  const unclaimed = async (dir: string) => {
    let failed = false;
    hooks.wrote = (file, data) => {
      if (!failed && file.endsWith("requests.jsonl") && data.includes('"adjust"')) {
        failed = true;
        throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
      }
    };
    const first = await invocation(dir, {});
    hooks.wrote = undefined;
    expect(first.stopped).toMatchObject({ reason: "error" });
    expect(first.records).toHaveLength(0);
    expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).servedModel).toMatchObject({ id: HAIKU });
    expect(ledger(dir).some((l) => l.servedModel !== undefined)).toBe(false);
    return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  };
  const write = (dir: string, manifest: unknown) => writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  it("was never measured: whatever the manifest then says, the resume sets it aside on the record, records the model it is served afresh, and the run measures on that one alone", async () => {
    for (const edit of ["left as it was", "removed by hand", "replaced by hand"] as const) {
      await withRun("unclaimed-model", async (dir) => {
        const recorded = await unclaimed(dir);
        if (edit === "removed by hand") delete recorded.servedModel;
        if (edit === "replaced by hand") recorded.servedModel = { ...recorded.servedModel, id: OTHER };
        write(dir, recorded);
        // Nothing was measured on the model: with or without a hand edit, the resume records the model it is served,
        // and every claim on the ledger names that one model. A model the manifest named is set aside, said so in the
        // invocation's log and record, and in the report.
        const lines: string[] = [];
        const resumed = await invocation(dir, { fetchImpl: servedBy(OTHER).fetchImpl, log: (l) => lines.push(l) });
        expect(resumed.stopped, edit).toBeUndefined();
        expect(resumed.records, edit).toHaveLength(1);
        expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).servedModel, edit).toMatchObject({ id: OTHER });
        expect(new Set(ledger(dir).map((l) => l.servedModel).filter((m) => m !== undefined)), edit).toEqual(new Set([OTHER]));
        const setAside = edit === "removed by hand" ? undefined : edit === "left as it was" ? HAIKU : OTHER;
        const pacing = readFileSync(join(dir, "pacing.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { setAside?: { servedModel: { id: string } } });
        const report = readFileSync(join(dir, "REPORT.md"), "utf8");
        if (setAside === undefined) {
          expect(pacing.some((p) => p.setAside), edit).toBe(false);
          expect(report, edit).not.toContain("Served models set aside");
          expect(lines.some((l) => l.startsWith("set aside servedModel")), edit).toBe(false);
        } else {
          expect(pacing.at(-1)?.setAside, edit).toMatchObject({ servedModel: { id: setAside } });
          expect(report, edit).toContain(`Served models set aside`);
          expect(report, edit).toContain(`\`${setAside}\``);
          expect(lines.some((l) => l.startsWith(`set aside servedModel ${setAside}`)), edit).toBe(true);
        }
      });
    }
  }, 60_000);

  it("is refused all the same when the manifest's servedModel is malformed, before anything is sent", async () => {
    await withRun("unclaimed-malformed", async (dir) => {
      const recorded = await unclaimed(dir);
      const at = recorded.servedModel.at as string;
      // A well-formed record of another family is refused by its id alone: nothing on the ledger claims a model.
      for (const servedModel of [{ id: "claude-opus-4-1-20250805", at }, { id: "claude-haiku-4-5-sonnet", at }, { id: HAIKU, at: "" }, { id: HAIKU, at: "not a date" }, { id: HAIKU, at: "2026-10-11" }, { id: HAIKU, at, restored: "by hand" }, [HAIKU, at]]) {
        write(dir, { ...recorded, servedModel });
        const served = servedBy(HAIKU);
        await expect(invocation(dir, { fetchImpl: served.fetchImpl }), JSON.stringify(servedModel)).rejects.toThrow(/^resume refused: .*servedModel/s);
        expect(served.posted(), JSON.stringify(servedModel)).toBe(0);
      }
      // Restored as it was, the record the run wrote resumes.
      write(dir, recorded);
      const resumed = await invocation(dir, { fetchImpl: servedBy(HAIKU).fetchImpl });
      expect(resumed.stopped).toBeUndefined();
      expect(resumed.records).toHaveLength(1);
    });
  }, 60_000);
});

describe("a stop whose own settlement cannot be written", () => {
  it("is reported as the write failure, never as the integrity stop, and the next resume raises its request to the most a request can cost", async () => {
    await withRun("integrity-unwritten", async (dir) => {
      // The plan's first call is an unusable output, which names no model of its own: the reply fails the run's
      // integrity check, and then its settlement line cannot be written. The record comes first, so the run stops on it.
      const w = worker(["not json", ...cellScript()]);
      let failed = false;
      hooks.wrote = (file, data) => {
        if (!failed && file.endsWith("requests.jsonl") && data.includes('"adjust"')) {
          failed = true;
          throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
        }
      };
      const first = await invocation(dir, { fetchImpl: w.fetchImpl });
      hooks.wrote = undefined;
      expect(failed).toBe(true);
      expect(w.posted()).toBe(1);
      expect(first.records).toHaveLength(0);
      expect(first.stopped).toMatchObject({ reason: "error" });
      expect(first.stopped!.message).toMatch(/could not write .*requests\.jsonl \(ENOSPC\)/);
      expect(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")).stopped).toMatchObject({ reason: "error" });
      expect(readFileSync(join(dir, "REPORT.md"), "utf8")).not.toMatch(/Integrity stops/);
      // Its request has no settlement on the record, so the next resume raises it to the most any request can cost.
      expect(ledger(dir).map((l) => l.reason ?? "request")).toEqual(["request"]);
      expect((await totals(dir)).usd).toBeCloseTo(REQUEST_USD_BOUND, 9);
    });
  }, 60_000);
});

describe("a crash of the machine loses no request that was sent", () => {
  it("puts a new ledger's directory entry on the disk before the first request is sent", async () => {
    await withRun("dir-entry", async (dir) => {
      const events: string[] = [];
      hooks.fsync = (path) => events.push(path === dir ? "fsync:dir" : `fsync:${path.split("/").at(-1)}`);
      hooks.send = () => events.push("send");
      await invocation(dir, {});
      const file = events.indexOf("fsync:requests.jsonl");
      const entry = events.indexOf("fsync:dir", file);
      expect(file).toBeGreaterThanOrEqual(0);
      expect(entry).toBeGreaterThan(file);
      expect(events.indexOf("send")).toBeGreaterThan(entry);
    });
  }, 60_000);

  it("puts a new run directory's own entry, and every directory it created, on the disk before anything is sent", async () => {
    await withRun("run-dir-entry", async (dir) => {
      const run = join(dir, "a", "b", "run");
      const synced: string[] = [];
      let sentAfter: string[] | undefined;
      hooks.fsync = (path) => synced.push(path);
      hooks.send = () => {
        sentAfter ??= [...synced];
      };
      await invocation(run, {});
      // Each directory the run created is named in its parent, and each parent is synced: dir holds a, a holds b,
      // and b holds the run directory itself.
      for (const parent of [dir, join(dir, "a"), join(dir, "a", "b")]) expect(sentAfter, parent).toContain(parent);
    });
  }, 60_000);

  it("syncs an existing ledger's directory entry before a resume sends anything, whatever an earlier invocation managed", async () => {
    await withRun("dir-entry-resume", async (dir) => {
      await invocation(dir, { maxRequests: 0 });
      // An earlier invocation created the ledger, and stopped before its directory entry was synced.
      writeFileSync(join(dir, "requests.jsonl"), "");
      const order: string[] = [];
      hooks.fsync = (path) => {
        if (path === dir) order.push("synced");
      };
      hooks.send = () => order.push("send");
      await invocation(dir, {});
      expect(order.indexOf("synced")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("synced")).toBeLessThan(order.indexOf("send"));
    });
  }, 60_000);

  it("stops when a directory it must sync cannot be synced, and passes over a filesystem that cannot sync directories at all", async () => {
    await withRun("dir-sync", async (dir) => {
      await invocation(dir, { maxRequests: 0 });
      const failing = (code: string) => (path: string) => {
        if (path === dir) throw Object.assign(new Error(`${code}: fsync`), { code });
      };
      // A resume that changes the ceiling replaces the manifest, and syncs its directory.
      hooks.fsync = failing("EIO");
      await expect(invocation(dir, { maxRequests: 0, maxTotalUsd: 2000 })).rejects.toThrow(/EIO/);
      hooks.fsync = failing("EINVAL");
      await expect(invocation(dir, { maxRequests: 0, maxTotalUsd: 3000 })).resolves.toBeDefined();
    });
  }, 60_000);

  it("syncs each request's line to the disk before the request is sent, and every replaced manifest before it is moved into place", async () => {
    await withRun("flush", async (dir) => {
      // What was written and synced, in order, file by file; and each send.
      const events: string[] = [];
      hooks.wrote = (path) => events.push(`write:${path.split("/").at(-1)}`);
      hooks.fsync = (path) => events.push(`fsync:${path.split("/").at(-1)}`);
      hooks.move = (path) => events.push(`move:${path.split("/").at(-1)}`);
      hooks.send = () => events.push("send");
      await invocation(dir, {});
      const sends = events.flatMap((e, i) => (e === "send" ? [i] : []));
      expect(sends.length).toBeGreaterThan(0);
      for (const send of sends) {
        const written = events.lastIndexOf("write:requests.jsonl", send);
        expect(written, `send at ${send}`).toBeGreaterThanOrEqual(0);
        const synced = events.indexOf("fsync:requests.jsonl", written);
        expect(synced, `send at ${send}`).toBeGreaterThan(written);
        expect(synced, `send at ${send}`).toBeLessThan(send);
      }
      // A resume that changes the ceiling replaces the manifest: written, synced, then moved into place.
      events.length = 0;
      await invocation(dir, { maxRequests: 0, maxTotalUsd: 2000 });
      const written = events.indexOf("write:manifest.json.tmp");
      expect(written).toBeGreaterThanOrEqual(0);
      const synced = events.indexOf("fsync:manifest.json.tmp", written);
      expect(synced).toBeGreaterThan(written);
      expect(events.indexOf("move:manifest.json.tmp", synced)).toBeGreaterThan(synced);
    });
  }, 60_000);
});
