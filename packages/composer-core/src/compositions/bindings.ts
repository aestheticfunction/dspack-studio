/**
 * Compositions (R1a spike): the two attachments made after emission
 * (R0-REVIEW 3.2), and the proof that each repeated button carries its own
 * item's payload (R0-REVIEW 6.1 item 2).
 *
 * 1. Input values. Each declared input's text field gets `value` bound to
 *    its own leaf path /input/<name>. The emitter never writes a path (the
 *    Astryx contract has no value prop), so these are the only data
 *    bindings in the messages, apart from action contexts that carry them.
 * 2. Action payloads. A repeated action's button gets the literal payload of
 *    its own item; a single action gets its literal payload and the input
 *    paths it carries.
 *
 * Which emitted button belongs to item k is never read from an emitted id's
 * suffix. It is established by structure: the list names its items in an
 * explicit ordered `children` array, item k is the k-th entry, and its button
 * is the one inside that entry's subtree. It is then checked by witness: the
 * subtree holds the values the template rendered for item k and none that
 * belong only to another item. Any mismatch is a refusal, never a guess.
 */
import { slug } from "@aestheticfunction/dspack-emit";
import { itemPayloads, evaluatePayload } from "./expand";
import type { ActionSpec, CompositionDefinition, CompositionState } from "./schema";

type Json = Record<string, any>;

export const INPUT_ROOT = "/input";
export const inputPath = (name: string) => `${INPUT_ROOT}/${name}`;

export interface BoundAction {
  name: string;
  /** The emitted component that dispatches it. */
  componentId: string;
  /** The literal part of the context, as sent. */
  payload: Record<string, string | number | boolean>;
  /** Input names carried as /input/<name> paths. */
  carries: string[];
  consequential: boolean;
  /** For a repeated action: the item's position in the data (0-based) and its witness values. */
  item?: { index: number; witness: string[] };
}

export interface BoundInput {
  name: string;
  componentId: string;
  path: string;
}

export type AttachResult =
  | { ok: true; messages: Json[]; actions: BoundAction[]; inputs: BoundInput[] }
  | { ok: false; reason: string };

/** The components of an updateComponents message, by id. */
function componentsOf(messages: Json[]): Map<string, Json> {
  const out = new Map<string, Json>();
  for (const m of messages) for (const c of m.updateComponents?.components ?? []) out.set(String(c.id), c);
  return out;
}

/** Ids a component references as children (0.9: `child` or a `children` id array). */
export function childRefs(component: Json): string[] {
  const out: string[] = [];
  if (typeof component.child === "string") out.push(component.child);
  if (Array.isArray(component.children)) for (const c of component.children) if (typeof c === "string") out.push(c);
  return out;
}

/** Every component id reachable from `root`, root included. Cycles are cut. */
export function subtree(components: Map<string, Json>, root: string): string[] {
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const c = components.get(id);
    if (c) stack.push(...childRefs(c).reverse());
  }
  return [...seen];
}

/** Every string a set of components renders: literal values, not ids, names or action events. */
export function renderedStrings(components: Map<string, Json>, ids: readonly string[]): Set<string> {
  const out = new Set<string>();
  const skip = new Set(["id", "component", "child", "children", "action", "variant", "size", "density", "type", "as"]);
  const walk = (v: unknown) => {
    if (typeof v === "string") out.add(v);
    else if (typeof v === "number") out.add(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!skip.has(k)) walk(x);
  };
  for (const id of ids) {
    const c = components.get(id);
    if (c) for (const [k, v] of Object.entries(c)) if (!skip.has(k)) walk(v);
  }
  return out;
}

function eventName(component: Json): string | undefined {
  const name = component.action?.event?.name;
  return typeof name === "string" ? name : undefined;
}

/**
 * Attach input bindings and payloads to freshly emitted messages (cloned;
 * the input is not modified). `scope` is the instance's parameters and data.
 */
export function attach(c: CompositionDefinition, state: CompositionState, messages: Json[], scope: Json): AttachResult {
  const out = structuredClone(messages) as Json[];
  const components = componentsOf(out);
  const actions: BoundAction[] = [];
  const inputs: BoundInput[] = [];
  const claimed = new Set<string>();

  for (const input of c.inputs) {
    const componentId = slug(input.node);
    const field = components.get(componentId);
    if (!field) {
      // An input lives in the states whose template holds its node; elsewhere it is simply absent.
      continue;
    }
    if (field.component !== "TextField") return { ok: false, reason: `input '${input.name}': component '${componentId}' is a ${String(field.component)}, not a TextField` };
    if (field.value !== undefined) return { ok: false, reason: `input '${input.name}': the emitter already wrote a value on '${componentId}'` };
    field.value = { path: inputPath(input.name) };
    inputs.push({ name: input.name, componentId, path: inputPath(input.name) });
  }

  const forState = c.actions.filter((a) => a.states.includes(state.id));
  for (const action of forState) {
    if (action.repeat) {
      const r = attachRepeated(action, components, scope);
      if (!r.ok) return r;
      for (const b of r.actions) claimed.add(b.componentId);
      actions.push(...r.actions);
    } else {
      const dispatchers = [...components.values()].filter((x) => eventName(x) === action.name);
      if (dispatchers.length !== 1) return { ok: false, reason: `action '${action.name}': expected exactly one dispatching component, found ${dispatchers.length}` };
      const target = dispatchers[0]!;
      const payload = evaluatePayload(action.payload, scope);
      if (!payload.ok) return { ok: false, reason: `action '${action.name}': ${payload.reason}` };
      const carries = (action.carries ?? []).filter((name) => inputs.some((i) => i.name === name));
      if (carries.length !== (action.carries ?? []).length) return { ok: false, reason: `action '${action.name}' carries an input this state does not show` };
      target.action.event.context = { ...payload.value, ...Object.fromEntries(carries.map((name) => [name, { path: inputPath(name) }])) };
      claimed.add(String(target.id));
      actions.push({ name: action.name, componentId: String(target.id), payload: payload.value, carries, consequential: !!action.consequential });
    }
  }

  // Every dispatching component in the messages must be a declared action of this state.
  for (const comp of components.values()) {
    const name = eventName(comp);
    if (name !== undefined && !claimed.has(String(comp.id))) {
      return { ok: false, reason: `component '${String(comp.id)}' dispatches '${name}', which state '${state.id}' does not declare` };
    }
  }
  return { ok: true, messages: out, actions, inputs };
}

