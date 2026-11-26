/**
 * Compositions (R1a spike): governed instantiation.
 *
 *   validate data -> select state by guard -> expand -> S1 S2 S3 under the
 *   state's purpose -> emit with the instance's surfaceId -> attach input
 *   bindings and payloads -> binding layout check -> A1 A2 A3 -> pins
 *
 * Every step fails closed and names the step and the rule. An instance is
 * immutable: one instance is one surface, its messages are the complete
 * creation batch, and nothing is ever sent to it again (R0-REVIEW 3.2).
 *
 * The guarantee (R0-REVIEW 3.4): the messages that make up a live surface are
 * byte-equal to the emission of an expansion that passed S1 to S3 and A1 to
 * A3 under recorded pins, plus the two attachments. The only thing that can
 * differ while it is shown is the content of the person's own input paths.
 */
import { sha256Hex } from "../blocks/digest";
import type { ExpandedSurface } from "../blocks/expand";
import { attach, bindingLayoutIssues, INPUT_ROOT, type BoundAction, type BoundInput } from "./bindings";
import { slug } from "@aestheticfunction/dspack-emit";
import { templateSites } from "./load";
import { expandInstance } from "./expand";
import type { GateFailure, Governor } from "./governance";
import type { CompositionDefinition } from "./schema";

type Json = Record<string, any>;

/** What an approval and an instance are pinned to (R0-REVIEW A6). */
export interface Pins {
  /** sha256 of the contract as governed, project rule edits included. */
  contractSha256: string;
  profileSha256: string;
  /** sha256 of the composition's declared data, inputs and actions: its interaction contract. */
  interactionSha256: string;
  /** sha256 of the whole definition, and its id and version. */
  compositionSha256: string;
  composition: string;
  version: number;
}

export interface Instance {
  surfaceId: string;
  composition: string;
  version: number;
  state: string;
  purpose: string;
  /** The complete creation batch: createSurface, updateComponents, updateDataModel. */
  messages: Json[];
  /** The governed expansion the messages were emitted from. */
  expansion: ExpandedSurface;
  expansionSha256: string;
  /** sha256 of the messages as emitted, before attachment. */
  emittedSha256: string;
  actions: BoundAction[];
  inputs: BoundInput[];
  /** The values the creation batch writes to /input. */
  inputValues: Record<string, string>;
  pins: Pins;
  warnings: unknown[];
  timings: { expandMs: number; lintMs: number; emitMs: number; attachMs: number; gatesMs: number; totalMs: number };
}

export type InstantiateResult =
  | { ok: true; instance: Instance }
  | { ok: false; stage: "data" | "state" | "expand" | "lint" | "emit" | "attach" | "layout" | "gates"; reason: string; failures?: GateFailure[]; state?: string; purpose?: string };

