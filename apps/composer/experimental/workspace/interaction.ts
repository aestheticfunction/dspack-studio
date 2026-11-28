/**
 * Interaction authoring (M1 advanced authoring): what a person types into an element and what pressing an
 * element sends, declared on the element a designer selected.
 *
 * Nothing here is a new schema or pipeline. A change is a plain edit of the composition's own `inputs` and
 * `actions` (schema.ts), applied to a draft through editDraft (authoring.ts) and validated there by the same
 * loader every composition goes through (load.ts). What this module adds is the designer's side of it:
 *
 *   - which declaration an element can have, and why not when it cannot;
 *   - the values a payload may send, read from the composition's declared data, so a payload can only name
 *     a field that exists (per item, inside a repeat);
 *   - a check of each change, in plain words, before it is applied;
 *   - the plain words for anything the loader still refuses.
 *
 * Safeguards are kept, never relaxed: a confirmation stays a confirmation; a consequential action sends fixed
 * values only; a repeated action sends its own item's values only; and a private (sensitive) field is masked
 * on screen. Marking a field private masks it in every state that shows it: the one template property this
 * module writes is the bound field's own `type`, and only for that.
 */
import { actionNameFor, findInStructure, statesWithElement, structureOf, type ActionSpec, type CompositionDefinition, type InputSpec, type PayloadValue, type StructureNode } from "@dspack-studio/composer-core/compositions";

type Json = Record<string, any>;

const NAME = /^[a-z][a-zA-Z0-9]*$/;
const words = (s: string) => {
  const w = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.-]+/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

export const KIND_LABEL: Record<InputSpec["kind"], string> = { text: "Text", date: "Date (YYYY-MM-DD)", integer: "Whole number" };

// ---- What an element can be ---------------------------------------------------------------------------------

export type ElementRole =
  | { kind: "input"; input?: InputSpec; blocked?: string }
  | { kind: "action"; action?: ActionSpec; blocked?: string; confirmation: boolean }
  | { kind: "content" };

/** The declaration an element has or can have, and why it cannot when it cannot. */
export function roleOf(definition: CompositionDefinition, node: StructureNode): ElementRole {
  if (node.kind !== "element") return { kind: "content" };
  if (node.component === "text-input") {
    const input = node.id ? definition.inputs.find((i) => i.node === node.id) : undefined;
    if (!node.id) return { kind: "input", blocked: "This field has no id, so nothing can be bound to it yet. On a draft, give it an id under Id, below." };
    if (node.within.length > 0) return { kind: "input", blocked: "This field is repeated for each item. A typed field holds one value, so it has to sit outside a repeat." };
    return { kind: "input", ...(input ? { input } : {}) };
  }
  if (node.component === "button" || node.component === "alert-dialog") {
    const action = node.id ? definition.actions.find((a) => a.node === node.id) : undefined;
    const confirmation = node.component === "alert-dialog";
    if (!node.id) return { kind: "action", confirmation, blocked: "This element has no id, so it cannot send an action yet. On a draft, give it an id under Id, below." };
    if (node.within.length > 1) return { kind: "action", confirmation, blocked: "Repeats inside repeats are not supported." };
    return { kind: "action", confirmation, ...(action ? { action } : {}) };
  }
  return { kind: "content" };
}

// ---- Where a value can come from -----------------------------------------------------------------------------

export interface FieldOption {
  /** The path a payload reads: "hotel.id", "selection.id", "destination". */
  path: string;
  label: string;
  type: string;
}

const SCALAR = new Set(["string", "integer", "number", "boolean", "enum"]);

