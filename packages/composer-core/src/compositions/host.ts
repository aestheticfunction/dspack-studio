/**
 * Compositions (R1a spike): the host side of an instance's life.
 *
 * The host shows one instance at a time per session and replaces it, never
 * patches it. It is the only party that sees what the person typed, where
 * focus was and which surface is current, so it carries those across a
 * replacement and it decides whether an action is accepted
 * (docs/blocks/HOST-ACTIONS.md: the host checks the surface on every action).
 *
 * Accepted only when every check passes, in this order:
 *   stale            the action's surface is not the current instance;
 *   needs-recheck    the approval's pins no longer match the contract,
 *                    profile or composition being governed;
 *   needs-confirmation  a consequential action from a surface that is not
 *                    its confirmation state;
 *   unauthorized     no declared action of this instance has that name on
 *                    that component;
 *   payload-mismatch the context is not exactly the instance's literal
 *                    payload plus the inputs it carries;
 *   invalid-input    a carried input value fails its declared type;
 *   duplicate        a consequential action already accepted on this surface.
 *
 * A refusal changes nothing: the current instance stays, and the refusal is
 * recorded with its reason.
 */
import type { BoundAction } from "./bindings";
import type { Governor } from "./governance";
import { instantiate, pinsFor, surfaceIdFor, type Instance, type InstantiateResult, type Pins } from "./instantiate";
import type { CompositionDefinition, InputSpec } from "./schema";

type Json = Record<string, any>;

export interface Approval {
  pins: Pins;
  scenarios: Array<{ id: string; expect: "ok" | "refused"; outcome: "ok" | "refused"; reason?: string }>;
}

/** Re-run every declared scenario. An approval exists only if each behaves as declared. */
export async function recheck(governor: Governor, c: CompositionDefinition): Promise<{ ok: boolean; approval?: Approval; scenarios: Approval["scenarios"] }> {
  const scenarios: Approval["scenarios"] = [];
  for (const [i, s] of c.scenarios.entries()) {
    const r = await instantiate(governor, c, { surfaceId: `${c.id}-recheck-${i + 1}`, data: s.data, state: s.state });
    scenarios.push({ id: s.id, expect: s.expect, outcome: r.ok ? "ok" : "refused", ...(r.ok ? {} : { reason: r.reason }) });
  }
  const ok = scenarios.length > 0 && scenarios.every((s) => s.expect === s.outcome);
  return ok ? { ok, approval: { pins: await pinsFor(governor, c), scenarios }, scenarios } : { ok, scenarios };
}

