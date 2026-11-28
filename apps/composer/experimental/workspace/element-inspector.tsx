"use client";

/**
 * The inspector for one selected element (M1 advanced authoring). It answers, in a designer's words: what
 * this is, where it sits, what it shows, what a person can type into it, and what pressing it sends. On a
 * draft, typed input and actions are edited here; every change goes through editDraft (the same validation
 * as everything else) and invalidates the draft's checks. Technical detail stays one disclosure deeper.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import type { CompositionDefinition, InputSpec, PayloadValue, StructureNode } from "@dspack-studio/composer-core/compositions";
import type { Edit } from "./editors";
import {
  actionProblem,
  applyActionChange,
  applyInputChange,
  carriableInputs,
  describeValue,
  inputProblem,
  isMasked,
  KIND_LABEL,
  payloadFields,
  plainInteractionIssue,
  roleOf,
  witnessFields,
  type ActionChange,
  type InputChange,
} from "./interaction";
import { describeTemplateValue, elementName, elementSummary } from "./structure-panel";
import { ContentEditor, EditResult, IdentityEditor, type ContentApi } from "./content-editor";

type Json = Record<string, any>;

const words = (s: string) => {
  const w = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.-]+/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** Where a shown value comes from: fixed text, the data, a parameter, or a mix. */
function sourceOf(definition: CompositionDefinition, value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return "Fixed";
  const v = value as Json;
  if (v && typeof v.$prop === "string") return definition.parameters.some((p) => p.name === v.$prop) ? "Parameter" : "From the data";
  if (v && Array.isArray(v.$concat)) return v.$concat.some((x: unknown) => typeof x === "object") ? "Text and data" : "Fixed";
  return "Template value";
}

export interface ItemContext {
  /** 0-based item picked on the canvas, the number of items, and the values that tell it apart. */
  index: number;
  count: number;
  witness: string[];
  /** What this item's action would send, from the instance's own binding. */
  payload?: Record<string, string | number | boolean>;
}

