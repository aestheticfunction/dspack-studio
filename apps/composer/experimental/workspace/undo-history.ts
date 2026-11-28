/**
 * Undo and redo for visual template editing (decision 62): element and structure edits only.
 *
 * A step records a draft's template, inputs and actions before and after one tracked edit; nothing else. Undoing
 * or redoing puts those three parts back and leaves the draft's name, summary, parameters, data and examples as
 * they are now, so an unrelated edit made since is never lost (F3). A step applies only when the draft's tracked
 * parts are exactly what the step left; otherwise it conflicts, and the caller clears the history rather than
 * restoring stale content. The result is still validated by the loader (editDraft) when it is applied.
 *
 * History belongs to one draft lifecycle: the workspace clears it when that draft is discarded or approved, and
 * when a new draft is created (F4). It is kept for the session only, and it cannot restore checks, approvals or
 * authorization: any applied step is an edit like any other, and makes the draft's checks stale.
 */
import type { CompositionDefinition } from "@dspack-studio/composer-core/compositions";

export type Tracked = { states: unknown; inputs: unknown; actions: unknown };
export type TrackedStep = { what: string; before: Tracked; after: Tracked };
export type History = { past: TrackedStep[]; future: TrackedStep[] };

/** How many steps are kept per draft. */
export const DEPTH = 30;

export const trackedOf = (d: CompositionDefinition): Tracked => structuredClone({ states: d.states, inputs: d.inputs, actions: d.actions });
export const sameTracked = (a: Tracked, b: Tracked) => JSON.stringify(a) === JSON.stringify(b);
export const emptyHistory = (): History => ({ past: [], future: [] });

/** Record one tracked edit; an edit that changed none of the tracked parts is not a step. */
export function record(h: History, before: CompositionDefinition, after: CompositionDefinition, what: string): History {
  const step = { what, before: trackedOf(before), after: trackedOf(after) };
  if (sameTracked(step.before, step.after)) return h;
  return { past: [...h.past.slice(-(DEPTH - 1)), step], future: [] };
}

export type Plan = { ok: true; step: TrackedStep; target: Tracked } | { ok: false; reason: "empty" | "conflict" };

/** What undo or redo would put back, or why it cannot: nothing to do, or the draft changed another way since. */
export function plan(h: History, current: CompositionDefinition, direction: "undo" | "redo"): Plan {
  const step = direction === "undo" ? h.past.at(-1) : h.future.at(-1);
  if (!step) return { ok: false, reason: "empty" };
  if (!sameTracked(trackedOf(current), direction === "undo" ? step.after : step.before)) return { ok: false, reason: "conflict" };
  return { ok: true, step, target: direction === "undo" ? step.before : step.after };
}

/** Put the tracked parts back on a draft being edited; everything else stays as it is. */
export function restoreTracked(draft: CompositionDefinition, target: Tracked): void {
  draft.states = structuredClone(target.states) as CompositionDefinition["states"];
  draft.inputs = structuredClone(target.inputs) as CompositionDefinition["inputs"];
  draft.actions = structuredClone(target.actions) as CompositionDefinition["actions"];
}

/** The history after a step was applied. */
export function settle(h: History, direction: "undo" | "redo"): History {
  if (direction === "undo") {
    const step = h.past.at(-1);
    return step ? { past: h.past.slice(0, -1), future: [...h.future, step] } : h;
  }
  const step = h.future.at(-1);
  return step ? { past: [...h.past, step], future: h.future.slice(0, -1) } : h;
}