/** The declared data and parameter fields a payload on this element may send, as `{ $prop }` paths. */
export function payloadFields(definition: CompositionDefinition, node: StructureNode): FieldOption[] {
  const specs = [...definition.parameters, ...definition.data] as Json[];
  const loop = node.within.at(-1);
  if (loop) {
    // Inside a repeat, only the item's own fields: what item k sends must be item k's.
    const source = specs.find((s) => s.name === loop.each);
    const props = (source?.items?.props ?? []) as Json[];
    return props.filter((p) => SCALAR.has(String(p.type))).map((p) => ({ path: `${loop.as}.${p.name}`, label: `${words(loop.as)} ${words(String(p.name)).toLowerCase()}`, type: String(p.type) }));
  }
  const out: FieldOption[] = [];
  for (const s of specs) {
    if (SCALAR.has(String(s.type))) out.push({ path: String(s.name), label: words(String(s.name)), type: String(s.type) });
    else if (s.type === "object") for (const p of (s.props ?? []) as Json[]) if (SCALAR.has(String(p.type))) out.push({ path: `${s.name}.${p.name}`, label: `${words(String(s.name))} ${words(String(p.name)).toLowerCase()}`, type: String(p.type) });
  }
  return out;
}

/** The item fields a repeated action can tell items apart by (rendered strings and numbers). */
export function witnessFields(definition: CompositionDefinition, node: StructureNode): FieldOption[] {
  return payloadFields(definition, node).filter((f) => f.type === "string" || f.type === "integer" || f.type === "number");
}

/** The typed fields shown in every state an action is sent from: the only ones it can carry. */
export function carriableInputs(definition: CompositionDefinition, action: ActionSpec): InputSpec[] {
  return definition.inputs.filter((i) => action.states.every((s) => statesWithElement(definition, `#${i.node}`).includes(s)));
}

/** A payload value in a designer's words. */
export function describeValue(definition: CompositionDefinition, node: StructureNode, value: PayloadValue): string {
  if (typeof value === "object") return payloadFields(definition, node).find((f) => f.path === value.$prop)?.label ?? value.$prop;
  return `“${String(value)}” (fixed)`;
}

// ---- Masking -------------------------------------------------------------------------------------------------

/** The template nodes, across states, that render this id. */
function nodesWithId(definition: CompositionDefinition, id: string): Json[] {
  const out: Json[] = [];
  const visit = (n: Json) => {
    if (!n || typeof n !== "object") return;
    if (n.id === id && typeof n.component === "string") out.push(n);
    for (const c of (n.children ?? []) as Json[]) visit(c);
    for (const c of (n.else ?? []) as Json[]) visit(c);
  };
  for (const s of definition.states) visit(s.template as unknown as Json);
  return out;
}

/** Whether every field bound to this node hides what is typed (the contract's TextInput type "password"). */
export function isMasked(definition: CompositionDefinition, nodeId: string): boolean {
  const nodes = nodesWithId(definition, nodeId);
  return nodes.length > 0 && nodes.every((n) => (n.props as Json | undefined)?.type === "password");
}

function setMasked(draft: CompositionDefinition, nodeId: string, masked: boolean) {
  for (const n of nodesWithId(draft, nodeId)) {
    const props = { ...((n.props as Json | undefined) ?? {}) };
    if (masked) props.type = "password";
    else if (props.type === "password") delete props.type;
    n.props = props;
  }
}

/**
 * What a version still needs before it can be approved here, beyond its checks: a private field must be
 * masked on screen. Each problem comes with the change that fixes it.
 */
