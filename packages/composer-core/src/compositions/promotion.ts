/**
 * Compositions: promoting a block into a reusable composition (M1 advanced authoring, slice D).
 *
 * The starting point is the 0.1 upcast (load.ts upcastBlock), unchanged. A promotion then makes it a new draft a
 * designer can refine and approve through the ordinary lifecycle:
 *
 * - a new, stable composition id (the block's own id, or the next free one), version 1, status draft;
 * - the block's props become the composition's data, so its examples can fill them: an agent provides them at
 *   instantiation and they are validated against the same declarations;
 * - one state, for the block's first intent, always shown; the template is the block's template, unchanged;
 * - each block example becomes an example (scenario) expected to be shown.
 *
 * Nothing is fabricated. The block's actions are only names the emitter writes for buttons; a composition
 * declares each action on a node with a literal id. Each block action is reported as mappable (a button with a
 * literal id that emits that name) or unresolved (its button's id is computed from data, so it cannot be bound,
 * or no button emits it). Typed fields are reported the same way. What a 0.2 composition cannot carry (the
 * block's cross-field constraints, further intents) is reported as not carried, never dropped silently. The
 * source block is never changed: the promotion works on a copy.
 */
import { slug } from "@aestheticfunction/dspack-emit";
import type { BlockDefinition, TemplateChild } from "../blocks/schema";
import { stateIdFor, upcastBlock } from "./load";
import type { CompositionDefinition, Scenario } from "./schema";

type Json = Record<string, any>;

export interface PromotionSource {
  block: string;
  version: number;
  /** The reference (design system) the block belongs to. */
  reference: string;
}

/** An interactive element of the promoted template, and whether the composition can declare it. */
export interface PromotionMapping {
  kind: "action" | "input";
  /** The block action name (for an action), or a description of the field. */
  name: string;
  /**
   * "mappable": a literal id, always shown, that can be declared; "conditional": a literal id shown only when a
   * condition holds, so a screen without it would have an action and no element; "computed": an id built from
   * data; "missing": no element emits it.
   */
  status: "mappable" | "conditional" | "computed" | "missing";
  /** For a conditional element: the field its condition reads. */
  when?: string;
  /** The literal node id, when there is one. */
  node?: string;
  /** For a computed id: the repeat it sits in. */
  repeat?: string;
}

export interface PromotionReport {
  source: PromotionSource;
  mappings: PromotionMapping[];
  /** What the 0.2 composition cannot carry, in plain words. */
  notCarried: string[];
}

/** An interactive node of a template, with whether its id is literal and the repeat it sits in, if any. */
type Interactive = { component: string; id: string | null; computed: boolean; repeat: string | null; when: string | null };
function interactiveNodes(template: Json): Interactive[] {
  const out: Interactive[] = [];
  const visit = (node: Json, repeat: string | null, when: string | null) => {
    if (node.component === "button" || node.component === "text-input" || node.component === "alert-dialog") {
      out.push({ component: String(node.component), id: typeof node.id === "string" ? node.id : null, computed: node.id !== undefined && typeof node.id !== "string", repeat, when });
    }
    children((node.children ?? []) as TemplateChild[], repeat, when);
  };
  const children = (list: TemplateChild[], repeat: string | null, when: string | null) => {
    for (const child of list) {
      const e = child as Json;
      if ("$each" in e) children((e.children ?? []) as TemplateChild[], String(e.$each), when);
      else if ("$if" in e) {
        const field = typeof e.$if === "string" ? e.$if : JSON.stringify(e.$if);
        children((e.children ?? []) as TemplateChild[], repeat, when ?? field);
        children((e.else ?? []) as TemplateChild[], repeat, when ?? field);
      } else visit(e, repeat, when);
    }
  };
  visit(template, null, null);
  return out;
}

/** The literal prefix of a computed id ({"$concat": ["auth-provider-", …]}), used to say which action it would emit. */
function computedPrefix(template: Json, repeat: string, component: string): string | null {
  let prefix: string | null = null;
  const visit = (n: Json, inRepeat: boolean) => {
    if (inRepeat && n.component === component && n.id && typeof n.id === "object" && Array.isArray(n.id.$concat) && typeof n.id.$concat[0] === "string") prefix ??= n.id.$concat[0];
    for (const c of (n.children ?? []) as Json[]) {
      if ("$each" in c) for (const x of (c.children ?? []) as Json[]) visit(x, c.$each === repeat);
      else if ("$if" in c) for (const x of [...((c.children ?? []) as Json[]), ...((c.else ?? []) as Json[])]) visit(x, inRepeat);
      else visit(c, inRepeat);
    }
  };
  visit(template, false);
  return prefix;
}

