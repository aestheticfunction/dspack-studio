import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCorpus } from "./corpus";
import { main, parseOptions, validateSelection } from "./run";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the CLI validates its options before any preflight or provider call", () => {
  it("accepts the documented values and parses the numbers, and ignores the '--' separator pnpm forwards", () => {
    const o = parseOptions(["--", "--provider", "hosted", "--arms", "block,capped", "--conditions", "fresh,refine-add", "--limit", "5", "--max-requests", "40", "--spacing-ms", "0"]);
    expect(o).toMatchObject({ provider: "hosted", arms: ["block", "capped"], conditions: ["fresh", "refine-add"], limit: 5, maxRequests: 40, spacingMs: 0 });
  });
  it("rejects an unknown arm, an unknown condition, an unknown provider, and a number that is not a whole non-negative count", () => {
    expect(() => parseOptions(["--arms", "block,nope"])).toThrow(/unknown arm 'nope'/);
    expect(() => parseOptions(["--conditions", "fresh,later"])).toThrow(/unknown condition 'later'/);
    expect(() => parseOptions(["--provider", "openai"])).toThrow(/unknown provider/);
    expect(() => parseOptions(["--limit", "-1"])).toThrow(/--limit/);
    expect(() => parseOptions(["--limit", "abc"])).toThrow(/--limit/);
    expect(() => parseOptions(["--limit", "0"])).toThrow(/--limit/);
    expect(() => parseOptions(["--max-requests", "0"])).toThrow(/--max-requests/);
    expect(() => parseOptions(["--spacing-ms", "-5"])).toThrow(/--spacing-ms/);
    expect(() => parseOptions(["--provider", "scripted", "--bogus"])).toThrow(/unknown option '--bogus'/);
  });
});

describe("the CLI refuses what would run nothing, or run something other than what was asked", () => {
  it("refuses empty lists and unknown references", () => {
    expect(() => parseOptions(["--arms", ""])).toThrow(/--arms needs at least one value/);
    expect(() => parseOptions(["--conditions", ","])).toThrow(/--conditions needs at least one value/);
    expect(() => parseOptions(["--prompts", " "])).toThrow(/--prompts needs at least one value/);
    expect(() => parseOptions(["--blocks", ""])).toThrow(/--blocks needs at least one value/);
    expect(() => parseOptions(["--reference", "astryx,nope"])).toThrow(/unknown reference 'nope'/);
  });

  it("refuses option combinations that would be silently ignored or would start the wrong run", () => {
    expect(() => parseOptions(["--rerun-failed"])).toThrow(/--rerun-failed needs --resume/);
    expect(() => parseOptions(["--resume", "live/runs/x", "--out", "live/runs/y"])).toThrow(/--out/);
    expect(() => parseOptions(["--provider", "ollama:gpt-oss", "--max-requests", "40"])).toThrow(/--max-requests applies to the hosted provider only/);
    expect(() => parseOptions(["--provider", "ollama:gpt-oss", "--spacing-ms", "0"])).toThrow(/--spacing-ms applies to the hosted provider only/);
    expect(() => parseOptions(["--provider", "scripted", "--base-url", "https://example.test"])).toThrow(/--base-url applies to the hosted provider only/);
    expect(() => parseOptions(["--provider", "scripted", "--force"])).toThrow(/--force applies to the hosted provider only/);
    expect(() => parseOptions(["--provider", "hosted", "--ollama-host", "http://localhost:11434"])).toThrow(/--ollama-host applies to an ollama provider only/);
  });

  it("refuses a hosted cap that can never admit a cell, and accepts the smallest one that can", () => {
    expect(() => parseOptions(["--provider", "hosted", "--max-requests", "19"])).toThrow(/--max-requests must be at least 20/);
    expect(parseOptions(["--provider", "hosted", "--max-requests", "20"]).maxRequests).toBe(20);
  });

  it("refuses prompt and block ids the corpus does not hold for the selected references", () => {
    const corpus = readCorpus();
    expect(() => validateSelection(parseOptions(["--prompts", "rt-01,rt-02,rt-3"]), corpus)).toThrow(/unknown prompt 'rt-3'/);
    expect(() => validateSelection(parseOptions(["--reference", "astryx", "--prompts", "nb-11"]), corpus)).toThrow(/prompt 'nb-11' does not apply to astryx/);
    expect(() => validateSelection(parseOptions(["--blocks", "records_table"]), corpus)).toThrow(/unknown block 'records_table'/);
    expect(() => validateSelection(parseOptions(["--blocks", "NULL"]), corpus)).toThrow(/unknown block 'NULL'/);
    expect(() => validateSelection(parseOptions(["--prompts", "rt-01", "--blocks", "records-table,null"]), corpus)).not.toThrow();
  });

  it("plans the cells before any network call, and exits non-zero on a selection that plans none, creating nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("no network"))));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runs = fileURLToPath(new URL("./runs", import.meta.url));
    const before = existsSync(runs) ? readdirSync(runs).length : 0;
    expect(await main(["--provider", "hosted", "--prompts", "rt-01", "--blocks", "auth-form", "--allow-drafts"])).toBe(2);
    expect(errors.mock.calls.flat().join("\n")).toMatch(/plans no cells/);
    expect(await main(["--provider", "hosted", "--prompts", "rt-1", "--allow-drafts"])).toBe(2);
    expect(errors.mock.calls.flat().join("\n")).toMatch(/unknown prompt 'rt-1'/);
    expect(fetch).not.toHaveBeenCalled();
    expect(existsSync(runs) ? readdirSync(runs).length : 0).toBe(before);
  }, 60_000);
});

describe("a run measures the frozen corpus only", () => {
  it("refuses a corpus that differs from its committed pin, before any network call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("no network"))));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const corpus = readCorpus();
    const edited = { ...corpus, prompts: corpus.prompts.map((p) => (p.id === "rt-05" ? { ...p, goal: `${p.goal} today` } : p)) };
    expect(await main(["--provider", "scripted", "--allow-drafts", "--limit", "1"], { corpus: edited })).toBe(2);
    expect(errors.mock.calls.flat().join("\n")).toMatch(/not the frozen corpus/);
    expect(fetch).not.toHaveBeenCalled();
  }, 60_000);
});

describe("an Ollama run pins the weights it measures", () => {
  it("refuses to start when Ollama reports no digest for the model, after asking only for the model list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ models: [{ name: "qwen3:8b", digest: "sha256:bbb" }] }))));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await main(["--provider", "ollama:gpt-oss", "--ollama-host", "http://127.0.0.1:9", "--allow-drafts", "--limit", "1"])).toBe(1);
    expect(errors.mock.calls.flat().join("\n")).toMatch(/gpt-oss:latest/);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual(["http://127.0.0.1:9/api/tags"]);
  }, 60_000);
});
