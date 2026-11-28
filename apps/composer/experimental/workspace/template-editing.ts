/**
 * Visual template editing (M1 advanced authoring): what an element shows, its identity, and the component tree,
 * on a draft. The designer's side of composer-core's template.ts.
 *
 * Nothing here is a new schema, expression language or pipeline. Content is the template language that already
 * exists: fixed text, a reference to a declared field ({ $prop }), or text and fields joined ({ $concat }), and a
 * component's props as the contract declares them (enums from its own values). A designer picks; nothing is
 * typed as an expression. Every change is one edit through editDraft, validated by the loader, previewed through
 * the governed pipeline, and invalidates the draft's checks.
 */
import {
  actionNameFor,
  assignId,
  CONTAINERS,
  dependenciesOf,
  findInStructure,
  insertNode,
  locate,
  moveNode,
  removeNode,
  renameId,
  structureOf,
  uniqueId,
  type CompositionDefinition,
  type Dependencies,
  type Position,
  type StructureNode,
} from "@dspack-studio/composer-core/compositions";
import { applyActionChange, applyInputChange, inputNameFor, plainInteractionIssue } from "./interaction";

type Json = Record<string, any>;

const words = (s: string) => {
  const w = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.-]+/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

// ---- The contract's vocabulary -------------------------------------------------------------------------------

export interface PropControl {
  name: string;
  label: string;
  kind: "text" | "enum" | "boolean";
  values?: string[];
  description?: string;
  /** The design system's own value when the prop is not set. */
  default?: unknown;
}

/** Props that are not edited as content: data-shaped props, and a field's type (masking follows "Private"). */
const NOT_CONTENT = new Set(["items", "data", "columns", "type:text-input"]);

/** What a designer can set on an element: its text (for Text) and the contract's own props for its component. */
export function editableContent(contract: Json, node: StructureNode): PropControl[] {
  if (node.kind !== "element") return [];
  const spec = (contract.components ?? {})[node.component!] as Json | undefined;
  const out: PropControl[] = [];
  if (node.component === "text") out.push({ name: "text", label: "Text", kind: "text" });
  for (const [name, p] of Object.entries((spec?.props ?? {}) as Record<string, Json>)) {
    if (NOT_CONTENT.has(name) || NOT_CONTENT.has(`${name}:${node.component}`)) continue;
    const kind = p.type === "enum" ? "enum" : p.type === "boolean" ? "boolean" : p.type === "string" ? "text" : null;
    if (!kind) continue;
    out.push({ name, label: words(name), kind, ...(p.values ? { values: p.values as string[] } : {}), ...(p.description ? { description: String(p.description) } : {}), ...(p.default !== undefined ? { default: p.default } : {}) });
  }
  return out;
}

export interface Field {
  path: string;
  label: string;
  /** "data", "parameter", or the item of a repeat. */
  source: string;
}

const SCALAR = new Set(["string", "integer", "number", "boolean", "enum"]);

/** The declared fields an element can show: data and parameters, their object fields, and each enclosing repeat's item fields. */
export function fieldsInScope(c: CompositionDefinition, node: StructureNode): Field[] {
  const out: Field[] = [];
  const add = (specs: Json[], source: string) => {
    for (const s of specs) {
      if (SCALAR.has(String(s.type))) out.push({ path: String(s.name), label: words(String(s.name)), source });
      else if (s.type === "object") for (const p of (s.props ?? []) as Json[]) if (SCALAR.has(String(p.type))) out.push({ path: `${s.name}.${p.name}`, label: `${words(String(s.name))} ${words(String(p.name)).toLowerCase()}`, source });
    }
  };
  add(c.parameters as Json[], "parameter");
  add(c.data as Json[], "data");
  for (const loop of node.within) {
    const list = ([...c.parameters, ...c.data] as Json[]).find((s) => s.name === loop.each);
    for (const p of (list?.items?.props ?? []) as Json[]) if (SCALAR.has(String(p.type))) out.push({ path: `${loop.as}.${p.name}`, label: `${words(loop.as)} ${words(String(p.name)).toLowerCase()}`, source: `each ${loop.as}` });
  }
  return out;
}

