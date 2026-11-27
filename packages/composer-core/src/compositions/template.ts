/**
 * Compositions: editing a draft's templates (M1 visual template editing).
 *
 * Operations on one state's template, addressed by the element keys of structure.ts (`#<id>` or
 * `<state>@<path>`). Each takes a mutable draft and either changes it and returns where the element now is,
 * or changes nothing and says why. The loader (load.ts) stays the last word: an operation that passes here can
 * still be refused there, and then nothing is kept.
 *
 * Identity. Inputs and actions bind by literal id, never by path, so moving or inserting elements never
 * redirects a binding. Literal ids are unique across a composition's states (the same id in two states is the
 * same element), and two ids may not be emitted alike. Renaming an id changes every reference to it in one
 * operation: the nodes in every state, the inputs and actions bound to it (an action is named as the emitter
 * names its node), and any repeated action whose list it is.
 *
 * Removal never drops a binding silently: it reports what depends on the element, and removes those
 * declarations only when asked to, as part of the same operation.
 */
import { slug } from "@aestheticfunction/dspack-emit";
import type { TemplateChild } from "../blocks/schema";
import type { CompositionDefinition, CompositionState } from "./schema";
import { elementKey } from "./structure";

type Json = Record<string, any>;

/** A literal node id: kebab-case, as the packaged templates use. */
export const NODE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export type TemplateResult = { ok: true; key: string } | { ok: false; reason: string };

interface Located {
  node: Json;
  /** The array that holds it (an element's or a repeat's children); null for the root. */
  container: TemplateChild[] | null;
  index: number;
  path: string;
  /** The path of the element or repeat that owns the container ("" is the root). */
  parentPath: string | null;
  kind: "element" | "repeat" | "condition";
}

/** Every node of a state's template with its location, in document order, using structure.ts's paths. */
function walk(state: CompositionState): Located[] {
  const out: Located[] = [];
  const children = (list: TemplateChild[], base: string, parentPath: string) => {
    list.forEach((child, i) => {
      const entry = child as Json;
      const path = base ? `${base}.${i}` : String(i);
      if ("$each" in entry) {
        out.push({ node: entry, container: list, index: i, path, parentPath, kind: "repeat" });
        children((entry.children ?? []) as TemplateChild[], path, path);
      } else if ("$if" in entry) {
        out.push({ node: entry, container: list, index: i, path, parentPath, kind: "condition" });
        children((entry.children ?? []) as TemplateChild[], `${path}.then`, path);
        children((entry.else ?? []) as TemplateChild[], `${path}.else`, path);
      } else {
        out.push({ node: entry, container: list, index: i, path, parentPath, kind: "element" });
        children((entry.children ?? []) as TemplateChild[], path, path);
      }
    });
  };
  const root = state.template as unknown as Json;
  out.push({ node: root, container: null, index: 0, path: "", parentPath: null, kind: "element" });
  children((root.children ?? []) as TemplateChild[], "", "");
  return out;
}

const keyOf = (state: CompositionState, l: Located) => (l.kind === "element" ? elementKey(state.id, l.path, l.node) : `${state.id}@${l.path}`);

export function locate(state: CompositionState, key: string): Located | null {
  return walk(state).find((l) => keyOf(state, l) === key) ?? null;
}

/** The key of a node object (by reference) in a state, after an operation moved it. */
function keyOfRef(state: CompositionState, ref: Json): string | null {
  const l = walk(state).find((x) => x.node === ref);
  return l ? keyOf(state, l) : null;
}

/** Every literal id in every state. */
export function allIds(c: CompositionDefinition): Set<string> {
  const ids = new Set<string>();
  for (const s of c.states) for (const l of walk(s)) if (l.kind === "element" && typeof l.node.id === "string") ids.add(l.node.id);
  return ids;
}

/** Why an id cannot be used for a new or renamed element; null when it can. */
export function idProblem(c: CompositionDefinition, id: string, except?: string): string | null {
  if (!NODE_ID.test(id)) return "an id uses lowercase letters, digits and single hyphens, starting with a letter, for example “hotel-name”";
  const taken = [...allIds(c)].filter((x) => x !== except);
  if (taken.includes(id)) return `another element already has the id “${id}”`;
  const twin = taken.find((x) => slug(x) === slug(id));
  if (twin) return `“${id}” would be emitted like “${twin}”; choose an id that differs in more than punctuation`;
  return null;
}

