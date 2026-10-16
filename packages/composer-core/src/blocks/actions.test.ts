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

/** Every subset of a list, the empty one included. */
const subsets = <T,>(items: readonly T[]): T[][] => items.reduce<T[][]>((all, item) => [...all, ...all.map((s) => [...s, item])], [[]]);

/**
 * Every auth-form call that varies what can decide an action name: each mode,
 * each set of fields the constraints allow, providers absent or any set of
 * them, and recovery absent, on or off.
 */
function authCalls(block: BlockDefinition, extra: Json = {}): Json[] {
  const values = (name: string) => block.props.find((p) => p.name === name)!.items!.values!;
  const calls: Json[] = [];
  for (const mode of block.props.find((p) => p.name === "mode")!.values!) {
    for (const fields of subsets(values("fields")).filter((f) => f.length > 0)) {
      for (const providers of [undefined, ...subsets(values("providers"))]) {
        for (const recovery of [undefined, true, false]) {
          const call: Json = { block: block.id, version: block.version, mode, title: "Welcome", fields, ...extra };
          if (providers !== undefined) call.providers = providers;
          if (recovery !== undefined) call.recovery = recovery;
          if (validateCall(block, call).length === 0 && checkConstraints(block, call).length === 0) calls.push(call);
        }
      }
    }
  }
  return calls;
}

/** The names the real expander and emitter produce over some calls: what a template can actually dispatch. */
function reachableNames(ref: Ref, block: BlockDefinition, calls: readonly Json[]): string[] {
  const { sidecar, contract, profile } = inputs(ref);
  const reference = parsed(sidecar).reference;
  const names = new Set<string>();
  for (const call of calls) {
    const expanded = expandBlock(block, call, { reference, intent: block.intents[0]! });
    if (!expanded.ok) continue;
    const emitted = emitCheck(expanded.surface, contract, profile);
    if (!emitted.ok) throw new Error(emitted.refusal);
    for (const name of emitted.actions) names.add(name);
  }
  return [...names].sort();
}

