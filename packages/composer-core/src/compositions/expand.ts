/**
 * Compositions (R1a spike): data-aware expansion and deterministic state selection.
 *
 * An instance's surface is the block expander's output (blocks/expand.ts,
 * unchanged) over one scope holding the parameters and the data. The state is
 * chosen by data, never by a caller's wish alone: the first state whose guard
 * holds is used, and a requested state is used only when its own guard holds
 * (R0-REVIEW A9). No guard holding is a refusal that names the guards.
 *
 * Payloads are not part of the surface (a dspack surface has nowhere to hold
 * them). They are evaluated here, from the same data, once per item, and
 * attached after emission (bindings.ts).
 */
import { expandBlock, type ExpandedSurface } from "../blocks/expand";
import type { BlockDefinition } from "../blocks/schema";
import { checkConstraints, validateCall } from "../blocks/call";
import type { ActionSpec, CompositionDefinition, CompositionState, Guard, PayloadValue } from "./schema";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Own properties only, like the expander's resolve. */
export function readPath(scope: Json, path: string): unknown {
  let current: unknown = scope;
  for (const segment of path.split(".")) {
    if (!isObject(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

export function guardHolds(guard: Guard, scope: Json): boolean {
  if ("always" in guard) return true;
  if ("present" in guard) {
    const v = readPath(scope, guard.present);
    return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
  }
  if ("empty" in guard) {
    const v = readPath(scope, guard.empty);
    return v === undefined || (Array.isArray(v) && v.length === 0);
  }
  if ("minItems" in guard) {
    const v = readPath(scope, guard.minItems.path);
    return Array.isArray(v) && v.length >= guard.minItems.min;
  }
  return guard.all.every((g) => guardHolds(g, scope));
}

export function describeGuard(guard: Guard): string {
  if ("always" in guard) return "always";
  if ("present" in guard) return `'${guard.present}' is present`;
  if ("empty" in guard) return `'${guard.empty}' is empty`;
  if ("minItems" in guard) return `'${guard.minItems.path}' has at least ${guard.minItems.min} items`;
  return guard.all.map(describeGuard).join(" and ");
}

export type StateChoice = { ok: true; state: CompositionState } | { ok: false; reason: string };

export function selectState(c: CompositionDefinition, scope: Json, requested?: string): StateChoice {
  if (requested !== undefined) {
    const state = c.states.find((s) => s.id === requested);
    if (!state) return { ok: false, reason: `${c.id} has no state '${requested}'` };
    if (!guardHolds(state.guard, scope)) return { ok: false, reason: `state '${requested}' needs ${describeGuard(state.guard)}, and the data does not satisfy it` };
    return { ok: true, state };
  }
  const state = c.states.find((s) => guardHolds(s.guard, scope));
  if (!state) return { ok: false, reason: `no state's guard holds: ${c.states.map((s) => `${s.id} (${describeGuard(s.guard)})`).join(", ")}` };
  return { ok: true, state };
}

/** A block-shaped view of one state, so the block validator and expander are reused unchanged. */
function asBlock(c: CompositionDefinition, state: CompositionState, specs: "data" | "all"): BlockDefinition {
  return {
    id: c.id,
    version: c.version,
    status: c.status,
    name: c.name,
    summary: c.summary,
    intents: [state.purpose],
    keywords: [],
    props: specs === "data" ? c.data : [...c.parameters, ...c.data],
    ...(c.constraints ? { constraints: c.constraints } : {}),
    actions: [],
    streaming: "static-safe",
    template: state.template,
    examples: [],
  };
}

/** Data and parameters checked against their declared types and bounds. */
export function validateInstanceInput(c: CompositionDefinition, parameters: Json, data: Json): string[] {
  const block = asBlock(c, c.states[0]!, "all");
  const scope = { ...parameters, ...data };
  const issues = validateCall(block, { block: c.id, version: c.version, ...scope }).map((i) => `${i.path}: ${i.message}`);
  // A block's constraints run only over a call that is otherwise valid, as B2 does (blocks/call.ts).
  if (issues.length === 0) issues.push(...checkConstraints(block, scope).map((i) => `${i.path}: ${i.message}`));
  for (const key of Object.keys(data)) if (!c.data.some((d) => d.name === key)) issues.push(`$.${key}: '${key}' is not declared data of ${c.id}`);
  for (const key of Object.keys(parameters)) if (!c.parameters.some((d) => d.name === key)) issues.push(`$.${key}: '${key}' is not a parameter of ${c.id}`);
  return [...new Set(issues)];
}

export type InstanceExpansion =
  | { ok: true; state: CompositionState; surface: ExpandedSurface }
  | { ok: false; stage: "data" | "state" | "expand"; reason: string };

export function expandInstance(c: CompositionDefinition, input: { parameters?: Json; data?: Json; state?: string; reference: { name: string } }): InstanceExpansion {
  const parameters = input.parameters ?? {};
  const data = input.data ?? {};
  const invalid = validateInstanceInput(c, parameters, data);
  if (invalid.length > 0) return { ok: false, stage: "data", reason: invalid.join("; ") };
  const scope = { ...parameters, ...data };
  const choice = selectState(c, scope, input.state);
  if (!choice.ok) return { ok: false, stage: "state", reason: choice.reason };
  const expanded = expandBlock(asBlock(c, choice.state, "all"), scope, { reference: input.reference, intent: choice.state.purpose });
  if (!expanded.ok) return { ok: false, stage: "expand", reason: `${expanded.path}: ${expanded.message}` };
  return { ok: true, state: choice.state, surface: expanded.surface };
}

/** Evaluate a payload against a scope. Every value must resolve to a JSON scalar. */
export function evaluatePayload(payload: Record<string, PayloadValue> | undefined, scope: Json): { ok: true; value: Record<string, string | number | boolean> } | { ok: false; reason: string } {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, spec] of Object.entries(payload ?? {})) {
    const value = isObject(spec) ? readPath(scope, String(spec.$prop)) : spec;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return { ok: false, reason: `payload '${key}' does not resolve to a string, number or boolean` };
    }
    out[key] = value;
  }
  return { ok: true, value: out };
}

/** Per-item payloads and witnesses for a repeated action, in data order. */
export function itemPayloads(action: ActionSpec, scope: Json): { ok: true; items: Array<{ payload: Record<string, string | number | boolean>; witness: string[] }> } | { ok: false; reason: string } {
  const repeat = action.repeat!;
  const source = readPath(scope, repeat.each);
  const list = Array.isArray(source) ? source : [];
  const items: Array<{ payload: Record<string, string | number | boolean>; witness: string[] }> = [];
  for (const [k, item] of list.entries()) {
    const itemScope = { ...scope, [repeat.as]: item };
    const payload = evaluatePayload(action.payload, itemScope);
    if (!payload.ok) return { ok: false, reason: `item ${k + 1}: ${payload.reason}` };
    const witness: string[] = [];
    for (const path of repeat.witness) {
      const w = readPath(itemScope, path);
      if (typeof w !== "string" && typeof w !== "number") return { ok: false, reason: `item ${k + 1}: witness '${path}' is not a rendered string or number` };
      witness.push(String(w));
    }
    items.push({ payload: payload.value, witness });
  }
  return { ok: true, items };
}
