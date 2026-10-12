/**
 * Whether an add or remove refinement did what it asked: the ADR-B3 addendum lists "whether refinements stay in block
 * mode and change what they should" among the questions only live calls answer. The pipeline's gates say a refined
 * surface is valid, and `changed` says it differs from the prior one, but neither says an item was added or removed: a
 * refinement that rewrote a title passes an add as readily as one that added the row.
 *
 * The check compares the passing refined surface with the prior one the same arm built, by the length of every list
 * in each: a node's children and every array in its props, keyed by the owning node's component and the path to the
 * list, and summed over the nodes that share the key. The same check reads a shadcn table's rows
 * (`table-body.children`) and an Astryx table's data (`table.props.data`). An add must lengthen a list and shorten
 * none; a remove, the reverse. It judges the direction of the change, not its content or its size, from the two
 * surfaces alone, so it scores every arm identically.
 *
 * It is a measurement beside the pass rate, never inside it. ADR-B3's pass is the pipeline's audit outcome, frozen
 * with the corpus and its scoring, so counting a refinement that missed its operation as a failure would be a re-freeze,
 * not a fix. The summary instead recomputes the decision with those refinements failing, as a sensitivity check
 * (metrics.ts, operationSensitivity).
 */
import type { OperationCheck } from "./types";

type Json = Record<string, unknown>;

/** Every list in a surface's root, by where it sits: the owning node's component and the key path to the list, lengths summed over nodes. */
export function listLengths(surface: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (value: unknown, owner: string, path: string): void => {
    if (Array.isArray(value)) {
      out.set(`${owner}${path}`, (out.get(`${owner}${path}`) ?? 0) + value.length);
      for (const item of value) walk(item, owner, Array.isArray(item) ? `${path}[]` : path);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Json;
    const component = typeof node.component === "string" ? node.component : undefined;
    for (const [key, child] of Object.entries(node)) {
      if (component) walk(child, component, `.${key}`);
      else walk(child, owner, `${path}.${key}`);
    }
  };
  const root = (surface as Json | null | undefined)?.root ?? surface;
  walk(root, "surface", "");
  return out;
}

/** What the refined surface did to the prior one's lists, against what the refinement asked for. */
export function checkOperation(requested: OperationCheck["requested"], prior: unknown, refined: unknown): OperationCheck {
  const before = listLengths(prior);
  const after = listLengths(refined);
  const deltas: Record<string, number> = {};
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const delta = (after.get(key) ?? 0) - (before.get(key) ?? 0);
    if (delta !== 0) deltas[key] = delta;
  }
  const changes = Object.values(deltas);
  const grew = changes.some((d) => d > 0);
  const shrank = changes.some((d) => d < 0);
  return { requested, observed: grew && shrank ? "mixed" : grew ? "add" : shrank ? "remove" : "none", deltas };
}

/** The operation was done: the lists changed in the requested direction only. */
export const performed = (check: OperationCheck): boolean => check.observed === check.requested;

/** The operation was clearly not done: no list changed, or they changed only the other way. A mixed change is neither. */
export const missed = (check: OperationCheck): boolean => check.observed === "none" || (check.observed !== "mixed" && check.observed !== check.requested);
