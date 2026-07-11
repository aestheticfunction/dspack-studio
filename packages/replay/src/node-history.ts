/**
 * FM-4 provenance reducers: which event created/updated each rendered node,
 * and which rule findings plausibly concern it. Both fold from the same
 * event prefix as everything else.
 *
 * Precision is labeled, never faked: created/updated indices are EXPLICIT
 * (read off the A2UI operations that carried the node); rule findings carry
 * dspack-surface locations ({ path, component }), not emitted node ids, so
 * matching a finding to a node by component type is INFERRED and presented
 * as such.
 */
import { eventsUpTo, type EventSource } from "./player";

export interface NodeHistory {
  nodeId: string;
  component?: string;
  /** Event index whose delivery first carried this node. */
  createdAt: number;
  /** Later event indices whose deliveries updated it. */
  updatedAt: number[];
}

export function nodeHistoryAt(source: EventSource, playhead: number): Map<string, NodeHistory> {
  const map = new Map<string, NodeHistory>();
  eventsUpTo(source, playhead).forEach((fe, index) => {
    const ev = fe.event as Record<string, any>;
    if (ev.type !== "TOOL_CALL_RESULT") return;
    let ops: any[] = [];
    try {
      ops = JSON.parse(String(ev.content ?? "")).a2ui_operations ?? [];
    } catch {
      return;
    }
    for (const op of ops) {
      for (const c of op?.updateComponents?.components ?? []) {
        if (!c?.id) continue;
        const existing = map.get(c.id);
        if (existing) existing.updatedAt.push(index);
        else map.set(c.id, { nodeId: c.id, component: c.component, createdAt: index, updatedAt: [] });
      }
    }
  });
  return map;
}

export interface RuleFinding {
  ruleId?: string;
  message?: string;
  rationale?: string;
  /** dspack-surface location the linter reported (path + component type). */
  location?: { path?: string; component?: string };
  eventIndex: number;
}

/** Every rule finding in the prefix, with the event it rode in on. */
export function findingsAt(source: EventSource, playhead: number): RuleFinding[] {
  const out: RuleFinding[] = [];
  eventsUpTo(source, playhead).forEach((fe, index) => {
    const ev = fe.event as Record<string, any>;
    if (ev.type === "CUSTOM" && ev.name === "dspack.gates") {
      for (const f of ev.value?.findings ?? []) {
        out.push({ ruleId: f.ruleId, message: f.message, rationale: f.rationale, location: f.location, eventIndex: index });
      }
    }
  });
  return out;
}

/** "AlertDialog" -> "alert-dialog": the catalog-name/contract-id bridge. */
export function toContractId(a2uiComponent: string | undefined): string {
  return String(a2uiComponent ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}