describe("H1 counts the names a call can reach, no more", () => {
  const view = (ref: Ref) => generationView(inputs(ref).contract, inputs(ref).profile);
  const auth = (template: Json, overrides: Partial<BlockDefinition> = {}): BlockDefinition => ({ ...blockOf("astryx", "auth-form"), template: template as never, ...overrides });
  const card = (...children: Json[]) => ({ component: "card", id: "auth-card", children });
  const submit = (id: unknown) => ({ component: "button", id, props: { label: "Go", variant: "primary" } });
  const names = (block: BlockDefinition) => templateActionNames(block, view("astryx").actionComponents);
  const issues = (block: BlockDefinition) => b0Issues(block, view("astryx")).join("\n");
  const withEnum = (name: string, count: number, required = true) => [
    ...blockOf("astryx", "auth-form").props,
    { name, ...(required ? { required: true } : {}), type: "enum" as const, values: Array.from({ length: count }, (_, i) => `v${i}`) },
  ];

  it("a name read twice holds one value: a repeated reference is not two independent choices", () => {
    const block = auth(card(submit({ $concat: [{ $prop: "mode" }, "-", { $prop: "mode" }] })));
    expect(names(block).names).toEqual(["reset_reset", "sign_in_sign_in", "sign_up_sign_up"]);
    expect(issues({ ...block, actions: ["reset_reset", "sign_in_sign_in", "sign_up_sign_up"] })).toBe("");
    expect(issues({ ...block, actions: ["reset_reset", "reset_sign_in", "sign_in_sign_in", "sign_up_sign_up"] })).toMatch(/'reset_sign_in' is declared, but no node of the template can emit it/);
  });

  it("a branch no call can take counts nothing, and declaring its name is a declaration no node can emit", () => {
    const template = card(submit("auth-submit"), { $if: { $eq: [1, 2] }, children: [submit("never")] });
    expect(names(auth(template)).names).toEqual(["auth_submit"]);
    expect(issues(auth(template, { actions: ["auth_submit"] }))).toBe("");
    expect(issues(auth(template, { actions: ["auth_submit", "never"] }))).toMatch(/'never' is declared, but no node of the template can emit it/);
  });

  it("an $if on an enum narrows that enum in each branch", () => {
    const template = card({
      $if: { $eq: [{ $prop: "mode" }, "reset"] },
      children: [submit({ $concat: ["auth-", { $prop: "mode" }] })],
      else: [submit({ $concat: ["auth-go-", { $prop: "mode" }] })],
    });
    expect(names(auth(template)).names).toEqual(["auth_go_sign_in", "auth_go_sign_up", "auth_reset"]);
  });

  it("an $if on a boolean narrows a $case on it", () => {
    const template = card({ $if: "recovery", children: [submit({ $case: "recovery", map: { true: "auth-forgot", false: "auth-never" } })] });
    expect(names(auth(template)).names).toEqual(["auth_forgot"]);
  });

  it("an $if comparing an enum read with a default narrows it with the default", () => {
    const props = withEnum("variant", 2, false);
    const read = { $prop: "variant", default: "v0" };
    const template = card({ $if: { $eq: [read, "v0"] }, children: [submit({ $concat: ["auth-", read] })] });
    expect(names(auth(template, { props })).names).toEqual(["auth_v0"]);
  });

  it("an optional enum may name an action where an $if guarantees it, and nowhere else", () => {
    const props = withEnum("variant", 2, false);
    const guarded = card({ $if: "variant", children: [submit({ $concat: ["auth-", { $prop: "variant" }] })] });
    expect(issues(auth(guarded, { props, actions: ["auth_v0", "auth_v1"] }))).toBe("");
    expect(issues(auth(card(submit({ $prop: "variant" })), { props, actions: ["v0", "v1"] }))).toMatch(/'variant' may be absent/);
  });

  it("an id read straight from an enum is capped at 256 names, like a combination", () => {
    const at = (count: number) => auth(card(submit({ $prop: "big" })), { props: withEnum("big", count), actions: Array.from({ length: count }, (_, i) => `v${i}`) });
    expect(issues(at(256))).toBe("");
    expect(issues(at(257))).toMatch(/more than 256 possible names/);
  });

  it("an id read through a $case is capped at 256 names too", () => {
    const at = (count: number) => {
      const map = Object.fromEntries(Array.from({ length: count }, (_, i) => [`v${i}`, `auth-k${i}`]));
      return auth(card(submit({ $case: "big", map })), { props: withEnum("big", count), actions: Array.from({ length: count }, (_, i) => `auth_k${i}`) });
    };
    expect(issues(at(256))).toBe("");
    expect(issues(at(257))).toMatch(/more than 256 possible names/);
  });

  it("an id with too many combinations to evaluate is refused before any is evaluated", () => {
    const props = [...blockOf("astryx", "auth-form").props, ...["a", "b", "c", "d"].map((name) => ({ name, required: true, type: "enum" as const, values: Array.from({ length: 10 }, (_, i) => `${name}${i}`) }))];
    const id = { $concat: [{ $prop: "a" }, { $prop: "b" }, { $prop: "c" }, { $prop: "d" }] };
    expect(issues(auth(card(submit(id)), { props, actions: ["x"] }))).toMatch(/more than 4096 combinations/);
  });

  it("on templates that narrow, H1's names are exactly what the real expander and emitter dispatch over every call", () => {
    const narrowing = card(
      { $if: { $eq: [{ $prop: "mode" }, "reset"] }, children: [submit({ $concat: ["auth-", { $prop: "mode" }] })], else: [submit({ $concat: ["auth-go-", { $prop: "mode" }] })] },
      { $if: "recovery", children: [submit({ $case: "recovery", map: { true: "auth-forgot", false: "auth-never" } })] },
      { $each: "providers", as: "provider", children: [{ $if: { $eq: [{ $prop: "provider" }, "github"] }, children: [submit({ $concat: ["auth-", { $prop: "provider" }] })] }] },
    );
    const block = auth(narrowing);
    expect(names(block).names).toEqual(reachableNames("astryx", block, authCalls(block)));
    expect(names(block).names).toEqual(["auth_forgot", "auth_github", "auth_go_sign_in", "auth_go_sign_up", "auth_reset"]);
  });

  for (const ref of REF_IDS) {
    it(`${ref}: on the shipped auth-form, H1's names are exactly what the real expander and emitter dispatch over every call`, () => {
      const block = blockOf(ref, "auth-form");
      expect(templateActionNames(block, actionComponents(inputs(ref).profile)).names).toEqual(reachableNames(ref, block, authCalls(block)));
    });
  }
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
