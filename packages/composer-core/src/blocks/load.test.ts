/**
 * Loading a sidecar for use (Phase 1A): binding, B0, the emit check and B2's
 * action allowlist. Every probe here must fail closed, and the drafts must
 * load clean against their packaged reference.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProfile, type Profile } from "@aestheticfunction/dspack-emit";
import {
  b0Issues,
  checkActions,
  emitCheck,
  expandBlock,
  generationView,
  loadBlocks,
  parseBlocksSidecar,
  type BlockDefinition,
  type BlocksSidecar,
} from "./index";

type Json = Record<string, any>;
const repo = (rel: string) => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));
const json = (rel: string) => JSON.parse(readFileSync(repo(rel), "utf8")) as Json;

const REFS = {
  "shadcn-v3": {
    sidecar: "apps/composer/experimental/blocks/shadcn-v3.blocks.json",
    contract: "apps/composer/shadcn-v3-project/shadcn-ui.dspack.json",
    profile: "apps/composer/shadcn-v3-project/shadcn-v3.profile.json",
  },
  astryx: {
    sidecar: "apps/composer/experimental/blocks/astryx.blocks.json",
    contract: "apps/composer/astryx-project/astryx.dspack.json",
    profile: "apps/composer/astryx-project/astryx.profile.json",
  },
} as const;

const inputs = (ref: keyof typeof REFS) => ({
  sidecar: json(REFS[ref].sidecar),
  contract: json(REFS[ref].contract),
  profile: loadProfile(json(REFS[ref].profile) as never) as Profile,
});

function parsed(raw: Json): BlocksSidecar {
  const result = parseBlocksSidecar(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.sidecar;
}

/** A copy of a draft block with its template replaced. */
function withTemplate(ref: keyof typeof REFS, blockId: string, template: unknown): BlockDefinition {
  const block = parsed(inputs(ref).sidecar).blocks.find((b) => b.id === blockId)!;
  return { ...block, template: template as never };
}

describe("loadBlocks: the drafts load clean against their packaged reference", () => {
  for (const ref of Object.keys(REFS) as Array<keyof typeof REFS>) {
    it(`${ref}: binding ok, every block usable`, async () => {
      const { sidecar, contract, profile } = inputs(ref);
      const loaded = await loadBlocks(sidecar, { baseContract: contract, profile });
      expect(loaded.binding).toBe("ok");
      expect(loaded.disabled).toEqual([]);
      expect(loaded.usable.map((b) => b.id)).toEqual(["records-table", "auth-form", "guide-steps"]);
    });
  }

  it("a base contract that moved disables every block (never silently partial)", async () => {
    const { sidecar, contract, profile } = inputs("astryx");
    const moved = { ...contract, description: `${contract.description ?? ""} (edited)` };
    const loaded = await loadBlocks(sidecar, { baseContract: moved, profile });
    expect(loaded.binding).toBe("mismatch");
    expect(loaded.usable).toEqual([]);
  });

  it("an invalid sidecar loads nothing and says why", async () => {
    const { contract, profile } = inputs("astryx");
    const loaded = await loadBlocks({ blocksSidecar: "9.9" }, { baseContract: contract, profile });
    expect(loaded.binding).toBe("invalid");
    expect(loaded.usable).toEqual([]);
    expect(loaded.issues.length).toBeGreaterThan(0);
  });

  it("a B0 failure disables that block only, with its reasons", async () => {
    const { sidecar, contract, profile } = inputs("shadcn-v3");
    const drifted = structuredClone(sidecar);
    drifted.blocks[1].template = { component: "tooltip", id: "x" };
    const loaded = await loadBlocks(drifted, { baseContract: contract, profile });
    expect(loaded.binding).toBe("ok");
    expect(loaded.usable.map((b) => b.id)).toEqual(["records-table", "guide-steps"]);
    expect(loaded.disabled).toEqual([expect.objectContaining({ block: "auth-form" })]);
    expect(loaded.disabled[0]!.issues.join(" ")).toMatch(/tooltip/);
  });
});

