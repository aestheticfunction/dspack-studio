/**
 * Compositions: authoring a draft's states (M1 advanced authoring, slice A).
 *
 * A state is a screen of the composition: an id, the contract intent it is judged under (its purpose), a
 * condition over the data in the closed guard forms (schema.ts), and its own template. The data chooses the
 * state: the first state whose condition holds, in order, unless an example asks for one whose own condition
 * holds (expand.ts selectState). Nothing here adds to that model.
 *
 * Each operation takes a mutable draft and either changes it and says what it did, or changes nothing and says
 * why. References follow in the same operation: a state's id is used by actions (the states they are sent
 * from) and by examples (the state they ask for). Removing a state never drops a reference silently: it reports
 * what depends on the state and changes those declarations only when asked to. The loader (load.ts) stays the
 * last word on whether the result is a valid composition.
 */
import type { CompositionDefinition, CompositionState, Guard } from "./schema";
import { templateSites } from "./load";

type Json = Record<string, any>;

/** A state id: kebab-case, as the schema requires. */
export const STATE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export type StateResult = { ok: true; id: string } | { ok: false; reason: string };

/** Why an id cannot be used for a new or renamed state; null when it can. */
export function stateIdProblem(c: CompositionDefinition, id: string, except?: string): string | null {
  if (!STATE_ID.test(id)) return "a state's name uses lowercase letters, digits and single hyphens, starting with a letter, for example “sold-out”";
  if (c.states.some((s) => s.id === id && s.id !== except)) return `there is already a “${id}” state`;
  return null;
}

/** A unique state id from a starting word. */
export function uniqueStateId(c: CompositionDefinition, from: string): string {
  const base =
    from
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^([0-9])/, "s-$1") || "state";
  let id = base;
  for (let n = 2; stateIdProblem(c, id) !== null; n++) id = `${base}-${n}`;
  return id;
}

// ---- Conditions ---------------------------------------------------------------------------------------------

/** The paths a condition can read: each declared parameter and data field, and an object's own fields. */
export function guardPaths(c: CompositionDefinition): Array<{ path: string; type: string }> {
  const out: Array<{ path: string; type: string }> = [];
  for (const spec of [...c.parameters, ...c.data] as Json[]) {
    out.push({ path: String(spec.name), type: String(spec.type) });
    if (spec.type === "object") for (const p of (spec.props ?? []) as Json[]) out.push({ path: `${spec.name}.${p.name}`, type: String(p.type) });
  }
  return out;
}

/** Why a condition cannot be used; null when it can. Every path must name a declared field. */
export function guardProblem(c: CompositionDefinition, guard: Guard): string | null {
  const paths = guardPaths(c);
  const check = (g: Guard): string | null => {
    if ("always" in g) return null;
    if ("all" in g) {
      if (g.all.length === 0) return "a combined condition needs at least one part";
      for (const part of g.all) {
        const p = check(part);
        if (p) return p;
      }
      return null;
    }
    const path = "present" in g ? g.present : "empty" in g ? g.empty : g.minItems.path;
    const field = paths.find((x) => x.path === path);
    if (!field) return `“${path}” is not a declared field of this composition`;
    if ("minItems" in g) {
      if (field.type !== "array") return `“${path}” is not a list, so it has no number of items`;
      if (!Number.isInteger(g.minItems.min) || g.minItems.min < 0) return "the number of items is a whole number, 0 or more";
    }
    return null;
  };
  return check(guard);
}

/** Set a state's condition. */
export function setGuard(c: CompositionDefinition, stateId: string, guard: Guard): StateResult {
  const state = c.states.find((s) => s.id === stateId);
  if (!state) return { ok: false, reason: `there is no “${stateId}” state` };
  const problem = guardProblem(c, guard);
  if (problem) return { ok: false, reason: problem };
  state.guard = structuredClone(guard);
  return { ok: true, id: stateId };
}

/** Set (or clear) a state's human title, 60 characters at most (decision 81). Presentation only. */
export function setStateTitle(c: CompositionDefinition, stateId: string, title: string): StateResult {
  const state = c.states.find((s) => s.id === stateId);
  if (!state) return { ok: false, reason: `there is no “${stateId}” state` };
  const t = title.trim();
  if (t.length > 60) return { ok: false, reason: "a state's title is 60 characters at most" };
  if (t) state.title = t;
  else delete state.title;
  return { ok: true, id: stateId };
}

/** Set (or clear) a state's description, 240 characters at most (decision 81). Presentation only. */
export function setStateDescription(c: CompositionDefinition, stateId: string, description: string): StateResult {
  const state = c.states.find((s) => s.id === stateId);
  if (!state) return { ok: false, reason: `there is no “${stateId}” state` };
  const d = description.trim();
  if (d.length > 240) return { ok: false, reason: "a state's description is 240 characters at most" };
  if (d) state.description = d;
  else delete state.description;
  return { ok: true, id: stateId };
}