/** A unique id from a starting word: "Choose hotel" -> "choose-hotel", "choose-hotel-2", … */
export function uniqueId(c: CompositionDefinition, from: string): string {
  const base =
    from
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^([0-9])/, "x-$1") || "element";
  let id = base;
  for (let n = 2; idProblem(c, id) !== null; n++) id = `${base}-${n}`;
  return id;
}

/** Give an element without an id a literal id. Its key becomes `#<id>`. */
export function assignId(c: CompositionDefinition, stateId: string, key: string, id: string): TemplateResult {
  const state = c.states.find((s) => s.id === stateId);
  const l = state && locate(state, key);
  if (!state || !l || l.kind !== "element") return { ok: false, reason: "that element is not in this state" };
  if (typeof l.node.id === "string") return { ok: false, reason: `it already has the id “${l.node.id}”; rename it instead` };
  const problem = idProblem(c, id);
  if (problem) return { ok: false, reason: problem };
  l.node.id = id;
  return { ok: true, key: `#${id}` };
}

/** Rename a literal id everywhere it is used, in one operation. */
export function renameId(c: CompositionDefinition, from: string, to: string): TemplateResult {
  if (from === to) return { ok: true, key: `#${to}` };
  if (!allIds(c).has(from)) return { ok: false, reason: `no element has the id “${from}”` };
  const problem = idProblem(c, to, from);
  if (problem) return { ok: false, reason: problem };
  for (const s of c.states) for (const l of walk(s)) if (l.kind === "element" && l.node.id === from) l.node.id = to;
  for (const i of c.inputs) if (i.node === from) i.node = to;
  for (const a of c.actions) {
    if (a.node === from) {
      a.node = to;
      a.name = slug(to);
    }
    if (a.repeat?.list === from) a.repeat.list = to;
  }
  return { ok: true, key: `#${to}` };
}

export type Position = "before" | "after" | "inside";

/** Where an insertion or a move lands: the container and the index in it. */
function target(state: CompositionState, key: string, position: Position): { container: TemplateChild[]; index: number; parentRef: Json } | { reason: string } {
  const l = locate(state, key);
  if (!l) return { reason: "that element is not in this state" };
  if (position === "inside") {
    if (l.kind === "condition") return { reason: "conditional content cannot be edited here" };
    if (l.kind === "element" && !CONTAINERS.has(String(l.node.component))) return { reason: `a ${String(l.node.component)} does not hold other elements` };
    l.node.children ??= [];
    return { container: l.node.children as TemplateChild[], index: (l.node.children as TemplateChild[]).length, parentRef: l.node };
  }
  if (!l.container) return { reason: "nothing can be placed beside the outermost element" };
  if (l.path.includes(".then") || l.path.includes(".else")) return { reason: "conditional content cannot be edited here" };
  const parent = walk(state).find((x) => x.path === l.parentPath)!;
  return { container: l.container, index: position === "before" ? l.index : l.index + 1, parentRef: parent.node };
}

/** Components that hold other elements (the contract's composition notes). */
export const CONTAINERS = new Set(["card", "dialog", "list", "selectable-card"]);

/** Insert a new node (a template element, possibly with an id) at a place in one state's template. */
export function insertNode(c: CompositionDefinition, stateId: string, at: { key: string; position: Position }, node: Json): TemplateResult {
  const state = c.states.find((s) => s.id === stateId);
  if (!state) return { ok: false, reason: `there is no “${stateId}” state` };
  if (typeof node.id === "string") {
    const problem = idProblem(c, node.id);
    if (problem) return { ok: false, reason: problem };
  }
  const t = target(state, at.key, at.position);
  if ("reason" in t) return { ok: false, reason: t.reason };
  const fresh = structuredClone(node);
  t.container.splice(t.index, 0, fresh as TemplateChild);
  return { ok: true, key: keyOfRef(state, fresh)! };
}

