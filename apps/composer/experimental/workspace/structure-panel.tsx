"use client";

/**
 * Structure (M1 advanced authoring): the elements of one state's template, as a tree a designer can move
 * through with the keyboard. One selection is shared by this tree, the canvas and the inspector.
 *
 * The tree lists TEMPLATE elements: a repeat is one node ("Each hotel"), and what it yields is listed once,
 * however many items the example has. How many are on the canvas is said beside it.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { type CompositionDefinition, type StructureNode } from "@dspack-studio/composer-core/compositions";
import { componentIcon, Icon, type IconName } from "./icons";

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
  dialog: "Dialog",
  badge: "Badge",
  table: "Table",
  "dropdown-menu": "Dropdown menu",
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

/**
 * How a Structure row is labelled (decision J1): content first. A row reads as what the element shows, with its
 * component type as the leading icon; an element that shows no text reads as its component name. The full name,
 * with the component type, always stays in the tooltip and the accessible name.
 */
export const ROW_LABEL: "content-first" | "type-first" = "content-first";
const NO_CONTENT_LABEL = new Set(["metadata-list", "table", "list"]);

/** Whether a template value shows declared data. */
const showsData = (v: unknown): boolean => !!v && typeof v === "object" && ("$prop" in (v as Json) || (Array.isArray((v as Json).$concat) && (v as Json).$concat.some(showsData)));

/** What a row carries, as glyphs with their names: data shown, typed input, private, sends, confirms. */
export function rowMarks(definition: CompositionDefinition, n: StructureNode): Array<{ icon: IconName; name: string }> {
  if (n.kind !== "element") return [];
  const out: Array<{ icon: IconName; name: string }> = [];
  const p = n.props ?? {};
  if ([p.label, p.title, n.text, p.actionLabel].some(showsData)) out.push({ icon: "bound", name: "shows data" });
  const input = n.id ? definition.inputs.find((i) => i.node === n.id) : undefined;
  if (input) out.push({ icon: "typed", name: "takes typed input" });
  if (input?.sensitive) out.push({ icon: "private", name: "private" });
  const action = n.id ? definition.actions.find((a) => a.node === n.id) : undefined;
  if (action) out.push({ icon: "sends", name: "sends an action" });
  if (action?.consequential) out.push({ icon: "confirms", name: "asks to confirm" });
  return out;
}