export function samePins(a: Pins, b: Pins): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A typed input value read the way its spec declares. Returns a reason, or null when valid. */
export function inputValueIssue(spec: InputSpec, value: unknown): string | null {
  if (typeof value !== "string") return `${spec.name} is not text`;
  if (value.length > spec.maxLength) return `${spec.name} is longer than ${spec.maxLength} characters`;
  if (value.trim() === "") return spec.required ? `${spec.name} is required` : null;
  if (spec.minLength !== undefined && value.trim().length < spec.minLength) return `${spec.name} needs at least ${spec.minLength} characters`;
  if (spec.kind === "date") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) return `${spec.name} is not a date in the form YYYY-MM-DD`;
    const d = new Date(`${value.trim()}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value.trim()) return `${spec.name} is not a real date`;
  }
  if (spec.kind === "integer") {
    if (!/^\d+$/.test(value.trim())) return `${spec.name} is not a whole number`;
    const n = Number(value.trim());
    if (n < (spec.minimum ?? -Infinity) || n > (spec.maximum ?? Infinity)) return `${spec.name} must be between ${spec.minimum} and ${spec.maximum}`;
  }
  return null;
}

export interface ActionEvent {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  context: Json;
  timestamp?: string;
}

export type ActCode = "stale" | "needs-recheck" | "needs-confirmation" | "unauthorized" | "payload-mismatch" | "invalid-input" | "duplicate";

export type ActResult =
  | { accepted: true; action: BoundAction; values: Record<string, string>; instance: Instance }
  | { accepted: false; code: ActCode; reason: string; fields?: Record<string, string> };

export type FocusHint = { kind: "component"; componentId: string } | { kind: "heading"; componentId: string | null };

export type ShowResult =
  | {
      ok: true;
      instance: Instance;
      /** What the renderer receives: deleteSurface for the previous instance, then the creation batch. */
      batch: Json[];
      carried: string[];
      dropped: Array<{ name: string; reason: string }>;
      focus: FocusHint;
      announcement: string;
    }
  | { ok: false; refusal: Extract<InstantiateResult, { ok: false }> | { stage: "needs-recheck"; reason: string }; kept: Instance | null };

export interface HostLogEntry {
  at: number;
  kind: "show" | "refused-show" | "accepted" | "refused";
  surfaceId?: string;
  name?: string;
  code?: string;
  reason?: string;
}

export interface Host {
  readonly session: string;
  current(): Instance | null;
  log(): HostLogEntry[];
  /** Replace the governor (a contract or rule edit). Approvals are re-checked against its pins. */
  setGovernor(governor: Governor): void;
  approve(compositionId: string, approval: Approval): void;
  show(compositionId: string, input: { parameters?: Json; data?: Json; state?: string; focused?: string | null }): Promise<ShowResult>;
  act(event: ActionEvent): ActResult;
}

export function createHost(options: { session: string; governor: Governor; compositions: CompositionDefinition[] }): Host {
  let governor = options.governor;
  const compositions = new Map(options.compositions.map((c) => [c.id, c]));
  const approvals = new Map<string, Approval>();
  let counter = 0;
  let current: Instance | null = null;
  const accepted = new Set<string>();
  const log: HostLogEntry[] = [];
  let seq = 0;

  const pinsCurrent = async (c: CompositionDefinition) => {
    const approval = approvals.get(c.id);
    return !!approval && samePins(approval.pins, await pinsFor(governor, c));
  };
  // act() is synchronous for the caller, so it reads a set computed ahead: on every setGovernor and approve,
  // and again before every show. Only the latest computation is applied, and until it lands a changed
  // governor leaves everything stale (fail closed).
  let stalePins = new Set<string>(compositions.keys());
  let generation = 0;
  const refreshPins = async () => {
    const mine = ++generation;
    const stale = new Set<string>();
    for (const c of compositions.values()) if (!(await pinsCurrent(c))) stale.add(c.id);
    if (mine === generation) stalePins = stale;
  };

  const host: Host = {
    session: options.session,
    current: () => current,
    log: () => [...log],
    setGovernor(next) {
      governor = next;
      stalePins = new Set(compositions.keys());
      void refreshPins();
    },
    approve(compositionId, approval) {
      approvals.set(compositionId, approval);
      void refreshPins();
    },
    show(compositionId, input) {
      // Replacements run one at a time (R1A-REVIEW M1): each reads the surface before it only after the previous
      // replacement has landed, so every batch deletes the surface actually shown and none is orphaned.
      const run = queue.then(() => showNow(compositionId, input));
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    act(event) {
      return actNow(event);
    },
  };

  let queue: Promise<unknown> = Promise.resolve();

  async function showNow(compositionId: string, input: Parameters<Host["show"]>[1]): Promise<ShowResult> {
    const c = compositions.get(compositionId);
    if (!c) throw new Error(`unknown composition '${compositionId}'`);
    await refreshPins();
    if (stalePins.has(c.id)) {
      const reason = approvals.has(c.id)
        ? `${c.id} was approved against other rules or another version; it needs a re-check before anything runs`
        : `${c.id} has no approval`;
      log.push({ at: ++seq, kind: "refused-show", code: "needs-recheck", reason });
      return { ok: false, refusal: { stage: "needs-recheck", reason }, kept: current };
    }
    // Carry entered values to a new instance of the same composition, where name and type still match.
    const previous = current;
    const carried: string[] = [];
    const dropped: Array<{ name: string; reason: string }> = [];
    const inputValues: Record<string, string> = {};
    if (previous && previous.composition === c.id) {
      for (const spec of c.inputs) {
        if (!Object.hasOwn(previous.inputValues, spec.name)) continue;
        const value = previous.inputValues[spec.name];
        const issue = typeof value === "string" && value.length <= spec.maxLength ? null : inputValueIssue(spec, value);
        if (issue) dropped.push({ name: spec.name, reason: issue });
        else {
          inputValues[spec.name] = value!;
          carried.push(spec.name);
        }
      }
    }
    const surfaceId = surfaceIdFor(c.id, options.session, ++counter);
    const r = await instantiate(governor, c, { surfaceId, parameters: input.parameters, data: input.data, state: input.state, inputValues });
    if (!r.ok) {
      log.push({ at: ++seq, kind: "refused-show", code: r.stage, reason: r.reason });
      return { ok: false, refusal: r, kept: current };
    }
    const instance = r.instance;
    const batch = [...(previous ? [{ version: "v0.9", deleteSurface: { surfaceId: previous.surfaceId } }] : []), ...instance.messages];
    current = instance;
    accepted.clear();
    log.push({ at: ++seq, kind: "show", surfaceId });
    const focus = focusAfter(previous, instance, input.focused ?? null);
    const announcement = previous && previous.composition === c.id
      ? `Updated: ${describe(instance)}`
      : `Showing ${describe(instance)}`;
    return { ok: true, instance, batch, carried: carried.filter((n) => instance.inputs.some((i) => i.name === n)), dropped, focus, announcement };
  }

  function actNow(event: ActionEvent): ActResult {
    const refuse = (code: ActCode, reason: string, fields?: Record<string, string>): ActResult => {
      log.push({ at: ++seq, kind: "refused", surfaceId: event.surfaceId, name: event.name, code, reason });
      return { accepted: false, code, reason, ...(fields ? { fields } : {}) };
    };
    if (!current || event.surfaceId !== current.surfaceId) return refuse("stale", `surface '${event.surfaceId}' is not the current instance${current ? ` ('${current.surfaceId}')` : ""}`);
    const c = compositions.get(current.composition)!;
    if (stalePins.has(c.id)) return refuse("needs-recheck", `${c.id} needs a re-check against the current rules`);
    // The surface itself must have been governed under the current approval's pins (R1A-REVIEW H1): a
    // re-approval under changed rules does not make a surface emitted under the old ones executable again.
    const approval = approvals.get(c.id);
    if (!approval || !samePins(approval.pins, current.pins)) {
      return refuse("needs-recheck", `surface '${current.surfaceId}' was governed under other rules or another version than ${c.id}'s current approval; it must be replaced before anything on it runs`);
    }
    const bound = current.actions.find((a) => a.name === event.name && a.componentId === event.sourceComponentId);
    const declared = c.actions.find((a) => a.name === event.name);
    if (!bound && declared?.consequential) return refuse("needs-confirmation", `'${event.name}' is consequential and is accepted only from its confirmation step (${declared.states.join(", ")})`);
    if (!bound) return refuse("unauthorized", `no declared action '${event.name}' on component '${event.sourceComponentId}' of this instance`);
    const context = event.context ?? {};
    const expected = new Set([...Object.keys(bound.payload), ...bound.carries]);
    const extra = Object.keys(context).filter((k) => !expected.has(k));
    if (extra.length > 0) return refuse("payload-mismatch", `unexpected context key(s): ${extra.join(", ")}`);
    for (const [k, v] of Object.entries(bound.payload)) {
      if (context[k] !== v) return refuse("payload-mismatch", `context '${k}' is ${JSON.stringify(context[k])}, but this button's payload is ${JSON.stringify(v)}`);
    }
    const values: Record<string, string> = {};
    const fields: Record<string, string> = {};
    for (const name of bound.carries) {
      const spec = c.inputs.find((i) => i.name === name)!;
      const issue = inputValueIssue(spec, context[name]);
      if (issue) fields[name] = issue;
      else values[name] = String(context[name]).trim();
    }
    if (Object.keys(fields).length > 0) return refuse("invalid-input", Object.values(fields).join("; "), fields);
    const key = `${event.name}@${event.sourceComponentId}`;
    if (bound.consequential && accepted.has(key)) return refuse("duplicate", `'${event.name}' was already accepted on surface '${current.surfaceId}'; a consequential action is accepted once per surface`);
    if (bound.consequential) accepted.add(key);
    // The person's latest values become what a replacement can carry.
    current = { ...current, inputValues: { ...current.inputValues, ...Object.fromEntries(bound.carries.map((n) => [n, String(context[n] ?? "")])) } };
    log.push({ at: ++seq, kind: "accepted", surfaceId: event.surfaceId, name: event.name });
    return { accepted: true, action: bound, values, instance: current };
  }

  void refreshPins();
  return host;
}

function describe(instance: Instance): string {
  return `${instance.composition} (${instance.state})`;
}

/** Focus after a replacement (R0-REVIEW 3.2). */
export function focusAfter(previous: Instance | null, next: Instance, focused: string | null): FocusHint {
  const components = new Map<string, Json>();
  for (const m of next.messages) for (const comp of m.updateComponents?.components ?? []) components.set(String(comp.id), comp);
  const heading = [...components.values()].find((x) => x.component === "Text")?.id ?? null;
  if (!previous || previous.composition !== next.composition || !focused) return { kind: "heading", componentId: heading };
  const was = previous.actions.find((a) => a.componentId === focused);
  if (was?.item) {
    const same = next.actions.find((a) => a.name === was.name && JSON.stringify(a.payload) === JSON.stringify(was.payload));
    return same ? { kind: "component", componentId: same.componentId } : { kind: "heading", componentId: heading };
  }
  return components.has(focused) ? { kind: "component", componentId: focused } : { kind: "heading", componentId: heading };
}
