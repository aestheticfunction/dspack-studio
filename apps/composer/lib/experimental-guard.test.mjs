/**
 * Source ratchet (docs/BLOCKS.md): every `import()` of block code from app
 * code must sit where the LITERAL `process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL === "1"`
 * is true. Next inlines that literal and webpack folds the dead branch away in
 * default builds, and next.config.mjs aliases the experimental directory to
 * nothing there, so an import() that survives would resolve to an empty module
 * at runtime and crash. This test fails before a build could. It also refuses
 * any STATIC import or re-export of block code from app code: the sidecar
 * schema carries the bundle-hygiene markers at module scope.
 *
 * The audit reads the syntax tree (lib/experimental-guard.mjs), so the guard
 * must really enclose the import: the then-branch of an `if`, the true arm
 * of a ternary, or the right side of an `&&`, whose test is the literal or an
 * `&&` chain that BEGINS with it. A guard on the line above, a negated test,
 * or the false arm does not count.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { auditSource } from "./experimental-guard.mjs";

const appDir = fileURLToPath(new URL("../app", import.meta.url));

const sources = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) sources.push(path);
  }
};
walk(appDir);

const FLAG = 'process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL === "1"';
const IMPORT = 'await import("../experimental/blocks-runtime")';
const audit = (text, fileName = "/probe.ts") => auditSource(text, fileName);

describe("experimental block code stays behind the literal flag (the app sources)", () => {
  it("every import() of block code in app code is enclosed by the literal guard, and nothing imports it statically", () => {
    const unguarded = [];
    const staticOffenders = [];
    let guarded = 0;
    for (const file of sources) {
      const result = auditSource(readFileSync(file, "utf8"), file.slice(appDir.length));
      guarded += result.guarded;
      unguarded.push(...result.unguarded);
      staticOffenders.push(...result.staticOffenders);
    }
    expect(unguarded).toEqual([]);
    expect(staticOffenders).toEqual([]);
    // Positive control: the audit really sees the runtime's import sites.
    expect(guarded).toBeGreaterThanOrEqual(7);
  });
});

describe("the audit (fixtures): what counts as guarded", () => {
  it("accepts an import() in the then-branch of the literal check, alone or as the FIRST operand of an && chain, however deeply nested", () => {
    const text = `
      export async function a(x: boolean) {
        if (${FLAG}) { const r = ${IMPORT}; return r; }
        if (${FLAG} && x && x !== false) {
          const inner = async () => { const r = ${IMPORT}; return r; };
          return inner();
        }
        if (${FLAG}) {
          try { const r = ${IMPORT}; return r; } catch { return null; }
        }
      }`;
    expect(audit(text)).toEqual({ guarded: 3, unguarded: [], staticOffenders: [] });
  });

  it("accepts the true arm of a ternary and the right side of an && whose chain begins with the literal", () => {
    const text = `
      export const a = async (x: boolean) => ${FLAG} ? ${IMPORT} : null;
      export const b = async (x: boolean) => ${FLAG} && x && (${IMPORT});
      export const c = async () => ("1" === process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL ? ${IMPORT} : null);`;
    expect(audit(text)).toEqual({ guarded: 3, unguarded: [], staticOffenders: [] });
  });

  it("ignores type-level import() queries and type-only imports and re-exports, which compile to nothing", () => {
    const text = `
      import type { BlockDefinition } from "@dspack-studio/composer-core/blocks";
      export type { BlockTrace } from "@dspack-studio/composer-core/blocks";
      type Runtime = typeof import("../experimental/blocks-runtime");
      export type Ctx = Awaited<ReturnType<Runtime["blockContext"]>>;
      export const nothing: BlockDefinition | null = null;`;
    expect(audit(text)).toEqual({ guarded: 0, unguarded: [], staticOffenders: [] });
  });

  it("rejects a bare import() and an import() whose guard is on the line above, not around it", () => {
    const text = `
      export async function a(note: string) {
        const r = ${IMPORT};
        if (${FLAG}) note = "x";
        const s = ${IMPORT};
        return [r, s];
      }`;
    expect(audit(text)).toEqual({ guarded: 0, unguarded: ["/probe.ts:3", "/probe.ts:5"], staticOffenders: [] });
  });

  it("rejects the false arm of a ternary, the else branch, a negated test, and a !== test", () => {
    const text = `
      export async function a(x: boolean) {
        const r = ${FLAG} ? null : ${IMPORT};
        if (${FLAG}) { x = true; } else { const s = ${IMPORT}; return s; }
        if (!(${FLAG})) { const t = ${IMPORT}; return t; }
        if (process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL !== "1") { const u = ${IMPORT}; return u; }
        return r;
      }`;
    expect(audit(text)).toEqual({ guarded: 0, unguarded: ["/probe.ts:3", "/probe.ts:4", "/probe.ts:5", "/probe.ts:6"], staticOffenders: [] });
  });

  it("rejects a guard that is not the FIRST operand of its && chain, and a check of anything but the exact literal", () => {
    const text = `
      const FLAG_ON = ${FLAG};
      export async function a(x: boolean) {
        if (x && ${FLAG}) { const r = ${IMPORT}; return r; }
        if (FLAG_ON) { const s = ${IMPORT}; return s; }
        if (process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL) { const t = ${IMPORT}; return t; }
        if (process.env["NEXT_PUBLIC_COMPOSER_EXPERIMENTAL"] === "1") { const u = ${IMPORT}; return u; }
        if (${FLAG} || x) { const v = ${IMPORT}; return v; }
      }`;
    expect(audit(text)).toEqual({ guarded: 0, unguarded: ["/probe.ts:4", "/probe.ts:5", "/probe.ts:6", "/probe.ts:7", "/probe.ts:8"], staticOffenders: [] });
  });

  it("audits an import() of the composer-core blocks subpath the same way", () => {
    const text = `
      export async function a() {
        if (${FLAG}) { const r = await import("@dspack-studio/composer-core/blocks"); return r; }
        const s = await import("@dspack-studio/composer-core/blocks");
        return s;
      }`;
    expect(audit(text)).toEqual({ guarded: 1, unguarded: ["/probe.ts:4"], staticOffenders: [] });
  });

  it("rejects every static value import or re-export of block code: named, default, namespace, bare, single-quoted, inline-type, export-from, export-star", () => {
    const text = `
      import { parseBlocksSidecar } from "@dspack-studio/composer-core/blocks";
      import runtime from "../experimental/blocks-runtime";
      import * as blocks from '@dspack-studio/composer-core/blocks';
      import "../experimental/blocks-runtime";
      import { type BlockDefinition } from "@dspack-studio/composer-core/blocks";
      export { expandBlock } from "@dspack-studio/composer-core/blocks";
      export * from "../../experimental/blocks-runtime";
      import { planDeterministic } from "@dspack-studio/composer-core";
      export const x = [parseBlocksSidecar, runtime, blocks, planDeterministic];`;
    expect(audit(text, "/views/probe.tsx")).toEqual({
      guarded: 0,
      unguarded: [],
      staticOffenders: [
        "/views/probe.tsx:2: @dspack-studio/composer-core/blocks",
        "/views/probe.tsx:3: ../experimental/blocks-runtime",
        "/views/probe.tsx:4: @dspack-studio/composer-core/blocks",
        "/views/probe.tsx:5: ../experimental/blocks-runtime",
        "/views/probe.tsx:6: @dspack-studio/composer-core/blocks",
        "/views/probe.tsx:7: @dspack-studio/composer-core/blocks",
        "/views/probe.tsx:8: ../../experimental/blocks-runtime",
      ],
    });
  });

  it("parses TSX", () => {
    const text = `
      export function View() {
        if (${FLAG}) { void import("../../experimental/blocks-runtime").then(() => undefined); }
        return <div>{${FLAG} ? "on" : "off"}</div>;
      }`;
    expect(audit(text, "/views/probe.tsx")).toEqual({ guarded: 1, unguarded: [], staticOffenders: [] });
  });
});
