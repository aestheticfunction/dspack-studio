import { describe, expect, it } from "vitest";
import { parseOptions } from "./run";

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
