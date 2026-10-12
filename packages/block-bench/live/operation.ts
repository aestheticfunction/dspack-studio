/**
 * Whether an add or remove refinement did what it asked: the ADR-B3 addendum lists "whether refinements stay in block
 * mode and change what they should" among the questions only live calls answer. The pipeline's gates say a refined
 * surface is valid, and `changed` says it differs from the prior one, but neither says an item was added or removed: a
 * refinement that rewrote a title passes an add as readily as one that added the row.
 *
 * The check compares the passing refined surface with the prior one the same arm built, list by list: every node's
 * children and every array in its props, each keyed by the node that owns it. A node with an id is matched by its
 * component and id (`table(tickets)`) wherever it sits, so an item put first, a table moved into a new container, or
 * siblings reordered leave its lists alone. A node without one is placed under its parent by its component and its rank
 * among id-less siblings of the same component (`table#1` is the second); an element of a plain array by its index. A
 * shadcn table's rows are its `table-body`'s children, an Astryx table's are its `props.data`. An add must lengthen a list
 * and shorten none; a remove, the reverse. Each list is judged on its own, so a row added to one table never hides a row
 * dropped from another. The check judges the direction of the change, not its content or its size, from the two
 * surfaces alone, so it scores every arm identically.
 *
 * It is a measurement beside the pass rate, never inside it. ADR-B3's pass is the pipeline's audit outcome, frozen
 * with the corpus and its scoring, so counting a refinement that missed its operation as a failure would be a re-freeze,
 * not a fix. The summary instead recomputes the decision with those refinements failing, as a sensitivity check
 * (metrics.ts, operationSensitivity).
 */
import type { OperationCheck } from "./types";

type Json = Record<string, unknown>;

const isNode = (value: unknown): value is Json & { component: string } => !!value && typeof value === "object" && typeof (value as Json).component === "string";

/** Every list in a surface's root, keyed by the node that owns it, with its length. */
export function listLengths(surface: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const anchored = new Set<string>();
  /** A node's key: its component and id where it has one (once: a repeated id falls back to its place), otherwise its place. */
  const keyOf = (node: Json & { component: string }, place: string): string => {
    const anchor = typeof node.id === "string" && node.id ? `${node.component}(${node.id})` : undefined;
    if (!anchor || anchored.has(anchor)) return place;
    anchored.add(anchor);
    return anchor;
  };
  const walk = (value: unknown, at: string): void => {
    if (Array.isArray(value)) {
      out.set(at, (out.get(at) ?? 0) + value.length);
      const ranks = new Map<string, number>();
      value.forEach((item, i) => {
        if (isNode(item)) {
          // Ranks count id-less siblings only, so a node with an id put among them moves none of them.
          const hasId = typeof item.id === "string" && item.id !== "";
          const rank = hasId ? 0 : (ranks.get(item.component) ?? 0);
          if (!hasId) ranks.set(item.component, rank + 1);
          walk(item, keyOf(item, `${at}>${item.component}${rank > 0 ? `#${rank}` : ""}`));
        } else walk(item, `${at}[${i}]`);
      });
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Json)) walk(child, `${at}.${key}`);
  };
  const root = (surface as Json | null | undefined)?.root ?? surface;
  walk(root, isNode(root) ? keyOf(root, root.component) : "root");
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