/** A row's visible label, and its full name for the tooltip and assistive technology. */
export function rowLabel(definition: CompositionDefinition, n: StructureNode, repeated?: number): { label: string; full: string; contentFirst: boolean } {
  const name = elementName(n);
  const summary = elementSummary(n);
  const contentFirst = ROW_LABEL === "content-first" && n.kind === "element" && !!summary && !NO_CONTENT_LABEL.has(String(n.component));
  const marks = rowMarks(definition, n).map((m) => m.name);
  const full = [name, summary, ...marks, repeated !== undefined ? `repeated ${repeated} time${repeated === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
  return { label: contentFirst ? summary : name, full, contentFirst };
}

/** Collapsed rows, kept for the session per composition version and state. */
const collapsedMemory = new Map<string, Set<string>>();

export type StructureShortcut = "up" | "down" | "remove";

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
  tools,
  focus,
  onShortcut,
  onEditStates,
}: {
  /** Open the states in the inspector: add, rename, reorder, set conditions (slice A). */
  onEditStates?: () => void;
  /** Structure editing controls for a draft (M1 visual template editing). */
  tools?: ReactNode;
  /** Move keyboard focus to an element after an edit placed, moved or removed it. */
  focus?: { key: string; n: number } | null;
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
  /** Editing shortcuts on a focused row (a draft only): Alt+Up, Alt+Down, and Delete or Backspace to ask to remove. */
  onShortcut?: (s: StructureShortcut) => void;
}) {
  const tree = useRef<HTMLUListElement>(null);
  const memoryKey = `${definition.id}@${definition.version}:${stateId}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => collapsedMemory.get(memoryKey) ?? new Set());
  useEffect(() => setCollapsed(collapsedMemory.get(memoryKey) ?? new Set()), [memoryKey]);
  const setOpen = (key: string, open: boolean) => {
    const next = new Set(collapsed);
    if (open) next.delete(key);
    else next.add(key);
    collapsedMemory.set(memoryKey, next);
    setCollapsed(next);
  };

  const parentOf = new Map<string, string>();
  const index = (n: StructureNode) => n.children.forEach((c) => (parentOf.set(c.key, n.key), index(c)));
  index(structure);
  // A selection made elsewhere (the canvas, an edit) is never hidden: its collapsed ancestors open.
  useEffect(() => {
    if (!selected) return;
    const hidden: string[] = [];
    for (let k = parentOf.get(selected); k; k = parentOf.get(k)) if (collapsed.has(k)) hidden.push(k);
    if (hidden.length) {
      const next = new Set(collapsed);
      hidden.forEach((k) => next.delete(k));
      collapsedMemory.set(memoryKey, next);
      setCollapsed(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, memoryKey]);
  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => tree.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(focus.key)}"]`)?.focus(), 0);
    return () => clearTimeout(t);
  }, [focus]);

  // The rows a person can reach: everything not inside a collapsed row.
  const visible: StructureNode[] = [];
  const walk = (n: StructureNode) => {
    visible.push(n);
    if (!collapsed.has(n.key)) n.children.forEach(walk);
  };
  walk(structure);
  const focusKey = selected && visible.some((n) => n.key === selected) ? selected : structure.key;

  // Every row is already in the tree, so focus moves at once; the selection (and the canvas) follow.
  const move = (key: string) => {
    tree.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
    onSelect(key);
  };
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const current = (document.activeElement as HTMLElement | null)?.dataset.key;
    if (!current) return;
    const at = visible.findIndex((n) => n.key === current);
    const node = visible[at]!;
    const open = node.children.length > 0 && !collapsed.has(node.key);
    if (onShortcut && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      onShortcut(e.key === "ArrowUp" ? "up" : "down");
      return;
    }
    if (onShortcut && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      onShortcut("remove");
      return;
    }
    let to: string | undefined;
    if (e.key === "ArrowDown") to = visible[at + 1]?.key;
    else if (e.key === "ArrowUp") to = visible[at - 1]?.key;
    else if (e.key === "Home") to = visible[0]?.key;
    else if (e.key === "End") to = visible.at(-1)?.key;
    else if (e.key === "ArrowRight") {
      // A collapsed row opens first; an open one moves to its first child.
      if (node.children.length && !open) {
        e.preventDefault();
        setOpen(node.key, true);
        return;
      }
      to = node.children[0]?.key;
    } else if (e.key === "ArrowLeft") {
      // An open row closes first; otherwise focus moves to the parent.
      if (open) {
        e.preventDefault();
        setOpen(node.key, false);
        return;
      }
      to = parentOf.get(current);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(current);
      return;
    } else return;
    e.preventDefault();
    if (to) move(to);
  };

  const item = (n: StructureNode, level: number) => {
    // A repeat says once how many items it shows now; what it repeats is listed once.
    const repeated = n.kind === "repeat" && n.children[0] && counts ? counts.get(n.children[0].key) : undefined;
    const { label, full, contentFirst } = rowLabel(definition, n, repeated);
    const marks = rowMarks(definition, n);
    const hasChildren = n.children.length > 0;
    const open = hasChildren && !collapsed.has(n.key);
    const icon: IconName = n.kind === "repeat" ? "repeat" : n.kind === "condition" ? "condition" : componentIcon(n.component);
    return (
      <li key={n.key} role="none">
        <div
          role="treeitem"
          aria-level={level}
          aria-selected={selected === n.key}
          aria-expanded={hasChildren ? open : undefined}
          aria-label={full}
          title={full}
          tabIndex={n.key === focusKey ? 0 : -1}
          data-key={n.key}
          data-testid={`structure-${n.key}`}
          className={`cl-tree__item${selected === n.key ? " cl-tree__item--on" : ""}${n.kind !== "element" ? " cl-tree__item--group" : ""}`}
          style={{ ["--level" as string]: level - 1 }}
          onClick={() => onSelect(n.key)}
          onDoubleClick={() => onOpen(n.key)}
        >
          <span
            className={`cl-tree__chev${hasChildren ? "" : " cl-tree__chev--none"}${open ? " cl-tree__chev--open" : ""}`}
            aria-hidden="true"
            data-testid={hasChildren ? `structure-toggle-${n.key}` : undefined}
            onClick={(e) => {
              if (!hasChildren) return;
              e.stopPropagation();
              setOpen(n.key, !open);
            }}
          >
            <Icon name="chevron" />
          </span>
          <Icon name={icon} className="cl-tree__type" />
          <span className={`cl-tree__label${contentFirst ? "" : " cl-tree__label--name"}`}>{label}</span>
          {marks.length > 0 && (
            <span className="cl-tree__marks" aria-hidden="true">
              {marks.map((m) => (
                <Icon key={m.icon} name={m.icon} />
              ))}
            </span>
          )}
          {repeated !== undefined && (
            <span className="cl-tree__count" aria-hidden="true">
              ×{repeated}
            </span>
          )}
        </div>
        {open && <ul role="group">{n.children.map((c) => item(c, level + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="cl-structure" data-testid="structure-panel">
      <div className="cl-structure__state">
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
        {onEditStates && (
          <button className="cl-tool cl-structure__states" onClick={onEditStates} title="States: add, rename, reorder, set conditions" data-testid="edit-states">
            States…
          </button>
        )}
      </div>
      {stateId !== shownState && <p className="cl-dim cl-structure__note">Not on the canvas with this example. Its elements can still be selected and inspected.</p>}
      {tools}
      <ul className="cl-tree" role="tree" aria-label={`Structure of ${definition.name}`} ref={tree} onKeyDown={onKey} data-testid="structure-tree">
        {item(structure, 1)}
      </ul>
      <details className="cl-keys" data-testid="structure-keys">
        <summary>Keyboard shortcuts</summary>
        <dl className="cl-keys__list">
          <dt>↑ ↓, Home, End</dt>
          <dd>Move through the structure; the canvas and the inspector follow</dd>
          <dt>← →</dt>
          <dd>Close or open a group, then move out or in</dd>
          <dt>Enter</dt>
          <dd>Open the selected element in the inspector</dd>
          {onShortcut && (
            <>
              <dt>Alt ↑, Alt ↓</dt>
              <dd>Move the element up or down</dd>
              <dt>Delete</dt>
              <dd>Ask to remove the element</dd>
              <dt>Ctrl or ⌘ Z, Shift Ctrl or ⌘ Z, Ctrl Y</dt>
              <dd>Undo and redo element and structure edits</dd>
            </>
          )}
        </dl>
      </details>
    </div>
  );
}
