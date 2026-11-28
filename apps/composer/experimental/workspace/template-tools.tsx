"use client";

/**
 * Structure editing controls (M1 visual template editing), shown in the Structure panel for a draft: add an
 * element before, after or inside the selected one; move it up, down or into another container; remove it,
 * with what depends on it said first; undo and redo. Explicit, keyboard-reachable controls; no drag and drop.
 *
 * Every panel closes with Escape or its own Cancel, and focus returns to the control that opened it (F8). Add
 * opens only where something can be added, on a position and component that work, found by trying each on a
 * copy through the loader first (F5); the loader stays the authority when it is confirmed.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { dependenciesOf, findInStructure, structureOf, type CompositionDefinition, type Position } from "@dspack-studio/composer-core/compositions";
import { describeDependencies, insertOptions, moveTargets, siblingMove, type Insertable } from "./template-editing";
import { elementName, elementSummary } from "./structure-panel";

type Json = Record<string, any>;

export interface TemplateOps {
  insert: (at: { key: string; position: Position }, component: Insertable, label: string) => Promise<string | null>;
  move: (to: { key: string; position: Position }, what?: string) => Promise<string | null>;
  remove: (resolve: boolean) => Promise<string | null>;
  /** Whether a component can go at a place, tried on a copy through the loader; null when it can. */
  check: (at: { key: string; position: Position }, component: Insertable) => Promise<string | null>;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  canUndo: boolean;
  canRedo: boolean;
  /** The latest edit's result, shown here so it stays visible beside the controls that made it (F6). */
  status: { text: string; tone: "ok" | "bad"; n: number } | null;
}

const POSITIONS: Position[] = ["after", "inside", "before"];
type Placement = Record<Position, Array<{ component: Insertable; label: string; hint: string; blocked?: string }>>;