export async function pinsFor(governor: Governor, c: CompositionDefinition): Promise<Pins> {
  return {
    contractSha256: governor.contractSha256,
    profileSha256: governor.profileSha256,
    interactionSha256: await sha256Hex(JSON.stringify({ data: c.data, inputs: c.inputs, actions: c.actions })),
    compositionSha256: await sha256Hex(JSON.stringify(c)),
    composition: c.id,
    version: c.version,
  };
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export interface InstantiateInput {
  surfaceId: string;
  parameters?: Json;
  data?: Json;
  state?: string;
  /** Initial input values (already checked by the caller; see host.ts carryInputs). */
  inputValues?: Record<string, string>;
}

export async function instantiate(governor: Governor, c: CompositionDefinition, input: InstantiateInput): Promise<InstantiateResult> {
  const t0 = now();
  const reference = { name: String(governor.contract.name ?? "") };
  const expanded = expandInstance(c, { parameters: input.parameters, data: input.data, state: input.state, reference });
  if (!expanded.ok) return { ok: false, stage: expanded.stage, reason: expanded.reason };
  const t1 = now();
  const { state, surface } = expanded;

  const lint = governor.lint(surface);
  const t2 = now();
  if (!lint.pass) {
    const first = lint.failures[0];
    return {
      ok: false,
      stage: "lint",
      state: state.id,
      purpose: state.purpose,
      failures: lint.failures,
      reason: first ? `${first.gate}${first.rule ? ` ${first.rule}` : ""}: ${first.message}` : "lint refused the surface",
    };
  }

  const emitted = governor.emit(surface, input.surfaceId);
  const t3 = now();
  if (!emitted.ok) return { ok: false, stage: "emit", state: state.id, purpose: state.purpose, failures: [emitted.failure], reason: emitted.failure.message };

  // A declared node the emitter renamed to avoid a collision would be bound by its old id to some other
  // component (R1A-REVIEW M2). Repeated nodes are renamed by design and are associated structurally instead.
  const declared = declaredNodes(c, state.id);
  for (const w of emitted.warnings as Array<{ code?: string; message?: string }>) {
    if (w.code !== "surface-id-deduplicated") continue;
    const renamed = /node id '([^']+)' already used/.exec(String(w.message))?.[1];
    if (renamed !== undefined && declared.has(renamed)) {
      return { ok: false, stage: "attach", state: state.id, purpose: state.purpose, reason: `the emitter renamed declared node '${renamed}' because another node already used that id: ${String(w.message)}` };
    }
  }

  const scope = { ...(input.parameters ?? {}), ...(input.data ?? {}) };
  const attached = attach(c, state, emitted.messages, scope);
  if (!attached.ok) return { ok: false, stage: "attach", state: state.id, purpose: state.purpose, reason: attached.reason };
  const inputValues: Record<string, string> = {};
  for (const i of attached.inputs) inputValues[i.name] = input.inputValues?.[i.name] ?? "";
  const messages = attached.inputs.length > 0
    ? [...attached.messages, { version: "v0.9", updateDataModel: { surfaceId: input.surfaceId, path: INPUT_ROOT, value: inputValues } }]
    : attached.messages;
  const layout = bindingLayoutIssues(messages);
  const t4 = now();
  if (layout.length > 0) return { ok: false, stage: "layout", state: state.id, purpose: state.purpose, reason: layout.join("; ") };

  const gates = governor.gates(messages);
  const t5 = now();
  if (!gates.pass) return { ok: false, stage: "gates", state: state.id, purpose: state.purpose, failures: gates.failures, reason: gates.failures.map((f) => `${f.gate}${f.version ? `@${f.version}` : ""}: ${f.message}`).slice(0, 3).join("; ") };

  const instance: Instance = {
    surfaceId: input.surfaceId,
    composition: c.id,
    version: c.version,
    state: state.id,
    purpose: state.purpose,
    messages,
    expansion: surface,
    expansionSha256: await sha256Hex(JSON.stringify(surface)),
    emittedSha256: await sha256Hex(JSON.stringify(emitted.messages)),
    actions: attached.actions,
    inputs: attached.inputs,
    inputValues,
    pins: await pinsFor(governor, c),
    warnings: emitted.warnings,
    timings: { expandMs: t1 - t0, lintMs: t2 - t1, emitMs: t3 - t2, attachMs: t4 - t3, gatesMs: t5 - t4, totalMs: now() - t0 },
  };
  return { ok: true, instance };
}

/** Emitted ids of the nodes this state's inputs and actions are found by, other than repeated ones. */
function declaredNodes(c: CompositionDefinition, stateId: string): Set<string> {
  const state = c.states.find((s) => s.id === stateId)!;
  const { sites } = templateSites(state.template as unknown as Json);
  const out = new Set<string>();
  const add = (id: string) => {
    const site = sites.get(id);
    if (site && !site.repeated) out.add(slug(id));
  };
  for (const i of c.inputs) add(i.node);
  for (const a of c.actions) {
    if (!a.states.includes(stateId)) continue;
    if (a.repeat) add(a.repeat.list);
    else add(a.node);
  }
  return out;
}

/**
 * The unique surface identity (R0-REVIEW 3.2): composition, session, counter.
 * The session id is random in use and injected in tests.
 */
export function surfaceIdFor(composition: string, session: string, counter: number): string {
  return `${composition}-${session}-${counter}`;
}
