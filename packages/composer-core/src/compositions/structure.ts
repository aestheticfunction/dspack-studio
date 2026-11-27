/**
 * Compositions: the structure of a state's template, and where each rendered component came from.
 *
 * Authoring selects TEMPLATE elements, never rendered instances. An element's identity is definition-level:
 *
 *   - a node with a literal id is `#<id>`, the same in every state that has it (inputs and actions already
 *     bind by that id, so this is the identity they use);
 *   - any other node is `<state>@<path>`, its position in that state's template (child indices, a repeat or a
 *     condition counting as one child of its parent).
 *
 * Neither depends on data, on how many items a repeat produced, or on the emitter's ids (which carry
 * per-item suffixes and layout wrappers and are never read as identities, as bindings.ts already holds).
 *
 * Where a rendered component came from is worked out by structure from the instance's own evidence: its
 * governed expansion and its emitted components, walked alongside the template, with each repeat's item
 * count read from the same data. The walk is checked against the bindings' own item evidence (each repeated
 * action's item index); any disagreement, or a template this walk cannot follow (a condition), gives no map
 * at all rather than a guess. A missing map only means the canvas cannot be used to select; the structure
 * itself is always available.
 */
import { slug } from "@aestheticfunction/dspack-emit";
import type { TemplateChild } from "../blocks/schema";
import { childRefs } from "./bindings";
import { readPath } from "./expand";
import type { Instance } from "./instantiate";
import type { CompositionDefinition, CompositionState } from "./schema";

type Json = Record<string, any>;

export interface StructureNode {
  /** The definition-level identity (see above). */
  key: string;
  kind: "element" | "repeat" | "condition";
  /** Position in the state's template: "" is the root; "1.0" is the first child of the root's second child. */
  path: string;
  /** An element's template component name (for example "button", "text-input"). */
  component?: string;
  /** An element's literal id, when it has one. */
  id?: string;
  /** An element's template props and text, as written (literals or directives such as {"$prop": "hotel.name"}). */
  props?: Json;
  text?: unknown;
  /** A repeat's source and item name. */
  repeat?: { each: string; as: string };
  /** The repeats enclosing this node, outermost first. */
  within: Array<{ each: string; as: string }>;
  children: StructureNode[];
}

/** The emitted A2UI action name of a node id (the emitter's own slug). */
export const actionNameFor = (nodeId: string): string => slug(nodeId);

/** The emitted component id of a node id outside any repeat. */
export const componentIdFor = (nodeId: string): string => slug(nodeId);

export function elementKey(stateId: string, path: string, node: Json): string {
  return typeof node.id === "string" ? `#${node.id}` : `${stateId}@${path}`;
}

/** The structure of one state's template. */
export function structureOf(state: CompositionState): StructureNode {
  const visitChildren = (children: TemplateChild[], base: string, within: StructureNode["within"]): StructureNode[] =>
    children.map((child, i) => {
      const entry = child as Json;
      const path = base ? `${base}.${i}` : String(i);
      if ("$each" in entry) {
        const repeat = { each: String(entry.$each), as: String(entry.as) };
        return { key: `${state.id}@${path}`, kind: "repeat", path, repeat, within, children: visitChildren((entry.children ?? []) as TemplateChild[], path, [...within, repeat]) };
      }
      if ("$if" in entry) {
        return { key: `${state.id}@${path}`, kind: "condition", path, within, children: [...visitChildren((entry.children ?? []) as TemplateChild[], `${path}.then`, within), ...visitChildren((entry.else ?? []) as TemplateChild[], `${path}.else`, within)] };
      }
      return visitNode(entry, path, within);
    });
  const visitNode = (node: Json, path: string, within: StructureNode["within"]): StructureNode => ({
    key: elementKey(state.id, path, node),
    kind: "element",
    path,
    component: String(node.component),
    ...(typeof node.id === "string" ? { id: node.id } : {}),
    ...(node.props !== undefined ? { props: node.props as Json } : {}),
    ...(node.text !== undefined ? { text: node.text } : {}),
    within,
    children: visitChildren((node.children ?? []) as TemplateChild[], path, within),
  });
  return visitNode(state.template as unknown as Json, "", []);
}

/** Every node of a structure, in document order. */
export function flattenStructure(root: StructureNode): StructureNode[] {
  const out: StructureNode[] = [];
  const visit = (n: StructureNode) => {
    out.push(n);
    n.children.forEach(visit);
  };
  visit(root);
  return out;
}

/** A node by key, with the nodes above it (root first, the node last). */
export function findInStructure(root: StructureNode, key: string): StructureNode[] | null {
  const trail: StructureNode[] = [];
  const visit = (n: StructureNode): boolean => {
    trail.push(n);
    if (n.key === key) return true;
    for (const c of n.children) if (visit(c)) return true;
    trail.pop();
    return false;
  };
  return visit(root) ? trail : null;
}

/** The states whose template holds an element with this key. */
export function statesWithElement(c: CompositionDefinition, key: string): string[] {
  return c.states.filter((s) => findInStructure(structureOf(s), key) !== null).map((s) => s.id);
}