export function TemplateTools({ definition, contract, stateId, selected, ops }: { definition: CompositionDefinition; contract: Json; stateId: string; selected: string | null; ops: TemplateOps }) {
  const [panel, setPanel] = useState<"add" | "move" | "remove" | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [position, setPosition] = useState<Position>("after");
  const [component, setComponent] = useState<Insertable>("text");
  const [label, setLabel] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { label: useId(), target: useId(), remove: useId() };
  const errorRef = useRef<HTMLParagraphElement>(null);
  const opener = useRef<Record<"add" | "move" | "remove", HTMLButtonElement | null>>({ add: null, move: null, remove: null });
  const firstField = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const history = useRef<{ undo: HTMLButtonElement | null; redo: HTMLButtonElement | null; pressed: "undo" | "redo" | null }>({ undo: null, redo: null, pressed: null });
  // A refusal takes focus once, so it is read out and the designer is where the explanation is.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    setPanel(null);
    setPlacement(null);
    setError(null);
  }, [selected, definition.version]);
  // An opened panel takes focus at its first field.
  useEffect(() => {
    if (panel === "add" || panel === "move") firstField.current?.focus();
  }, [panel]);
  // Undo or Redo that disables itself hands focus to the other, or to the tree, never to the page (F8).
  useEffect(() => {
    const h = history.current;
    if (!h.pressed) return;
    const gone = h.pressed === "undo" ? !ops.canUndo : !ops.canRedo;
    if (!gone) return;
    const other = h.pressed === "undo" ? h.redo : h.undo;
    h.pressed = null;
    if (other && !other.disabled) other.focus();
    else (document.querySelector<HTMLElement>('[data-testid="structure-tree"] [aria-selected="true"]') ?? document.querySelector<HTMLElement>('[data-testid="structure-tree"] [role="treeitem"]'))?.focus();
  }, [ops.canUndo, ops.canRedo]);

  const state = definition.states.find((s) => s.id === stateId)!;
  const trail = selected ? findInStructure(structureOf(state), selected) : null;
  const node = trail?.at(-1);
  const isRoot = !!trail && trail.length === 1;
  const options = placement?.[position] ?? [];
  const chosen = options.find((o) => o.component === component);
  const up = selected ? siblingMove(definition, stateId, selected, "up") : null;
  const down = selected ? siblingMove(definition, stateId, selected, "down") : null;
  const targets = selected ? moveTargets(definition, stateId, selected) : [];
  const deps = selected && !isRoot ? dependenciesOf(definition, stateId, selected) : null;
  const effects = deps ? describeDependencies(deps) : [];
  const named = node ? `${elementName(node)}${elementSummary(node) ? ` “${elementSummary(node)}”` : ""}` : "it";

  const close = (which: "add" | "move" | "remove") => {
    setPanel(null);
    setTimeout(() => opener.current[which]?.focus(), 0);
  };
  const onPanelKey = (which: "add" | "move" | "remove") => (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    e.preventDefault();
    close(which);
  };
  const run = async (p: Promise<string | null>) => {
    const problem = await p;
    setError(problem);
    if (!problem) setPanel(null);
  };

  /** Try every position and component on a copy, then open on the first that works, or say why none does. */
  const openAdd = async () => {
    if (!selected) return;
    if (panel === "add") return close("add");
    setBusy(true);
    setError(null);
    const found = {} as Placement;
    for (const p of POSITIONS) {
      found[p] = await Promise.all(
        insertOptions(definition, contract, stateId, selected, p).map(async (o) => {
          if (o.blocked) return o;
          const why = await ops.check({ key: selected, position: p }, o.component);
          return why ? { ...o, blocked: why } : o;
        }),
      );
    }
    setBusy(false);
    const works = (p: Position) => found[p].some((o) => !o.blocked);
    const start = POSITIONS.find((p) => p === position && works(p)) ?? POSITIONS.find(works);
    if (!start) {
      const reasons = [...new Set(POSITIONS.flatMap((p) => found[p].map((o) => o.blocked!)))];
      setError(`Nothing can be added around this element. ${reasons[0] ?? ""}`.trim());
      return;
    }
    setPlacement(found);
    setPosition(start);
    if (!found[start].some((o) => o.component === component && !o.blocked)) setComponent(found[start].find((o) => !o.blocked)!.component);
    setPanel("add");
  };
  const choosePosition = (p: Position) => {
    setPosition(p);
    const list = placement?.[p] ?? [];
    if (!list.some((o) => o.component === component && !o.blocked)) {
      const first = list.find((o) => !o.blocked);
      if (first) setComponent(first.component);
    }
  };
  const positionBlocked = (p: Position) => {
    const list = placement?.[p] ?? [];
    return list.length > 0 && list.every((o) => o.blocked) ? list[0]!.blocked! : null;
  };
  const step = async (which: "undo" | "redo") => {
    history.current.pressed = which;
    await (which === "undo" ? ops.undo() : ops.redo());
  };

  return (
    <div className="cl-tt" data-testid="template-tools">
      <div className="cl-tt__row" role="group" aria-label="Edit the structure">
        <button className="cl-tool" ref={(el) => void (opener.current.add = el)} onClick={() => void openAdd()} aria-expanded={panel === "add"} disabled={!selected || busy} data-testid="tt-add">
          Add element…
        </button>
        <button className="cl-tool" onClick={() => up && void run(ops.move(up, "Moved up."))} disabled={!up || isRoot} data-testid="tt-up" aria-label="Move up">
          ↑ Up
        </button>
        <button className="cl-tool" onClick={() => down && void run(ops.move(down, "Moved down."))} disabled={!down || isRoot} data-testid="tt-down" aria-label="Move down">
          ↓ Down
        </button>
        <button className="cl-tool" ref={(el) => void (opener.current.move = el)} onClick={() => (panel === "move" ? close("move") : setPanel("move"))} aria-expanded={panel === "move"} disabled={!selected || isRoot || targets.length === 0} data-testid="tt-move">
          Move to…
        </button>
        <button className="cl-tool" ref={(el) => void (opener.current.remove = el)} onClick={() => (panel === "remove" ? close("remove") : setPanel("remove"))} aria-expanded={panel === "remove"} disabled={!selected || isRoot} data-testid="tt-remove">
          Remove…
        </button>
        <button className="cl-tool" ref={(el) => void (history.current.undo = el)} onClick={() => void step("undo")} disabled={!ops.canUndo} data-testid="tt-undo">
          Undo
        </button>
        <button className="cl-tool" ref={(el) => void (history.current.redo = el)} onClick={() => void step("redo")} disabled={!ops.canRedo} data-testid="tt-redo">
          Redo
        </button>
      </div>
      {ops.status && !error && (
        <p className={`cl-tt__status${ops.status.tone === "bad" ? " cl-tt__status--bad" : ""}`} data-testid="tt-status">
          {ops.status.text}
        </p>
      )}
      {!selected && <p className="cl-dim">Select an element below or on the canvas to add, move or remove elements around it.</p>}

      {panel === "add" && selected && placement && (
        <div className="cl-tt__panel" role="group" aria-label="Add an element" data-testid="tt-add-panel" onKeyDown={onPanelKey("add")}>
          <fieldset className="cl-tt__where">
            <legend className="cl-label">Where</legend>
            {(["before", "after", "inside"] as Position[]).map((p) => {
              const why = positionBlocked(p);
              return (
                <label key={p} className="cl-check">
                  <input type="radio" name="tt-position" checked={position === p} onChange={() => choosePosition(p)} disabled={!!why} data-testid={`tt-pos-${p}`} aria-describedby={why ? `${ids.label}-${p}` : undefined} />
                  <span>
                    {p === "inside" ? "Inside it, at the end" : p === "before" ? "Before it" : "After it"}
                    {why && (
                      <span className="cl-tt__why" id={`${ids.label}-${p}`}>
                        {" "}
                        {why}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <p className="cl-label">Component</p>
          <ul className="cl-tt__options" data-testid="tt-components">
            {options.map((o) => (
              <li key={o.component}>
                <label className={`cl-tt__option${o.blocked ? " cl-tt__option--blocked" : ""}`}>
                  <input
                    type="radio"
                    name="tt-component"
                    checked={component === o.component}
                    onChange={() => setComponent(o.component)}
                    disabled={!!o.blocked}
                    data-testid={`tt-component-${o.component}`}
                    ref={component === o.component ? (el) => void (firstField.current = el) : undefined}
                  />
                  <span>
                    <strong>{o.label}</strong> <span className={o.blocked ? "cl-tt__why" : "cl-dim"}>{o.blocked ?? o.hint}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <label className="cl-field__label" htmlFor={ids.label}>
            {component === "text" ? "Text" : "Label"}
          </label>
          <input id={ids.label} className="af-input cl-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={component === "button" ? "for example Show map" : "Optional"} data-testid="tt-label" />
          {(component === "button" || component === "text-input") && <p className="cl-dim">{component === "button" ? "A button always sends an action: it is declared with it, previewed only. Set what it sends in the inspector." : "A text field takes typed input: it is declared with it. Set its rules in the inspector."}</p>}
          <div className="cl-bar__actions">
            <button className="cl-tool cl-tool--primary" disabled={!chosen || !!chosen.blocked} onClick={() => void run(ops.insert({ key: selected, position }, component, label))} data-testid="tt-add-confirm">
              Add {chosen?.label.toLowerCase() ?? "element"}
            </button>
            <button className="cl-tool" onClick={() => close("add")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {panel === "move" && selected && (
        <div className="cl-tt__panel" role="group" aria-label="Move the element" data-testid="tt-move-panel" onKeyDown={onPanelKey("move")}>
          <label className="cl-field__label" htmlFor={ids.target}>
            Move it into
          </label>
          <select id={ids.target} className="af-select cl-input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} data-testid="tt-move-target" ref={(el) => void (firstField.current = el)}>
            <option value="">Choose a container…</option>
            {targets.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <div className="cl-bar__actions">
            <button className="cl-tool cl-tool--primary" disabled={!moveTo} onClick={() => void run(ops.move({ key: moveTo, position: "inside" }))} data-testid="tt-move-confirm">
              Move it there
            </button>
            <button className="cl-tool" onClick={() => close("move")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {panel === "remove" && selected && (
        <div className="cl-tt__confirm" role="group" aria-labelledby={ids.remove} data-testid="tt-remove-panel" onKeyDown={onPanelKey("remove")}>
          <p className="cl-tt__title" id={ids.remove}>
            Remove {named}
            {node && node.children.length ? " and everything inside it" : ""} from this state?
          </p>
          {effects.length ? (
            <>
              <p className="cl-text">Other declarations depend on it. Removing it also changes them, in the same step:</p>
              <ul className="cl-plain" data-testid="tt-remove-effects">
                {effects.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="cl-text">Nothing else depends on it.</p>
          )}
          <p className="cl-dim">Undo brings it back while you work on this draft.</p>
          <div className="cl-tt__actions">
            <button className="cl-tool cl-tool--danger" onClick={() => void run(ops.remove(effects.length > 0))} data-testid="tt-remove-confirm">
              {effects.length ? `Remove it and update ${effects.length} declaration${effects.length > 1 ? "s" : ""}` : "Remove it"}
            </button>
            <button className="cl-tool" onClick={() => close("remove")} autoFocus>
              Keep it
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="cl-field__error" role="alert" data-testid="tt-error" tabIndex={-1} ref={errorRef}>
          Not done: {error}
        </p>
      )}
    </div>
  );
}
