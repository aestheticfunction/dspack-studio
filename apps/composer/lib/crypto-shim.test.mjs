/**
 * Provenance parity: the browser SHA-256 shim MUST equal node:crypto exactly.
 *
 * audit/report.js hashes the contract for provenance with
 * createHash("sha256").update(str).digest("hex"). The hosted Composer runs that
 * in the browser via lib/crypto-shim.mjs; the CLI and agent run it via
 * node:crypto. If the two ever disagree, a hosted receipt's contract hash would
 * silently diverge from the same contract's CLI hash — provenance would lie.
 * This test is the gate that keeps them byte-identical.
 */
import { describe, it, expect } from "vitest";
import { createHash as node } from "node:crypto";
import { createHash as shim } from "./crypto-shim.mjs";

const inputs = [
  "",
  "abc",
  "hello world",
  JSON.stringify({ name: "shadcn/ui", dspack: "0.4", n: 42, u: "café — naïve 🚀", nested: { a: [1, 2, 3] } }),
  "a".repeat(1000), // crosses multiple 64-byte blocks
  "x".repeat(55), // one byte short of a block boundary (padding edge)
  "y".repeat(56), // forces an extra padding block
];

describe("crypto-shim sha256 parity with node:crypto", () => {
  for (const input of inputs) {
    it(`matches node:crypto for input of length ${input.length}`, () => {
      const s = shim("sha256").update(input).digest("hex");
      const n = node("sha256").update(input).digest("hex");
      expect(s).toBe(n);
      expect(s).toMatch(/^[0-9a-f]{64}$/);
    });
  }

  it("matches the FIPS 180-4 known-answer vectors", () => {
    expect(shim("sha256").update("").digest("hex")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(shim("sha256").update("abc").digest("hex")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("supports chained update() the same way node:crypto does", () => {
    expect(shim("sha256").update("ab").update("c").digest("hex")).toBe(node("sha256").update("abc").digest("hex"));
  });

  it("refuses algorithms/encodings it does not implement, rather than lying", () => {
    expect(() => shim("md5")).toThrow(/sha256/);
    expect(() => shim("sha256").update("x").digest("base64")).toThrow(/hex/);
  });
});
