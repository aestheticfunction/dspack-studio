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
 * An entry may carry a `pin`: a deliberate hold at one upstream commit rather
 * than following a branch. A pin is a STRONGER claim than tracking, not a
 * weaker one — it asserts the exact bytes this repo was built against, is
 * verified by sha256 on every run, always reports how far behind the tracked
 * branch it sits, and carries an explicit removal condition. Staleness hides;
 * a pin announces itself. See docs/CONTRACT-PIN.md.
 *
 * Boring by design: node builtins + global fetch, one retry, no deps.
 * `--write` re-syncs local copies from canonical.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const RAW = "https://raw.githubusercontent.com/aestheticfunction/dspack";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

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
    source: `${RAW}/805732c154f0f214721c9934a450b0edb2656c99/examples/shadcn-ui.dspack.json`,
    note: "the shadcn contract — copy of the spec repo's source of truth",
    // A DELIBERATE PIN, not staleness. dspack main now carries the
    // 32-component production contract, but the shadcn renderers, the emit
    // profile and the scenario surfaces here were all built against the
    // 8-component v2.3.0 contract. Migrating before the emitter can represent
    // the production catalog would break catalog builds and scenario surfaces
    // rather than widen coverage. See docs/CONTRACT-PIN.md.
    pin: {
      ref: "805732c154f0f214721c9934a450b0edb2656c99",
      version: "2.3.0",
      // Teeth: a pinned ref must be immutable. If the bytes behind it change
      // (force-push, history rewrite, CDN mismatch), fail loudly rather than
      // quietly re-syncing to something this repo was never built for.
      sha256: "ca19f8410a97f2004cf1d6f6dd2d7542abccfbb5430b756e0ccdc1ee954c7bb7",
      tracks: `${RAW}/main/examples/shadcn-ui.dspack.json`,
      removeWhen:
        "the dspack-emit representation foundation lands and the profile migration completes — " +
        "the emitter must be able to represent the production catalog first",
      issue: "aestheticfunction/dspack-studio#48",
    },
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

/** A pinned ref must be immutable; report how far behind the tracked branch it sits. */
async function reportPin(entry, source) {
  const { pin } = entry;
  const actual = sha256(source);
  if (actual !== pin.sha256) {
    console.error(`TAMPERED ${entry.label}  the PINNED artifact itself changed`);
    console.error(`         ref      ${pin.ref}`);
    console.error(`         expected sha256 ${pin.sha256}`);
    console.error(`         actual   sha256 ${actual}`);
    console.error(`         a pinned commit must be immutable — investigate before re-syncing.`);
    return false;
  }
  let ahead = "unavailable";
  try {
    const head = await fetchSource(pin.tracks);
    ahead = head.equals(source)
      ? "none — main matches the pin; the pin can be lifted"
      : `main has moved (v${JSON.parse(head.toString()).version}, ${head.length} bytes vs pinned ${source.length})`;
  } catch {
    /* offline: the pin still verifies against its own hash */
  }
  console.log(`PINNED   ${entry.label}  v${pin.version} @ ${pin.ref.slice(0, 7)} (sha256 verified)`);
  console.log(`         upstream drift: ${ahead}`);
  console.log(`         NOT current production shadcn coverage — see docs/CONTRACT-PIN.md (${pin.issue})`);
  return true;
}

let drifted = 0;
for (const entry of MANIFEST) {
  const source = await fetchSource(entry.source);
  if (entry.pin && !(await reportPin(entry, source))) {
    drifted++;
    continue;
  }
  let local;
  try {
    local = readFileSync(entry.local);
  } catch {
    local = null;
  }
  if (local && source.equals(local)) {
    if (!entry.pin) console.log(`in sync  ${entry.label}`);
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
