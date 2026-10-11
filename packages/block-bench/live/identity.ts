/**
 * What produced a run, so a resume cannot mix two versions of it: a digest
 * of the source the cells run through (this harness, the offline bench it
 * reads the references from, and composer-core, which is a workspace
 * package and carries no version of its own), plus the published dspack
 * packages by version. Tests and prose are not part of it.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO } from "../src/bench";

const SOURCE_ROOTS = ["packages/block-bench/live", "packages/block-bench/src", "packages/composer-core/src"];
const PACKAGES = ["@aestheticfunction/dspack-gen", "@aestheticfunction/dspack-emit"];
const SKIPPED_DIRS = new Set(["node_modules", "runs"]);

const isSource = (name: string) => /\.(ts|tsx|mts|mjs|js)$/.test(name) && !/\.test\.[a-z]+$/.test(name) && !/\.d\.[cm]?ts$/.test(name);

/** sha256 over every source file under the roots, by path and content, in a fixed order. */
export function sourceDigest(roots: readonly string[]): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile() && isSource(entry.name)) files.push(join(dir, entry.name));
    }
  };
  for (const root of roots) walk(root);
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(`${relative(REPO, file)}\0`);
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export interface CodeIdentity {
  sha256: string;
  packages: Record<string, string>;
}

export function codeIdentity(): CodeIdentity {
  const packages: Record<string, string> = {};
  for (const name of PACKAGES) {
    const manifest = JSON.parse(readFileSync(join(REPO, "packages/block-bench/node_modules", name, "package.json"), "utf8")) as { version?: unknown };
    packages[name] = String(manifest.version);
  }
  return { sha256: sourceDigest(SOURCE_ROOTS.map((root) => join(REPO, root))), packages };
}
