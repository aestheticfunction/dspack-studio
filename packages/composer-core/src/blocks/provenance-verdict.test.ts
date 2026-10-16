/**
 * The provenance verdict (docs/blocks/PHASE-2-RELEASE-PLAN.md, §8; step 4):
 * what the beta's Preview says about a surface's block provenance. A surface
 * earns "made with block X vN" only by exact expansion identity: the record
 * is trusted against a bundled sidecar, its call re-expands to the digest it
 * recorded, and the surface is that expansion. Anything less is inert, with
 * the specific reason, and no label. The verdict states what a surface is;
 * it never carries an action or a grant.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadProfile, type Profile } from "@aestheticfunction/dspack-emit";
import {
  actionManifest,
  expandBlock,
  expansionDigest,
  loadBlocks,
  parseBlocksSidecar,
  parseProvenance,
  PROVENANCE_REASON_TEXT,
  provenanceVerdict,
  type LoadedBlocks,
  type ProvenanceVerdict,
} from "./index";

type Json = Record<string, any>;
const repo = (rel: string) => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));
const json = (rel: string) => JSON.parse(readFileSync(repo(rel), "utf8")) as Json;

const rawSidecar = json("apps/composer/experimental/blocks/astryx.blocks.json");
const contract = json("apps/composer/astryx-project/astryx.dspack.json");
const profile = loadProfile(json("apps/composer/astryx-project/astryx.profile.json") as never) as Profile;
const parsed = parseBlocksSidecar(rawSidecar);
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
const sidecar = parsed.sidecar;
const authForm = sidecar.blocks.find((b) => b.id === "auth-form")!;
const example = authForm.examples[0]!;
const expanded = expandBlock(authForm, example.call, { reference: sidecar.reference, intent: example.intent });
if (!expanded.ok) throw new Error(expanded.message);
const surface = expanded.surface as unknown as Json;

/** The same surface after a hand edit: no longer the expansion. */
const edited = structuredClone(surface);
edited.root.children[0].text = "Edited by hand";

let loaded: LoadedBlocks;
let record: Json;
const REFERENCE_PROJECT = { kind: "reference" as const, reference: sidecar.reference };

beforeAll(async () => {
  loaded = await loadBlocks(rawSidecar, { baseContract: contract, profile });
  record = {
    v: 1,
    reference: sidecar.reference,
    baseSha256: sidecar.baseSha256,
    block: "auth-form",
    version: 1,
    intent: example.intent,
    blockSchemaSha256: "a".repeat(64),
    encoding: "named",
    call: example.call,
    expansionDigest: await expansionDigest(surface),
  };
});

const verdict = (overrides: Partial<Parameters<typeof provenanceVerdict>[0]> = {}) =>
  provenanceVerdict({ record, surface, loaded: [loaded], project: REFERENCE_PROJECT, ...overrides });

describe("trusted provenance earns the label", () => {
  it("a reference project's accepted block surface is made with its block, and refinable", async () => {
    expect(await verdict()).toEqual({ block: "auth-form", version: 1, madeWith: true, status: "refinable" });
  });

  it("an Example session is a reference project too", async () => {
    expect(await verdict({ project: { kind: "reference", reference: sidecar.reference } })).toMatchObject({ madeWith: true, status: "refinable" });
  });
});

