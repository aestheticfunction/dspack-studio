/**
 * The contract-time ratchet for interface blocks (docs/BLOCKS.md, Phase 1A).
 *
 * Runs in `pnpm test`, so a contract, profile, sidecar or golden edit fails
 * loudly here rather than at a flagged build. For every draft block on every
 * packaged reference:
 *   1. each example's expansion equals its hand-expanded golden, byte for byte;
 *   2. that surface, played through the REAL runPipeline under the reference
 *      profile exactly as hosted-build.ts runs it, passes at attempt 0 with no
 *      representability refusal and every A-gate green on A2UI 0.9.1 and 1.0;
 *   3. the emitted action names are a subset of the block's declared actions;
 *   4. boundary calls (minimum and maximum items, optional props omitted and
 *      present) satisfy B1 and B2 and survive the same pipeline;
 *   5. the sidecar binds to the packaged base (its baseSha256 equals the
 *      current digest), and a corrupted template or a B0 drift fails closed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProfile } from "@aestheticfunction/dspack-emit";
import { runPipeline, ScriptedAdapter } from "@aestheticfunction/dspack-gen/browser";
import {
  checkActions,
  checkConstraints,
  emitCheck,
  expandBlock,
  loadBlocks,
  parseBlocksSidecar,
  rootScope,
  specAtPath,
  validateCall,
} from "@dspack-studio/composer-core/blocks";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const json = (rel) => JSON.parse(read(rel));

const REFERENCES = {
  "shadcn-v3": {
    sidecar: "../experimental/blocks/shadcn-v3.blocks.json",
    contract: "../shadcn-v3-project/shadcn-ui.dspack.json",
    profile: "../shadcn-v3-project/shadcn-v3.profile.json",
  },
  astryx: {
    sidecar: "../experimental/blocks/astryx.blocks.json",
    contract: "../astryx-project/astryx.dspack.json",
    profile: "../astryx-project/astryx.profile.json",
  },
};

const golden = (ref, block, example) => read(`../../../packages/block-bench/goldens/${ref}/${block}.${example}.dsurface.json`);

/** The pipeline exactly as hosted-build.ts runs it, with the surface preloaded. */
async function pipelinePasses(surface, contract, profile, intent) {
  const { report } = await runPipeline({
    contract,
    intent,
    prompt: "ratchet",
    adapter: new ScriptedAdapter([{ output: surface }]),
    maxRepairs: 0,
    emitProfile: profile,
    now: () => new Date(0),
  });
  const gates = (report.emitted?.validations ?? []).flatMap((v) => v.gates.map((g) => `${v.a2uiVersion} ${g.gate} ${g.pass ? "PASS" : "FAIL"}`));
  return {
    outcome: report.outcome,
    attempts: report.attempts.length,
    representability: report.attempts[0]?.representability,
    versions: (report.emitted?.validations ?? []).map((v) => v.a2uiVersion),
    failedGates: gates.filter((g) => g.endsWith("FAIL")),
  };
}

/** A string at a prop's minimum or maximum length, read from the signature. */
function str(block, path, bound) {
  const spec = specAtPath(rootScope(block), path, true);
  if (!spec || spec.type !== "string") throw new Error(`${block.id}: ${path} is not a string prop`);
  return "x".repeat(bound === "min" ? Math.max(spec.minLength ?? 1, 1) : spec.maxLength);
}
const count = (block, path, bound) => {
  const spec = specAtPath(rootScope(block), path, true);
  if (!spec || spec.type !== "array") throw new Error(`${block.id}: ${path} is not an array prop`);
  return bound === "min" ? Math.max(spec.minItems ?? 1, 1) : spec.maxItems;
};
const values = (block, path) => specAtPath(rootScope(block), path, true)?.items?.values ?? [];
const integer = (block, path, bound) => {
  const spec = specAtPath(rootScope(block), path, true);
  return bound === "min" ? spec.minimum : spec.maximum;
};

/**
 * Boundary calls, hand-shaped per block so the cross-field constraints hold
 * (equal-length columns/cells; the auth-form mode rules), with every length
 * and count taken from the signature itself.
 */
