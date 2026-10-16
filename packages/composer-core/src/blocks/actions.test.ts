/**
 * Host actions, H1 (docs/blocks/HOST-ACTIONS.md; docs/blocks/PHASE-2-RELEASE-PLAN.md,
 * §7): B0 proves the action allowlist at load. Every node the profile gives
 * an action carries an id built only from literals and enum props, so the
 * model can never coin an action name, and the names a template can emit
 * equal the block's declared `actions`, exactly. A block that fails either
 * rule is disabled at load, like any other B0 failure.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emitSurface, loadProfile, type Profile } from "@aestheticfunction/dspack-emit";
import {
  actionComponents,
  actionEvents,
  b0Issues,
  checkConstraints,
  emitCheck,
  expandBlock,
  generationView,
  loadBlocks,
  parseBlocksSidecar,
  templateActionNames,
  validateCall,
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
type Ref = keyof typeof REFS;
const REF_IDS = Object.keys(REFS) as Ref[];

const inputs = (ref: Ref) => ({
  sidecar: json(REFS[ref].sidecar),
  contract: json(REFS[ref].contract),
  profile: loadProfile(json(REFS[ref].profile) as never) as Profile,
});

function parsed(raw: Json): BlocksSidecar {
  const result = parseBlocksSidecar(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.sidecar;
}

const blockOf = (ref: Ref, id: string): BlockDefinition => parsed(inputs(ref).sidecar).blocks.find((b) => b.id === id)!;

/** The §7 table: the names each block can dispatch, the same on both references. */
const TABLE: Record<string, string[]> = {
  "records-table": ["records_create", "records_export", "records_refresh"],
  "auth-form": ["auth_forgot", "auth_provider_apple", "auth_provider_github", "auth_provider_google", "auth_provider_microsoft", "auth_submit"],
  "guide-steps": ["guide_save", "guide_start"],
};

const surfaceOf = (contract: Json, intent: string, root: Json) => ({ dspackSurface: "0.1", system: contract.name, intent, root });

describe("actionComponents: the nodes the emitter gives an action, read from the profile", () => {
  it("Astryx (profile language v1) and shadcn/ui v3 (v2): buttons and alert dialogs", () => {
    expect([...actionComponents(inputs("astryx").profile)].sort()).toEqual(["alert-dialog", "button"]);
    expect([...actionComponents(inputs("shadcn-v3").profile)].sort()).toEqual(["alert-dialog", "button"]);
  });

  it("with no profile, the emitter's own default, as emitSurface falls back to it", () => {
    expect([...actionComponents()].sort()).toEqual(["alert-dialog", "button"]);
  });

  it("the generation view carries them, so B0 holds every template to them", () => {
    for (const ref of REF_IDS) {
      const { contract, profile } = inputs(ref);
      expect(generationView(contract, profile).actionComponents).toEqual(actionComponents(profile));
    }
  });

  it("the hazard H1 closes: an action node without an id is named from its text, which a model may write", () => {
    const { contract, profile } = inputs("shadcn-v3");
    const card = (button: Json) => ({ component: "card", id: "c", children: [{ component: "card-content", id: "cc", children: [button] }] });
    const named = emitCheck(surfaceOf(contract, "structured-input", card({ component: "button", id: "auth-submit", text: "Sign in" })), contract, profile);
    const unnamed = emitCheck(surfaceOf(contract, "structured-input", card({ component: "button", text: "Delete everything" })), contract, profile);
    expect(named).toEqual({ ok: true, actions: ["auth_submit"] });
    expect(unnamed).toEqual({ ok: true, actions: ["delete_everything"] });
  });
});