export function interactionIssues(definition: CompositionDefinition): Array<{ node: string; text: string; fix: InputChange; fixLabel: string }> {
  const unmasked = definition.inputs
    .filter((i) => i.sensitive && !isMasked(definition, i.node))
    .map((i) => ({ node: i.node, text: `${words(i.name)} is private, but its field shows what is typed. Mask it before this version can be approved.`, fix: { op: "update", name: i.name, patch: { sensitive: true } } as InputChange, fixLabel: "Mask the field" }));
  // Safeguards R4: a field drawn as a password is treated as holding a secret. It must be declared private, so its
  // value is redacted from everything recorded and never carried into a replacement.
  const drawn = new Set<string>();
  const visit = (n: Json) => {
    if (!n || typeof n !== "object") return;
    if (n.component === "text-input" && typeof n.id === "string" && (n.props as Json | undefined)?.type === "password") drawn.add(n.id);
    for (const c of (n.children ?? []) as Json[]) visit(c);
    for (const c of (n.else ?? []) as Json[]) visit(c);
  };
  for (const st of definition.states) visit(st.template as unknown as Json);
  const notPrivate = [...drawn].flatMap((node) => {
    const input = definition.inputs.find((i) => i.node === node);
    if (input?.sensitive) return [];
    return input
      ? [{ node, text: `${words(input.name)} is drawn as a password but is not private, so what is typed could be recorded. Make it private before this version can be approved.`, fix: { op: "update", name: input.name, patch: { sensitive: true } } as InputChange, fixLabel: "Make it private" }]
      : [{ node, text: `The “${node}” field is drawn as a password but takes no declared input. Declare it and make it private before this version can be approved.`, fix: { op: "declare", node } as InputChange, fixLabel: "Declare the field" }];
  });
  return [...unmasked, ...notPrivate];
}

// ---- Input changes -------------------------------------------------------------------------------------------

export interface InputPatch {
  name?: string;
  kind?: InputSpec["kind"];
  required?: boolean;
  minLength?: number | null;
  maxLength?: number;
  minimum?: number | null;
  maximum?: number | null;
  sensitive?: boolean;
}

export type InputChange = { op: "declare"; node: string } | { op: "update"; name: string; patch: InputPatch } | { op: "remove"; name: string };

/** A new field's name from its node id: "check-in" -> "checkIn", made unique. */
export function inputNameFor(definition: CompositionDefinition, nodeId: string): string {
  const base = nodeId.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, "") || "field";
  const start = /^[a-z]/.test(base) ? base : `field${base}`;
  let name = start;
  for (let n = 2; definition.inputs.some((i) => i.name === name); n++) name = `${start}${n}`;
  return name;
}

/** Why a change to a typed field cannot be applied, in plain words; null when it can. */
export function inputProblem(definition: CompositionDefinition, change: InputChange): string | null {
  if (change.op === "declare") {
    if (definition.inputs.some((i) => i.node === change.node)) return "This field already takes typed input.";
    const trail = statesWithElement(definition, `#${change.node}`);
    if (trail.length === 0) return "This field is not in any state of this composition.";
    return null;
  }
  const input = definition.inputs.find((i) => i.name === change.name);
  if (!input) return "This typed field no longer exists.";
  const users = definition.actions.filter((a) => a.carries?.includes(change.name));
  if (change.op === "remove") return users.length ? `${users.map((a) => `“${words(a.name)}”`).join(" and ")} sends what is typed here. Stop sending it there first.` : null;
  const p = change.patch;
  if (p.name !== undefined && p.name !== input.name) {
    if (!NAME.test(p.name)) return "Use letters and digits only, starting with a lowercase letter, for example “checkIn”.";
    if (definition.inputs.some((i) => i.name === p.name)) return `Another typed field is already called “${p.name}”. Choose a different name.`;
  }
  if (p.maxLength !== undefined && (!Number.isInteger(p.maxLength) || p.maxLength < 1 || p.maxLength > 500)) return "The longest it can be is a whole number from 1 to 500.";
  const minLength = p.minLength === undefined ? input.minLength : (p.minLength ?? undefined);
  const maxLength = p.maxLength ?? input.maxLength;
  if (minLength !== undefined && (!Number.isInteger(minLength) || minLength < 0)) return "The shortest it can be is a whole number, 0 or more.";
  if (minLength !== undefined && minLength > maxLength) return "The shortest it can be is longer than the longest it can be.";
  const kind = p.kind ?? input.kind;
  if (kind === "integer") {
    const minimum = p.minimum === undefined ? (input.minimum ?? 1) : p.minimum;
    const maximum = p.maximum === undefined ? (input.maximum ?? 100) : p.maximum;
    if (minimum === null || maximum === null) return "A whole-number field needs a smallest and a largest value.";
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum)) return "The smallest and largest values are whole numbers.";
    if (minimum > maximum) return "The smallest value is larger than the largest value.";
  }
  if (p.sensitive === false && input.sensitive) return null;
  return null;
}