// ---- Text and data, as parts --------------------------------------------------------------------------------

export type Part = { kind: "text"; value: string } | { kind: "field"; path: string; fallback?: string };

/** A template value as parts a designer edits; null for anything else (left as it is, read-only). */
export function toParts(value: unknown): Part[] | null {
  if (value === undefined) return [];
  if (typeof value === "string") return [{ kind: "text", value }];
  if (typeof value === "number") return [{ kind: "text", value: String(value) }];
  const v = value as Json;
  if (v && typeof v.$prop === "string" && Object.keys(v).every((k) => k === "$prop" || k === "default")) return [{ kind: "field", path: v.$prop, ...(typeof v.default === "string" ? { fallback: v.default } : {}) }];
  if (v && Array.isArray(v.$concat) && Object.keys(v).length === 1) {
    const parts: Part[] = [];
    for (const x of v.$concat) {
      const p = toParts(x);
      if (!p || p.length !== 1) return null;
      parts.push(p[0]!);
    }
    return parts;
  }
  return null;
}

/** Parts back to the template language: one text, one field, or text and fields joined. */
export function fromParts(parts: Part[]): unknown {
  const one = (p: Part) => (p.kind === "text" ? p.value : p.fallback !== undefined ? { $prop: p.path, default: p.fallback } : { $prop: p.path });
  const kept = parts.filter((p) => !(p.kind === "text" && p.value === ""));
  if (kept.length === 0) return "";
  if (kept.length === 1) return one(kept[0]!);
  return { $concat: kept.map(one) };
}

// ---- Locating an element across states ---------------------------------------------------------------------

/** The template nodes an element key names: every state's node with that id, or the one node at that path. */
function nodesFor(c: CompositionDefinition, stateId: string, key: string): Array<{ state: string; node: Json; structure: StructureNode }> {
  const states = key.startsWith("#") ? c.states : c.states.filter((s) => s.id === stateId);
  const out: Array<{ state: string; node: Json; structure: StructureNode }> = [];
  for (const s of states) {
    const l = locate(s, key);
    const trail = findInStructure(structureOf(s), key);
    if (l && trail) out.push({ state: s.id, node: l.node, structure: trail.at(-1)! });
  }
  return out;
}

export type ContentChange = { stateId: string; key: string; field: string; value: unknown };

/** Why a content change cannot apply, in plain words; null when it can. */
export function contentProblem(c: CompositionDefinition, contract: Json, change: ContentChange): string | null {
  const nodes = nodesFor(c, change.stateId, change.key);
  if (nodes.length === 0) return "This element is no longer in the draft.";
  for (const { structure } of nodes) {
    const control = editableContent(contract, structure).find((p) => p.name === change.field);
    if (!control) return `A ${words(structure.component ?? "element").toLowerCase()} has no “${words(change.field).toLowerCase()}” to set here.`;
    // Not set: the prop is removed and the design system's default applies (F1, F2). Text is checked below.
    const reset = change.value === undefined || (change.value === "" && control.kind !== "text");
    if (reset) continue;
    if (control.kind === "enum" && !control.values!.includes(String(change.value))) return `“${String(change.value)}” is not one of the choices for ${control.label.toLowerCase()}.`;
    if (control.kind === "boolean" && typeof change.value !== "boolean") return `${control.label} is on or off.`;
    if (control.kind === "text") {
      const parts = toParts(change.value);
      if (!parts) return "Only fixed text and declared fields can be shown here.";
      const allowed = fieldsInScope(c, structure);
      for (const p of parts) {
        if (p.kind === "field" && !allowed.some((f) => f.path === p.path)) return structure.within.length ? `“${p.path}” is not a field this element can show: inside a repeat it can show the item's fields and the composition's.` : `“${p.path}” is not a declared field of this composition.`;
      }
      if (change.field === "label" && fromParts(parts) === "") return "A label cannot be empty: a person needs to know what this is.";
    }
  }
  return null;
}

/**
 * The value a boolean control stores: only what differs from the design system's default, so turning it back
 * to the default removes the prop rather than writing the default out.
 */