/** Where each of the block's interactions stands in a composition's templates (all states). */
export function promotionMappings(c: CompositionDefinition, blockActions: readonly string[]): PromotionMapping[] {
  const nodes = c.states.flatMap((s) => interactiveNodes(s.template as unknown as Json));
  const out: PromotionMapping[] = [];
  for (const name of blockActions) {
    const literal = nodes.find((n) => n.id && !n.computed && (n.component === "button" || n.component === "alert-dialog") && slug(n.id) === name);
    if (literal) {
      out.push(literal.when || literal.repeat ? { kind: "action", name, status: "conditional", node: literal.id!, when: literal.when ?? literal.repeat! } : { kind: "action", name, status: "mappable", node: literal.id! });
      continue;
    }
    // A computed id inside a repeat: name it by its literal prefix when one matches the action.
    const computed = nodes.find((n) => n.computed && n.component === "button" && n.repeat && name.startsWith(slug((c.states.map((s) => computedPrefix(s.template as unknown as Json, n.repeat!, "button")).find(Boolean) ?? "").replace(/-$/, ""))));
    out.push(computed ? { kind: "action", name, status: "computed", repeat: computed.repeat! } : { kind: "action", name, status: "missing" });
  }
  for (const n of nodes.filter((x) => x.component === "text-input")) {
    if (n.computed) out.push({ kind: "input", name: `Text fields repeated for each item in “${n.repeat ?? "items"}”`, status: "computed", repeat: n.repeat ?? undefined });
    else if (n.id && n.when) out.push({ kind: "input", name: n.id, status: "conditional", node: n.id, when: n.when });
    else if (n.id) out.push({ kind: "input", name: n.id, status: "mappable", node: n.id });
  }
  // One entry per computed repeat of text fields.
  return out.filter((m, i) => !(m.kind === "input" && m.status === "computed" && out.findIndex((x) => x.kind === "input" && x.status === "computed" && x.repeat === m.repeat) !== i));
}

/** A composition id from the block's id that the library does not use yet. */
export function promotedId(blockId: string, taken: ReadonlySet<string>): string {
  if (!taken.has(blockId)) return blockId;
  for (let n = 2; ; n++) if (!taken.has(`${blockId}-${n}`)) return `${blockId}-${n}`;
}

/** An example's id from a block example's id ("blk.sign-up" -> "sign-up"), unique among the ones already made. */
function scenarioId(id: string, taken: Set<string>): string {
  const base =
    id
      .replace(/^blk\./, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^([0-9])/, "x-$1") || "example";
  let s = base;
  for (let n = 2; taken.has(s); n++) s = `${base}-${n}`;
  taken.add(s);
  return s;
}

/** A block constraint in words: "columns and rows.*.cells have the same length", "when mode is reset, fields includes email". */
function constraintWords(k: Json): string {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).join(", ") : String(v));
  const when = k.when && typeof k.when === "object" && "prop" in k.when ? `when ${k.when.prop} is ${list(k.when.equals)}, ` : "";
  if (k.kind === "equal-length" && Array.isArray(k.paths)) return `${(k.paths as string[]).join(" and ")} have the same length`;
  if (k.kind === "includes-when") return `${when}${k.path} includes ${list(k.values)}`;
  if (k.kind === "excludes-when") return `${when}${k.path} does not include ${list(k.values)}`;
  return `its fields agree (${String(k.kind)})`;
}

/**
 * Promote a block: a new draft composition, and a report of what maps, what does not and what is not carried.
 * The block is not modified.
 */