describe("H1 at load: an action id is built only from literals and enum props", () => {
  const view = (ref: Ref) => generationView(inputs(ref).contract, inputs(ref).profile);
  /** auth-form on Astryx with its template replaced and, when given, its actions and props. */
  const auth = (template: Json, overrides: Partial<BlockDefinition> = {}): BlockDefinition => ({ ...blockOf("astryx", "auth-form"), template: template as never, ...overrides });
  const card = (...children: Json[]) => ({ component: "card", id: "auth-card", children });
  const submit = (id: unknown) => ({ component: "button", id, props: { label: "Go", variant: "primary" } });
  const issues = (block: BlockDefinition) => b0Issues(block, view("astryx")).join("\n");

  it("a button whose id is a string the model fills: the model would coin its action", () => {
    expect(issues(auth(card(submit({ $prop: "title" })), { actions: ["auth_submit"] }))).toMatch(/'title' is a string the model fills/);
  });

  it("a button with no id: the emitter would name its action from its text or its component", () => {
    expect(issues(auth(card({ component: "button", props: { label: "Go", variant: "primary" } }), { actions: ["auth_submit"] }))).toMatch(
      /'button' dispatches an action, so it needs an id/,
    );
  });

  it("a $concat with a part the model fills", () => {
    expect(issues(auth(card(submit({ $concat: ["auth-", { $prop: "title" }] })), { actions: ["auth_submit"] }))).toMatch(/'title' is a string the model fills/);
  });

  it("an id from a position ($index): a count, not a literal or an enum", () => {
    const template = card({ $each: "fields", as: "field", children: [submit({ $concat: ["auth-", { $index: "field" }] })] });
    expect(issues(auth(template, { actions: ["auth_1"] }))).toMatch(/\$index/);
  });

  it("an id that is not a string", () => {
    expect(issues(auth(card(submit(7)), { actions: ["auth_submit"] }))).toMatch(/not a string/);
  });

  it("an optional enum prop with no default: the id could be missing, and the name with it", () => {
    const props = [...blockOf("astryx", "auth-form").props, { name: "variant", type: "enum" as const, values: ["submit", "next"] }];
    expect(issues(auth(card(submit({ $concat: ["auth-", { $prop: "variant" }] })), { props, actions: ["auth_next", "auth_submit"] }))).toMatch(/'variant' may be absent/);
    // A default makes it total: every call names an action the template declares.
    expect(issues(auth(card(submit({ $concat: ["auth-", { $prop: "variant", default: "submit" }] })), { props, actions: ["auth_next", "auth_submit"] }))).toBe("");
  });

  it("a $case over an enum, onto literal ids, is bounded, and each result is a name", () => {
    const id = { $case: "mode", map: { "sign-in": "auth-sign-in", "sign-up": "auth-sign-up", reset: "auth-reset" } };
    expect(issues(auth(card(submit(id)), { actions: ["auth_reset", "auth_sign_in", "auth_sign_up"] }))).toBe("");
    expect(templateActionNames(auth(card(submit(id))), view("astryx").actionComponents).names).toEqual(["auth_reset", "auth_sign_in", "auth_sign_up"]);
  });

  it("the names must equal the declaration: a name the template can emit but does not declare fails at load", () => {
    const block = blockOf("astryx", "auth-form");
    expect(issues({ ...block, actions: block.actions.filter((a) => a !== "auth_forgot") })).toMatch(/can emit 'auth_forgot', which is not declared/);
  });

  it("and a declared name that no node can emit fails at load", () => {
    const block = blockOf("astryx", "auth-form");
    expect(issues({ ...block, actions: [...block.actions, "auth_logout"] })).toMatch(/'auth_logout' is declared, but no node of the template can emit it/);
  });

  it("a name declared twice", () => {
    const block = blockOf("astryx", "auth-form");
    expect(issues({ ...block, actions: [...block.actions, "auth_submit"] })).toMatch(/'auth_submit' is declared more than once/);
  });

  it("an id whose combinations would make an unbounded list of names", () => {
    const props = [
      ...blockOf("astryx", "auth-form").props,
      ...["a", "b", "c"].map((name) => ({ name, required: true, type: "enum" as const, values: Array.from({ length: 10 }, (_, i) => `${name}${i}`) })),
    ];
    // 10 × 10 × 10 ids: past the cap, a declaration could not be read or reviewed.
    const id = { $concat: ["auth-", { $prop: "a" }, "-", { $prop: "b" }, "-", { $prop: "c" }] };
    expect(issues(auth(card(submit(id)), { props, actions: ["auth_submit"] }))).toMatch(/more than 256 possible names/);
  });

  it("only action nodes are held to it: a badge numbered by position stays fine", () => {
    const template = card(submit("auth-submit"), { $each: "fields", as: "field", children: [{ component: "badge", id: { $concat: ["auth-badge-", { $index: "field" }] }, text: "x" }] });
    expect(issues(auth(template, { actions: ["auth_submit"] }))).toBe("");
  });

  it("an alert dialog dispatches an action too, and is held to the same rule", () => {
    expect(issues(auth(card({ component: "alert-dialog" }), { actions: ["auth_submit"] }))).toMatch(/'alert-dialog' dispatches an action, so it needs an id/);
  });
});

describe("H1 on the shipped sidecars: the names each template can emit are the §7 table, and equal its declaration", () => {
  for (const ref of REF_IDS) {
    it(ref, () => {
      const { sidecar, profile } = inputs(ref);
      const components = actionComponents(profile);
      for (const block of parsed(sidecar).blocks) {
        const { names, issues } = templateActionNames(block, components);
        expect(issues, block.id).toEqual([]);
        expect(names, block.id).toEqual(TABLE[block.id]);
        expect([...block.actions].sort(), block.id).toEqual(TABLE[block.id]);
      }
    });
  }
});

