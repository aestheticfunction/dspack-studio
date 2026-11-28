"use client";

/**
 * States and what actions do (M1 advanced authoring, slices A and B), in the inspector's composition view.
 *
 * A state is a screen of the composition. The data chooses it: the first state, in order, whose condition the
 * data meets. Each state is judged under the contract intent it is for (its purpose). On a draft a designer can
 * add, duplicate, rename, reorder and remove states, and set each one's purpose and condition, all through the
 * composition's existing schema (composer-core states.ts) and the loader. Conditions are chosen from the declared
 * fields, never typed as expressions.
 *
 * What actions do is said in plain words: where an action is sent from, what it sends, whether it asks for
 * confirmation, and what follows. In this architecture an action never moves the screen by itself: the agent
 * answers with data, and that data chooses the next state. The Library previews; nothing runs.
 */
import { useEffect, useId, useState } from "react";
import {
  addState,
  duplicateState,
  guardPaths,
  guardProblem,
  moveState,
  removeState,
  renameState,
  setActionStates,
  setGuard,
  setPurpose,
  stateDependencies,
  statesShowingAction,
  uniqueStateId,
  unreachableStates,
  type CompositionDefinition,
  type Guard,
} from "@dspack-studio/composer-core/compositions";

type Json = Record<string, any>;
type Edit = (edit: (draft: CompositionDefinition) => void) => Promise<string | null>;

const words = (s: string) => {
  const w = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.-]+/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

type Part = { kind: "present" | "empty" | "minItems"; path: string; min: number };

function partsOf(g: Guard): { always: boolean; parts: Part[] } {
  if ("always" in g) return { always: true, parts: [] };
  const one = (x: Guard): Part | null => ("present" in x ? { kind: "present", path: x.present, min: 1 } : "empty" in x ? { kind: "empty", path: x.empty, min: 1 } : "minItems" in x ? { kind: "minItems", path: x.minItems.path, min: x.minItems.min } : null);
  const list = "all" in g ? g.all : [g];
  return { always: false, parts: list.map(one).filter((p): p is Part => !!p) };
}

function guardOf(always: boolean, parts: Part[]): Guard {
  if (always || parts.length === 0) return { always: true };
  const one = (p: Part): Guard => (p.kind === "present" ? { present: p.path } : p.kind === "empty" ? { empty: p.path } : { minItems: { path: p.path, min: p.min } });
  return parts.length === 1 ? one(parts[0]!) : { all: parts.map(one) };
}

/** A condition in plain words, with the composition's own field names. */
export function describeCondition(g: Guard): string {
  if ("always" in g) return "always, when no earlier state is chosen";
  const f = (p: string) => words(p).toLowerCase();
  const one = (x: Guard): string => ("present" in x ? `${f(x.present)} is given` : "empty" in x ? `${f(x.empty)} is empty` : "minItems" in x ? `${f(x.minItems.path)} has at least ${x.minItems.min} item${x.minItems.min === 1 ? "" : "s"}` : "all" in x ? x.all.map(one).join(" and ") : "");
  return `when ${one(g)}`;
}

