"use client";

/**
 * Structure editing controls (M1 visual template editing), shown in the Structure panel for a draft. One toolbar
 * row in three groups: Add (labelled, the primary action) | Move up, Move down, Move to | Remove. Undo and Redo
 * live with the canvas, where they are reachable whichever panel is open. No drag and drop.
 *
 * Add opens a contextual picker: a popover beside the Structure panel at 900 px and wider, so the tree and the
 * selected row stay where they are; inside the Structure sheet on a phone. It names its target, offers Before,
 * After and Inside, and says why an impossible position or component cannot be used before anything is chosen.
 * Each is tried on a copy through the loader first (the dry run), and the loader stays the authority when it is
 * confirmed. Escape or Cancel closes a panel and returns focus to the control that opened it.
 */
import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { dependenciesOf, findInStructure, structureOf, type CompositionDefinition, type Position, type StructureNode } from "@dspack-studio/composer-core/compositions";
import { describeDependencies, insertOptions, moveTargets, siblingMove, type Insertable } from "./template-editing";
import { elementName, elementSummary, type StructureShortcut } from "./structure-panel";
import { componentIcon, Icon, type IconName } from "./icons";

type Json = Record<string, any>;

export interface TemplateOps {
  insert: (at: { key: string; position: Position }, component: Insertable, label: string) => Promise<string | null>;
  move: (to: { key: string; position: Position }, what?: string) => Promise<string | null>;
  remove: (resolve: boolean) => Promise<string | null>;
  /** Whether a component can go at a place, tried on a copy through the loader; null when it can. */
  check: (at: { key: string; position: Position }, component: Insertable) => Promise<string | null>;
  /** Whether the selected element can move into a container, tried the same way; null when it can. */
  checkMove: (into: string) => Promise<string | null>;
}

export interface TemplateToolsHandle {
  shortcut: (s: StructureShortcut) => void;
}

const POSITIONS: Position[] = ["after", "inside", "before"];
const POSITION_LABEL: Record<Position, string> = { before: "Before", after: "After", inside: "Inside" };
type Option = { component: Insertable; label: string; hint: string; blocked?: string };
type Placement = Record<Position, Option[]>;

/** One toolbar control: an icon with its name as the accessible name, a tooltip with its shortcut or why it is unavailable. */
function Tool({ icon, name, shortcut, keys, reason, onClick, testid, label, refEl, expanded, danger }: { icon: IconName; name: string; shortcut?: string; keys?: string; reason?: string | null; onClick: () => void; testid: string; label?: string; refEl?: (el: HTMLButtonElement | null) => void; expanded?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      ref={refEl}
      className={`cl-tool cl-tt__tool${label ? " cl-tt__tool--label" : ""}${danger ? " cl-tt__tool--danger" : ""}`}
      aria-label={label ? undefined : name}
      aria-disabled={reason ? true : undefined}
      aria-keyshortcuts={keys}
      aria-expanded={expanded}
      title={reason ? `${name}: ${reason}` : shortcut ? `${name} (${shortcut})` : name}
      onClick={() => {
        if (!reason) onClick();
      }}
      data-testid={testid}
    >
      <Icon name={icon} />
      {label && <span>{label}</span>}
    </button>
  );
}

