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
 *   duplicate        the surface already accepted this consequential action
 *                    (the refusal names its idempotency key);
 *   locked           the surface accepted a consequential action and has not
 *                    been replaced since (R1A-REVIEW M3, decision D3);
 *   needs-recheck    the approval's pins no longer match the contract,
 *                    profile, toolchain or composition being governed, or the
 *                    surface itself was governed under other pins;
 *   needs-confirmation  a consequential action from a surface that is not
 *                    its confirmation state;
 *   unauthorized     no declared action of this instance has that name on
 *                    that component;
 *   payload-mismatch the context is not exactly the instance's literal
 *                    payload plus the inputs it carries;
 *   invalid-input    a carried input value fails its declared type.
 *
 * A refusal changes nothing on screen: the current instance stays, and the
 * refusal is recorded with its reason. An invalid-input refusal still keeps
 * the values typed, where they are not sensitive, so the next state of the
 * same composition can show them again (R1A-REVIEW M4).
 *
 * The consequential lifecycle. Accepting a consequential action opens a
 * commitment: a stable idempotency key and an outcome that starts pending.
 *
 *   pending  -> succeeded | failed | unknown
 *   unknown  -> succeeded | failed            (by reconciling the same key)
 *
 * From acceptance until a replacement is shown, the surface accepts nothing.
 * While the outcome is pending or unknown, no replacement is shown either:
 * the person stays on the surface where they committed, and nothing they
 * press dispatches again. Only a known outcome opens the way to the next
 * surface. A failed outcome is the one case where a new attempt is safe, and
 * a new attempt is a new surface with a new key.
 *
 * What the host guarantees, and what it cannot:
 *   - it accepts a consequential action at most once per surface, returns
 *     the same key for any repeat, and opens no second attempt while an
 *     earlier one is pending or unknown;
 *   - it never executes anything. The tool that performs the transaction
 *     must treat the key as an idempotency key, and the agent must report
 *     the outcome (settle) and, after an unknown one, ask the tool by that key
 *     rather than call it again under a new one.
 *
 * Sensitive inputs (decision D5): the value reaches the caller in the
 * accepted action that carries it (ActResult.values) and nowhere else. The
 * host keeps no sensitive value, never carries one into a replacement, and
 * redact() gives the form of an action event that may be recorded.
 */
import type { BoundAction } from "./bindings";
import { deepFreeze, type Governor } from "./governance";
import {
  checkSessionId,
  compositionPins,
  createSessionId,
  instantiate,
  pinsFor,
  pinsWith,
  samePins,
  surfaceIdFor,
  type CompositionPins,
  type Instance,
  type InstantiateResult,
  type Pins,
} from "./instantiate";
import type { CompositionDefinition, InputSpec } from "./schema";

type Json = Record<string, any>;

export interface ScenarioResult {
  id: string;
  expect: "ok" | "refused";
  outcome: "ok" | "refused";
  /** The scenario behaved as declared: accepted, or refused by the rule or stage it names (R1A-REVIEW L3). */
  matches: boolean;
  refusedBy?: string;
  /** For a refusal: the stage, and every rule that refused it. */
  stage?: string;
  rules?: string[];
  reason?: string;
}

/** Issued only by recheck, frozen, and accepted by a host only as issued (R1A-REVIEW L4). */
export interface Approval {
  readonly pins: Pins;
  readonly scenarios: readonly ScenarioResult[];
}

const issued = new WeakSet<object>();

/** Re-run every declared scenario. An approval exists only if each behaves as declared. */
export async function recheck(governor: Governor, c: CompositionDefinition): Promise<{ ok: boolean; approval?: Approval; scenarios: ScenarioResult[] }> {
  const scenarios: ScenarioResult[] = [];
  const session = createSessionId();
  for (const [i, s] of c.scenarios.entries()) {
    const r = await instantiate(governor, c, { surfaceId: surfaceIdFor(c.id, session, i + 1), data: s.data, state: s.state });
    if (r.ok) {
      scenarios.push({ id: s.id, expect: s.expect, outcome: "ok", matches: s.expect === "ok" });
      continue;
    }
    const rules = [...new Set((r.failures ?? []).map((f) => f.rule).filter((x): x is string => typeof x === "string"))];
    const named = !!s.refusedBy && (rules.includes(s.refusedBy) || r.stage === s.refusedBy);
    scenarios.push({ id: s.id, expect: s.expect, outcome: "refused", matches: s.expect === "refused" && named, ...(s.refusedBy ? { refusedBy: s.refusedBy } : {}), stage: r.stage, rules, reason: r.reason });
  }
  const ok = scenarios.length > 0 && scenarios.every((s) => s.matches);
  if (!ok) return { ok, scenarios };
  const approval: Approval = deepFreeze({ pins: await pinsFor(governor, c), scenarios: structuredClone(scenarios) });
  issued.add(approval);
  return { ok, approval, scenarios };
}