export function ElementInspector({
  definition,
  editable,
  trail,
  statesWith,
  shownState,
  onCanvas,
  item,
  edit,
  select,
  stateLabel,
  componentIds,
  contract,
  content,
  contentStates = [],
  suggestId = "",
}: {
  /** Template editing on a draft (M1 visual template editing): the contract, and the content and identity edits. */
  contract?: Record<string, any>;
  content?: ContentApi;
  /** The states a content change applies in. */
  contentStates?: string[];
  suggestId?: string;
  definition: CompositionDefinition;
  editable: boolean;
  trail: StructureNode[];
  statesWith: string[];
  shownState: string | null;
  /** How many rendered components show this element now (0 when not on the canvas). */
  onCanvas: number;
  item: ItemContext | null;
  edit: Edit;
  select: (key: string | null) => void;
  stateLabel: (id: string) => string;
  componentIds: string[];
}) {
  const node = trail.at(-1)!;
  const role = roleOf(definition, node);
  const loop = node.within.at(-1);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    setApplied(null);
  }, [node.key, definition.version]);

  const run = async (problem: string | null, apply: (d: CompositionDefinition) => void, done: string) => {
    setApplied(null);
    if (problem) return setError(problem);
    const refused = await edit(apply);
    setError(refused ? plainInteractionIssue(refused) : null);
    if (!refused) setApplied(done);
  };
  const inputChange = (change: InputChange, done: string) => run(inputProblem(definition, change), (d) => applyInputChange(d, change), done);
  const actionChange = (change: ActionChange, done: string) => run(actionProblem(definition, change), (d) => applyActionChange(d, change), done);

  // The result of the latest input or action change, said in the group where it was made (F6).
  const result = <EditResult error={error} done={applied} errorId="element-error" doneId="element-applied" suffix=" The checks need to run again before this draft can be approved." />;

  const shown = Object.entries({ ...(node.text !== undefined ? { text: node.text } : {}), ...(node.props ?? {}) }).filter(([k]) => !["variant", "type", "size", "items"].includes(k));

  return (
    <div className="cl-element" data-testid="element-inspector" data-key={node.key}>
      <nav className="cl-trail" aria-label="Where this sits">
        <button className="cl-link" onClick={() => select(null)} data-testid="element-back">
          {definition.name}
        </button>
        {trail.slice(1).map((t) => (
          <span key={t.key}>
            <span aria-hidden="true"> › </span>
            <button className="cl-link" aria-current={t.key === node.key ? "true" : undefined} onClick={() => select(t.key)}>
              {elementName(t)}
            </button>
          </span>
        ))}
      </nav>
      <h3 className="cl-element__title" data-testid="element-title">
        {elementName(node)}
        {elementSummary(node) ? <span className="cl-element__summary">: {elementSummary(node)}</span> : null}
      </h3>

      {/* Instance or definition: a repeated element is always edited as the reusable definition. */}
      {loop && (
        <p className="cl-note" data-testid="element-repeat">
          Repeated for each {words(loop.as).toLowerCase()} in {words(loop.each).toLowerCase()}
          {onCanvas ? ` (${onCanvas} in this example)` : ""}.{" "}
          {item ? (
            <>
              You picked the one for <strong>{item.witness.map((w) => `“${w}”`).join(", ") || `item ${item.index + 1}`}</strong> (item {item.index + 1} of {item.count}).{" "}
            </>
          ) : null}
          <strong>Changes here apply to every {words(loop.as).toLowerCase()}.</strong>
        </p>
      )}
      {onCanvas === 0 && node.kind === "element" && (
        <p className="cl-note cl-note--warn" role="status" data-testid="element-unavailable">
          Not on the canvas with this example
          {statesWith.length ? `: it appears in the ${statesWith.map(stateLabel).join(" and ")} state${statesWith.length > 1 ? "s" : ""}` : ""}
          {shownState && !statesWith.includes(shownState) ? ". Choose an example that shows that state to see it." : "."}
        </p>
      )}

      {editable && content && contract && node.kind === "element" ? (
        <Group title="What it shows">
          <ContentEditor definition={definition} contract={contract} node={node} states={contentStates} api={content} />
        </Group>
      ) : (
        shown.length > 0 && (
          <Group title="What it shows">
            <dl className="cl-kv">
              {shown.map(([k, v]) => (
                <Row key={k} label={k === "text" ? "Text" : words(k)}>
                  {describeTemplateValue(v)} <span className="cl-src">{sourceOf(definition, v)}</span>
                </Row>
              ))}
            </dl>
            {definition.status === "approved" && <p className="cl-dim">This version is approved and cannot change. Create a draft to change what it shows.</p>}
          </Group>
        )
      )}

      {editable && content && node.kind === "element" && (
        <Group title="Identity">
          <IdentityEditor node={node} suggest={suggestId} api={content} />
        </Group>
      )}

      {role.kind === "input" && (
        <Group title="What a person types">
          {role.blocked ? (
            <p className="cl-text">{role.blocked}</p>
          ) : role.input ? (
            <InputForm definition={definition} input={role.input} editable={editable} change={inputChange} />
          ) : (
            <>
              <p className="cl-text">This field does not take typed input yet: nothing a person types here reaches the agent.</p>
              {editable && (
                <button className="cl-tool cl-tool--primary" onClick={() => void inputChange({ op: "declare", node: node.id! }, "This field now takes typed input.")} data-testid="input-declare">
                  Take typed input here
                </button>
              )}
            </>
          )}
          {result}
        </Group>
      )}

      {role.kind === "action" && (
        <Group title={role.confirmation ? "When confirmed" : "When pressed"}>
          {role.blocked ? (
            <p className="cl-text">{role.blocked}</p>
          ) : role.action ? (
            <ActionForm definition={definition} node={node} action={role.action} confirmation={role.confirmation} editable={editable} change={actionChange} item={item} stateLabel={stateLabel} />
          ) : (
            <>
              <p className="cl-text">Pressing this sends nothing yet.</p>
              {editable && (
                <button className="cl-tool cl-tool--primary" onClick={() => void actionChange({ op: "declare", node: node.id! }, "This element now sends an action.")} data-testid="action-declare">
                  Send an action when pressed
                </button>
              )}
            </>
          )}
          {result}
        </Group>
      )}

      {role.kind === "content" && node.kind === "element" && <p className="cl-dim">This element shows content only: a person cannot type into it or press it.</p>}

      {!editable && (role.kind === "input" || role.kind === "action") && (
        <p className="cl-dim" data-testid="element-readonly">
          {definition.status === "approved" ? "This version is approved and cannot change. Create a draft to change what this element does." : "Changes are not available while a rule try-out is on."}
        </p>
      )}

      <details className="cl-tech" data-testid="element-technical">
        <summary>Technical details</summary>
        <dl className="cl-kv">
          <Row label="Element">{node.key}</Row>
          {node.id && <Row label="Template id">{node.id}</Row>}
          <Row label="Component">{node.component ?? node.kind}</Row>
          {role.kind === "action" && role.action && <Row label="Action name">{role.action.name}</Row>}
          <Row label="On the canvas as">{componentIds.length ? componentIds.join(", ") : "not rendered"}</Row>
        </dl>
        {role.kind === "input" && role.input && <pre className="cl-pre">{JSON.stringify(role.input, null, 2)}</pre>}
        {role.kind === "action" && role.action && <pre className="cl-pre">{JSON.stringify(role.action, null, 2)}</pre>}
      </details>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cl-section" data-group={title}>
      <h4 className="cl-label">{title}</h4>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** A value committed on blur or Enter, not on every keystroke. */
function Committed({ label, value, onCommit, type = "text", hint, testid, min, max }: { label: string; value: string; onCommit: (v: string) => void; type?: "text" | "number"; hint?: string; testid: string; min?: number; max?: number }) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text !== value && onCommit(text);
  return (
    <div className="cl-field">
      <label className="cl-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="af-input cl-input"
        type={type}
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        aria-describedby={hint ? `${id}-hint` : undefined}
        data-testid={testid}
      />
      {hint && (
        <p className="cl-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

function Check({ label, checked, onChange, disabled, hint, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string; testid: string }) {
  const id = useId();
  return (
    <div className="cl-check">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} data-testid={testid} />
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p className="cl-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));

function InputForm({ definition, input, editable, change }: { definition: CompositionDefinition; input: InputSpec; editable: boolean; change: (c: InputChange, done: string) => void }) {
  const kindId = useId();
  const masked = isMasked(definition, input.node);
  const sentBy = definition.actions.filter((a) => a.carries?.includes(input.name));
  const update = (patch: Parameters<typeof change>[0] extends infer C ? (C extends { op: "update"; patch: infer P } ? P : never) : never, done: string) => change({ op: "update", name: input.name, patch }, done);
  if (!editable) {
    return (
      <dl className="cl-kv" data-testid="input-facts">
        <Row label="Name">{input.name}</Row>
        <Row label="Kind">{KIND_LABEL[input.kind]}</Row>
        <Row label="Required">{input.required ? "Yes" : "No"}</Row>
        <Row label="Length">{`${input.minLength ?? 0} to ${input.maxLength} characters`}</Row>
        {input.kind === "integer" && <Row label="Range">{`${input.minimum} to ${input.maximum}`}</Row>}
        <Row label="Private">{input.sensitive ? (masked ? "Yes: masked on screen, sent once with its action, never kept or recorded" : "Yes, but its field is not masked on screen") : "No"}</Row>
        <Row label="Sent by">{sentBy.length ? sentBy.map((a) => words(a.name)).join(", ") : "No action sends it yet"}</Row>
      </dl>
    );
  }
  return (
    <div className="cl-form" data-testid="input-form">
      <Committed label="Name" value={input.name} onCommit={(v) => update({ name: v.trim() }, `Renamed “${v.trim()}”.`)} hint="How the agent receives it, for example checkIn." testid="input-name" />
      <div className="cl-field">
        <label className="cl-field__label" htmlFor={kindId}>
          Kind
        </label>
        <select id={kindId} className="af-select cl-input" value={input.kind} onChange={(e) => update({ kind: e.target.value as InputSpec["kind"] }, "The kind changed.")} data-testid="input-kind">
          {(Object.keys(KIND_LABEL) as InputSpec["kind"][]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <Check label="Required" checked={!!input.required} onChange={(v) => update({ required: v }, v ? "Now required." : "Now optional.")} testid="input-required" />
      <div className="cl-form__pair">
        <Committed label="Shortest (characters)" type="number" min={0} value={input.minLength === undefined ? "" : String(input.minLength)} onCommit={(v) => update({ minLength: num(v) }, "The shortest length changed.")} testid="input-min-length" />
        <Committed label="Longest (characters)" type="number" min={1} max={500} value={String(input.maxLength)} onCommit={(v) => update({ maxLength: num(v) ?? NaN }, "The longest length changed.")} testid="input-max-length" />
      </div>
      {input.kind === "integer" && (
        <div className="cl-form__pair">
          <Committed label="Smallest value" type="number" value={String(input.minimum ?? "")} onCommit={(v) => update({ minimum: num(v) }, "The smallest value changed.")} testid="input-minimum" />
          <Committed label="Largest value" type="number" value={String(input.maximum ?? "")} onCommit={(v) => update({ maximum: num(v) }, "The largest value changed.")} testid="input-maximum" />
        </div>
      )}
      <Check
        label="Private (sensitive)"
        checked={!!input.sensitive}
        onChange={(v) => update({ sensitive: v }, v ? "It is private and masked on screen." : "It is no longer private.")}
        hint={input.sensitive ? (masked ? "Masked on screen. Its value is sent once with its action and replaced in anything recorded or kept." : "Not masked on screen yet: tick again, or use “Mask the field” below, before this version can be approved.") : "For values such as account or loyalty numbers: masked on screen, sent once, never kept or recorded."}
        testid="input-sensitive"
      />
      {input.sensitive && !masked && (
        <button className="cl-tool" onClick={() => update({ sensitive: true }, "The field is masked on screen.")} data-testid="input-mask">
          Mask the field
        </button>
      )}
      <p className="cl-dim">
        {sentBy.length ? `Sent by ${sentBy.map((a) => `“${words(a.name)}”`).join(" and ")}.` : "No action sends it yet: choose a button and tick it under “Also sends what was typed in”."} A starting value is not supported: what a field holds is what the person types.
      </p>
      <button className="cl-tool" onClick={() => change({ op: "remove", name: input.name }, "This field no longer takes typed input.")} data-testid="input-remove">
        Stop taking typed input
      </button>
    </div>
  );
}

function ActionForm({
  definition,
  node,
  action,
  confirmation,
  editable,
  change,
  item,
  stateLabel,
}: {
  definition: CompositionDefinition;
  node: StructureNode;
  action: NonNullable<Extract<ReturnType<typeof roleOf>, { kind: "action" }>["action"]>;
  confirmation: boolean;
  editable: boolean;
  change: (c: ActionChange, done: string) => void;
  item: ItemContext | null;
  stateLabel: (id: string) => string;
}) {
  const fields = payloadFields(definition, node);
  const carriable = carriableInputs(definition, action);
  const payload = action.payload ?? {};
  const update = (patch: Extract<ActionChange, { op: "update" }>["patch"], done: string) => change({ op: "update", name: action.name, patch }, done);
  const label = node.props?.label ?? node.props?.actionLabel;
  const setPayload = (next: Record<string, PayloadValue>, done: string) => update({ payload: next }, done);
  const [adding, setAdding] = useState(false);

  return (
    <div className="cl-form" data-testid="action-form">
      <dl className="cl-kv">
        <Row label="Trigger">
          {confirmation ? "Confirming the dialog" : "Pressing it"}
          {label !== undefined ? ` (“${describeTemplateValue(label)}”)` : ""}
          {action.repeat ? `, on each ${words(action.repeat.as).toLowerCase()}` : ""}
        </Row>
        <Row label="Action">{words(action.name)}</Row>
        <Row label="Shown in">{action.states.map(stateLabel).join(", ")}</Row>
      </dl>

      <h5 className="cl-form__title">What it sends</h5>
      {Object.keys(payload).length === 0 && <p className="cl-dim">No values: only the action itself.</p>}
      <ul className="cl-payload" data-testid="action-payload">
        {Object.entries(payload).map(([key, value]) => (
          <li key={key} className="cl-payload__row" data-testid={`payload-${key}`}>
            <span className="cl-payload__key">{key}</span>
            {editable ? (
              <PayloadSource
                value={value}
                fields={fields}
                onChange={(v) => setPayload({ ...payload, [key]: v }, `“${key}” now sends ${describeValue(definition, node, v)}.`)}
                testid={`payload-source-${key}`}
                label={`What “${key}” sends`}
              />
            ) : (
              <span>{describeValue(definition, node, value)}</span>
            )}
            {editable && (
              <button
                className="cl-tool"
                aria-label={`Stop sending ${key}`}
                onClick={() => {
                  const { [key]: _, ...rest } = payload;
                  setPayload(rest, `“${key}” is no longer sent.`);
                }}
                data-testid={`payload-remove-${key}`}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (adding ? <NewPayload fields={fields} cancel={() => setAdding(false)} add={(k, v) => (setAdding(false), setPayload({ ...payload, [k]: v }, `It now also sends “${k}”.`))} /> : (
        <button className="cl-tool" onClick={() => setAdding(true)} data-testid="payload-add">
          Add a value
        </button>
      ))}

      {!action.repeat && (
        <>
          <h5 className="cl-form__title">Also sends what was typed in</h5>
          {carriable.length === 0 ? (
            <p className="cl-dim">No typed field is shown everywhere this is sent from.</p>
          ) : (
            carriable.map((i) => (
              <Check
                key={i.name}
                label={`${words(i.name)}${i.sensitive ? " (private: sent once, never recorded)" : ""}`}
                checked={!!action.carries?.includes(i.name)}
                disabled={!editable || !!action.consequential}
                onChange={(v) => update({ carries: v ? [...(action.carries ?? []), i.name] : (action.carries ?? []).filter((c) => c !== i.name) }, v ? `It now sends what was typed in “${words(i.name)}”.` : `It no longer sends “${words(i.name)}”.`)}
                testid={`carries-${i.name}`}
              />
            ))
          )}
          {action.consequential && <p className="cl-dim">A consequential action sends fixed values only, so what a person confirms is exactly what is sent.</p>}
        </>
      )}

      {action.repeat && (
        <>
          <h5 className="cl-form__title">Tell the items apart by</h5>
          <p className="cl-dim">Each item's button must show something no other item shows, so a person knows which one they are choosing. The check refuses an example whose items look the same.</p>
          {witnessFields(definition, node).map((f) => (
            <Check
              key={f.path}
              label={f.label}
              checked={action.repeat!.witness.includes(f.path)}
              disabled={!editable}
              onChange={(v) => update({ witness: v ? [...action.repeat!.witness, f.path] : action.repeat!.witness.filter((w) => w !== f.path) }, "How items are told apart changed.")}
              testid={`witness-${f.path}`}
            />
          ))}
        </>
      )}

      <h5 className="cl-form__title">Safeguards</h5>
      <Check
        label="Asks for confirmation (consequential)"
        checked={!!action.consequential}
        disabled={!editable || !!action.consequential || confirmation}
        onChange={(v) => update({ consequential: v }, "It now asks for confirmation.")}
        hint={action.consequential ? "Accepted only from its confirmation state, once per surface; a press from a replaced surface is refused. This is a safeguard, so it cannot be turned off here." : "For actions that commit something, such as a payment or a booking."}
        testid="action-consequential"
      />
      <ul className="cl-plain cl-dim">
        <li>Pressing it in the Library only shows what it would send. Nothing runs.</li>
        {action.carries?.some((c) => definition.inputs.find((i) => i.name === c)?.sensitive) && <li>A private field's value is sent once and replaced in anything recorded.</li>}
      </ul>

      <h5 className="cl-form__title">Try it</h5>
      {item?.payload ? (
        <p className="cl-text" data-testid="action-item-payload">
          For {item.witness.map((w) => `“${w}”`).join(", ")} it would send{" "}
          {Object.keys(item.payload).length ? Object.entries(item.payload).map(([k, v]) => `${k}: “${String(v)}”`).join(", ") : "nothing else"}.
        </p>
      ) : null}
      <p className="cl-dim">Turn off Select and press it on the canvas: Composer shows exactly what it would send.</p>
    </div>
  );
}

function PayloadSource({ value, fields, onChange, testid, label }: { value: PayloadValue; fields: Array<{ path: string; label: string }>; onChange: (v: PayloadValue) => void; testid: string; label: string }) {
  const current = typeof value === "object" ? `field:${value.$prop}` : "fixed";
  const [fixed, setFixed] = useState(typeof value === "object" ? "" : String(value));
  return (
    <span className="cl-payload__source">
      <select className="af-select cl-input" aria-label={label} value={current} onChange={(e) => (e.target.value === "fixed" ? onChange(fixed || "value") : onChange({ $prop: e.target.value.slice(6) }))} data-testid={testid}>
        {fields.map((f) => (
          <option key={f.path} value={`field:${f.path}`}>
            {f.label}
          </option>
        ))}
        <option value="fixed">Fixed value…</option>
      </select>
      {current === "fixed" && <input className="af-input cl-input" aria-label={`${label}: fixed value`} value={fixed} onChange={(e) => setFixed(e.target.value)} onBlur={() => fixed !== String(value) && onChange(fixed)} data-testid={`${testid}-fixed`} />}
    </span>
  );
}

function NewPayload({ fields, add, cancel }: { fields: Array<{ path: string; label: string }>; add: (key: string, value: PayloadValue) => void; cancel: () => void }) {
  const [key, setKey] = useState("");
  const [source, setSource] = useState(fields[0] ? `field:${fields[0].path}` : "fixed");
  const [fixed, setFixed] = useState("");
  const keyId = useId();
  const sourceId = useId();
  return (
    <div className="cl-payload__new" data-testid="payload-new">
      <label className="cl-field__label" htmlFor={keyId}>
        Name
      </label>
      <input id={keyId} className="af-input cl-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="for example hotelName" data-testid="payload-new-key" />
      <label className="cl-field__label" htmlFor={sourceId}>
        Value
      </label>
      <select id={sourceId} className="af-select cl-input" value={source} onChange={(e) => setSource(e.target.value)} data-testid="payload-new-source">
        {fields.map((f) => (
          <option key={f.path} value={`field:${f.path}`}>
            {f.label}
          </option>
        ))}
        <option value="fixed">Fixed value…</option>
      </select>
      {source === "fixed" && <input className="af-input cl-input" aria-label="Fixed value" value={fixed} onChange={(e) => setFixed(e.target.value)} data-testid="payload-new-fixed" />}
      <div className="cl-bar__actions">
        <button className="cl-tool cl-tool--primary" onClick={() => add(key.trim(), source === "fixed" ? fixed : { $prop: source.slice(6) })} data-testid="payload-new-add">
          Add
        </button>
        <button className="cl-tool" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