function attachRepeated(action: ActionSpec, components: Map<string, Json>, scope: Json): { ok: true; actions: BoundAction[] } | { ok: false; reason: string } {
  const repeat = action.repeat!;
  const evaluated = itemPayloads(action, scope);
  if (!evaluated.ok) return { ok: false, reason: `action '${action.name}': ${evaluated.reason}` };
  const items = evaluated.items;
  const listId = slug(repeat.list);
  const list = components.get(listId);
  if (!list) return { ok: false, reason: `action '${action.name}': the list '${listId}' was not emitted` };
  if (!Array.isArray(list.children) || list.children.some((x: unknown) => typeof x !== "string")) {
    return { ok: false, reason: `action '${action.name}': '${listId}' does not name its items in an explicit ordered children array` };
  }
  const children = list.children as string[];
  if (children.length !== items.length) return { ok: false, reason: `action '${action.name}': '${listId}' has ${children.length} items, the data has ${items.length}` };

  // Witness: item k's values must be told apart from every other item's.
  const tuples = items.map((it) => JSON.stringify(it.witness));
  const dup = tuples.findIndex((t, i) => tuples.indexOf(t) !== i);
  if (dup !== -1) {
    return { ok: false, reason: `action '${action.name}': items ${tuples.indexOf(tuples[dup]!) + 1} and ${dup + 1} render the same ${repeat.witness.join(", ")}, so a person could not tell them apart (completeness, I3)` };
  }

  const bound: BoundAction[] = [];
  for (const [k, root] of children.entries()) {
    const ids = subtree(components, root);
    const strings = renderedStrings(components, ids);
    for (const w of items[k]!.witness) if (!strings.has(w)) return { ok: false, reason: `action '${action.name}': item ${k + 1}'s subtree does not render its witness '${w}'` };
    for (const [j, other] of items.entries()) {
      if (j === k) continue;
      for (const w of other.witness) {
        const sharedWithK = items[k]!.witness.includes(w);
        if (!sharedWithK && strings.has(w)) return { ok: false, reason: `action '${action.name}': item ${k + 1}'s subtree renders '${w}', which belongs to item ${j + 1}` };
      }
    }
    const dispatchers = ids.map((id) => components.get(id)!).filter((x) => x && eventName(x) === action.name);
    if (dispatchers.length !== 1) return { ok: false, reason: `action '${action.name}': item ${k + 1} has ${dispatchers.length} dispatching components, expected 1` };
    const target = dispatchers[0]!;
    target.action.event.context = { ...items[k]!.payload };
    bound.push({ name: action.name, componentId: String(target.id), payload: items[k]!.payload, carries: [], consequential: !!action.consequential, item: { index: k, witness: items[k]!.witness } });
  }
  // No dispatcher of this action outside the items.
  const all = [...components.values()].filter((x) => eventName(x) === action.name).length;
  if (all !== bound.length) return { ok: false, reason: `action '${action.name}': ${all - bound.length} dispatching component(s) sit outside '${listId}'s items` };
  return { ok: true, actions: bound };
}

/**
 * The binding layout every instance must keep: the only data paths in the
 * messages are input leaves, and they appear only as a text field's value or
 * inside an action context. Nothing governed can read them.
 */
export function bindingLayoutIssues(messages: Json[]): string[] {
  const issues: string[] = [];
  const visit = (v: unknown, where: string, allowed: boolean) => {
    if (Array.isArray(v)) return v.forEach((x, i) => visit(x, `${where}[${i}]`, allowed));
    if (!v || typeof v !== "object") return;
    const o = v as Json;
    if (typeof o.path === "string" && Object.keys(o).length === 1) {
      if (!allowed) issues.push(`${where}: a data binding outside an input value or action context`);
      else if (!/^\/input\/[a-z][a-zA-Z0-9]*$/.test(o.path)) issues.push(`${where}: '${o.path}' is not an input leaf path`);
      return;
    }
    for (const [k, x] of Object.entries(o)) visit(x, `${where}.${k}`, allowed);
  };
  for (const m of messages) {
    for (const c of m.updateComponents?.components ?? []) {
      for (const [k, v] of Object.entries(c as Json)) {
        if (k === "action") visit((v as Json)?.event?.context, `${c.id}.action.event.context`, true);
        else if (k === "value" && c.component === "TextField") visit(v, `${c.id}.value`, true);
        else visit(v, `${c.id}.${k}`, false);
      }
    }
  }
  return issues;
}