export { samePins } from "./instantiate";

/** A typed input value read the way its spec declares. Returns a reason, or null when valid. Never echoes the value. */
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

/** What replaces a sensitive value in anything recorded. */
export const REDACTED = "[sensitive]";

/**
 * The recordable form of an action event (decision D5): every context value of an input the composition
 * declares sensitive is replaced. The event itself is not modified; it is what the agent uses, once.
 */
export function redactEvent(event: ActionEvent, owner: { inputs: ReadonlyArray<{ name: string; sensitive?: boolean }> }): ActionEvent {
  const sensitive = new Set(owner.inputs.filter((i) => i.sensitive).map((i) => i.name));
  const context = Object.fromEntries(Object.entries(event.context ?? {}).map(([k, v]) => [k, sensitive.has(k) ? REDACTED : v]));
  return { ...event, context };
}

/** The idempotency key of a consequential action: stable for a surface, an action and its component. */
export function idempotencyKey(surfaceId: string, action: string, componentId: string): string {
  return `${surfaceId}/${action}/${componentId}`;
}

export type Outcome = "pending" | "succeeded" | "failed" | "unknown";

/** A consequential action the host accepted, and what is known of its outcome. */
export interface Commitment {
  readonly key: string;
  readonly surfaceId: string;
  readonly composition: string;
  readonly action: string;
  readonly componentId: string;
  /** Literal only: a consequential action carries no input (R1A-REVIEW M6). */
  readonly payload: Readonly<Record<string, string | number | boolean>>;
  readonly status: Outcome;
  readonly history: ReadonlyArray<{ status: Outcome; at: number }>;
}

export type ActCode = "stale" | "duplicate" | "locked" | "needs-recheck" | "needs-confirmation" | "unauthorized" | "payload-mismatch" | "invalid-input";

export type ActResult =
  | {
      accepted: true;
      action: BoundAction;
      /** The carried values, trimmed, sensitive ones included: for this action only. Never record them; see redact. */
      values: Record<string, string>;
      instance: Instance;
      /** Present when the action is consequential: its key and its pending outcome. */
      commitment?: Commitment;
    }
  | { accepted: false; code: ActCode; reason: string; fields?: Record<string, string>; key?: string };

export type SettleResult = { ok: true; commitment: Commitment } | { ok: false; code: "unknown-key" | "conflict" | "invalid-outcome"; reason: string };

export type ApproveResult = { approved: true } | { approved: false; reason: string };

export type FocusHint = { kind: "component"; componentId: string } | { kind: "heading"; componentId: string | null };

export type ShowResult =
  | {
      ok: true;
      instance: Instance;
      /** What the renderer receives: deleteSurface for the previous instance, then the creation batch. */
      batch: Json[];
      /** Inputs whose earlier non-empty value the new instance shows again. */
      carried: string[];
      dropped: Array<{ name: string; reason: string }>;
      focus: FocusHint;
      announcement: string;
    }
  | {
      ok: false;
      refusal: Extract<InstantiateResult, { ok: false }> | { stage: "needs-recheck"; reason: string } | { stage: "outcome-pending"; reason: string; key: string };
      kept: Instance | null;
    };

export interface HostLogEntry {
  at: number;
  kind: "show" | "refused-show" | "accepted" | "refused" | "approved" | "refused-approval" | "settled" | "refused-settle";
  surfaceId?: string;
  name?: string;
  code?: string;
  reason?: string;
  /** The idempotency key, for a consequential action and its outcomes. */
  key?: string;
}

export interface Host {
  readonly session: string;
  current(): Instance | null;
  log(): HostLogEntry[];
  /** The commitment on the current surface, while it is shown. */
  commitment(): Commitment | null;
  /** Every commitment this host opened, oldest first. */
  commitments(): Commitment[];
  /** Replace the governor (a contract, rule or toolchain change). Approvals are judged against its pins at once. */
  setGovernor(governor: Governor): void;
  /** Accepts only an approval recheck issued, for that composition. */
  approve(compositionId: string, approval: Approval): ApproveResult;
  show(compositionId: string, input: { parameters?: Json; data?: Json; state?: string; focused?: string | null }): Promise<ShowResult>;
  act(event: ActionEvent): ActResult;
  /** Report what is known of a commitment's outcome. */
  settle(key: string, outcome: Outcome): SettleResult;
  /** The recordable form of an action event: sensitive values of any composition this host governs replaced. */
  redact(event: ActionEvent): ActionEvent;
}