describe("loadBlocks: a block whose action names differ from its declaration is disabled at load", () => {
  it("one name fewer declared disables that block only, with the H1 reason", async () => {
    const { sidecar, contract, profile } = inputs("astryx");
    const changed = structuredClone(sidecar);
    const auth = changed.blocks.find((b: Json) => b.id === "auth-form");
    auth.actions = auth.actions.filter((a: string) => a !== "auth_forgot");
    const loaded = await loadBlocks(changed, { baseContract: contract, profile });
    expect(loaded.binding).toBe("ok");
    expect(loaded.usable.map((b) => b.id)).toEqual(["records-table", "guide-steps"]);
    expect(loaded.disabled.map((d) => d.block)).toEqual(["auth-form"]);
    expect(loaded.disabled[0]!.issues.join(" ")).toMatch(/auth_forgot/);
  });

  it("a template edited so the model fills a button id is disabled at load", async () => {
    const { sidecar, contract, profile } = inputs("shadcn-v3");
    const changed = structuredClone(sidecar);
    const guide = changed.blocks.find((b: Json) => b.id === "guide-steps");
    const walk = (node: Json): void => {
      if (node.component === "button") node.id = { $concat: ["guide-", { $prop: "title" }] };
      for (const child of node.children ?? []) walk(child);
    };
    walk(guide.template);
    const loaded = await loadBlocks(changed, { baseContract: contract, profile });
    expect(loaded.usable.map((b) => b.id)).toEqual(["records-table", "auth-form"]);
    expect(loaded.disabled[0]!.issues.join(" ")).toMatch(/'title' is a string the model fills/);
  });
});

/** auth-form's largest call: every field and provider, recovery on. */
const fullAuthCall = (block: BlockDefinition): Json => ({
  block: block.id,
  version: block.version,
  mode: "sign-up",
  title: "Create your account",
  fields: block.props.find((p) => p.name === "fields")!.items!.values!,
  intro: "Use your work email.",
  providers: block.props.find((p) => p.name === "providers")!.items!.values!,
  recovery: true,
});

describe("what the emitter dispatches: names within H1's, and an empty context", () => {
  for (const ref of REF_IDS) {
    it(`${ref}: every example dispatches only names H1 proved, each with an empty context`, () => {
      const { sidecar, contract, profile } = inputs(ref);
      const loaded = parsed(sidecar);
      const components = actionComponents(profile);
      for (const block of loaded.blocks) {
        const allowed = templateActionNames(block, components).names;
        for (const example of block.examples) {
          const expanded = expandBlock(block, example.call, { reference: loaded.reference, intent: example.intent });
          if (!expanded.ok) throw new Error(expanded.message);
          const events = actionEvents(emitSurface(expanded.surface as never, contract as never, { profile }).messages);
          expect(events.length, `${block.id}/${example.id}`).toBeGreaterThan(0);
          for (const event of events) {
            expect(allowed, `${block.id}/${example.id}`).toContain(event.name);
            expect(event.context, `${block.id}/${example.id}`).toEqual({});
          }
        }
      }
    });

    it(`${ref}: auth-form actions carry an empty context, even for its largest call: no credential or entered value can ride along`, () => {
      const { sidecar, contract, profile } = inputs(ref);
      const loaded = parsed(sidecar);
      const block = loaded.blocks.find((b) => b.id === "auth-form")!;
      const call = fullAuthCall(block);
      expect(validateCall(block, call)).toEqual([]);
      expect(checkConstraints(block, call)).toEqual([]);
      const expanded = expandBlock(block, call, { reference: loaded.reference, intent: block.intents[0]! });
      if (!expanded.ok) throw new Error(expanded.message);
      const messages = emitSurface(expanded.surface as never, contract as never, { profile }).messages as Json[];
      const events = actionEvents(messages);
      expect(events.map((e) => e.name).sort()).toEqual(TABLE["auth-form"]);
      for (const event of events) expect(Reflect.ownKeys(event.context as object)).toEqual([]);
      // No field is bound to a data model, so an action has nothing to sync: typed text stays in the page.
      const bound: unknown[] = [];
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") {
          if ("path" in value) bound.push(value);
          Object.values(value).forEach(walk);
        }
      };
      walk(messages);
      expect(bound).toEqual([]);
      expect(messages.flatMap((m) => Object.keys(m)).sort()).toEqual(["createSurface", "updateComponents", "version", "version"]);
    });
  }

  it("actionEvents reads every event, whatever else the messages hold", () => {
    const messages = [
      { version: "v0.9", createSurface: { surfaceId: "s" } },
      { version: "v0.9", updateComponents: { surfaceId: "s", components: [{ id: "a", action: { event: { name: "x_one", context: {} } } }, { id: "b", nested: [{ action: { event: { name: "x_two", context: { k: 1 } } } }] }] } },
    ];
    expect(actionEvents(messages)).toEqual([
      { name: "x_one", context: {} },
      { name: "x_two", context: { k: 1 } },
    ]);
  });
});
