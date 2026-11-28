/**
 * Compositions: designer-authored transition intent (decision 81, schema 0.3).
 *
 * An action may declare the states the designer intends it to lead to (`leadsTo`). This is intent, never
 * execution authority:
 * - the host never moves to a declared state;
 * - it never refuses data that leads elsewhere;
 * - it never authorizes an action because of it.
 *
 * The next state is still the one the agent's returned data chooses (expand.ts selectState). Testing what
 * pressing an action actually does belongs to the Playground.
 *
 * What can be checked here is reachability. For each declared target, at least one example that is expected to
 * be shown must choose that state, by the same selection the pipeline uses. That proves the intended screen can
 * be reached with real data. It does not prove that pressing the action leads there.
 */
import { selectState } from "./expand";
import type { CompositionDefinition } from "./schema";

export type TransitionResult = { ok: true } | { ok: false; reason: string };

/** The states an action's intent may name: any state, except a consequential action's own confirmation state. */
export function leadsToOptions(c: CompositionDefinition, name: string): string[] {
  const a = c.actions.find((x) => x.name === name);
  if (!a) return [];
  return c.states.map((s) => s.id).filter((s) => !(a.consequential && a.states.includes(s)));
}

/** Set (or, with no targets, clear) the states an action is intended to lead to. */
export function setLeadsTo(c: CompositionDefinition, name: string, targets: string[]): TransitionResult {
  const a = c.actions.find((x) => x.name === name);
  if (!a) return { ok: false, reason: `there is no “${name}” action` };
  const unknown = targets.find((t) => !c.states.some((s) => s.id === t));
  if (unknown) return { ok: false, reason: `there is no “${unknown}” state` };
  if (a.consequential && targets.some((t) => a.states.includes(t))) return { ok: false, reason: "a consequential action cannot lead back to its own confirmation state, which it is sent from once" };
  const ordered = c.states.map((s) => s.id).filter((s) => targets.includes(s));
  if (ordered.length === 0) delete a.leadsTo;
  else a.leadsTo = ordered;
  return { ok: true };
}

/** The state an example's data chooses, by the pipeline's own selection, or null if none (or a refusal is expected). */
export function exampleState(c: CompositionDefinition, scenarioId: string): string | null {
  const s = c.scenarios.find((x) => x.id === scenarioId);
  if (!s || s.expect !== "ok") return null;
  const choice = selectState(c, s.data as Record<string, unknown>, s.state);
  return choice.ok ? choice.state.id : null;
}

export interface TransitionEvidence {
  action: string;
  target: string;
  /** Examples expected to be shown whose data chooses the target state. Empty: no evidence yet. */
  examples: string[];
}

/** For each declared target of each action, the examples that show the target state can be reached. */
export function transitionEvidence(c: CompositionDefinition): TransitionEvidence[] {
  const reaching = new Map<string, string[]>();
  for (const s of c.scenarios) {
    const state = exampleState(c, s.id);
    if (state) reaching.set(state, [...(reaching.get(state) ?? []), s.id]);
  }
  return c.actions.flatMap((a) => (a.leadsTo ?? []).map((target) => ({ action: a.name, target, examples: reaching.get(target) ?? [] })));
}

/**
 * What stops approval: a declared target that no example reaches. Combined with passing checks, an example
 * listed as evidence was actually shown in that state.
 */
export function transitionIssues(c: CompositionDefinition): string[] {
  return transitionEvidence(c)
    .filter((e) => e.examples.length === 0)
    .map((e) => `“${e.action}” is intended to lead to the “${e.target}” state, but no example reaches that state. Add an example whose data chooses it`);
}