/** Set the contract intent a state is judged under. The loader checks that it is an intent of the contract. */
export function setPurpose(c: CompositionDefinition, stateId: string, purpose: string): StateResult {
  const state = c.states.find((s) => s.id === stateId);
  if (!state) return { ok: false, reason: `there is no “${stateId}” state` };
  state.purpose = purpose;
  return { ok: true, id: stateId };
}

/**
 * Which states the data can never choose by itself: a state after one whose condition always holds. Such a state
 * is shown only when an example asks for it and its own condition holds.
 */
export function unreachableStates(c: CompositionDefinition): string[] {
  const out: string[] = [];
  let shadowed = false;
  for (const s of c.states) {
    if (shadowed) out.push(s.id);
    if ("always" in s.guard) shadowed = true;
  }
  return out;
}

// ---- Creating, duplicating, renaming, ordering --------------------------------------------------------------

/** A new state's starting template: a card with one line of text, valid for the contract. */
export const NEW_STATE_TEMPLATE = { component: "card", children: [{ component: "text", props: { type: "body" }, text: "New state" }] };

/**
 * Add a state. By default it goes before the first state whose condition always holds, so the data can choose
 * it; a new state's condition starts as "always" only when it is the last.
 */
export function addState(c: CompositionDefinition, input: { id: string; purpose: string; guard?: Guard; index?: number }): StateResult {
  const problem = stateIdProblem(c, input.id);
  if (problem) return { ok: false, reason: problem };
  const firstAlways = c.states.findIndex((s) => "always" in s.guard);
  const index = input.index ?? (firstAlways === -1 ? c.states.length : firstAlways);
  const guard: Guard = input.guard ?? { always: true };
  if (input.guard) {
    const g = guardProblem(c, guard);
    if (g) return { ok: false, reason: g };
  }
  const state: CompositionState = { id: input.id, purpose: input.purpose, guard, template: structuredClone(NEW_STATE_TEMPLATE) as CompositionState["template"] };
  c.states.splice(Math.max(0, Math.min(index, c.states.length)), 0, state);
  return { ok: true, id: input.id };
}

/** The actions a state's template could dispatch: its buttons and confirmation dialogs that have declarations. */
function actionsShownIn(c: CompositionDefinition, state: CompositionState) {
  const { sites } = templateSites(state.template as unknown as Json);
  return c.actions.filter((a) => sites.has(a.node));
}

/**
 * Duplicate a state: the same purpose, condition and template, placed right after it. Its elements keep their
 * ids, so they are the same elements, with the same typed fields; every action sent from the original is also
 * sent from the copy. A state that confirms a consequential action cannot be duplicated: that action is sent
 * from exactly one confirmation state.
 */
export function duplicateState(c: CompositionDefinition, from: string, id: string): StateResult {
  const source = c.states.find((s) => s.id === from);
  if (!source) return { ok: false, reason: `there is no “${from}” state` };
  const problem = stateIdProblem(c, id);
  if (problem) return { ok: false, reason: problem };
  const shown = actionsShownIn(c, source).filter((a) => a.states.includes(from));
  const consequential = shown.find((a) => a.consequential);
  if (consequential) return { ok: false, reason: `“${from}” confirms the consequential action “${consequential.name}”, which is sent from exactly one confirmation state; duplicate a state without it` };
  const copy: CompositionState = { id, purpose: source.purpose, guard: structuredClone(source.guard), template: structuredClone(source.template) };
  c.states.splice(c.states.indexOf(source) + 1, 0, copy);
  for (const a of shown) a.states = [...a.states, id];
  return { ok: true, id };
}

/** Rename a state, and every reference to it, in one operation. */
export function renameState(c: CompositionDefinition, from: string, to: string): StateResult {
  if (from === to) return { ok: true, id: to };
  const state = c.states.find((s) => s.id === from);
  if (!state) return { ok: false, reason: `there is no “${from}” state` };
  const problem = stateIdProblem(c, to, from);
  if (problem) return { ok: false, reason: problem };
  state.id = to;
  for (const a of c.actions) {
    a.states = a.states.map((s) => (s === from ? to : s));
    if (a.leadsTo) a.leadsTo = a.leadsTo.map((s) => (s === from ? to : s));
  }
  for (const s of c.scenarios) if (s.state === from) s.state = to;
  return { ok: true, id: to };
}

/** Move a state one place earlier or later: the order in which the data chooses. */
export function moveState(c: CompositionDefinition, id: string, direction: "earlier" | "later"): StateResult {
  const i = c.states.findIndex((s) => s.id === id);
  if (i === -1) return { ok: false, reason: `there is no “${id}” state` };
  const j = direction === "earlier" ? i - 1 : i + 1;
  if (j < 0) return { ok: false, reason: "it is already the first state" };
  if (j >= c.states.length) return { ok: false, reason: "it is already the last state" };
  [c.states[i], c.states[j]] = [c.states[j]!, c.states[i]!];
  return { ok: true, id };
}

// ---- Removing -----------------------------------------------------------------------------------------------

