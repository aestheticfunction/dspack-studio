/**
 * Host actions, H2 (docs/blocks/HOST-ACTIONS.md; docs/blocks/PHASE-2-RELEASE-PLAN.md,
 * §7): the per-surface action manifest the beta's Catalog export carries.
 *
 * It binds every action a surface's messages dispatch by surface and name. A
 * surface gets a block binding (block id, version, expansion identity,
 * declared actions, streaming policy) only when it verifiably IS its block's
 * expansion: its provenance, under an approved sidecar the build bundles,
 * re-expands to exactly the stored surface, and emits exactly the exported
 * messages, every action declared and every context empty. Anything else,
 * forged provenance and edited surfaces included, binds nothing: a surface
 * name plus an action name alone grants nothing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { emitSurface, loadProfile, type Profile } from "@aestheticfunction/dspack-emit";
import {
  ACTION_MANIFEST_VERSION,
  actionManifest,
  expandBlock,
  expansionDigest,
  loadBlocks,
  parseBlocksSidecar,
  sha256Hex,
  type ActionManifest,
  type LoadedBlocks,
  type ManifestReference,
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
const emit = (s: unknown) => emitSurface(s as never, contract as never, { profile }).messages as unknown[];
const messages = emit(surface);

/** The surface's name in the export: the accepted example's id. */
const NAME = "ex.chat-1";
const PRIMITIVE = "ex.chat-2";

/** A hand-built surface (no block) whose button id slugs to a block's action name. */
const primitive: Json = {
  dspackSurface: "0.1",
  system: contract.name,
  intent: example.intent,
  root: { component: "card", id: "auth-card", children: [{ component: "button", id: "auth-submit", props: { label: "Sign in", variant: "primary" } }] },
};
const primitiveMessages = emit(primitive);

let digest: string;
let entry: Json;
let loaded: LoadedBlocks;
let references: ManifestReference[];

beforeAll(async () => {
  digest = await expansionDigest(surface);
  entry = {
    v: 1,
    reference: sidecar.reference,
    baseSha256: sidecar.baseSha256,
    block: "auth-form",
    version: 1,
    intent: example.intent,
    blockSchemaSha256: "a".repeat(64),
    encoding: "named",
    call: example.call,
    expansionDigest: digest,
  };
  loaded = await loadBlocks(rawSidecar, { baseContract: contract, profile });
  references = [{ loaded, contract, profile }];
});

/** The export of one accepted block surface and one primitive surface, with provenance for the first. */
const input = (overrides: Json = {}) => ({
  surfaces: [
    { name: NAME, messages },
    { name: PRIMITIVE, messages: primitiveMessages },
  ],
  examples: [
    { id: NAME, surface },
    { id: PRIMITIVE, surface: primitive },
  ],
  provenance: { [NAME]: entry } as Record<string, unknown>,
  references,
  ...overrides,
});

const entryFor = (manifest: ActionManifest, name: string) => manifest.surfaces.find((s) => s.surface === name)!;
const bindsNothing = (manifest: ActionManifest, name: string) => {
  const found = entryFor(manifest, name);
  expect(found.block).toBeNull();
  expect(found.actions.length).toBeGreaterThan(0);
  expect(found.actions.every((a) => a.declared === false)).toBe(true);
};

describe("a surface that is its block's expansion", () => {
  it("binds each action it dispatches by surface and name, with the block id, version, expansion identity, declared actions and streaming policy", async () => {
    const manifest = await actionManifest(input());
    expect(manifest.v).toBe(ACTION_MANIFEST_VERSION);
    expect(entryFor(manifest, NAME)).toEqual({
      surface: NAME,
      surfaceId: "data_collection",
      messagesSha256: await sha256Hex(JSON.stringify(messages)),
      actions: [
        { name: "auth_provider_github", declared: true },
        { name: "auth_submit", declared: true },
      ],
      block: {
        id: "auth-form",
        version: 1,
        reference: sidecar.reference,
        baseSha256: sidecar.baseSha256,
        intent: example.intent,
        expansionDigest: digest,
        declaredActions: authForm.actions,
        streaming: "disable-actions-until-complete",
      },
    });
  });

  it("names are not capabilities: a primitive surface whose button id slugs to auth_submit binds nothing", async () => {
    const manifest = await actionManifest(input());
    expect(entryFor(manifest, PRIMITIVE)).toEqual({
      surface: PRIMITIVE,
      surfaceId: "data_collection",
      messagesSha256: await sha256Hex(JSON.stringify(primitiveMessages)),
      actions: [{ name: "auth_submit", declared: false }],
      block: null,
    });
  });

  it("lists every exported surface in the export's order, and none without messages", async () => {
    const manifest = await actionManifest(input({ surfaces: [{ name: PRIMITIVE, messages: primitiveMessages }, { name: "ex.refused" }, { name: NAME, messages }] }));
    expect(manifest.surfaces.map((s) => s.surface)).toEqual([PRIMITIVE, NAME]);
  });
});

