#!/usr/bin/env node
/**
 * Contract-copy sync check (PHASE-NEXT P0), the dspack-gen check-sync
 * pattern verbatim: the studio deliberately carries byte-copies of the
 * canonical contracts in dspack/examples, and the price of copies is
 * silent drift — this script makes drift loud.
 *
 * THE INVARIANT: at every green commit on main, the canonical Astryx
 * contract in dspack and the consumed copy here are BYTE-IDENTICAL.
 * Repository synchronization is absolute byte equality; design-system
 * fidelity (documented `x-drift` divergences from the Astryx component
 * API) lives INSIDE the synchronized artifact and is checked separately
 * by drift-check.ts — the two must never be conflated.
 *
 * Contract-change merge protocol (the definition of done): canonical
 * change lands in dspack first; the consuming dspack-studio PR carries
 * the byte-copied file; sync checks are green in both repositories.
 *
 * Boring by design: node builtins + global fetch, one retry, no deps.
 * `--write` re-syncs local copies from canonical.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const MANIFEST = [
  {
    local: join(root, "astryx.dspack.json"),
    label: "astryx.dspack.json",
    source:
      "https://raw.githubusercontent.com/aestheticfunction/dspack/main/examples/astryx.dspack.json",
    note: "the Astryx contract — copy of the spec repo's source of truth",
  },
  {
    local: join(root, "shadcn-ui.dspack.json"),
    label: "shadcn-ui.dspack.json",
    source:
      "https://raw.githubusercontent.com/aestheticfunction/dspack/main/examples/shadcn-ui.dspack.json",
    note: "the shadcn contract — copy of the spec repo's source of truth",
  },
];

const write = process.argv.includes("--write");

async function fetchSource(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= 2) throw new Error(`fetching ${url}: ${error.message ?? error}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

let drifted = 0;
for (const entry of MANIFEST) {
  const source = await fetchSource(entry.source);
  let local;
  try {
    local = readFileSync(entry.local);
  } catch {
    local = null;
  }
  if (local && source.equals(local)) {
    console.log(`in sync  ${entry.label}`);
    continue;
  }
  if (write) {
    writeFileSync(entry.local, source);
    console.log(`SYNCED   ${entry.label}  <-  ${entry.source}`);
    console.log(`         rebuild catalogs (build:catalogs) before committing.`);
  } else {
    drifted++;
    console.error(`DRIFT    ${entry.label}  (${entry.note})`);
    console.error(`         differs from ${entry.source}`);
    console.error(`         canonical change lands in dspack first; then either`);
    console.error(`         node scripts/check-sync.mjs --write, or copy this file upstream via a dspack PR.`);
  }
}
if (drifted > 0) process.exit(1);