export function promoteBlock(block: BlockDefinition, options: { reference: string; taken: ReadonlySet<string> }): { composition: CompositionDefinition; report: PromotionReport } {
  const source = structuredClone(block);
  const upcast = upcastBlock(source);
  const id = promotedId(source.id, options.taken);
  const ids = new Set<string>();
  const scenarios: Scenario[] = source.examples.map((e) => {
    const { block: _b, version: _v, ...data } = e.call as Json;
    void _b;
    void _v;
    const sid = scenarioId(e.id, ids);
    const title = sid.replace(/-/g, " ").replace(/^./, (x) => x.toUpperCase()).slice(0, 60);
    return { id: sid, data, expect: "ok", title };
  });
  const [first, ...rest] = upcast.states;
  const composition: CompositionDefinition = {
    id,
    version: 1,
    status: "draft",
    name: source.name,
    summary: source.summary,
    parameters: [],
    data: upcast.parameters,
    inputs: [],
    actions: [],
    states: [{ ...first!, id: stateIdFor(first!.purpose), guard: { always: true } }],
    scenarios,
  };
  const notCarried: string[] = [];
  if (source.constraints?.length)
    notCarried.push(
      source.constraints.length === 1
        ? `The block's check that ${constraintWords(source.constraints[0] as Json)}. Compositions cannot declare checks between fields yet, so data that breaks it is not refused.`
        : `The block's ${source.constraints.length} checks between its fields: ${source.constraints.map((k) => constraintWords(k as Json)).join("; ")}. Compositions cannot declare checks between fields yet, so data that breaks them is not refused.`,
    );
  if (rest.length) notCarried.push(`The block's other intents (${rest.map((s) => s.purpose).join(", ")}): the composition has one state, for ${first!.purpose}. Add states for the others if they are needed.`);
  return { composition, report: { source: { block: source.id, version: source.version, reference: options.reference }, mappings: promotionMappings(composition, source.actions ?? []), notCarried } };
}

/**
 * Why a promoted composition cannot be approved yet: every block action that an element still emits must be
 * declared, and no element may have an id computed from data. Resolved by declaring a mappable action, or by
 * removing (or replacing) the element through the ordinary editing. Empty when nothing is left to resolve.
 */
export function promotionIssues(c: CompositionDefinition, blockActions: readonly string[]): string[] {
  const out: string[] = [];
  for (const m of promotionMappings(c, blockActions)) {
    if (m.kind === "action" && m.status === "mappable" && !c.actions.some((a) => a.node === m.node)) out.push(`The block's “${m.name}” action is not mapped: its button “${m.node}” sends nothing until it is declared.`);
    if (m.kind === "action" && m.status === "conditional") out.push(`The block's “${m.name}” action comes from a button shown only when “${m.when}” is set: a screen without the button would still carry the action. Remove that conditional part, or replace it with a button that is always shown.`);
    if (m.kind === "input" && m.status === "computed") out.push(`${m.name} have computed ids, so what is typed in them cannot be bound. Remove them, or replace them with text fields of their own.`);
  }
  // Computed actions, one problem per repeat: the buttons made for each item in it.
  const computed = new Map<string, string[]>();
  for (const m of promotionMappings(c, blockActions)) if (m.kind === "action" && m.status === "computed") computed.set(m.repeat!, [...(computed.get(m.repeat!) ?? []), m.name]);
  for (const [repeat, names] of computed)
    out.push(`The block's ${names.length === 1 ? "action" : "actions"} ${names.map((n) => `“${n}”`).join(", ")} ${names.length === 1 ? "comes" : "come"} from buttons whose ids are computed for each item in “${repeat}”: they cannot be bound. Remove them, or replace them with buttons of their own.`);
  return [...new Set(out)];
}

/**
 * The Structure key of the repeat over `field` (kind "repeat") or the condition on `field` (kind "condition")
 * in a composition's states, so the part an unresolved mapping sits in can be selected or removed with the
 * ordinary template editing. Null when the composition no longer has it.
 */
export function promotionPartKey(c: CompositionDefinition, kind: "repeat" | "condition", field: string): { state: string; key: string } | null {
  for (const s of c.states) {
    const find = (n: Json, path: string): string | null => {
      for (const [i, ch] of ((n.children ?? []) as Json[]).entries()) {
        const p = path ? `${path}.${i}` : String(i);
        if (kind === "repeat" ? ch.$each === field : "$if" in ch && (typeof ch.$if === "string" ? ch.$if : JSON.stringify(ch.$if)) === field) return `${s.id}@${p}`;
        const deeper = find(ch, p);
        if (deeper) return deeper;
      }
      return null;
    };
    const key = find(s.template as unknown as Json, "");
    if (key) return { state: s.id, key };
  }
  return null;
}