describe("only exact expansion identity earns the label", () => {
  it("edited: a surface changed after acceptance is inert, with no label; saving drops the record", async () => {
    expect(await verdict({ surface: edited })).toEqual({ block: "auth-form", version: 1, madeWith: false, status: "inert", reason: "edited" });
  });

  it("forged digest: a record that claims the edited surface's digest still cannot label it, because its call does not expand to it", async () => {
    const forged = { ...record, expansionDigest: await expansionDigest(edited) };
    expect(await verdict({ record: forged, surface: edited })).toEqual({ block: "auth-form", version: 1, madeWith: false, status: "inert", reason: "expansion" });
  });

  it("forged call: another valid call under the recorded digest does not expand to it", async () => {
    const forged = { ...record, call: { ...example.call, title: "Someone else's title" } };
    expect(await verdict({ record: forged })).toEqual({ block: "auth-form", version: 1, madeWith: false, status: "inert", reason: "expansion" });
  });

  it("forged or stale bindings: each is inert, with the specific reason", async () => {
    const cases: Array<[string, Json, string]> = [
      ["a reference this build does not bundle", { ...record, reference: { name: "Elsewhere", dspack: "0.4", version: "9.9.9" } }, "reference"],
      ["another base contract", { ...record, baseSha256: "0".repeat(64) }, "base"],
      ["a block this build does not bundle", { ...record, block: "auth-wizard" }, "block"],
      ["a version this build does not bundle", { ...record, version: 2 }, "version"],
      ["a call that fails B1", { ...record, call: { ...example.call, mode: "sign-ip" } }, "validation"],
      ["an intent the block does not declare", { ...record, intent: "record-collection" }, "validation"],
      ["the wrong encoding", { ...record, encoding: "positional" }, "validation"],
    ];
    for (const [what, forged, reason] of cases) {
      expect(await verdict({ record: forged }), what).toEqual({ block: forged.block, version: forged.version, madeWith: false, status: "inert", reason });
    }
  });

  it("a reference project only trusts provenance for its own reference", async () => {
    const shadcn = { name: "shadcn/ui", dspack: "0.4", version: "3.2.0" };
    expect(await verdict({ project: { kind: "reference", reference: shadcn } })).toMatchObject({ madeWith: false, status: "inert", reason: "reference" });
  });

  it("a sidecar that no longer binds to this build's base contract vouches for nothing", async () => {
    const moved: LoadedBlocks = { ...loaded, binding: "mismatch", usable: [] };
    expect(await verdict({ loaded: [moved] })).toMatchObject({ madeWith: false, status: "inert", reason: "base" });
  });

  it("a record already reduced to inert keeps its stated reason, or says it was stored inert; neither earns a label", async () => {
    expect(await verdict({ record: { block: "auth-form", version: 2, status: "inert", reason: "version" } })).toEqual({ block: "auth-form", version: 2, madeWith: false, status: "inert", reason: "version" });
    expect(await verdict({ record: { block: "auth-form", version: 1, status: "inert" } })).toEqual({ block: "auth-form", version: 1, madeWith: false, status: "inert", reason: "stored" });
    expect(await verdict({ record: { block: "auth-form", version: 1, status: "inert", reason: "grants-everything" } })).toMatchObject({ madeWith: false, reason: "stored" });
  });

  it("nothing to say about garbage: no verdict", async () => {
    for (const junk of [null, "x", 7, [], {}, { block: "auth-form" }, { version: 1 }, { block: 1, version: 1 }]) {
      expect(await verdict({ record: junk })).toBeNull();
    }
  });

  it("a missing surface is never the expansion", async () => {
    expect(await verdict({ surface: undefined })).toMatchObject({ madeWith: false, status: "inert", reason: "edited" });
  });
});

describe("imported, repository and unoffered provenance", () => {
  it("imported: the surface is still made with the block, but an imported project never refines from it", async () => {
    expect(await verdict({ project: { kind: "imported" } })).toEqual({ block: "auth-form", version: 1, madeWith: true, status: "unavailable", reason: "imported" });
  });

  it("a repository project never refines from it either", async () => {
    expect(await verdict({ project: { kind: "agent" } })).toEqual({ block: "auth-form", version: 1, madeWith: true, status: "unavailable", reason: "repository" });
  });

  it("an imported project's forged provenance is inert, not merely unavailable", async () => {
    expect(await verdict({ project: { kind: "imported" }, surface: edited })).toMatchObject({ madeWith: false, status: "inert", reason: "edited" });
  });

  it("a block this build does not offer (draft, or disabled at load) labels the surface but cannot refine it", async () => {
    const draftBlock: LoadedBlocks = { ...loaded, sidecar: { ...sidecar, blocks: sidecar.blocks.map((b) => (b.id === "auth-form" ? { ...b, status: "draft" as const } : b)) } };
    const draftSidecar: LoadedBlocks = { ...loaded, sidecar: { ...sidecar, status: "draft" } };
    const disabled: LoadedBlocks = { ...loaded, usable: loaded.usable.filter((b) => b.id !== "auth-form"), disabled: [{ block: "auth-form", issues: ["B0"] }] };
    for (const [what, l] of [["draft block", draftBlock], ["draft sidecar", draftSidecar], ["disabled at load", disabled]] as const) {
      expect(await verdict({ loaded: [l] }), what).toEqual({ block: "auth-form", version: 1, madeWith: true, status: "inert", reason: "not-offered" });
    }
  });
});