/** Apply a change to a draft (inside editDraft). Call inputProblem first. */
export function applyInputChange(draft: CompositionDefinition, change: InputChange): void {
  if (change.op === "declare") {
    draft.inputs.push({ name: inputNameFor(draft, change.node), node: change.node, kind: "text", maxLength: 80 });
    return;
  }
  const at = draft.inputs.findIndex((i) => i.name === change.name);
  if (at < 0) return;
  if (change.op === "remove") {
    if (draft.inputs[at]!.sensitive) setMasked(draft, draft.inputs[at]!.node, false);
    draft.inputs.splice(at, 1);
    return;
  }
  const input = { ...draft.inputs[at]! };
  const p = change.patch;
  if (p.name !== undefined && p.name !== input.name) {
    // A rename follows into every action that sends the field: references stay valid.
    for (const a of draft.actions) if (a.carries) a.carries = a.carries.map((c) => (c === input.name ? p.name! : c));
    input.name = p.name;
  }
  if (p.kind !== undefined) {
    input.kind = p.kind;
    if (p.kind === "integer") {
      input.minimum ??= 1;
      input.maximum ??= 100;
    } else {
      delete input.minimum;
      delete input.maximum;
    }
  }
  if (p.required !== undefined) {
    if (p.required) input.required = true;
    else delete input.required;
  }
  if (p.minLength !== undefined) {
    if (p.minLength === null) delete input.minLength;
    else input.minLength = p.minLength;
  }
  if (p.maxLength !== undefined) input.maxLength = p.maxLength;
  if (p.minimum !== undefined && p.minimum !== null) input.minimum = p.minimum;
  if (p.maximum !== undefined && p.maximum !== null) input.maximum = p.maximum;
  if (p.sensitive !== undefined) {
    if (p.sensitive) input.sensitive = true;
    else delete input.sensitive;
    setMasked(draft, input.node, p.sensitive);
  }
  draft.inputs[at] = input;
}

// ---- Action changes ------------------------------------------------------------------------------------------

export interface ActionPatch {
  payload?: Record<string, PayloadValue>;
  carries?: string[];
  witness?: string[];
  consequential?: boolean;
}

export type ActionChange = { op: "declare"; node: string } | { op: "update"; name: string; patch: ActionPatch };

/** The declaration a button or dialog would get: named as the emitter names it, sent from every state that shows it. */
export function newAction(definition: CompositionDefinition, nodeId: string): ActionSpec | null {
  const states = statesWithElement(definition, `#${nodeId}`);
  if (states.length === 0) return null;
  const action: ActionSpec = { name: actionNameFor(nodeId), node: nodeId, states };
  const state = definition.states.find((s) => s.id === states[0])!;
  const trail = findInStructure(structureOf(state), `#${nodeId}`);
  const node = trail?.at(-1);
  if (node && node.within.length === 1) {
    const at = trail!.findIndex((n) => n.kind === "repeat");
    const list = trail![at - 1];
    const loop = node.within[0]!;
    // Tell items apart by what is shown: the fields another action on the same list already uses, or else a
    // name-like field, rather than an id a person never sees (the binding check refuses an unseen witness).
    const fields = witnessFields(definition, node);
    const sibling = definition.actions.find((a) => a.repeat && a.repeat.list === list?.id && a.repeat.as === loop.as)?.repeat?.witness;
    const named = fields.find((f) => /\.(name|title|label)$/.test(f.path));
    const witness = sibling ?? (named ? [named.path] : fields[0] ? [fields[0].path] : null);
    if (!list?.id || !witness) return null;
    action.repeat = { list: list.id, each: loop.each, as: loop.as, witness: [...witness] };
  }
  if (node?.component === "alert-dialog") action.consequential = true;
  return action;
}

const PAYLOAD_KEY = /^[a-z][a-zA-Z0-9]*$/;