export interface StateDependencies {
  /** Actions sent from this state: removed altogether, or no longer sent from it. */
  actions: Array<{ name: string; effect: "removed" | "no-longer-in-state" }>;
  /** Typed fields shown in no other state. */
  inputs: string[];
  /** Actions that would stop carrying a removed typed field. */
  carries: Array<{ action: string; input: string }>;
  /** Examples that ask for this state: they stop asking, and the data chooses their state. */
  scenarios: string[];
  /** Actions intended to lead to this state (decision 81): the intent is removed with it. */
  leadsTo: string[];
}

/** What depends on a state. */
export function stateDependencies(c: CompositionDefinition, id: string): StateDependencies | null {
  const state = c.states.find((s) => s.id === id);
  if (!state) return null;
  const actions = c.actions.filter((a) => a.states.includes(id)).map((a) => ({ name: a.name, effect: (a.states.length === 1 ? "removed" : "no-longer-in-state") as "removed" | "no-longer-in-state" }));
  const here = templateSites(state.template as unknown as Json).sites;
  const elsewhere = (node: string) => c.states.some((s) => s.id !== id && templateSites(s.template as unknown as Json).sites.has(node));
  const inputs = c.inputs.filter((i) => here.has(i.node) && !elsewhere(i.node)).map((i) => i.name);
  const removed = new Set(actions.filter((a) => a.effect === "removed").map((a) => a.name));
  const carries = c.actions.filter((a) => !removed.has(a.name)).flatMap((a) => (a.carries ?? []).filter((x) => inputs.includes(x)).map((input) => ({ action: a.name, input })));
  const scenarios = c.scenarios.filter((s) => s.state === id).map((s) => s.id);
  const leadsTo = c.actions.filter((a) => !removed.has(a.name) && a.leadsTo?.includes(id)).map((a) => a.name);
  return { actions, inputs, carries, scenarios, leadsTo };
}

export const stateHasDependencies = (d: StateDependencies) => d.actions.length + d.inputs.length + d.carries.length + d.scenarios.length + d.leadsTo.length > 0;

/**
 * Remove a state. The last state cannot be removed. With dependencies, it is refused unless `resolve` is set;
 * then exactly the reported declarations change, in the same operation.
 */
export function removeState(c: CompositionDefinition, id: string, resolve = false): StateResult {
  const i = c.states.findIndex((s) => s.id === id);
  if (i === -1) return { ok: false, reason: `there is no “${id}” state` };
  if (c.states.length === 1) return { ok: false, reason: "a composition keeps at least one state" };
  const deps = stateDependencies(c, id)!;
  if (stateHasDependencies(deps) && !resolve) return { ok: false, reason: "other declarations depend on it" };
  c.states.splice(i, 1);
  if (resolve) {
    for (const d of deps.actions) {
      const a = c.actions.find((x) => x.name === d.name)!;
      if (d.effect === "removed") c.actions.splice(c.actions.indexOf(a), 1);
      else a.states = a.states.filter((s) => s !== id);
    }
    const gone = new Set(deps.inputs);
    c.inputs = c.inputs.filter((x) => !gone.has(x.name));
    for (const a of c.actions) {
      if (a.carries) a.carries = a.carries.filter((x) => !gone.has(x));
      if (a.carries && a.carries.length === 0) delete a.carries;
    }
    for (const s of c.scenarios) if (s.state === id) delete s.state;
    for (const a of c.actions) {
      if (!a.leadsTo) continue;
      a.leadsTo = a.leadsTo.filter((s) => s !== id);
      if (a.leadsTo.length === 0) delete a.leadsTo;
    }
  }
  return { ok: true, id: c.states[Math.min(i, c.states.length - 1)]!.id };
}

// ---- What actions do (slice B) ------------------------------------------------------------------------------

/** The states an action's element appears in: the only states it can be sent from. */
export function statesShowingAction(c: CompositionDefinition, name: string): string[] {
  const a = c.actions.find((x) => x.name === name);
  if (!a) return [];
  return c.states.filter((s) => templateSites(s.template as unknown as Json).sites.has(a.node)).map((s) => s.id);
}

/**
 * Set the states an action is sent from. Each must show its element; a consequential action is sent from exactly
 * one state, its confirmation state.
 */
export function setActionStates(c: CompositionDefinition, name: string, states: string[]): StateResult {
  const a = c.actions.find((x) => x.name === name);
  if (!a) return { ok: false, reason: `there is no “${name}” action` };
  if (states.length === 0) return { ok: false, reason: "an action is sent from at least one state; to stop sending it, remove its element or its action" };
  const showing = statesShowingAction(c, name);
  const missing = states.find((s) => !showing.includes(s));
  if (missing) return { ok: false, reason: `the “${missing}” state does not show this action's element` };
  if (a.consequential && states.length !== 1) return { ok: false, reason: "a consequential action is sent from exactly one confirmation state" };
  a.states = c.states.map((s) => s.id).filter((s) => states.includes(s));
  return { ok: true, id: name };
}