describe("provenance never grants action authority", () => {
  it("a verdict carries what the surface is, never an action, a declaration or a grant", async () => {
    const all: ProvenanceVerdict[] = [
      (await verdict())!,
      (await verdict({ surface: edited }))!,
      (await verdict({ project: { kind: "imported" } }))!,
      (await verdict({ record: { ...record, version: 2 } }))!,
    ];
    for (const v of all) {
      for (const key of Object.keys(v)) expect(["block", "version", "madeWith", "status", "reason"]).toContain(key);
      expect(JSON.stringify(v)).not.toMatch(/auth_submit|declared|action|grant|authori[sz]/i);
    }
  });

  it("the label does not bind actions: messages altered after the surface was labelled bind nothing in the manifest", async () => {
    const { emitSurface } = await import("@aestheticfunction/dspack-emit");
    const messages = emitSurface(surface as never, contract as never, { profile }).messages as Json[];
    const altered = structuredClone(messages);
    altered.find((m) => m.updateComponents)!.updateComponents.components[0].text = "Altered";
    expect(await verdict()).toMatchObject({ madeWith: true });
    const manifest = await actionManifest({
      surfaces: [{ name: "ex.chat-1", messages: altered }],
      examples: [{ id: "ex.chat-1", surface }],
      provenance: { "ex.chat-1": record },
      references: [{ loaded, contract, profile }],
    });
    expect(manifest.surfaces[0]!.block).toBeNull();
    expect(manifest.surfaces[0]!.actions.every((a) => a.declared === false)).toBe(true);
  });
});

describe("the words for every reason", () => {
  it("every inert and unavailable reason has plain text, in the AF voice", () => {
    const reasons = ["reference", "base", "block", "version", "validation", "expansion", "edited", "not-offered", "stored", "imported", "repository"];
    expect(Object.keys(PROVENANCE_REASON_TEXT).sort()).toEqual([...reasons].sort());
    for (const reason of reasons) {
      const text = PROVENANCE_REASON_TEXT[reason as keyof typeof PROVENANCE_REASON_TEXT];
      expect(text.length, reason).toBeGreaterThan(10);
      expect(text, reason).not.toMatch(/—/);
    }
  });
});

describe("parseProvenance keeps the reason it reduced a record for", () => {
  it("each record reduced to inert on import says why", async () => {
    const out = parseProvenance(
      {
        ok: record,
        reference: { ...record, reference: { name: "Elsewhere", dspack: "0.4", version: "9.9.9" } },
        base: { ...record, baseSha256: "0".repeat(64) },
        block: { ...record, block: "auth-wizard" },
        version: { ...record, version: 7 },
        validation: { ...record, call: { ...example.call, mode: "sign-ip" } },
      },
      [sidecar],
    );
    expect(out.ok).toEqual(record);
    expect(out.reference).toEqual({ block: "auth-form", version: 1, status: "inert", reason: "reference" });
    expect(out.base).toEqual({ block: "auth-form", version: 1, status: "inert", reason: "base" });
    expect(out.block).toEqual({ block: "auth-wizard", version: 1, status: "inert", reason: "block" });
    expect(out.version).toEqual({ block: "auth-form", version: 7, status: "inert", reason: "version" });
    expect(out.validation).toEqual({ block: "auth-form", version: 1, status: "inert", reason: "validation" });
  });

  it("an inert record keeps a known reason and drops any other text", () => {
    const out = parseProvenance(
      { a: { block: "auth-form", version: 2, status: "inert", reason: "version" }, b: { block: "auth-form", version: 1, status: "inert", reason: "<script>" } },
      [sidecar],
    );
    expect(out).toEqual({ a: { block: "auth-form", version: 2, status: "inert", reason: "version" }, b: { block: "auth-form", version: 1, status: "inert" } });
  });
});