export const TemplateTools = forwardRef<TemplateToolsHandle, { definition: CompositionDefinition; contract: Json; stateId: string; selected: string | null; ops: TemplateOps; layout: "wide" | "medium" | "narrow"; extra?: ReactNode }>(function TemplateTools({ definition, contract, stateId, selected, ops, layout, extra }, handle) {
  const [panel, setPanel] = useState<"add" | "move" | "remove" | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [moves, setMoves] = useState<Record<string, string | null> | null>(null);
  const [position, setPosition] = useState<Position>("after");
  const [component, setComponent] = useState<Insertable>("text");
  const [label, setLabel] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const ids = { label: useId(), target: useId(), remove: useId(), title: useId(), why: useId() };
  const errorRef = useRef<HTMLParagraphElement>(null);
  const opener = useRef<Record<"add" | "move" | "remove", HTMLButtonElement | null>>({ add: null, move: null, remove: null });
  const firstField = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const picker = useRef<HTMLDivElement>(null);
  // A refusal takes focus once, so it is read out and the designer is where the explanation is.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    setPanel(null);
    setPlacement(null);
    setMoves(null);
    setError(null);
  }, [selected, definition.version]);
  // An opened panel takes focus at its first field.
  useEffect(() => {
    if (panel === "add" || panel === "move") firstField.current?.focus();
  }, [panel]);

  const state = definition.states.find((s) => s.id === stateId)!;
  const trail = selected ? findInStructure(structureOf(state), selected) : null;
  const node = trail?.at(-1);
  const parent = trail?.at(-2);
  const isRoot = !!trail && trail.length === 1;
  const options = placement?.[position] ?? [];
  const chosen = options.find((o) => o.component === component);
  const up = selected ? siblingMove(definition, stateId, selected, "up") : null;
  const down = selected ? siblingMove(definition, stateId, selected, "down") : null;
  const targets = selected ? moveTargets(definition, stateId, selected) : [];
  const deps = selected && !isRoot ? dependenciesOf(definition, stateId, selected) : null;
  const effects = deps ? describeDependencies(deps) : [];
  const nameOf = (n: StructureNode | undefined) => (n ? `${elementName(n)}${elementSummary(n) ? ` “${elementSummary(n)}”` : ""}` : "it");
  const named = nameOf(node);
  const parentName = parent ? elementName(parent) : "";

  // Why each control is unavailable now, said in its tooltip; null when it can be used.
  const why = {
    add: !selected ? "Select an element first" : null,
    up: !selected ? "Select an element first" : isRoot ? "The outermost element cannot be moved" : !up ? `Already first in ${parentName}` : null,
    down: !selected ? "Select an element first" : isRoot ? "The outermost element cannot be moved" : !down ? `Already last in ${parentName}` : null,
    move: !selected ? "Select an element first" : isRoot ? "The outermost element cannot be moved" : targets.length === 0 ? "There is no other container in this state" : null,
    remove: !selected ? "Select an element first" : isRoot ? "The outermost element cannot be removed" : null,
  };

  const close = (which: "add" | "move" | "remove") => {
    setPanel(null);
    setTimeout(() => opener.current[which]?.focus(), 0);
  };
  const onPanelKey = (which: "add" | "move" | "remove") => (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      close(which);
      return;
    }
    // Enter adds from anywhere in the picker except a button, which acts for itself.
    if (which === "add" && e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && chosen && !chosen.blocked && selected) {
      e.preventDefault();
      void run(ops.insert({ key: selected, position }, component, label));
    }
  };
  const run = async (p: Promise<string | null>) => {
    const problem = await p;
    setError(problem);
    if (!problem) setPanel(null);
  };

  /** Place the picker beside the Structure panel, clear of the tree, inside the window. */
  const place = () => {
    const b = opener.current.add?.getBoundingClientRect();
    const host = opener.current.add?.closest(".cl-panel")?.getBoundingClientRect();
    if (!b || !host) return;
    const width = 340;
    const left = host.right + 8 + width <= window.innerWidth ? host.right + 8 : Math.max(8, window.innerWidth - width - 8);
    const top = Math.max(8, Math.min(b.top, window.innerHeight - 420));
    setAt({ top, left, maxHeight: window.innerHeight - top - 12 });
  };
  useLayoutEffect(() => {
    if (panel !== "add" || layout === "narrow") return;
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, layout]);

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
          const reason = await ops.check({ key: selected, position: p }, o.component);
          return reason ? { ...o, blocked: reason } : o;
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
  const openMove = async () => {
    if (!selected) return;
    if (panel === "move") return close("move");
    setBusy(true);
    const found: Record<string, string | null> = {};
    for (const t of targets) found[t.key] = await ops.checkMove(t.key);
    setBusy(false);
    setMoves(found);
    const first = targets.find((t) => !found[t.key] && t.key !== parent?.key);
    setMoveTo(first?.key ?? "");
    setPanel("move");
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

  useImperativeHandle(handle, () => ({
    shortcut: (s) => {
      if (s === "up" && !why.up && up) void run(ops.move(up, "Moved up."));
      if (s === "down" && !why.down && down) void run(ops.move(down, "Moved down."));
      if (s === "remove" && !why.remove) setPanel("remove");
    },
  }));

  const blockedPositions = (["before", "after", "inside"] as Position[]).filter((p) => positionBlocked(p));
  const ok = options.filter((o) => !o.blocked);
  const no = options.filter((o) => o.blocked);
  const narrow = layout === "narrow";

  return (
    <div className="cl-tt" data-testid="template-tools">
      <div className="cl-tt__row" role="toolbar" aria-label="Edit the structure">
        <Tool icon="add" name="Add an element" label="Add" reason={busy ? "Working…" : why.add} onClick={() => void openAdd()} testid="tt-add" refEl={(el) => void (opener.current.add = el)} expanded={panel === "add"} />
        <span className="cl-tt__sep" aria-hidden="true" />
        <Tool icon="up" name="Move up" shortcut="Alt+↑" keys="Alt+ArrowUp" reason={why.up} onClick={() => up && void run(ops.move(up, "Moved up."))} testid="tt-up" />
        <Tool icon="down" name="Move down" shortcut="Alt+↓" keys="Alt+ArrowDown" reason={why.down} onClick={() => down && void run(ops.move(down, "Moved down."))} testid="tt-down" />
        <Tool icon="move-to" name="Move to another container" reason={busy ? "Working…" : why.move} onClick={() => void openMove()} testid="tt-move" refEl={(el) => void (opener.current.move = el)} expanded={panel === "move"} />
        <span className="cl-tt__sep" aria-hidden="true" />
        <Tool icon="remove" name="Remove" shortcut="Delete" keys="Delete" reason={why.remove} onClick={() => (panel === "remove" ? close("remove") : setPanel("remove"))} testid="tt-remove" refEl={(el) => void (opener.current.remove = el)} expanded={panel === "remove"} danger />
        {extra && <span className="cl-tt__extra">{extra}</span>}
      </div>

      {panel === "add" && selected && placement && node && (
        <div
          ref={picker}
          className={`cl-picker${narrow ? " cl-picker--sheet" : ""}`}
          role="dialog"
          aria-labelledby={ids.title}
          data-testid="tt-add-panel"
          onKeyDown={onPanelKey("add")}
          style={!narrow && at ? { top: at.top, left: at.left, maxHeight: at.maxHeight } : undefined}
        >
          <div className="cl-picker__head">
            <p className="cl-picker__title" id={ids.title}>
              <Icon name="add" />
              <span>Add to</span>
              <Icon name={node.kind === "repeat" ? "repeat" : componentIcon(node.component)} />
              <span className="cl-picker__target">{named}</span>
            </p>
            <fieldset className="cl-picker__pos" aria-describedby={blockedPositions.length ? ids.why : undefined}>
              <legend className="cl-sr">Where</legend>
              {(["before", "after", "inside"] as Position[]).map((p) => {
                const reason = positionBlocked(p);
                return (
                  <label key={p} className={`cl-picker__seg${position === p ? " cl-picker__seg--on" : ""}${reason ? " cl-picker__seg--off" : ""}`} title={reason ?? undefined}>
                    <input type="radio" name="tt-position" checked={position === p} onChange={() => choosePosition(p)} disabled={!!reason} data-testid={`tt-pos-${p}`} />
                    <span>{POSITION_LABEL[p]}</span>
                  </label>
                );
              })}
            </fieldset>
            {blockedPositions.length > 0 && (
              <p className="cl-picker__why" id={ids.why}>
                {blockedPositions.map((p) => POSITION_LABEL[p]).join(" and ")} unavailable: {positionBlocked(blockedPositions[0]!)}
              </p>
            )}
          </div>
          <div className="cl-picker__list" data-testid="tt-components">
            <p className="cl-picker__group">Can be added here</p>
            {ok.map((o) => (
              <label key={o.component} className={`cl-picker__opt${component === o.component ? " cl-picker__opt--on" : ""}`}>
                <input type="radio" name="tt-component" checked={component === o.component} onChange={() => setComponent(o.component)} data-testid={`tt-component-${o.component}`} ref={component === o.component ? (el) => void (firstField.current = el) : undefined} />
                <Icon name={componentIcon(o.component)} />
                <span className="cl-picker__name">{o.label}</span>
                <span className="cl-picker__hint">{o.hint}</span>
              </label>
            ))}
            {no.length > 0 && <p className="cl-picker__group">Cannot go here</p>}
            {no.map((o) => (
              <label key={o.component} className="cl-picker__opt cl-picker__opt--blocked">
                <input type="radio" name="tt-component" checked={false} disabled data-testid={`tt-component-${o.component}`} />
                <Icon name={componentIcon(o.component)} />
                <span className="cl-picker__name">{o.label}</span>
                <span className="cl-picker__hint cl-picker__reason">{o.blocked}</span>
              </label>
            ))}
          </div>
          <div className="cl-picker__foot">
            <label className="cl-field__label" htmlFor={ids.label}>
              {component === "text" ? "Text" : "Label"}
            </label>
            <input id={ids.label} className="af-input cl-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={component === "button" ? "for example Show map" : "Optional"} data-testid="tt-label" />
            {(component === "button" || component === "text-input") && <p className="cl-dim">{component === "button" ? "A button always sends an action: it is declared with it, previewed only. Set what it sends in the inspector." : "A text field takes typed input: it is declared with it. Set its rules in the inspector."}</p>}
            <div className="cl-tt__actions">
              <button className="cl-tool cl-tool--primary" disabled={!chosen || !!chosen.blocked} onClick={() => void run(ops.insert({ key: selected, position }, component, label))} data-testid="tt-add-confirm">
                Add {chosen?.label.toLowerCase() ?? "element"}
              </button>
              <button className="cl-tool" onClick={() => close("add")}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {panel === "move" && selected && moves && (
        <div className="cl-tt__panel" role="group" aria-label={`Move ${named}`} data-testid="tt-move-panel" onKeyDown={onPanelKey("move")}>
          <label className="cl-field__label" htmlFor={ids.target}>
            Move {named} into
          </label>
          <select id={ids.target} className="af-select cl-input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} data-testid="tt-move-target" ref={(el) => void (firstField.current = el)}>
            <option value="">Choose a container…</option>
            {targets.map((t) => (
              <option key={t.key} value={t.key} disabled={!!moves[t.key]}>
                {"  ".repeat(t.depth)}
                {t.label}
                {t.key === parent?.key ? " (it is here now; moves it to the end)" : ""}
                {moves[t.key] ? ` · ${moves[t.key]}` : ""}
              </option>
            ))}
          </select>
          {targets.some((t) => moves[t.key]) && <p className="cl-dim">Containers it cannot move into are listed with the reason.</p>}
          <div className="cl-tt__actions">
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
});
