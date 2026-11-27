"use client";

/**
 * Structure editing controls (M1 visual template editing), shown in the Structure panel for a draft: add an
 * element before, after or inside the selected one; move it up, down or into another container; remove it,
 * with what depends on it said first; undo and redo. Explicit, keyboard-reachable controls; no drag and drop.
 */
import { useEffect, useId, useRef, useState } from "react";
import { dependenciesOf, findInStructure, structureOf, type CompositionDefinition, type Position } from "@dspack-studio/composer-core/compositions";
import { describeDependencies, insertOptions, moveTargets, siblingMove, type Insertable } from "./template-editing";

type Json = Record<string, any>;

export interface TemplateOps {
  insert: (at: { key: string; position: Position }, component: Insertable, label: string) => Promise<string | null>;
  move: (to: { key: string; position: Position }) => Promise<string | null>;
  remove: (resolve: boolean) => Promise<string | null>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function TemplateTools({ definition, contract, stateId, selected, ops }: { definition: CompositionDefinition; contract: Json; stateId: string; selected: string | null; ops: TemplateOps }) {
  const [panel, setPanel] = useState<"add" | "move" | "remove" | null>(null);
  const [position, setPosition] = useState<Position>("after");
  const [component, setComponent] = useState<Insertable>("text");
  const [label, setLabel] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ids = { label: useId(), target: useId() };
  const errorRef = useRef<HTMLParagraphElement>(null);
  // A refusal takes focus once, so it is read out and the designer is where the explanation is.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    setPanel(null);
    setError(null);
  }, [selected, definition.version]);

  const state = definition.states.find((s) => s.id === stateId)!;
  const trail = selected ? findInStructure(structureOf(state), selected) : null;
  const node = trail?.at(-1);
  const isRoot = !!trail && trail.length === 1;
  const options = selected ? insertOptions(definition, contract, stateId, selected, position) : [];
  const chosen = options.find((o) => o.component === component);
  const up = selected ? siblingMove(definition, stateId, selected, "up") : null;
  const down = selected ? siblingMove(definition, stateId, selected, "down") : null;
  const targets = selected ? moveTargets(definition, stateId, selected) : [];
  const deps = selected && !isRoot ? dependenciesOf(definition, stateId, selected) : null;
  const effects = deps ? describeDependencies(deps) : [];

  const run = async (p: Promise<string | null>) => {
    const problem = await p;
    setError(problem);
    if (!problem) setPanel(null);
  };

  return (
    <div className="cl-tt" data-testid="template-tools">
      <div className="cl-tt__row" role="group" aria-label="Edit the structure">
        <button className="cl-tool" onClick={() => setPanel(panel === "add" ? null : "add")} aria-expanded={panel === "add"} disabled={!selected} data-testid="tt-add">
          Add element…
        </button>
        <button className="cl-tool" onClick={() => up && void run(ops.move(up))} disabled={!up || isRoot} data-testid="tt-up" aria-label="Move up">
          ↑ Up
        </button>
        <button className="cl-tool" onClick={() => down && void run(ops.move(down))} disabled={!down || isRoot} data-testid="tt-down" aria-label="Move down">
          ↓ Down
        </button>
        <button className="cl-tool" onClick={() => setPanel(panel === "move" ? null : "move")} aria-expanded={panel === "move"} disabled={!selected || isRoot || targets.length === 0} data-testid="tt-move">
          Move to…
        </button>
        <button className="cl-tool" onClick={() => setPanel(panel === "remove" ? null : "remove")} aria-expanded={panel === "remove"} disabled={!selected || isRoot} data-testid="tt-remove">
          Remove…
        </button>
        <button className="cl-tool" onClick={ops.undo} disabled={!ops.canUndo} data-testid="tt-undo">
          Undo
        </button>
        <button className="cl-tool" onClick={ops.redo} disabled={!ops.canRedo} data-testid="tt-redo">
          Redo
        </button>
      </div>
      {!selected && <p className="cl-dim">Select an element below or on the canvas to add, move or remove elements around it.</p>}

      {panel === "add" && selected && (
        <div className="cl-tt__panel" role="group" aria-label="Add an element" data-testid="tt-add-panel">
          <fieldset className="cl-tt__where">
            <legend className="cl-label">Where</legend>
            {(["before", "after", "inside"] as Position[]).map((p) => (
              <label key={p} className="cl-check">
                <input type="radio" name="tt-position" checked={position === p} onChange={() => setPosition(p)} disabled={(p !== "inside" && isRoot) || (p === "inside" && node?.kind === "element" && !["card", "dialog", "list", "selectable-card"].includes(String(node.component)))} data-testid={`tt-pos-${p}`} />
                <span>{p === "inside" ? "Inside it, at the end" : p === "before" ? "Before it" : "After it"}</span>
              </label>
            ))}
          </fieldset>
          <p className="cl-label">Component</p>
          <ul className="cl-tt__options" data-testid="tt-components">
            {options.map((o) => (
              <li key={o.component}>
                <label className={`cl-tt__option${o.blocked ? " cl-tt__option--blocked" : ""}`}>
                  <input type="radio" name="tt-component" checked={component === o.component} onChange={() => setComponent(o.component)} disabled={!!o.blocked} data-testid={`tt-component-${o.component}`} />
                  <span>
                    <strong>{o.label}</strong> <span className="cl-dim">{o.blocked ?? o.hint}</span>
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
            <button className="cl-tool" onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {panel === "move" && selected && (
        <div className="cl-tt__panel" role="group" aria-label="Move the element" data-testid="tt-move-panel">
          <label className="cl-field__label" htmlFor={ids.target}>
            Move it into
          </label>
          <select id={ids.target} className="af-select cl-input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} data-testid="tt-move-target">
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
            <button className="cl-tool" onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {panel === "remove" && selected && (
        <div className="cl-bar cl-bar--confirm" role="group" aria-labelledby="tt-remove-title" data-testid="tt-remove-panel">
          <p className="cl-bar__title" id="tt-remove-title">
            Remove it{node && node.children.length ? " and everything inside it" : ""} from this state?
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
          <div className="cl-bar__actions">
            <button className="cl-tool cl-tool--danger" onClick={() => void run(ops.remove(effects.length > 0))} data-testid="tt-remove-confirm">
              {effects.length ? `Remove it and update ${effects.length} declaration${effects.length > 1 ? "s" : ""}` : "Remove it"}
            </button>
            <button className="cl-tool" onClick={() => setPanel(null)} autoFocus>
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