describe("B0: a template may emit only what generation could emit under the same profile", () => {
  const view = (ref: keyof typeof REFS) => {
    const { contract, profile } = inputs(ref);
    return generationView(contract, profile);
  };
  const issues = (ref: keyof typeof REFS, template: unknown) => b0Issues(withTemplate(ref, "auth-form", template), view(ref)).join("\n");

  it("a casualty component (in the contract, refused under the profile)", () => {
    expect(issues("shadcn-v3", { component: "card", id: "c", children: [{ component: "pagination", id: "p" }] })).toMatch(/pagination/);
  });
  it("a component the contract does not have", () => {
    expect(issues("astryx", { component: "carousel", id: "c" })).toMatch(/carousel/);
  });
  it("a prop the component does not declare", () => {
    expect(issues("astryx", { component: "button", id: "b", props: { label: "x", glow: true } })).toMatch(/glow/);
  });
  it("props on a component or sub-component that declares none", () => {
    expect(issues("shadcn-v3", { component: "table", id: "t", props: { dense: true } })).toMatch(/table.*no props/);
  });
  it("a literal enum value the contract does not allow", () => {
    expect(issues("astryx", { component: "text", id: "t", props: { type: "headline" }, text: "x" })).toMatch(/headline/);
  });
  it("a $case result the enum does not allow", () => {
    expect(issues("astryx", { component: "text", id: "t", props: { type: { $case: "mode", map: { "sign-in": "body", "sign-up": "huge", reset: "body" } } }, text: "x" })).toMatch(/huge/);
  });
  it("an enum prop fed by a block enum with values the contract does not allow", () => {
    expect(issues("astryx", { component: "text", id: "t", props: { type: { $prop: "mode" } }, text: "x" })).toMatch(/sign-in/);
  });
  it("a join-id component without an id", () => {
    expect(issues("shadcn-v3", { component: "tabs", id: "t", children: [{ component: "tabs-trigger", text: "One" }] })).toMatch(/tabs-trigger.*id/);
  });
  it("the drafts themselves have no B0 issues", () => {
    for (const ref of Object.keys(REFS) as Array<keyof typeof REFS>) {
      const { sidecar } = inputs(ref);
      for (const block of parsed(sidecar).blocks) expect(b0Issues(block, view(ref))).toEqual([]);
    }
  });
});

describe("emitCheck and B2's action allowlist", () => {
  it("every draft example emits, and dispatches only its declared actions", () => {
    for (const ref of Object.keys(REFS) as Array<keyof typeof REFS>) {
      const { sidecar, contract, profile } = inputs(ref);
      const loadedSidecar = parsed(sidecar);
      for (const block of loadedSidecar.blocks) {
        for (const example of block.examples) {
          const expanded = expandBlock(block, example.call, { reference: loadedSidecar.reference, intent: example.intent });
          if (!expanded.ok) throw new Error(expanded.message);
          const emitted = emitCheck(expanded.surface, contract, profile);
          if (!emitted.ok) throw new Error(emitted.refusal);
          expect(checkActions(block, emitted.actions)).toEqual([]);
        }
      }
    }
  });

  it("an action the block does not declare is a B2 issue", () => {
    const block = parsed(inputs("astryx").sidecar).blocks.find((b) => b.id === "auth-form")!;
    expect(checkActions(block, ["auth_submit", "auth_delete_everything"])).toEqual([
      { path: "actions", message: "emitted action 'auth_delete_everything' is not declared by auth-form" },
    ]);
  });

  it("a surface the emitter refuses is reported, never thrown", () => {
    const { contract, profile } = inputs("shadcn-v3");
    const refused = emitCheck({ dspackSurface: "0.1", system: contract.name, intent: "record-collection", root: { component: "card", id: "c" } }, contract, profile);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.refusal).toMatch(/child/);
  });
});
