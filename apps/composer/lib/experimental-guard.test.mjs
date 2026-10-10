/**
 * Source ratchet (docs/BLOCKS.md): every dynamic import of the experimental
 * block runtime in app code must sit behind the LITERAL
 * `process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL === "1"` check. Next folds
 * that literal away in default builds, and next.config.mjs aliases the
 * directory to nothing there, so an unguarded import() would resolve to an
 * empty module at runtime and crash. This test fails before a build could.
 * It also refuses any STATIC import of the block code from app code: the
 * sidecar schema carries the bundle-hygiene markers at module scope.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL("../app", import.meta.url));
const GUARD = 'process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL === "1"';

const sources = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) sources.push(path);
  }
};
walk(appDir);

describe("experimental block code stays behind the literal flag", () => {
  it("every import() of the block runtime has the literal guard within the 12 preceding lines", () => {
    const unguarded = [];
    let guarded = 0;
    for (const file of sources) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // A type query (`typeof import(...)`) is erased at compile time.
        if (!/import\("(\.\.\/)+experimental\//.test(line) || /typeof import\(/.test(line)) return;
        const window = lines.slice(Math.max(0, i - 12), i + 1).join("\n");
        if (window.includes(GUARD)) guarded += 1;
        else unguarded.push(`${file.slice(appDir.length)}:${i + 1}`);
      });
    }
    expect(unguarded).toEqual([]);
    expect(guarded).toBeGreaterThan(0);
  });

  it("app code never imports the block code or the sidecars statically (type-only imports are erased and allowed)", () => {
    const offenders = [];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/^import\s+(?!type\s)[^;]*from\s+"([^"]+)";/gm)) {
        const spec = match[1];
        if (spec.includes("composer-core/blocks") || spec.includes("experimental/")) offenders.push(`${file.slice(appDir.length)}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