describe("each entry pins the exact messages it describes", () => {
  it("messagesSha256 is the sha256 of the exported messages, so a host can tell an altered export from the one reviewed", async () => {
    const manifest = await actionManifest(input());
    for (const [name, list] of [[NAME, messages], [PRIMITIVE, primitiveMessages]] as const) {
      expect(entryFor(manifest, name).messagesSha256).toBe(await sha256Hex(JSON.stringify(list)));
    }
    const altered = structuredClone(messages) as Json[];
    altered.find((m) => m.updateComponents)!.updateComponents.components[0].text = "Altered";
    expect(await sha256Hex(JSON.stringify(altered))).not.toBe(entryFor(manifest, NAME).messagesSha256);
  });
});

describe("forged provenance grants no authority", () => {
  const forgeries: Array<[string, () => Json]> = [
    ["a real call filed against another surface's digest", () => ({ ...entry })],
    ["a version the sidecar does not have", () => ({ ...entry, version: 2 })],
    ["a reference the build does not bundle", () => ({ ...entry, reference: { ...sidecar.reference, version: "9.9.9" } })],
    ["a base the sidecar is not bound to", () => ({ ...entry, baseSha256: "0".repeat(64) })],
    ["a call with a slot for a password", () => ({ ...entry, call: { ...example.call, password: "hunter2" } })],
    ["a call that is not the one that made the surface", () => ({ ...entry, call: { ...example.call, title: "Something else" } })],
    ["an intent the block does not serve", () => ({ ...entry, intent: "record-collection" })],
    ["an encoding the beta does not write", () => ({ ...entry, encoding: "positional" })],
    ["an inert record", () => ({ block: "auth-form", version: 1, status: "inert" })],
    ["a record for another block", () => ({ ...entry, block: "guide-steps" })],
    ["a recorded digest that is not its call's expansion", () => ({ ...entry, expansionDigest: "f".repeat(64) })],
  ];

  it.each(forgeries)("%s: the primitive surface binds nothing", async (_name, forge) => {
    const record = forge();
    const forged = _name.startsWith("a real call") ? { ...record, expansionDigest: await expansionDigest(primitive) } : record;
    const manifest = await actionManifest(input({ provenance: { [PRIMITIVE]: forged, [NAME]: entry } }));
    bindsNothing(manifest, PRIMITIVE);
  });

  it.each(forgeries.slice(1))("%s: even the real block surface binds nothing", async (_name, forge) => {
    const manifest = await actionManifest(input({ provenance: { [NAME]: forge() } }));
    bindsNothing(manifest, NAME);
  });

  it("the real entry filed under a primitive surface's name binds nothing", async () => {
    const manifest = await actionManifest(input({ provenance: { [PRIMITIVE]: entry } }));
    bindsNothing(manifest, PRIMITIVE);
    bindsNothing(manifest, NAME);
  });

  it("a record reached only through the prototype is not the surface's", async () => {
    const manifest = await actionManifest(input({ provenance: Object.create({ [NAME]: entry }) }));
    bindsNothing(manifest, NAME);
  });

  it("an entry the stored surface does not match: provenance is a claim, the expansion is the proof", async () => {
    const manifest = await actionManifest(input({ examples: [{ id: NAME, surface: primitive }, { id: PRIMITIVE, surface: primitive }] }));
    bindsNothing(manifest, NAME);
  });

  it("a draft sidecar or a draft block binds nothing", async () => {
    const draftSidecar = await loadBlocks({ ...structuredClone(rawSidecar), status: "draft" }, { baseContract: contract, profile });
    bindsNothing(await actionManifest(input({ references: [{ loaded: draftSidecar, contract, profile }] })), NAME);

    const draftBlock = structuredClone(rawSidecar);
    draftBlock.blocks.find((b: Json) => b.id === "auth-form").status = "draft";
    const loadedDraft = await loadBlocks(draftBlock, { baseContract: contract, profile });
    bindsNothing(await actionManifest(input({ references: [{ loaded: loadedDraft, contract, profile }] })), NAME);
  });

  it("a block B0 disabled at load binds nothing, whatever its provenance says", async () => {
    const changed = structuredClone(rawSidecar);
    const auth = changed.blocks.find((b: Json) => b.id === "auth-form");
    auth.actions = auth.actions.filter((a: string) => a !== "auth_forgot");
    const disabled = await loadBlocks(changed, { baseContract: contract, profile });
    expect(disabled.disabled.map((d) => d.block)).toEqual(["auth-form"]);
    bindsNothing(await actionManifest(input({ references: [{ loaded: disabled, contract, profile }] })), NAME);
  });

  it("a block whose declaration misses a name its template emits binds nothing, even if H1 were bypassed at load", async () => {
    const auth = loaded.usable.find((b) => b.id === "auth-form")!;
    const bypassed: LoadedBlocks = { ...loaded, usable: loaded.usable.map((b) => (b === auth ? { ...auth, actions: auth.actions.filter((a) => a !== "auth_provider_github") } : b)) };
    const manifest = await actionManifest(input({ references: [{ loaded: bypassed, contract, profile }] }));
    bindsNothing(manifest, NAME);
  });

  it("no bundled reference: nothing binds, and nothing throws", async () => {
    const manifest = await actionManifest(input({ references: [] }));
    bindsNothing(manifest, NAME);
    bindsNothing(manifest, PRIMITIVE);
  });

  it("garbage in the provenance map binds nothing, and nothing throws", async () => {
    for (const junk of [null, 7, "auth-form", [], { ...entry, call: null }, { ...entry, reference: null }, { ...entry, expansionDigest: 7 }]) {
      bindsNothing(await actionManifest(input({ provenance: { [NAME]: junk } })), NAME);
    }
  });
});