const NEXT: Record<Outcome, readonly Outcome[]> = {
  pending: ["succeeded", "failed", "unknown"],
  unknown: ["succeeded", "failed", "unknown"],
  succeeded: ["succeeded"],
  failed: ["failed"],
};

/**
 * A host for one session. The session id is generated (createSessionId) unless one is supplied, and a
 * supplied one is validated. The host governs its own frozen snapshot of each composition, hashed once here,
 * so every pin comparison is synchronous (R1A-REVIEW L4).
 */
export async function createHost(options: { session?: string; governor: Governor; compositions: CompositionDefinition[] }): Promise<Host> {
  const session = options.session === undefined ? createSessionId() : checkSessionId(options.session);
  let governor = options.governor;
  const compositions = new Map<string, CompositionDefinition>();
  for (const c of options.compositions) {
    if (compositions.has(c.id)) throw new Error(`createHost: composition '${c.id}' is given twice`);
    compositions.set(c.id, deepFreeze(structuredClone(c)));
  }
  const own = new Map<string, CompositionPins>();
  for (const c of compositions.values()) own.set(c.id, await compositionPins(c));
  const sensitiveNames = { inputs: [...compositions.values()].flatMap((c) => c.inputs.filter((i) => i.sensitive)) };

  const approvals = new Map<string, Approval>();
  let counter = 0;
  let current: Instance | null = null;
  /** The latest non-sensitive values typed on the current surface: what a replacement can carry. */
  let entered: Record<string, string> = {};
  /** The commitment on the current surface. Cleared only by a replacement. */
  let open: Commitment | null = null;
  const history: Commitment[] = [];
  const log: HostLogEntry[] = [];
  let seq = 0;

  const approvalCurrent = (id: string) => {
    const approval = approvals.get(id);
    return !!approval && samePins(approval.pins, pinsWith(governor, own.get(id)!));
  };
  const blocking = () => !!open && (open.status === "pending" || open.status === "unknown");

  let queue: Promise<unknown> = Promise.resolve();

  const host: Host = {
    session,
    current: () => current,
    log: () => log.map((e) => ({ ...e })),
    commitment: () => open,
    commitments: () => [...history],
    setGovernor(next) {
      governor = next;
    },
    approve(compositionId, approval) {
      const refuse = (reason: string): ApproveResult => {
        log.push({ at: ++seq, kind: "refused-approval", name: compositionId, reason });
        return { approved: false, reason };
      };
      if (!compositions.has(compositionId)) return refuse(`unknown composition '${compositionId}'`);
      if (!approval || typeof approval !== "object" || !issued.has(approval)) return refuse("an approval is accepted only as recheck issued it");
      if (approval.pins.composition !== compositionId) return refuse(`the approval is for '${approval.pins.composition}', not '${compositionId}'`);
      const governed = compositions.get(compositionId)!;
      if (approval.pins.version !== governed.version) return refuse(`the approval is for v${approval.pins.version} of '${compositionId}'; this host governs v${governed.version}`);
      approvals.set(compositionId, approval);
      log.push({ at: ++seq, kind: "approved", name: compositionId });
      return { approved: true };
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
    settle(key, outcome) {
      const refuse = (code: "unknown-key" | "conflict" | "invalid-outcome", reason: string): SettleResult => {
        log.push({ at: ++seq, kind: "refused-settle", code, reason, ...(typeof key === "string" ? { key } : {}) });
        return { ok: false, code, reason };
      };
      const i = history.findIndex((c) => c.key === key);
      if (i === -1) return refuse("unknown-key", "no commitment has that key");
      if (!["succeeded", "failed", "unknown"].includes(outcome)) return refuse("invalid-outcome", `'${String(outcome)}' is not an outcome a commitment can move to`);
      const was = history[i]!;
      if (!NEXT[was.status].includes(outcome)) return refuse("conflict", `the outcome is already ${was.status}, which is final`);
      if (was.status === outcome) return { ok: true, commitment: was };
      const next: Commitment = deepFreeze({ ...was, status: outcome, history: [...was.history, { status: outcome, at: ++seq }] });
      history[i] = next;
      if (open?.key === key) open = next;
      log.push({ at: seq, kind: "settled", surfaceId: next.surfaceId, name: next.action, code: outcome, key });
      return { ok: true, commitment: next };
    },
    redact(event) {
      return redactEvent(event, sensitiveNames);
    },
  };

  async function showNow(compositionId: string, input: Parameters<Host["show"]>[1]): Promise<ShowResult> {
    const c = compositions.get(compositionId);
    if (!c) throw new Error(`unknown composition '${compositionId}'`);
    if (blocking()) {
      const reason = `the outcome of '${open!.action}' (${open!.key}) is ${open!.status}; nothing replaces its surface until it is known`;
      log.push({ at: ++seq, kind: "refused-show", code: "outcome-pending", reason, key: open!.key });
      return { ok: false, refusal: { stage: "outcome-pending", reason, key: open!.key }, kept: current };
    }
    if (!approvalCurrent(c.id)) {
      const reason = approvals.has(c.id)
        ? `${c.id} was approved against other rules, another toolchain or another version; it needs a re-check before anything runs`
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
        if (spec.sensitive) {
          if (previous.inputs.some((i) => i.name === spec.name)) dropped.push({ name: spec.name, reason: "sensitive: never carried" });
          continue;
        }
        if (!Object.hasOwn(entered, spec.name)) continue;
        const value = entered[spec.name];
        const issue = typeof value === "string" && value.length <= spec.maxLength ? null : inputValueIssue(spec, value);
        if (issue) dropped.push({ name: spec.name, reason: issue });
        else if (value !== "") {
          inputValues[spec.name] = value!;
          carried.push(spec.name);
        }
      }
    }
    const surfaceId = surfaceIdFor(c.id, session, ++counter);
    const r = await instantiate(governor, c, { surfaceId, parameters: input.parameters, data: input.data, state: input.state, inputValues });
    if (!r.ok) {
      log.push({ at: ++seq, kind: "refused-show", code: r.stage, reason: r.reason });
      return { ok: false, refusal: r, kept: current };
    }
    const instance = r.instance;
    const batch = deepFreeze([...(previous ? [{ version: "v0.9", deleteSurface: { surfaceId: previous.surfaceId } }] : []), ...instance.messages]);
    current = instance;
    entered = { ...instance.inputValues };
    open = null;
    log.push({ at: ++seq, kind: "show", surfaceId });
    const focus = focusAfter(previous, instance, input.focused ?? null);
    const announcement = previous && previous.composition === c.id
      ? `Updated: ${describe(instance)}`
      : `Showing ${describe(instance)}`;
    return { ok: true, instance, batch, carried: carried.filter((n) => instance.inputs.some((i) => i.name === n)), dropped, focus, announcement };
  }

  function actNow(event: ActionEvent): ActResult {
    const refuse = (code: ActCode, reason: string, extra: { fields?: Record<string, string>; key?: string } = {}): ActResult => {
      log.push({ at: ++seq, kind: "refused", surfaceId: event.surfaceId, name: event.name, code, reason, ...(extra.key ? { key: extra.key } : {}) });
      return { accepted: false, code, reason, ...extra };
    };
    if (!current || event.surfaceId !== current.surfaceId) return refuse("stale", `surface '${event.surfaceId}' is not the current instance${current ? ` ('${current.surfaceId}')` : ""}`);
    if (open) {
      if (event.name === open.action && event.sourceComponentId === open.componentId) {
        return refuse("duplicate", `'${event.name}' was already accepted on surface '${current.surfaceId}' (key ${open.key}, ${open.status}); it is not dispatched again`, { key: open.key });
      }
      return refuse("locked", `surface '${current.surfaceId}' accepted '${open.action}' (${open.status}); it accepts nothing more until it is replaced`, { key: open.key });
    }
    const c = compositions.get(current.composition)!;
    if (!approvalCurrent(c.id)) return refuse("needs-recheck", `${c.id} needs a re-check against the current rules and toolchain`);
    // The surface itself must have been governed under the current approval's pins (R1A-REVIEW H1): a
    // re-approval under changed rules does not make a surface emitted under the old ones executable again.
    if (!samePins(approvals.get(c.id)!.pins, current.pins)) {
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
      // What the person typed stays available to the next state, valid or not, unless it is sensitive or no
      // field could hold it (R1A-REVIEW M4).
      if (!spec.sensitive && typeof context[name] === "string" && context[name].length <= spec.maxLength) entered[name] = context[name];
    }
    if (Object.keys(fields).length > 0) return refuse("invalid-input", Object.values(fields).join("; "), { fields });
    if (!bound.consequential) {
      log.push({ at: ++seq, kind: "accepted", surfaceId: event.surfaceId, name: event.name });
      return { accepted: true, action: bound, values, instance: current };
    }
    const key = idempotencyKey(current.surfaceId, bound.name, bound.componentId);
    const commitment: Commitment = deepFreeze({ key, surfaceId: current.surfaceId, composition: c.id, action: bound.name, componentId: bound.componentId, payload: { ...bound.payload }, status: "pending" as const, history: [{ status: "pending" as const, at: ++seq }] });
    open = commitment;
    history.push(commitment);
    log.push({ at: seq, kind: "accepted", surfaceId: event.surfaceId, name: event.name, key });
    return { accepted: true, action: bound, values, instance: current, commitment };
  }

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
