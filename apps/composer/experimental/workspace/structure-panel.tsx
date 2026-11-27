"use client";

/**
 * Structure (M1 advanced authoring): the elements of one state's template, as a tree a designer can move
 * through with the keyboard. One selection is shared by this tree, the canvas and the inspector.
 *
 * The tree lists TEMPLATE elements: a repeat is one node ("Each hotel"), and what it yields is listed once,
 * however many items the example has. How many are on the canvas is said beside it.
 */
import { useRef, type KeyboardEvent } from "react";
import { flattenStructure, type CompositionDefinition, type StructureNode } from "@dspack-studio/composer-core/compositions";

type Json = Record<string, any>;

export const COMPONENT_LABEL: Record<string, string> = {
  card: "Card",
  text: "Text",
  list: "List",
  "selectable-card": "Selectable card",
  "metadata-list": "Details list",
  button: "Button",
  "text-input": "Text field",
  "alert-dialog": "Confirmation dialog",
};

const words = (s: string) => {
  const w = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.-]+/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** A template value as a designer reads it: literal text in quotes, data in angle quotes. */
export function describeTemplateValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const v = value as Json;
    if (typeof v.$prop === "string") return `‹${words(v.$prop).toLowerCase()}›`;
    if (Array.isArray(v.$concat)) return v.$concat.map(describeTemplateValue).join("");
  }
  return "…";
}

export function elementName(node: StructureNode): string {
  if (node.kind === "repeat") return `Each ${words(node.repeat!.as).toLowerCase()}`;
  if (node.kind === "condition") return "Shown when";
  return COMPONENT_LABEL[node.component!] ?? words(node.component!);
}

/** The short text that tells one element from its siblings: its label, title or text. */
export function elementSummary(node: StructureNode): string {
  if (node.kind === "repeat") return `from ${words(node.repeat!.each).toLowerCase()}`;
  const p = node.props ?? {};
  const v = p.label ?? p.title ?? node.text ?? p.actionLabel ?? (Array.isArray(p.items) ? `${p.items.length} rows` : undefined);
  const s = v === undefined ? "" : describeTemplateValue(v);
  return s.length > 48 ? `${s.slice(0, 47)}…` : s;
}

export function StructurePanel({
  definition,
  structure,
  stateId,
  shownState,
  states,
  onState,
  selected,
  onSelect,
  onOpen,
  counts,
}: {
  definition: CompositionDefinition;
  structure: StructureNode;
  stateId: string;
  shownState: string | null;
  states: Array<{ id: string; label: string }>;
  onState: (id: string) => void;
  selected: string | null;
  onSelect: (key: string) => void;
  /** Enter or Space on an element: open it in the inspector. */
  onOpen: (key: string) => void;
  /** How many components render each element on the canvas now (absent when the canvas cannot be mapped). */
  counts: Map<string, number> | null;
}) {
  const tree = useRef<HTMLUListElement>(null);
  const flat = flattenStructure(structure);
  const parentOf = new Map<string, string>();
  const index = (n: StructureNode) => n.children.forEach((c) => (parentOf.set(c.key, n.key), index(c)));
  index(structure);
  const focusKey = selected && flat.some((n) => n.key === selected) ? selected : structure.key;

  // Every item is already in the tree, so focus moves at once; the selection (and the canvas) follow.
  const move = (key: string) => {
    tree.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
    onSelect(key);
  };
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const current = (document.activeElement as HTMLElement | null)?.dataset.key;
    if (!current) return;
    const at = flat.findIndex((n) => n.key === current);
    const node = flat[at]!;
    let to: string | undefined;
    if (e.key === "ArrowDown") to = flat[at + 1]?.key;
    else if (e.key === "ArrowUp") to = flat[at - 1]?.key;
    else if (e.key === "Home") to = flat[0]?.key;
    else if (e.key === "End") to = flat.at(-1)?.key;
    else if (e.key === "ArrowRight") to = node.children[0]?.key;
    else if (e.key === "ArrowLeft") to = parentOf.get(current);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(current);
      return;
    } else return;
    e.preventDefault();
    if (to) move(to);
  };

  const badge = (n: StructureNode): string | null => {
    if (n.kind !== "element" || !n.id) return null;
    const input = definition.inputs.find((i) => i.node === n.id);
    if (input) return input.sensitive ? "Typed · private" : "Typed";
    const action = definition.actions.find((a) => a.node === n.id);
    if (action) return action.consequential ? "Sends · confirms" : "Sends";
    return null;
  };

  const item = (n: StructureNode, level: number) => {
    const count = counts?.get(n.key);
    const b = badge(n);
    return (
      <li key={n.key} role="none">
        <div
          role="treeitem"
          aria-level={level}
          aria-selected={selected === n.key}
          aria-expanded={n.children.length ? true : undefined}
          tabIndex={n.key === focusKey ? 0 : -1}
          data-key={n.key}
          data-testid={`structure-${n.key}`}
          className={`cl-tree__item${selected === n.key ? " cl-tree__item--on" : ""}${n.kind !== "element" ? " cl-tree__item--group" : ""}`}
          onClick={() => onSelect(n.key)}
          onDoubleClick={() => onOpen(n.key)}
        >
          <span className="cl-tree__name">{elementName(n)}</span>
          {elementSummary(n) && <span className="cl-tree__summary">{elementSummary(n)}</span>}
          {b && <span className="cl-tree__badge">{b}</span>}
          {n.within.length > 0 && n.kind === "element" && count !== undefined && <span className="cl-tree__count">×{count}</span>}
        </div>
        {n.children.length > 0 && <ul role="group">{n.children.map((c) => item(c, level + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="cl-structure" data-testid="structure-panel">
      <label className="cl-label" htmlFor="cl-structure-state">
        State
      </label>
      <select id="cl-structure-state" className="af-select cl-input" value={stateId} onChange={(e) => onState(e.target.value)} data-testid="structure-state">
        {states.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
            {s.id === shownState ? " (on the canvas)" : ""}
          </option>
        ))}
      </select>
      {stateId !== shownState && <p className="cl-dim">This state is not on the canvas with the chosen example. Its elements can still be selected and inspected.</p>}
      <p className="cl-dim">Arrow keys move through the structure; the canvas and the inspector follow. Enter opens the inspector.</p>
      <ul className="cl-tree" role="tree" aria-label={`Structure of ${definition.name}`} ref={tree} onKeyDown={onKey} data-testid="structure-tree">
        {item(structure, 1)}
      </ul>
    </div>
  );
}
