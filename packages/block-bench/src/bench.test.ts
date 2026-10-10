/**
 * The bench drift test: recompute everything and compare with the committed
 * results.json. Any change to what Composer sends, to the contracts, the
 * drafts, the goldens, or the pinned dspack packages shows up here as a
 * readable diff; regenerate on purpose with
 * `pnpm --filter @dspack-studio/block-bench bench` and review it.
 *
 * The request hashes in results.json are the flag-off byte-identity oracle:
 * later phases must leave them unchanged.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { computeResults, type BenchResults } from "./bench";
import { renderMarkdown } from "./report";

type Json = Record<string, any>;

const committed = JSON.parse(readFileSync(fileURLToPath(new URL("../results.json", import.meta.url)), "utf8")) as BenchResults;
let fresh: BenchResults;

/** Every JSON path whose value differs, as "path: committed -> now" (first 40). */
function diffPaths(a: unknown, b: unknown, at = "$", out: string[] = []): string[] {
  if (out.length >= 40) return out;
  const isObj = (v: unknown) => v !== null && typeof v === "object";
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) diffPaths((a as Json)[k], (b as Json)[k], `${at}.${k}`, out);
  } else if (JSON.stringify(a) !== JSON.stringify(b)) {
    out.push(`${at}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
  return out;
}

beforeAll(async () => {
  fresh = await computeResults();
}, 180_000);

describe("block-bench", () => {
  it("matches the committed results.json exactly (regenerate with the bench script and review the diff)", () => {
    // Path-level diff first, so a failure names exactly what moved.
    expect(diffPaths(committed, fresh)).toEqual([]);
    expect(fresh).toEqual(committed);
  });

  it("RESULTS.md is exactly the rendered view of results.json", () => {
    const rendered = readFileSync(fileURLToPath(new URL("../RESULTS.md", import.meta.url)), "utf8");
    expect(renderMarkdown(committed)).toBe(rendered);
  });

  it("captures a hashed request for every governed context, fresh and refine, plus planning", () => {
    for (const ref of fresh.references as Json[]) {
      const intents = new Set((ref.requests.generation as Json[]).map((g) => g.intent));
      expect(intents.size).toBeGreaterThan(0);
      for (const g of ref.requests.generation as Json[]) expect(g.bodySha256).toMatch(/^[0-9a-f]{64}$/);
      expect((ref.requests.planning as Json[]).map((p) => p.kind)).toEqual(["plan", "plan", "plan", "flow-plan"]);
    }
  });

  it("every draft golden passes S1-S3, emits on both A2UI versions and json-render, and dispatches only declared actions", () => {
    for (const ref of fresh.references as Json[]) {
      for (const d of ref.drafts as Json[]) {
        const at = `${ref.reference}/${d.block}`;
        expect(d.lint, at).toEqual({ S1: "PASS", S2: "PASS", S3: "PASS" });
        expect(d.a2ui.refusal, at).toBeUndefined();
        for (const gates of Object.values(d.a2ui.gates as Json)) expect(Object.values(gates as Json).every(Boolean), at).toBe(true);
        expect(d.jsonRender.J2J3, at).toBe(true);
        for (const action of d.a2ui.actions as string[]) expect(d.declaredActions, at).toContain(action);
      }
    }
  });

  it("B0's ported generation view agrees with the real generation schema", () => {
    for (const ref of fresh.references as Json[]) {
      expect(ref.parity.componentsMatch, ref.reference).toBe(true);
      expect(ref.parity.idRequiredMatch, ref.reference).toBe(true);
    }
  });

  it("states the leak table's scope and denominator explicitly", () => {
    const astryx = (fresh.references as Json[]).find((r) => r.reference === "astryx") as Json;
    expect(astryx.leak.scope).toMatch(/not hosted evidence/);
    expect(astryx.leak.summary.s3FailingRecomputed).toBe((astryx.leak.rows as Json[]).filter((r) => r.recomputed.S3 === "FAIL").length);
  });
});
