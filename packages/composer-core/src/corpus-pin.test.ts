/**
 * The Gateway acceptance corpus is immutable (acceptance/gateway-corpus/README.md,
 * rule 1; the owner's 2026-08-10 instruction, restated for the repositioning on
 * 2026-11-24). This pins its prompt files byte for byte, so any edit, however
 * well meant, fails CI and has to be made deliberately. EXPECTED.md is not
 * pinned: it is meant to change when a milestone changes a verdict.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sha256 = (path: string) =>
  createHash("sha256")
    .update(readFileSync(fileURLToPath(new URL(`../../../acceptance/gateway-corpus/${path}`, import.meta.url))))
    .digest("hex");

describe("the Gateway acceptance corpus is unchanged", () => {
  it("corpus.mjs (the twelve prompts) matches its pinned hash", () => {
    expect(sha256("corpus.mjs")).toBe("f9e6be1641133d484fd721cb5371537882231f6cce4971bd0018d00ef1732180");
  });
  it("paraphrases.mjs matches its pinned hash", () => {
    expect(sha256("paraphrases.mjs")).toBe("bd27cf9d65bef691741a7545d321d109007666a63c69c9f8efb3301f4cf4a9c2");
  });
});