export const booleanValue = (control: PropControl, on: boolean): boolean | undefined => (on === (control.default === true) ? undefined : on);

/** Apply a content change to every node the key names (an id names the same element in every state). */
export function applyContent(draft: CompositionDefinition, change: ContentChange): void {
  for (const { node } of nodesFor(draft, change.stateId, change.key)) {
    if (change.field === "text") {
      if (change.value === "") delete node.text;
      else node.text = change.value;
      continue;
    }
    const props = { ...((node.props as Json | undefined) ?? {}) };
    if (change.value === "" || change.value === undefined) delete props[change.field];
    else props[change.field] = change.value;
    if (Object.keys(props).length) node.props = props;
    else delete node.props;
  }
}

/** The states an element key appears in: a content change to an element with an id applies in all of them. */
export const statesShowing = (c: CompositionDefinition, stateId: string, key: string) => nodesFor(c, stateId, key).map((n) => n.state);

// ---- Inserting components -----------------------------------------------------------------------------------

export type Insertable = "text" | "badge" | "button" | "text-input" | "card" | "selectable-card";

export const INSERTABLE: Array<{ component: Insertable; label: string; hint: string }> = [
  { component: "text", label: "Text", hint: "A line or paragraph of text." },
  { component: "badge", label: "Badge", hint: "A short label, such as “New” or “Popular”." },
  { component: "button", label: "Button", hint: "Something a person presses. It sends an action, previewed only." },
  { component: "text-input", label: "Text field", hint: "Something a person types into." },
  { component: "card", label: "Card", hint: "A box that groups other elements." },
  { component: "selectable-card", label: "Selectable card", hint: "One option in a list a person chooses from." },
];

/** Which components can go at a place, and why the others cannot. */
export function insertOptions(c: CompositionDefinition, contract: Json, stateId: string, key: string, position: Position): Array<{ component: Insertable; label: string; hint: string; blocked?: string }> {
  const state = c.states.find((s) => s.id === stateId);
  const trail = state && findInStructure(structureOf(state), key);
  const at = trail?.at(-1);
  const parent = position === "inside" ? at : trail?.at(-2);
  const within = position === "inside" ? [...(at?.within ?? []), ...(at?.kind === "repeat" ? [at.repeat!] : [])] : (at?.within ?? []);
  return INSERTABLE.filter((x) => (contract.components ?? {})[x.component]).map((x) => {
    let blocked: string | undefined;
    if (!at || (position !== "inside" && !parent)) blocked = "Nothing can be placed beside the outermost element.";
    else if (position === "inside" && at.kind === "element" && !CONTAINERS.has(String(at.component))) blocked = `A ${words(String(at.component)).toLowerCase()} does not hold other elements.`;
    else if (parent?.component === "list" && x.component !== "selectable-card") blocked = "A list holds selectable cards.";
    else if (x.component === "selectable-card" && parent?.component !== "list" && parent?.kind !== "repeat") blocked = "A selectable card goes in a list.";
    else if (x.component === "text-input" && within.length > 0) blocked = "A text field holds one value, so it cannot be repeated for each item.";
    return { ...x, ...(blocked ? { blocked } : {}) };
  });
}

/** A new element with valid initial props, and the declarations it needs. */
function newElement(c: CompositionDefinition, component: Insertable, label: string): Json {
  const text = label.trim();
  switch (component) {
    case "text":
      return { component: "text", props: { type: "body" }, text: text || "New text" };
    case "badge":
      return { component: "badge", props: { label: text || "New" } };
    case "button":
      return { component: "button", id: uniqueId(c, text || "button"), props: { label: text || "New button", variant: "secondary" } };
    case "text-input":
      return { component: "text-input", id: uniqueId(c, text || "field"), props: { label: text || "New field" } };
    case "card":
      return { component: "card", children: [{ component: "text", props: { type: "body" }, text: text || "New card" }] };
    case "selectable-card":
      return { component: "selectable-card", props: { label: text || "New option" }, children: [{ component: "text", props: { type: "body" }, text: "Details" }] };
  }
}