export interface ElementOrigin {
  key: string;
  /** For a component inside a repeat: which item (0-based) of the innermost repeat it was rendered for. */
  item?: { each: string; as: string; index: number };
}

export interface InstanceElements {
  /** Every emitted component id (layout wrappers included) and the template element it renders. */
  byComponent: Map<string, ElementOrigin>;
  /** For each element key, the components that render it, in document order (one per item when repeated). */
  byKey: Map<string, string[]>;
}

/**
 * Where each rendered component of an instance came from. `data` is the instance's data (and parameters):
 * the same scope its expansion was made from. Null when the walk cannot be followed or does not agree with
 * the instance's own binding evidence.
 */
export function instanceElements(c: CompositionDefinition, instance: Instance, data: Json): InstanceElements | null {
  const state = c.states.find((s) => s.id === instance.state);
  if (!state) return null;
  const components = new Map<string, Json>();
  for (const m of instance.messages) for (const x of m.updateComponents?.components ?? []) components.set(String(x.id), x);
  const byComponent = new Map<string, ElementOrigin>();
  const byKey = new Map<string, string[]>();
  type Loop = { each: string; as: string; index: number };

  class Mismatch extends Error {}
  const record = (componentId: string, origin: ElementOrigin) => {
    if (byComponent.has(componentId)) throw new Mismatch(`component '${componentId}' reached twice`);
    byComponent.set(componentId, origin);
  };

  // An element: its expanded node and its emitted component, then its children in parallel.
  const visitElement = (template: Json, path: string, expanded: Json, componentId: string, env: Json, loops: Loop[]) => {
    if (expanded?.component !== template.component) throw new Mismatch(`expected a ${String(template.component)} at ${path || "root"}`);
    const key = elementKey(state.id, path, template);
    const loop = loops.at(-1);
    const origin: ElementOrigin = loop ? { key, item: { ...loop } } : { key };
    record(componentId, origin);
    byKey.set(key, [...(byKey.get(key) ?? []), componentId]);
    const expandedChildren = (expanded.children ?? []) as Json[];
    let component = components.get(componentId);
    if (!component) throw new Mismatch(`component '${componentId}' was not emitted`);
    let refs = childRefs(component);
    // A layout wrapper the emitter inserts (for example a card's column) renders the same element.
    while (refs.length === 1 && expandedChildren.length !== 1) {
      const wrapper = refs[0]!;
      record(wrapper, origin);
      component = components.get(wrapper);
      if (!component) throw new Mismatch(`component '${wrapper}' was not emitted`);
      refs = childRefs(component);
    }
    if (refs.length !== expandedChildren.length) throw new Mismatch(`${key}: ${refs.length} emitted children for ${expandedChildren.length} expanded`);
    let next = 0;
    const take = () => {
      if (next >= expandedChildren.length) throw new Mismatch(`${key}: fewer expanded children than the template yields`);
      const at = next++;
      return { expanded: expandedChildren[at]!, componentId: refs[at]! };
    };
    const visitChildren = (children: TemplateChild[], base: string, scope: Json, loopsHere: Loop[]) => {
      children.forEach((child, i) => {
        const entry = child as Json;
        const p = base ? `${base}.${i}` : String(i);
        if ("$if" in entry) throw new Mismatch("conditions are not followed");
        if ("$each" in entry) {
          const source = readPath(scope, String(entry.$each));
          if (source === undefined) return;
          if (!Array.isArray(source)) throw new Mismatch(`'${String(entry.$each)}' is not an array`);
          source.forEach((item, n) => {
            const inner = { ...scope, [String(entry.as)]: item };
            visitChildren((entry.children ?? []) as TemplateChild[], p, inner, [...loopsHere, { each: String(entry.$each), as: String(entry.as), index: n }]);
          });
          return;
        }
        const t = take();
        visitElement(entry, p, t.expanded, t.componentId, scope, loopsHere);
      });
    };
    visitChildren((template.children ?? []) as TemplateChild[], path, env, loops);
    if (next !== expandedChildren.length) throw new Mismatch(`${key}: more expanded children than the template yields`);
  };

  try {
    visitElement(state.template as unknown as Json, "", instance.expansion.root as Json, "root", data, []);
  } catch (e) {
    if (e instanceof Mismatch) return null;
    throw e;
  }
  // Every emitted component is accounted for, and the bindings' own item evidence agrees.
  if (byComponent.size !== components.size) return null;
  for (const a of instance.actions) {
    const origin = byComponent.get(a.componentId);
    if (!origin) return null;
    const declared = c.actions.find((x) => x.name === a.name);
    if (declared && origin.key !== `#${declared.node}`) return null;
    if (a.item && origin.item?.index !== a.item.index) return null;
  }
  for (const input of instance.inputs) if (byComponent.get(input.componentId)?.key !== `#${c.inputs.find((i) => i.name === input.name)?.node}`) return null;
  return { byComponent, byKey };
}