/** Why a change to an action cannot be applied, in plain words; null when it can. */
export function actionProblem(definition: CompositionDefinition, change: ActionChange): string | null {
  if (change.op === "declare") {
    if (definition.actions.some((a) => a.node === change.node)) return "This element already sends an action.";
    if (!newAction(definition, change.node)) return "This element cannot send an action: it is not in any state, or its repeat has no list with an id and no item field to tell items apart by.";
    return null;
  }
  const action = definition.actions.find((a) => a.name === change.name);
  if (!action) return "This action no longer exists.";
  const p = change.patch;
  const consequential = p.consequential ?? !!action.consequential;
  if (p.consequential === false && action.consequential) return "This action asks for confirmation before it runs. Removing a confirmation is not available here: it is a safeguard, not a setting.";
  const carries = p.carries ?? action.carries ?? [];
  if (p.consequential && action.states.length !== 1) return "A consequential action is sent from exactly one confirmation state; this one is sent from more than one.";
  if (consequential && carries.length) return "A consequential action sends fixed values only, so what a person confirms is exactly what is sent. Stop sending typed fields first.";
  if (action.repeat && carries.length) return "A repeated action sends its own item's values only, never typed fields.";
  for (const name of carries) {
    const input = definition.inputs.find((i) => i.name === name);
    if (!input) return `There is no typed field called “${name}”.`;
    if (!carriableInputs(definition, action).includes(input)) return `“${words(name)}” is not shown everywhere this action is sent from.`;
  }
  if (p.payload) {
    for (const [key, value] of Object.entries(p.payload)) {
      if (!PAYLOAD_KEY.test(key)) return `“${key}”: a value's name uses letters and digits only, starting with a lowercase letter, for example “hotelId”.`;
      if (carries.includes(key)) return `“${key}” is already sent as a typed field. Choose another name.`;
      if (typeof value === "object") {
        const state = definition.states.find((s) => s.id === action.states[0])!;
        const node = findInStructure(structureOf(state), `#${action.node}`)?.at(-1);
        if (!node || !payloadFields(definition, node).some((f) => f.path === value.$prop)) {
          return action.repeat ? `“${value.$prop}” is not a field of each ${action.repeat.as}; a repeated action sends its own item's values only.` : `“${value.$prop}” is not a declared field of this composition.`;
        }
      } else if (typeof value === "string" && value.trim() === "") return `“${key}” has no value. Choose a field or type a fixed value.`;
    }
  }
  if (p.witness !== undefined) {
    if (!action.repeat) return "Only a repeated action tells items apart.";
    if (p.witness.length === 0) return "Choose at least one field that tells the items apart, such as the name.";
  }
  return null;
}

/** Apply a change to a draft (inside editDraft). Call actionProblem first. */
export function applyActionChange(draft: CompositionDefinition, change: ActionChange): void {
  if (change.op === "declare") {
    const action = newAction(draft, change.node);
    if (action) draft.actions.push(action);
    return;
  }
  const at = draft.actions.findIndex((a) => a.name === change.name);
  if (at < 0) return;
  const action = structuredClone(draft.actions[at]!);
  const p = change.patch;
  if (p.payload !== undefined) {
    if (Object.keys(p.payload).length) action.payload = p.payload;
    else delete action.payload;
  }
  if (p.carries !== undefined) {
    if (p.carries.length) action.carries = p.carries;
    else delete action.carries;
  }
  if (p.witness !== undefined && action.repeat) action.repeat.witness = p.witness;
  if (p.consequential) action.consequential = true;
  draft.actions[at] = action;
}

// ---- The loader's words, as a designer reads them ------------------------------------------------------------