describe("an edited surface recomputes its manifest from its messages", () => {
  it("a button added to an accepted block surface: no block binding, and the new action is listed, undeclared", async () => {
    const edited = structuredClone(surface);
    edited.root.children.push({ component: "button", id: "auth-delete-account", props: { label: "Delete account", variant: "secondary" } });
    const manifest = await actionManifest(input({ surfaces: [{ name: NAME, messages: emit(edited) }], examples: [{ id: NAME, surface: edited }] }));
    expect(entryFor(manifest, NAME)).toEqual({
      surface: NAME,
      surfaceId: "data_collection",
      messagesSha256: await sha256Hex(JSON.stringify(emit(edited))),
      actions: [
        { name: "auth_delete_account", declared: false },
        { name: "auth_provider_github", declared: false },
        { name: "auth_submit", declared: false },
      ],
      block: null,
    });
  });

  it("copy edited alone: the same actions, none of them bound", async () => {
    const edited = structuredClone(surface);
    edited.root.children[0].text = "Welcome back, admin";
    const manifest = await actionManifest(input({ surfaces: [{ name: NAME, messages: emit(edited) }], examples: [{ id: NAME, surface: edited }] }));
    bindsNothing(manifest, NAME);
    expect(entryFor(manifest, NAME).actions.map((a) => a.name)).toEqual(["auth_provider_github", "auth_submit"]);
  });

  it("messages that are not the stored surface's own emission bind nothing (a stale or altered export)", async () => {
    const manifest = await actionManifest(input({ surfaces: [{ name: NAME, messages: primitiveMessages }] }));
    bindsNothing(manifest, NAME);
  });
});

describe("undeclared actions and action context fail closed", () => {
  /** The verified messages with one component's action replaced. */
  const withAction = (action: Json) => {
    const altered = structuredClone(messages) as Json[];
    const components = altered.find((m) => m.updateComponents)!.updateComponents.components as Json[];
    const button = components.find((c) => c.action?.event?.name === "auth_submit")!;
    button.action = action;
    return altered;
  };

  it("an action the block does not declare binds nothing, and is listed undeclared", async () => {
    const manifest = await actionManifest(input({ surfaces: [{ name: NAME, messages: withAction({ event: { name: "auth_delete_everything", context: {} } }) }] }));
    bindsNothing(manifest, NAME);
    expect(entryFor(manifest, NAME).actions).toContainEqual({ name: "auth_delete_everything", declared: false });
  });

  it("a block action whose context would carry an entered value binds nothing", async () => {
    const manifest = await actionManifest(input({ surfaces: [{ name: NAME, messages: withAction({ event: { name: "auth_submit", context: { password: { path: "/password" } } } }) }] }));
    bindsNothing(manifest, NAME);
  });

  it("an action with no name binds nothing", async () => {
    const manifest = await actionManifest(input({ surfaces: [{ name: NAME, messages: withAction({ event: { context: {} } }) }] }));
    expect(entryFor(manifest, NAME).block).toBeNull();
  });

  it("two exported surfaces under one name bind nothing: a host could not tell them apart", async () => {
    const manifest = await actionManifest(input({ surfaces: [{ name: NAME, messages }, { name: NAME, messages }] }));
    expect(manifest.surfaces).toHaveLength(2);
    for (const found of manifest.surfaces) expect(found.block).toBeNull();
  });

  it("messages that name more than one surface report no single surfaceId, and bind nothing", async () => {
    const two = [...messages, ...emit({ ...surface, intent: "record-collection" })];
    const manifest = await actionManifest(input({ surfaces: [{ name: NAME, messages: two }] }));
    expect(entryFor(manifest, NAME).surfaceId).toBeNull();
    expect(entryFor(manifest, NAME).block).toBeNull();
  });
});
