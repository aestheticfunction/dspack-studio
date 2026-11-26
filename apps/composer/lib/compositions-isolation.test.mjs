/**
 * The composition runtime (packages/composer-core/src/compositions, the R1a spike) stays out of every
 * application until an application integration is authorized (docs/repositioning/R1A-REVIEW.md §7).
 * No application source may import it, and composer-core's root entry must not re-export it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const ROOTS = ["apps/composer/app", "apps/composer/lib", "apps/composer/worker", "apps/composer/scripts", "apps/composer/experimental", "apps/agent/src", "apps/web"];
const SOURCE = /\.(m?[jt]sx?|cjs)$/;
const SKIP = new Set(["node_modules", ".next", "out", "dist"]);
const FORBIDDEN = /composer-core\/compositions|composer-core\/src\/compositions|["'/]compositions\/(index|instantiate|host|governance|bindings|expand|load|schema)/;

function* files(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (SOURCE.test(name)) yield path;
  }
}

describe("composition runtime isolation", () => {
  it("no application source imports the composition runtime", () => {
    const offenders = [];
    let scanned = 0;
    for (const root of ROOTS) {
      for (const file of files(join(REPO, root))) {
        if (file.endsWith("compositions-isolation.test.mjs")) continue;
        scanned++;
        const text = readFileSync(file, "utf8");
        for (const line of text.split("\n")) {
          if (/\b(import|from|require\s*\(|import\s*\()/.test(line) && FORBIDDEN.test(line)) offenders.push(`${file.slice(REPO.length)}: ${line.trim()}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });

  it("composer-core's root entry does not re-export it", () => {
    const index = readFileSync(join(REPO, "packages/composer-core/src/index.ts"), "utf8");
    expect(index).not.toMatch(/compositions/);
  });
});
