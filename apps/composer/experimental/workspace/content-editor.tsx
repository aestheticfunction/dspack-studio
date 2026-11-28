"use client";

/**
 * What an element shows, edited on a draft (M1 visual template editing): its text and the contract's own props.
 * Text is edited as parts, fixed text and declared fields, chosen from lists: never typed as an expression.
 * Enums offer the contract's values; booleans are on or off. Each change is applied on Apply, as one edit.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { CompositionDefinition, StructureNode } from "@dspack-studio/composer-core/compositions";
import { booleanValue, editableContent, fieldsInScope, fromParts, toParts, type Part, type PropControl } from "./template-editing";
import { describeTemplateValue } from "./structure-panel";

type Json = Record<string, any>;

export interface ContentApi {
  set: (field: string, value: unknown, label: string) => Promise<string | null>;
  assignId: (id: string) => Promise<string | null>;
  renameId: (to: string) => Promise<string | null>;
}

export function ContentEditor({ definition, contract, node, states, api }: { definition: CompositionDefinition; contract: Json; node: StructureNode; states: string[]; api: ContentApi }) {
  const controls = editableContent(contract, node);
  const fields = fieldsInScope(definition, node);
  // The result of the latest change, said directly under the control that made it (F6).
  const [result, setResult] = useState<{ field: string; error: string | null; done: string | null } | null>(null);
  useEffect(() => setResult(null), [node.key]);
  const set = async (c: PropControl, value: unknown) => {
    setResult(null);
    const problem = await api.set(c.name, value, c.label);
    setResult({ field: c.name, error: problem, done: problem ? null : value === undefined ? `${c.label} is not set: the design system's default applies.` : `${c.label} changed.` });
  };
  const feedback = (name: string) => (result?.field === name ? <EditResult error={result.error} done={result.done} errorId="content-error" doneId="content-applied" /> : null);
  const current = (name: string) => (name === "text" ? node.text : node.props?.[name]);
  if (controls.length === 0) return <p className="cl-dim">This element has nothing to set here.</p>;
  return (
    <div className="cl-form" data-testid="content-editor">
      {states.length > 1 && <p className="cl-dim">This element appears in {states.length} states; a change here applies in all of them.</p>}
      {controls.map((c) => (
        <div key={`${node.key}-${c.name}-${definition.version}`} className="cl-content__control">
          {c.kind === "text" ? (
            <PartsEditor control={c} value={current(c.name)} fields={fields} apply={(v) => set(c, v)} />
          ) : c.kind === "enum" ? (
            <EnumEditor control={c} value={current(c.name)} apply={(v) => set(c, v)} />
          ) : (
            <BoolEditor control={c} value={current(c.name)} apply={(v) => set(c, v)} />
          )}
          {feedback(c.name)}
        </div>
      ))}
    </div>
  );
}

function PartsEditor({ control, value, fields, apply }: { control: PropControl; value: unknown; fields: Array<{ path: string; label: string; source: string }>; apply: (v: unknown) => void }) {
  const initial = toParts(value);
  const [parts, setParts] = useState<Part[]>(initial ?? []);
  const id = useId();
  if (!initial) {
    return (
      <div className="cl-field">
        <p className="cl-field__label">{control.label}</p>
        <p className="cl-text">{describeTemplateValue(value)}</p>
        <p className="cl-dim">This value uses template features that cannot be edited here.</p>
      </div>
    );
  }
  const update = (i: number, p: Part) => setParts(parts.map((x, k) => (k === i ? p : x)));
  const remove = (i: number) => setParts(parts.filter((_, k) => k !== i));
  const changed = JSON.stringify(fromParts(parts)) !== JSON.stringify(value === undefined ? "" : value);
  return (
    <fieldset className="cl-parts" data-testid={`content-${control.name}`}>
      <legend className="cl-field__label">{control.label}</legend>
      {parts.length === 0 && <p className="cl-dim">Not set.</p>}
      <ul className="cl-parts__list">
        {parts.map((p, i) => (
          <li key={i} className="cl-parts__row">
            {p.kind === "text" ? (
              <input className="af-input cl-input" aria-label={`${control.label}: fixed text ${i + 1}`} value={p.value} onChange={(e) => update(i, { kind: "text", value: e.target.value })} data-testid={`content-${control.name}-text-${i}`} />
            ) : (
              <select className="af-select cl-input" aria-label={`${control.label}: field ${i + 1}`} value={p.path} onChange={(e) => update(i, { kind: "field", path: e.target.value })} data-testid={`content-${control.name}-field-${i}`}>
                {!fields.some((f) => f.path === p.path) && <option value={p.path}>{p.path} (not available here)</option>}
                {fields.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.label} ({f.source})
                  </option>
                ))}
              </select>
            )}
            <button className="cl-tool" onClick={() => remove(i)} aria-label={`Remove part ${i + 1} of ${control.label}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="cl-parts__add" id={id}>
        <button className="cl-tool" onClick={() => setParts([...parts, { kind: "text", value: "" }])} data-testid={`content-${control.name}-add-text`}>
          Add text
        </button>
        <button className="cl-tool" onClick={() => fields[0] && setParts([...parts, { kind: "field", path: fields[0].path }])} disabled={fields.length === 0} data-testid={`content-${control.name}-add-field`}>
          Add a field
        </button>
        <button className="cl-tool cl-tool--primary" onClick={() => apply(fromParts(parts))} disabled={!changed} data-testid={`content-${control.name}-apply`}>
          Apply
        </button>
      </div>
      <p className="cl-dim">Shows: {describeTemplateValue(fromParts(parts)) || "nothing"}</p>
    </fieldset>
  );
}

function EnumEditor({ control, value, apply }: { control: PropControl; value: unknown; apply: (v: unknown) => void }) {
  const id = useId();
  return (
    <div className="cl-field">
      <label className="cl-field__label" htmlFor={id}>
        {control.label}
      </label>
      <select id={id} className="af-select cl-input" value={typeof value === "string" ? value : ""} onChange={(e) => apply(e.target.value === "" ? undefined : e.target.value)} data-testid={`content-${control.name}`}>
        <option value="">{control.default !== undefined ? `Not set (the default, ${String(control.default)})` : "Not set (the design system's default)"}</option>
        {control.values!.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}

function BoolEditor({ control, value, apply }: { control: PropControl; value: unknown; apply: (v: unknown) => void }) {
  const id = useId();
  return (
    <div className="cl-check">
      <input id={id} type="checkbox" checked={value === undefined ? control.default === true : value === true} onChange={(e) => apply(booleanValue(control, e.target.checked))} data-testid={`content-${control.name}`} />
      <label htmlFor={id}>{control.label}</label>
    </div>
  );
}

/**
 * The result of an edit, placed by the control that made it and brought into view, clear of the sticky bar
 * (F6). A refusal is an alert; a success is a status message.
 */
