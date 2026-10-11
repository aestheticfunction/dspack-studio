import { afterEach, describe, expect, it, vi } from "vitest";
import { main, parseOptions } from "./run";

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
