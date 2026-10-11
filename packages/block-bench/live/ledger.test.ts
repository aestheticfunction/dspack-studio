/**
 * The run's ledger (requests.jsonl) and its lock (run.lock), under the faults the post-merge audit of the dollar
 * ceiling found: a line that cannot be written, settlements that are duplicated, stray, out of order or missing, an
 * invocation's lines lost, a ceiling that floating-point sums cross, a lock taken by two invocations, and a crash of
 * the machine itself. node:fs is wrapped so a test can fail one write or watch how it is made; every request goes to
 * the real Worker module with a stubbed model, and nothing leaves the process.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  append: undefined as undefined | ((file: string, data: string, options: unknown) => void),
  write: undefined as undefined | ((file: string, data: string, options: unknown) => void),
  move: undefined as undefined | ((path: string) => void),
  read: undefined as undefined | ((path: string) => void),
  fsync: undefined as undefined | ((path: string) => void),
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const appendFileSync = ((file: string, data: string, options?: unknown) => {
    hooks.append?.(String(file), String(data), options);
    return actual.appendFileSync(file, data, options as never);
  }) as typeof actual.appendFileSync;
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
  const fs = { ...actual, appendFileSync, writeFileSync, renameSync, rmSync, readFileSync, openSync, fsyncSync };
  return { ...fs, default: fs };
});

import { handlePropose } from "../../../apps/composer/worker/propose.mjs";
import { exampleFor } from "./arms";
import { readCorpus, type Corpus } from "./corpus";
import { CELL_USD_BOUND, REQUEST_USD_BOUND, absoluteUsd, toNanos } from "./cost";
import { lockRun, runEvaluation } from "./evaluate";
import { createPacer } from "./pacing";
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
  hooks.append = undefined;
  hooks.write = undefined;
  hooks.move = undefined;
  hooks.read = undefined;
  hooks.fsync = undefined;
});

const PLAN = JSON.stringify({ intent: "record-collection", feasible: true, restated: "A table.", reason: "fits" });
const BAD = JSON.stringify({ dspackSurface: "0.1", root: { component: "no-such-component" } });

/**
 * The real Worker, its model answering each call in turn from `script` and reporting no usage, so every request is
 * unverified and raised to its absolute worst case: a production cell is its plan and three generation requests.
 */
function worker(script: string[]) {
  let n = 0;
  let posted = 0;
  const env = { HOSTED_AI: "on", AI: { run: async () => ({ content: [{ type: "text", text: script[Math.min(n++, script.length - 1)] }] }) } };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    posted += 1;
    hooks.append?.("<fetch>", "", undefined);
    return handlePropose(new Request(url, init), env);
  }) as typeof fetch;
  return { fetchImpl, posted: () => posted };
}
const cellScript = () => [PLAN, BAD, BAD, JSON.stringify(exampleFor(astryx, "record-collection"))];

let tick = 0;
/** One invocation of a production run over rt-01, as one CLI process makes it: its own pacer and invocation id. */
async function invocation(dir: string, o: { fetchImpl?: typeof fetch; maxRequests?: number; maxTotalUsd?: number; resume?: boolean }) {
  const fetchImpl = o.fetchImpl ?? worker(cellScript()).fetchImpl;
  return runEvaluation({
    runId: "ledger",
    provider: createHostedProvider({ baseUrl: "https://example.test", fetchImpl, pacer: createPacer({ maxRequests: o.maxRequests ?? 1000, spacingMs: 0, now: () => 0, sleep: async () => undefined }) }),
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
  });
}
/** What the next resume reads from the run directory, sending nothing. */
const totals = async (dir: string) => (await invocation(dir, { maxRequests: 0 })).requests!;
const ledger = (dir: string) => readFileSync(join(dir, "requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { request?: string; usd?: number; adjust?: number; final?: number; reason?: string });
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
      hooks.append = (file, data) => {
        if (!failed && file.endsWith("requests.jsonl") && data.includes('"usage not verified"')) {
          failed = true;
          throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
        }
      };
      const first = await invocation(dir, { fetchImpl: w.fetchImpl });
      hooks.append = undefined;
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
      hooks.append = (file, data) => {
        if (file.endsWith("requests.jsonl") && !data.includes('"adjust"')) throw Object.assign(new Error("EIO: i/o error, write"), { code: "EIO" });
      };
      const first = await invocation(dir, { fetchImpl: w.fetchImpl });
      expect(first.stopped).toMatchObject({ reason: "error" });
      expect(first.stopped!.message).toMatch(/could not write .*requests\.jsonl/);
      expect(w.posted()).toBe(0);
      expect(first.records).toHaveLength(0);
    });
  }, 60_000);
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

describe("one invocation at a time", () => {
  const holder = (fields: Record<string, unknown>) => `${JSON.stringify({ at: "2026-10-01T00:00:00.000Z", ...fields })}\n`;
  const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid!;

  it("removes only its own lock when it ends", async () => {
    await withRun("lock-own", async (dir) => {
      const release = lockRun(dir);
      const other = holder({ pid: process.pid, host: hostname(), nonce: "another" });
      writeFileSync(join(dir, "run.lock"), other);
      release();
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
      writeFileSync(file, holder({ pid: deadPid() }));
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
      lockRun(dir)();
      expect(direct).toEqual([]);
    });
  });
});

describe("a crash of the machine loses no request that was sent", () => {
  it("puts a new ledger's directory entry on the disk before the first request is sent", async () => {
    await withRun("dir-entry", async (dir) => {
      const order: string[] = [];
      let created = false;
      hooks.append = (file) => {
        if (file === "<fetch>") order.push("send");
        else if (file.endsWith("requests.jsonl") && !created) {
          created = true;
          order.push("created");
        }
      };
      hooks.fsync = (path) => {
        if (path === dir && created) order.push("synced");
      };
      await invocation(dir, {});
      expect(order.slice(0, 3)).toEqual(["created", "synced", "send"]);
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

  it("flushes each request's line to the disk before the request is sent, and every replaced manifest before it is moved into place", async () => {
    await withRun("flush", async (dir) => {
      const appends: Array<{ file: string; flushed: boolean }> = [];
      let unflushedAtSend = 0;
      hooks.append = (file, _data, options) => {
        if (file === "<fetch>") {
          const last = appends.filter((a) => a.file.endsWith("requests.jsonl")).at(-1);
          if (!last?.flushed) unflushedAtSend += 1;
          return;
        }
        appends.push({ file, flushed: (options as { flush?: boolean } | undefined)?.flush === true });
      };
      const writes: Array<{ file: string; flushed: boolean }> = [];
      hooks.write = (file, _data, options) => writes.push({ file, flushed: (options as { flush?: boolean } | undefined)?.flush === true });
      await invocation(dir, {});
      expect(appends.filter((a) => a.file.endsWith("requests.jsonl")).length).toBeGreaterThan(0);
      expect(appends.filter((a) => a.file.endsWith("requests.jsonl") && !a.flushed)).toEqual([]);
      expect(unflushedAtSend).toBe(0);
      // A resume that changes the ceiling replaces the manifest.
      writes.length = 0;
      await invocation(dir, { maxRequests: 0, maxTotalUsd: 2000 });
      const manifests = writes.filter((w) => w.file.includes("manifest.json"));
      expect(manifests.length).toBeGreaterThan(0);
      expect(manifests.filter((w) => !w.flushed)).toEqual([]);
    });
  }, 60_000);
});