export function EditResult({ error, done, errorId, doneId, suffix = " The canvas shows it, and the checks need to run again." }: { error: string | null; done: string | null; errorId: string; doneId: string; suffix?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [error, done]);
  if (error)
    return (
      <p className="cl-field__error cl-result" role="alert" data-testid={errorId} ref={ref}>
        Not applied: {error}
      </p>
    );
  if (done)
    return (
      <p className="cl-ok cl-result" role="status" data-testid={doneId} ref={ref}>
        {done}
        {suffix}
      </p>
    );
  return null;
}

/** An element's id: give one to an element without, or rename it everywhere it is used. */
export function IdentityEditor({ node, suggest, api }: { node: StructureNode; suggest: string; api: ContentApi }) {
  const [value, setValue] = useState(node.id ?? suggest);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  useEffect(() => {
    setValue(node.id ?? suggest);
    setError(null);
  }, [node.key, node.id, suggest]);
  const submit = async () => setError(node.id ? await api.renameId(value.trim()) : await api.assignId(value.trim()));
  return (
    <div className="cl-form" data-testid="identity-editor">
      <p className="cl-dim">
        {node.id
          ? "Its id is how typed fields and actions refer to it. Renaming updates every state and every declaration that uses it, in one step."
          : "It has no id. Give it one to bind a typed field or an action to it, or to keep track of it while the structure changes."}
      </p>
      <label className="cl-field__label" htmlFor={id}>
        Id
      </label>
      <div className="cl-parts__row cl-parts__row--wrap">
        <input id={id} className="af-input cl-input" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} data-testid="identity-input" />
        <button className="cl-tool" onClick={() => void submit()} disabled={value.trim() === (node.id ?? "")} data-testid="identity-apply">
          {node.id ? "Rename" : "Give it this id"}
        </button>
      </div>
      {error && (
        <p className="cl-field__error" role="alert" data-testid="identity-error">
          Not applied: {error}
        </p>
      )}
    </div>
  );
}