function ConditionEditor({ definition, value, apply, idPrefix }: { definition: CompositionDefinition; value: Guard; apply: (g: Guard) => void; idPrefix: string }) {
  const start = partsOf(value);
  const [always, setAlways] = useState(start.always);
  const [parts, setParts] = useState<Part[]>(start.parts.length ? start.parts : []);
  const paths = guardPaths(definition);
  const lists = paths.filter((p) => p.type === "array");
  const id = useId();
  useEffect(() => {
    const s = partsOf(value);
    setAlways(s.always);
    setParts(s.parts);
  }, [JSON.stringify(value)]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (i: number, p: Partial<Part>) => setParts(parts.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const next = guardOf(always, parts);
  const changed = JSON.stringify(next) !== JSON.stringify(value);
  return (
    <fieldset className="cl-cond" data-testid={`${idPrefix}-condition`}>
      <legend className="cl-field__label">Shown</legend>
      <label className="cl-check">
        <input type="radio" name={`${id}-mode`} checked={always} onChange={() => setAlways(true)} data-testid={`${idPrefix}-always`} />
        <span>Always, when no earlier state is chosen</span>
      </label>
      <label className="cl-check">
        <input
          type="radio"
          name={`${id}-mode`}
          checked={!always}
          onChange={() => {
            setAlways(false);
            if (parts.length === 0 && paths[0]) setParts([{ kind: "present", path: paths[0].path, min: 1 }]);
          }}
          data-testid={`${idPrefix}-when`}
        />
        <span>When the data meets all of these</span>
      </label>
      {!always && (
        <ul className="cl-cond__parts">
          {parts.map((p, i) => (
            <li key={i} className="cl-cond__part">
              <select className="af-select cl-input" aria-label={`Field ${i + 1}`} value={p.path} onChange={(e) => update(i, { path: e.target.value, ...(p.kind === "minItems" && !lists.some((l) => l.path === e.target.value) ? { kind: "present" as const } : {}) })} data-testid={`${idPrefix}-field-${i}`}>
                {paths.map((x) => (
                  <option key={x.path} value={x.path}>
                    {words(x.path)}
                  </option>
                ))}
              </select>
              <select className="af-select cl-input" aria-label={`Test ${i + 1}`} value={p.kind} onChange={(e) => update(i, { kind: e.target.value as Part["kind"] })} data-testid={`${idPrefix}-kind-${i}`}>
                <option value="present">is given</option>
                <option value="empty">is empty</option>
                <option value="minItems" disabled={!lists.some((l) => l.path === p.path)}>
                  has at least … items
                </option>
              </select>
              {p.kind === "minItems" && <input className="af-input cl-input cl-cond__min" type="number" min={0} aria-label={`At least, ${i + 1}`} value={p.min} onChange={(e) => update(i, { min: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} data-testid={`${idPrefix}-min-${i}`} />}
              <button className="cl-tool" onClick={() => setParts(parts.filter((_, k) => k !== i))} aria-label={`Remove condition ${i + 1}`} disabled={parts.length === 1}>
                Remove
              </button>
            </li>
          ))}
          <li>
            <button className="cl-tool" onClick={() => paths[0] && setParts([...parts, { kind: "present", path: paths[0].path, min: 1 }])} disabled={parts.length >= 4 || paths.length === 0} data-testid={`${idPrefix}-add-part`}>
              Add a condition
            </button>
          </li>
        </ul>
      )}
      <p className="cl-dim">Shown {describeCondition(next)}.</p>
      <button className="cl-tool cl-tool--primary" onClick={() => apply(next)} disabled={!changed} data-testid={`${idPrefix}-apply`}>
        Apply condition
      </button>
    </fieldset>
  );
}

export function StatesEditor({
  definition,
  contract,
  editable,
  edit,
  selected,
  select,
  preview,
}: {
  definition: CompositionDefinition;
  contract: Json;
  editable: boolean;
  edit: Edit;
  /** The state shown in Structure. */
  selected: string | null;
  /** Show a state in Structure (and keep it selected here). */
  select: (id: string) => void;
  /** Preview a state on the canvas, as an example's request would. */
  preview: (id: string) => void;
}) {
  const intents = ((contract.intents ?? []) as Json[]).map((i) => ({ id: String(i.id), name: String(i.name ?? words(String(i.id))) }));
  const intentName = (id: string) => intents.find((i) => i.id === id)?.name ?? words(id);
  const unreachable = new Set(unreachableStates(definition));
  const [result, setResult] = useState<{ error: string | null; done: string | null }>({ error: null, done: null });
  const [panel, setPanel] = useState<"new" | "duplicate" | "remove" | null>(null);
  const [rename, setRename] = useState("");
  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState(intents[0]?.id ?? "");
  const current = definition.states.find((s) => s.id === selected) ?? definition.states[0]!;
  useEffect(() => {
    setRename(current.id);
    setPanel(null);
  }, [current.id]);
  useEffect(() => setResult({ error: null, done: null }), [definition.id, definition.version]);

  const run = async (op: (d: CompositionDefinition) => { ok: true; id: string } | { ok: false; reason: string }, done: (id: string) => string, then?: (id: string) => void) => {
    const dry = op(structuredClone(definition));
    if (!dry.ok) return setResult({ error: `${dry.reason.charAt(0).toUpperCase()}${dry.reason.slice(1)}.`, done: null });
    const refused = await edit((d) => void op(d));
    if (refused) return setResult({ error: refused, done: null });
    setResult({ error: null, done: `${done(dry.id)} The checks need to run again.` });
    setPanel(null);
    then?.(dry.id);
  };
  const deps = panel === "remove" ? stateDependencies(definition, current.id) : null;
  const depLines = deps
    ? [
        ...deps.actions.map((a) => (a.effect === "removed" ? `The “${words(a.name)}” action is removed.` : `“${words(a.name)}” is no longer sent from this state.`)),
        ...deps.inputs.map((i) => `The typed field “${words(i)}” is removed.`),
        ...deps.carries.map((x) => `“${words(x.action)}” stops sending “${words(x.input)}”.`),
        ...deps.scenarios.map((s) => `The example “${words(definition.scenarios.find((x) => x.id === s)?.title ?? s)}” stops asking for this state; its data chooses the state.`),
      ]
    : [];

  return (
    <div className="cl-states" data-testid="states-editor">
      <ol className="cl-states__list" aria-label="States, in the order the data chooses">
        {definition.states.map((s, i) => (
          <li key={s.id}>
            <button className={`cl-states__row${s.id === current.id ? " cl-states__row--on" : ""}`} aria-pressed={s.id === current.id} onClick={() => select(s.id)} data-testid={`state-row-${s.id}`}>
              <span className="cl-states__n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="cl-states__name">{words(s.id)}</span>
              <span className="cl-states__when">
                {describeCondition(s.guard)} · {intentName(s.purpose)}
                {unreachable.has(s.id) ? " · never chosen by the data" : ""}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {unreachable.size > 0 && (
        <p className="cl-note cl-note--warn" data-testid="states-unreachable">
          {[...unreachable].map(words).join(", ")} {unreachable.size === 1 ? "comes" : "come"} after a state that is always shown, so the data never chooses {unreachable.size === 1 ? "it" : "them"}. Move {unreachable.size === 1 ? "it" : "them"} earlier, or give the earlier state a condition.
        </p>
      )}

      <div className="cl-states__detail" data-testid="state-detail" data-state={current.id}>
        <p className="cl-states__title">{words(current.id)}</p>
        <p className="cl-dim">
          Shown {describeCondition(current.guard)}. Judged as {intentName(current.purpose).toLowerCase()}: the design rules for that purpose apply to this screen.
        </p>
        <div className="cl-tt__actions">
          <button className="cl-tool" onClick={() => preview(current.id)} data-testid="state-preview">
            Preview this state
          </button>
        </div>
        {editable && (
          <>
            <div className="cl-field">
              <label className="cl-field__label" htmlFor="cl-state-rename">
                Name
              </label>
              <div className="cl-parts__row cl-parts__row--wrap">
                <input id="cl-state-rename" className="af-input cl-input" value={rename} onChange={(e) => setRename(e.target.value)} data-testid="state-rename-input" />
                <button className="cl-tool" disabled={rename.trim() === current.id} onClick={() => void run((d) => renameState(d, current.id, rename.trim()), (id) => `Renamed to ${words(id)}; its actions and examples follow.`, select)} data-testid="state-rename-apply">
                  Rename
                </button>
              </div>
            </div>
            <div className="cl-field">
              <label className="cl-field__label" htmlFor="cl-state-purpose">
                Purpose
              </label>
              <select id="cl-state-purpose" className="af-select cl-input" value={current.purpose} onChange={(e) => void run((d) => setPurpose(d, current.id, e.target.value), () => `Now judged as ${intentName(e.target.value).toLowerCase()}.`)} data-testid="state-purpose">
                {intents.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
            <ConditionEditor key={current.id} definition={definition} value={current.guard} idPrefix="state-guard" apply={(g) => void run((d) => setGuard(d, current.id, g), () => `The condition now reads: shown ${describeCondition(g)}.`)} />
            <div className="cl-tt__actions" role="group" aria-label="Order and copies">
              <button className="cl-tool" onClick={() => void run((d) => moveState(d, current.id, "earlier"), () => "Moved earlier: the data considers it sooner.")} disabled={definition.states[0]!.id === current.id} data-testid="state-earlier">
                Earlier
              </button>
              <button className="cl-tool" onClick={() => void run((d) => moveState(d, current.id, "later"), () => "Moved later.")} disabled={definition.states.at(-1)!.id === current.id} data-testid="state-later">
                Later
              </button>
              <button className="cl-tool" onClick={() => setPanel(panel === "duplicate" ? null : "duplicate")} aria-expanded={panel === "duplicate"} data-testid="state-duplicate">
                Duplicate…
              </button>
              <button className="cl-tool" onClick={() => setPanel(panel === "remove" ? null : "remove")} aria-expanded={panel === "remove"} disabled={definition.states.length === 1} data-testid="state-remove">
                Remove…
              </button>
            </div>
            {panel === "duplicate" && (
              <DuplicateForm definition={definition} from={current.id} cancel={() => setPanel(null)} apply={(id) => void run((d) => duplicateState(d, current.id, id), (x) => `${words(x)} is a copy of ${words(current.id)}: the same elements, sent the same actions.`, select)} />
            )}
            {panel === "remove" && (
              <div className="cl-tt__confirm" role="group" aria-labelledby="cl-state-remove-title" data-testid="state-remove-panel" onKeyDown={(e) => e.key === "Escape" && setPanel(null)}>
                <p className="cl-tt__title" id="cl-state-remove-title">
                  Remove the {words(current.id).toLowerCase()} state?
                </p>
                {depLines.length ? (
                  <>
                    <p className="cl-text">Other declarations depend on it. Removing it also changes them, in the same step:</p>
                    <ul className="cl-plain" data-testid="state-remove-effects">
                      {depLines.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="cl-text">Nothing else depends on it.</p>
                )}
                <div className="cl-tt__actions">
                  <button className="cl-tool cl-tool--danger" onClick={() => void run((d) => removeState(d, current.id, depLines.length > 0), () => `The ${words(current.id).toLowerCase()} state is removed.`, select)} data-testid="state-remove-confirm">
                    {depLines.length ? `Remove it and update ${depLines.length} declaration${depLines.length > 1 ? "s" : ""}` : "Remove it"}
                  </button>
                  <button className="cl-tool" onClick={() => setPanel(null)} autoFocus>
                    Keep it
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {editable && (
        <div className="cl-states__new">
          <button className="cl-tool" onClick={() => setPanel(panel === "new" ? null : "new")} aria-expanded={panel === "new"} data-testid="state-new">
            New state…
          </button>
          {panel === "new" && (
            <div className="cl-tt__panel" role="group" aria-label="A new state" data-testid="state-new-panel" onKeyDown={(e) => e.key === "Escape" && setPanel(null)}>
              <label className="cl-field__label" htmlFor="cl-state-new-name">
                Name
              </label>
              <input id="cl-state-new-name" className="af-input cl-input" value={newName} placeholder={uniqueStateId(definition, "new state")} onChange={(e) => setNewName(e.target.value)} data-testid="state-new-name" autoFocus />
              <label className="cl-field__label" htmlFor="cl-state-new-purpose">
                Purpose
              </label>
              <select id="cl-state-new-purpose" className="af-select cl-input" value={newPurpose} onChange={(e) => setNewPurpose(e.target.value)} data-testid="state-new-purpose">
                {intents.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <p className="cl-dim">It starts with a card and one line of text, before the first state that is always shown, and is shown always until you give it a condition. Then design it in Structure.</p>
              <div className="cl-tt__actions">
                <button
                  className="cl-tool cl-tool--primary"
                  onClick={() => {
                    const id = (newName.trim() || uniqueStateId(definition, "new state")).toLowerCase().replace(/\s+/g, "-");
                    void run((d) => addState(d, { id, purpose: newPurpose }), (x) => `${words(x)} is added. Give it a condition so the data can choose the states after it.`, (x) => {
                      setNewName("");
                      select(x);
                    });
                  }}
                  data-testid="state-new-add"
                >
                  Add state
                </button>
                <button className="cl-tool" onClick={() => setPanel(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {result.error && (
        <p className="cl-field__error cl-result" role="alert" data-testid="state-error">
          Not applied: {result.error}
        </p>
      )}
      {result.done && !result.error && (
        <p className="cl-ok cl-result" role="status" data-testid="state-applied">
          {result.done}
        </p>
      )}
    </div>
  );
}

function DuplicateForm({ definition, from, apply, cancel }: { definition: CompositionDefinition; from: string; apply: (id: string) => void; cancel: () => void }) {
  const [name, setName] = useState(uniqueStateId(definition, `${from} copy`));
  return (
    <div className="cl-tt__panel" role="group" aria-label="Duplicate the state" data-testid="state-duplicate-panel" onKeyDown={(e) => e.key === "Escape" && cancel()}>
      <label className="cl-field__label" htmlFor="cl-state-dup-name">
        Name of the copy
      </label>
      <input id="cl-state-dup-name" className="af-input cl-input" value={name} onChange={(e) => setName(e.target.value)} data-testid="state-duplicate-name" autoFocus />
      <div className="cl-tt__actions">
        <button className="cl-tool cl-tool--primary" onClick={() => apply(name.trim())} data-testid="state-duplicate-confirm">
          Duplicate
        </button>
        <button className="cl-tool" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * What actions do (slice B): for each declared action, where it is sent from (editable among the states that show
 * its element), what it sends, whether it asks for confirmation, and what follows. Nothing here runs.
 */
export function ActionFlow({ definition, editable, edit, inspect }: { definition: CompositionDefinition; editable: boolean; edit: Edit; inspect: (name: string) => void }) {
  const [result, setResult] = useState<{ name: string; error: string | null } | null>(null);
  if (definition.actions.length === 0) return <p className="cl-dim">Nothing sends an action yet. Add a button or a confirmation dialog in Structure.</p>;
  const toggle = async (name: string, state: string, on: boolean) => {
    const a = definition.actions.find((x) => x.name === name)!;
    const next = on ? [...a.states, state] : a.states.filter((s) => s !== state);
    const dry = setActionStates(structuredClone(definition), name, next);
    if (!dry.ok) return setResult({ name, error: `${dry.reason.charAt(0).toUpperCase()}${dry.reason.slice(1)}.` });
    const refused = await edit((d) => void setActionStates(d, name, next));
    setResult({ name, error: refused });
  };
  return (
    <>
    <p className="cl-dim" data-testid="action-flow-lead">
      An action never changes the screen by itself: the agent receives it and answers with data, and that data chooses the next state, by the conditions above. An action sent from a screen that is no longer current is refused. In the Library actions are previewed, never run.
    </p>
    <ul className="cl-flow" data-testid="action-flow">
      {definition.actions.map((a) => {
        const showing = statesShowingAction(definition, a.name);
        const sends = [...Object.keys(a.payload ?? {}).map((k) => words(k).toLowerCase()), ...(a.carries ?? []).map((c) => `what was typed in ${words(c).toLowerCase()}`)];
        return (
          <li key={a.name} className="cl-flow__item" data-testid={`action-flow-${a.name}`}>
            <button className="cl-link" onClick={() => inspect(a.name)} data-testid={`inspect-action-${a.name}`}>
              <strong>{words(a.name)}</strong>
            </button>
            {a.repeat ? <span className="cl-dim">, on each {words(a.repeat.as).toLowerCase()}</span> : null}
            <dl className="cl-kv cl-flow__kv">
              <div>
                <dt>Sent from</dt>
                <dd>
                  {editable && showing.length > 1 && !a.consequential ? (
                    <span className="cl-flow__states" role="group" aria-label={`States ${words(a.name)} is sent from`}>
                      {showing.map((s) => (
                        <label key={s} className="cl-check">
                          <input type="checkbox" checked={a.states.includes(s)} onChange={(e) => void toggle(a.name, s, e.target.checked)} data-testid={`action-from-${a.name}-${s}`} />
                          <span>{words(s)}</span>
                        </label>
                      ))}
                    </span>
                  ) : (
                    a.states.map(words).join(", ")
                  )}
                </dd>
              </div>
              <div>
                <dt>Sends</dt>
                <dd>{sends.length ? sends.join(", ") : "its name only"}</dd>
              </div>
              <div>
                <dt>Confirmation</dt>
                <dd>{a.consequential ? `Asked in ${words(a.states[0]!)}: it is sent once, from that screen only, and only what the confirmation shows` : "None: sent when pressed"}</dd>
              </div>
              {(a.consequential || !!a.carries?.length) && (
                <div>
                  <dt>Also refused</dt>
                  <dd>{[a.consequential ? "a second time from the same screen" : "", a.carries?.length ? "with typed values that break their rules" : ""].filter(Boolean).join("; ")}</dd>
                </div>
              )}
            </dl>
            {result?.name === a.name && result.error && (
              <p className="cl-field__error" role="alert" data-testid="action-flow-error">
                Not applied: {result.error}
              </p>
            )}
          </li>
        );
      })}
    </ul>
    </>
  );
}