/** Move an element (or a repeat) to another place in the same state's template. */
export function moveNode(c: CompositionDefinition, stateId: string, key: string, to: { key: string; position: Position }): TemplateResult {
  const state = c.states.find((s) => s.id === stateId);
  if (!state) return { ok: false, reason: `there is no “${stateId}” state` };
  const from = locate(state, key);
  if (!from) return { ok: false, reason: "that element is not in this state" };
  if (!from.container) return { ok: false, reason: "the outermost element cannot be moved" };
  if (from.kind === "condition") return { ok: false, reason: "conditional content cannot be edited here" };
  const dest = locate(state, to.key);
  if (!dest) return { ok: false, reason: "the place to move it to is not in this state" };
  if (dest.path === from.path || (from.path && dest.path.startsWith(`${from.path}.`))) return { ok: false, reason: "an element cannot be moved into itself" };
  const ref = from.node;
  // Take it out, then place it relative to the destination (which may have shifted).
  from.container.splice(from.index, 1);
  const t = target(state, keyOfRef(state, dest.node) ?? to.key, to.position);
  if ("reason" in t) {
    from.container.splice(from.index, 0, ref as TemplateChild);
    return { ok: false, reason: t.reason };
  }
  t.container.splice(t.index, 0, ref as TemplateChild);
  return { ok: true, key: keyOfRef(state, ref)! };
}

export interface Dependencies {
  /** Typed fields that would no longer be shown in any state. */
  inputs: string[];
  /** Actions whose element leaves this state: removed altogether, or no longer sent from this state. */
  actions: Array<{ name: string; effect: "removed" | "no-longer-in-state" }>;
  /** Actions that send a removed typed field. */
  carries: Array<{ action: string; input: string }>;
}

/** The literal ids in a node's subtree. */
function idsIn(node: Json): string[] {
  const out: string[] = [];
  const visit = (n: Json) => {
    if (typeof n.id === "string") out.push(n.id);
    for (const c of (n.children ?? []) as Json[]) visit(c);
    for (const c of (n.else ?? []) as Json[]) visit(c);
  };
  visit(node);
  return out;
}

/** What depends on an element (and everything inside it) in one state. */
export function dependenciesOf(c: CompositionDefinition, stateId: string, key: string): Dependencies | null {
  const state = c.states.find((s) => s.id === stateId);
  const l = state && locate(state, key);
  if (!state || !l) return null;
  const ids = new Set(idsIn(l.node));
  const elsewhere = (id: string) => c.states.some((s) => s.id !== stateId && walk(s).some((x) => x.kind === "element" && x.node.id === id));
  const inputs = c.inputs.filter((i) => ids.has(i.node) && !elsewhere(i.node)).map((i) => i.name);
  const actions = c.actions
    .filter((a) => ids.has(a.node) && a.states.includes(stateId))
    .map((a) => ({ name: a.name, effect: (a.states.length === 1 ? "removed" : "no-longer-in-state") as "removed" | "no-longer-in-state" }));
  const removedActions = new Set(actions.filter((a) => a.effect === "removed").map((a) => a.name));
  const carries = c.actions.filter((a) => !removedActions.has(a.name)).flatMap((a) => (a.carries ?? []).filter((x) => inputs.includes(x)).map((input) => ({ action: a.name, input })));
  return { inputs, actions, carries };
}

export const hasDependencies = (d: Dependencies) => d.inputs.length + d.actions.length + d.carries.length > 0;

/**
 * Remove an element (or a repeat) from one state. With dependencies, it is refused unless `resolve` is set; then
 * the declarations that depend on it change in the same operation, exactly as dependenciesOf reported.
 */
export function removeNode(c: CompositionDefinition, stateId: string, key: string, resolve = false): TemplateResult {
  const state = c.states.find((s) => s.id === stateId);
  const l = state && locate(state, key);
  if (!state || !l) return { ok: false, reason: "that element is not in this state" };
  if (!l.container) return { ok: false, reason: "the outermost element cannot be removed" };
  if (l.kind === "condition") return { ok: false, reason: "conditional content cannot be edited here" };
  const deps = dependenciesOf(c, stateId, key)!;
  if (hasDependencies(deps) && !resolve) return { ok: false, reason: "other declarations depend on it" };
  const parentKey = keyOfRef(state, walk(state).find((x) => x.path === l.parentPath)!.node)!;
  l.container.splice(l.index, 1);
  if (resolve) {
    const goneInputs = new Set(deps.inputs);
    for (const d of deps.actions) {
      const a = c.actions.find((x) => x.name === d.name)!;
      if (d.effect === "removed") c.actions.splice(c.actions.indexOf(a), 1);
      else a.states = a.states.filter((s) => s !== stateId);
    }
    for (const a of c.actions) if (a.carries) a.carries = a.carries.filter((x) => !goneInputs.has(x));
    for (const a of c.actions) if (a.carries && a.carries.length === 0) delete a.carries;
    c.inputs = c.inputs.filter((i) => !goneInputs.has(i.name));
  }
  return { ok: true, key: parentKey };
}