/** A loader or edit refusal ("inputs: two inputs are named 'x'") in plain words. Unknown messages pass through. */
export function plainInteractionIssue(message: string): string {
  const m = message.replace(/^[A-Za-z]+(\.[A-Za-z0-9]+)*: /, "");
  const rules: Array<[RegExp, (...g: string[]) => string]> = [
    [/two inputs are named '([^']+)'/, (n) => `Another typed field is already called “${n}”. Choose a different name.`],
    [/two inputs bind node '([^']+)'/, () => "This field already takes typed input."],
    [/two actions (are named|are declared on node) '([^']+)'/, () => "This element already sends an action."],
    [/an integer input declares minimum and maximum/, () => "A whole-number field needs a smallest and a largest value."],
    [/a consequential action carries literals only/, () => "A consequential action sends fixed values only. Stop sending typed fields first."],
    [/a consequential action is dispatched from exactly one confirmation state/, () => "A consequential action is sent from exactly one confirmation state."],
    [/a per-item payload reads the item only/, () => "A repeated action sends its own item's values only."],
    [/a repeated action carries a literal payload only/, () => "A repeated action sends its own item's values only, never typed fields."],
    [/is inside \$each; an input binds one leaf path/, () => "A typed field holds one value, so it has to sit outside a repeat."],
    [/is a ([a-z-]+), not a text-input/, (c) => `Only a text field takes typed input; this is a ${words(c).toLowerCase()}.`],
    [/only buttons and alert dialogs dispatch here/, () => "Only buttons and confirmation dialogs can send an action."],
  ];
  for (const [re, say] of rules) {
    const g = re.exec(m);
    if (g) return say(...g.slice(1));
  }
  return m.charAt(0).toUpperCase() + m.slice(1);
}

// ---- What changed, for the draft's summary -------------------------------------------------------------------

/** Changes to typed fields and actions between two versions, in a designer's words. */
export function describeInteractionChanges(base: CompositionDefinition, draft: CompositionDefinition): string[] {
  const out: string[] = [];
  const before = new Map(base.inputs.map((i) => [i.node, i]));
  const after = new Map(draft.inputs.map((i) => [i.node, i]));
  for (const [node, i] of after) {
    const old = before.get(node);
    if (!old) out.push(`“${words(i.name)}” now takes typed input.`);
    else {
      if (old.name !== i.name) out.push(`The “${words(old.name)}” field is renamed “${words(i.name)}”.`);
      if (!!old.sensitive !== !!i.sensitive) out.push(i.sensitive ? `“${words(i.name)}” is now private.` : `“${words(i.name)}” is no longer private.`);
      if (isMasked(base, node) !== isMasked(draft, node)) out.push(isMasked(draft, node) ? `“${words(i.name)}” is masked on screen.` : `“${words(i.name)}” is no longer masked.`);
      const rules = (x: InputSpec) => JSON.stringify([x.kind, !!x.required, x.minLength, x.maxLength, x.minimum, x.maximum]);
      if (rules(old) !== rules(i)) out.push(`The rules for “${words(i.name)}” changed.`);
    }
  }
  for (const [node, i] of before) if (!after.has(node)) out.push(`“${words(i.name)}” no longer takes typed input.`);
  const actionsBefore = new Map(base.actions.map((a) => [a.name, a]));
  for (const a of draft.actions) {
    const old = actionsBefore.get(a.name);
    if (!old) out.push(`“${words(a.name)}” now sends an action.`);
    else {
      if (JSON.stringify(old.payload ?? {}) !== JSON.stringify(a.payload ?? {})) out.push(`What “${words(a.name)}” sends changed.`);
      if (JSON.stringify(old.carries ?? []) !== JSON.stringify(a.carries ?? [])) out.push(`The typed fields “${words(a.name)}” sends changed.`);
      if (JSON.stringify(old.repeat?.witness ?? []) !== JSON.stringify(a.repeat?.witness ?? [])) out.push(`How “${words(a.name)}” tells items apart changed.`);
      if (!!old.consequential !== !!a.consequential) out.push(`“${words(a.name)}” now asks for confirmation.`);
    }
  }
  return out;
}

/** A definition with masking taken out, so a mask is not reported as a structural change. */
export function withoutMasks(definition: CompositionDefinition): CompositionDefinition {
  const copy = structuredClone(definition);
  for (const i of copy.inputs) setMasked(copy, i.node, false);
  return copy;
}