export type InsertChange = { stateId: string; at: { key: string; position: Position }; component: Insertable; label: string };

/**
 * Insert, in one operation: the element, and for a button or a text field the action or typed input it needs,
 * so no button is ever left sending an undeclared action. Returns the new element's key.
 */
export function applyInsert(draft: CompositionDefinition, change: InsertChange): { ok: true; key: string } | { ok: false; reason: string } {
  const node = newElement(draft, change.component, change.label);
  const r = insertNode(draft, change.stateId, change.at, node);
  if (!r.ok) return r;
  if (change.component === "button") {
    applyActionChange(draft, { op: "declare", node: node.id });
    if (!draft.actions.some((a) => a.node === node.id)) return { ok: false, reason: "the button's action could not be declared here" };
  }
  if (change.component === "text-input") applyInputChange(draft, { op: "declare", node: node.id });
  return r;
}

// ---- Moving, removing, identity -----------------------------------------------------------------------------

/** Move one place up or down among its siblings. */
export function siblingMove(c: CompositionDefinition, stateId: string, key: string, direction: "up" | "down"): { key: string; position: Position } | null {
  const state = c.states.find((s) => s.id === stateId);
  const trail = state && findInStructure(structureOf(state), key);
  if (!trail || trail.length < 2) return null;
  const siblings = trail.at(-2)!.children;
  const at = siblings.findIndex((n) => n.key === key);
  const other = siblings[direction === "up" ? at - 1 : at + 1];
  return other ? { key: other.key, position: direction === "up" ? "before" : "after" } : null;
}

/** The containers in a state an element could move into (not itself or anything inside it). */
export function moveTargets(c: CompositionDefinition, stateId: string, key: string): Array<{ key: string; label: string; depth: number }> {
  const state = c.states.find((s) => s.id === stateId);
  if (!state) return [];
  const out: Array<{ key: string; label: string; depth: number }> = [];
  const visit = (n: StructureNode, inside: boolean, depth: number) => {
    const self = inside || n.key === key;
    if (!self && ((n.kind === "element" && CONTAINERS.has(String(n.component))) || n.kind === "repeat")) out.push({ key: n.key, depth, label: n.kind === "repeat" ? `Each ${words(n.repeat!.as).toLowerCase()}` : `${words(String(n.component))}${n.id ? ` (${n.id})` : ""}` });
    n.children.forEach((ch) => visit(ch, self, depth + 1));
  };
  visit(structureOf(state), false, 0);
  return out;
}

/** What a removal would change, in plain words. */
export function describeDependencies(d: Dependencies): string[] {
  return [
    ...d.actions.map((a) => (a.effect === "removed" ? `The “${words(a.name)}” action is removed.` : `The “${words(a.name)}” action is no longer sent from this state.`)),
    ...d.inputs.map((i) => `The typed field “${words(i)}” is removed.`),
    ...d.carries.map((x) => `“${words(x.action)}” stops sending “${words(x.input)}”.`),
  ];
}

export { assignId, dependenciesOf, moveNode, removeNode, renameId, actionNameFor, inputNameFor };

/** A template or loader refusal in plain words, naming what is being placed when it is known. */
export function plainTemplateIssue(message: string, subject = "button"): string {
  const m = message.replace(/^[A-Za-z]+(\.[A-Za-z0-9]+)*: /, "");
  const rules: Array<[RegExp, string]> = [
    [/each item must expand to exactly one node/, `Each item of a repeat must be one element, so each item's ${subject} stays with its own item. Put it inside the item's card instead.`],
    [/must hold exactly one \$each and nothing else/, "A list whose items send an action holds only its repeated items. Put the element outside the list, or inside an item."],
    [/is not inside the '([^']+)' repeat/, "A repeated button must stay inside its item."],
    [/state '([^']+)' has no node with id '([^']+)'/, "An action would be sent from a state that no longer shows its button."],
    [/no state's template has a node with id/, "A typed field would no longer be shown anywhere."],
    [/node id '([^']+)' appears twice/, "Two elements would have the same id."],
  ];
  for (const [re, say] of rules) if (re.test(m)) return say;
  return plainInteractionIssue(message);
}