const BOUNDARY = {
  "records-table": {
    min: (b) => ({ block: b.id, version: b.version, title: str(b, "title", "min"), caption: str(b, "caption", "min"), columns: ["c"], rows: [{ cells: ["x"] }] }),
    max: (b) => {
      const n = count(b, "columns", "max");
      return {
        block: b.id,
        version: b.version,
        title: str(b, "title", "max"),
        caption: str(b, "caption", "max"),
        columns: Array.from({ length: n }, (_, i) => `${str(b, "columns.*", "max").slice(2)}c${i}`),
        rows: Array.from({ length: count(b, "rows", "max") }, (_, r) => ({
          cells: Array.from({ length: n }, (_, c) => `r${r}c${c}`),
          tone: values(b, "rows")[0] === undefined ? undefined : specAtPath(rootScope(b), "rows.*.tone")?.values?.[0],
        })),
        statusColumn: integer(b, "statusColumn", "max"),
        description: str(b, "description", "max"),
        actions: values(b, "actions"),
      };
    },
  },
  "auth-form": {
    min: (b) => ({ block: b.id, version: b.version, mode: "reset", title: str(b, "title", "min"), fields: ["email"] }),
    max: (b) => ({
      block: b.id,
      version: b.version,
      mode: "sign-up",
      title: str(b, "title", "max"),
      fields: values(b, "fields"),
      intro: str(b, "intro", "max"),
      providers: values(b, "providers"),
      recovery: true,
    }),
  },
  "guide-steps": {
    min: (b) => ({ block: b.id, version: b.version, title: str(b, "title", "min"), steps: ["Do the thing."] }),
    max: (b) => ({
      block: b.id,
      version: b.version,
      title: str(b, "title", "max"),
      steps: Array.from({ length: count(b, "steps", "max") }, (_, i) => `Step ${i + 1}: ${str(b, "steps.*", "max").slice(0, 20)}`),
      summary: str(b, "summary", "max"),
      items: Array.from({ length: count(b, "items", "max") }, (_, i) => `item ${i + 1}`),
      itemsHeading: str(b, "itemsHeading", "max"),
      meta: Array.from({ length: count(b, "meta", "max") }, (_, i) => ({ label: `label ${i}`, detail: `detail ${i}` })),
      actions: values(b, "actions"),
    }),
  },
};

for (const [ref, paths] of Object.entries(REFERENCES)) {
  const contract = json(paths.contract);
  const profile = loadProfile(json(paths.profile));
  const raw = json(paths.sidecar);
  const parsed = parseBlocksSidecar(raw);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const sidecar = parsed.sidecar;

  describe(`blocks ratchet: ${ref}`, () => {
    it("the sidecar binds to the packaged base and every block passes B0", async () => {
      const loaded = await loadBlocks(raw, { baseContract: contract, profile });
      expect(loaded.binding).toBe("ok");
      expect(loaded.disabled).toEqual([]);
      expect(loaded.usable.length).toBe(sidecar.blocks.length);
    });

    for (const block of sidecar.blocks) {
      for (const example of block.examples) {
        it(`${block.id} / ${example.id}: expansion equals its golden, and passes the real pipeline at attempt 0`, async () => {
          const expanded = expandBlock(block, example.call, { reference: sidecar.reference, intent: example.intent });
          if (!expanded.ok) throw new Error(`${expanded.path}: ${expanded.message}`);
          expect(JSON.stringify(expanded.surface, null, 2) + "\n").toBe(golden(ref, block.id, example.id));

          const emitted = emitCheck(expanded.surface, contract, profile);
          if (!emitted.ok) throw new Error(emitted.refusal);
          expect(checkActions(block, emitted.actions)).toEqual([]);

          const run = await pipelinePasses(expanded.surface, contract, profile, example.intent);
          expect(run).toEqual({ outcome: "passed", attempts: 1, representability: undefined, versions: ["0.9.1", "1.0"], failedGates: [] });
        });
      }

      for (const bound of ["min", "max"]) {
        it(`${block.id} / ${bound} boundary call: B1 and B2 hold, and the expansion passes the real pipeline`, async () => {
          const call = BOUNDARY[block.id][bound](block);
          for (const key of Object.keys(call)) if (call[key] === undefined) delete call[key];
          expect(validateCall(block, call)).toEqual([]);
          expect(checkConstraints(block, call)).toEqual([]);
          const intent = block.intents[0];
          const expanded = expandBlock(block, call, { reference: sidecar.reference, intent });
          if (!expanded.ok) throw new Error(`${expanded.path}: ${expanded.message}`);
          const emitted = emitCheck(expanded.surface, contract, profile);
          if (!emitted.ok) throw new Error(emitted.refusal);
          expect(checkActions(block, emitted.actions)).toEqual([]);
          const run = await pipelinePasses(expanded.surface, contract, profile, intent);
          expect(run).toEqual({ outcome: "passed", attempts: 1, representability: undefined, versions: ["0.9.1", "1.0"], failedGates: [] });
        });
      }
    }

    it("a corrupted template fails closed at parse; a B0 drift disables only that block", async () => {
      const corrupted = structuredClone(raw);
      corrupted.blocks[0].template = { component: "card", id: "c", children: [{ "$each": "nope", as: "n", children: [] }] };
      expect(parseBlocksSidecar(corrupted).ok).toBe(false);

      const drifted = structuredClone(raw);
      drifted.blocks[0].template = { component: "not-a-component", id: "c" };
      const loaded = await loadBlocks(drifted, { baseContract: contract, profile });
      expect(loaded.binding).toBe("ok");
      expect(loaded.disabled.map((d) => d.block)).toEqual([raw.blocks[0].id]);
      expect(loaded.usable.length).toBe(sidecar.blocks.length - 1);
    });
  });
}
