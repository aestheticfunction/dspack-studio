"use client";

/**
 * Example data as a form (M1 authoring, A2): one control per declared field, generated from the
 * composition's own data declarations (the block value language: string, integer, enum, boolean, object,
 * array). Lists of objects and of values get add and remove. Anything the form cannot express is edited as
 * JSON, in place, with the parse error said plainly. The declarations stay the single source of truth: the
 * form never adds a field that is not declared, and the data it produces is validated by the same
 * validateInstanceInput the pipeline runs.
 */
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { emptyValue } from "./authoring";

type Json = Record<string, any>;
type Spec = Json;

const words = (name: string) => {
  const w = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** A labelled control for one declared field. `value === undefined` means the field is left out. */
function Field({ spec, value, onChange, path }: { spec: Spec; value: unknown; onChange: (v: unknown) => void; path: string }) {
  const id = useId();
  const label = (
    <label className="cl-field__label" htmlFor={id}>
      {words(spec.name)}
      {spec.required ? "" : <span className="cl-field__hint"> (optional)</span>}
    </label>
  );
  switch (spec.type) {
    case "string":
      return (
        <div className="cl-field">
          {label}
          <TextValue id={id} value={typeof value === "string" ? value : ""} maxLength={spec.maxLength} onChange={(v) => onChange(v === "" && !spec.required ? undefined : v)} testid={`data-${path}`} />
        </div>
      );
    case "integer":
      return (
        <div className="cl-field">
          {label}
          <NumberValue id={id} value={typeof value === "number" ? value : undefined} min={spec.minimum} max={spec.maximum} onChange={(v) => onChange(v)} testid={`data-${path}`} />
        </div>
      );
    case "enum":
      return (
        <div className="cl-field">
          {label}
          <select id={id} className="af-select cl-input" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} data-testid={`data-${path}`}>
            {!spec.required && <option value="">Left out</option>}
            {(spec.values ?? []).map((v: string) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      );
    case "boolean":
      return (
        <div className="cl-field cl-field--check">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} data-testid={`data-${path}`} />
          {label}
        </div>
      );
    case "object": {
      if (value === undefined || value === null || typeof value !== "object") {
        return (
          <div className="cl-field">
            <span className="cl-field__label">{words(spec.name)}</span>
            <button type="button" className="cl-tool" onClick={() => onChange(emptyValue(spec))} data-testid={`data-${path}-add`}>
              Add {words(spec.name).toLowerCase()}
            </button>
          </div>
        );
      }
      return (
        <fieldset className="cl-fieldset">
          <legend>{words(spec.name)}</legend>
          <DataForm specs={spec.props ?? []} value={value as Json} onChange={(v) => onChange(v)} path={path} />
          {!spec.required && (
            <button type="button" className="cl-tool" onClick={() => onChange(undefined)}>
              Leave out {words(spec.name).toLowerCase()}
            </button>
          )}
        </fieldset>
      );
    }
    case "array": {
      const items = Array.isArray(value) ? value : [];
      const item: Spec = { ...(spec.items ?? { type: "string" }), name: "item", required: true };
      const full = typeof spec.maxItems === "number" && items.length >= spec.maxItems;
      if (!["string", "integer", "enum", "boolean", "object"].includes(item.type)) return <JsonField spec={spec} value={value} onChange={onChange} path={path} />;
      return (
        <fieldset className="cl-fieldset">
          <legend>
            {words(spec.name)} <span className="cl-field__hint">({items.length === 1 ? "1 item" : `${items.length} items`})</span>
          </legend>
          {items.length === 0 && <p className="cl-dim">None yet.</p>}
          <ol className="cl-items">
            {items.map((v, i) => (
              <li key={i} className="cl-items__item">
                <div className="cl-items__head">
                  <span className="cl-items__title">
                    {words(spec.name.replace(/s$/, ""))} {i + 1}
                    {item.type === "object" && typeof (v as Json)?.name === "string" && (v as Json).name ? `: ${(v as Json).name}` : ""}
                  </span>
                  <button type="button" className="cl-tool" aria-label={`Remove ${words(spec.name.replace(/s$/, "")).toLowerCase()} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))} data-testid={`data-${path}-${i}-remove`}>
                    Remove
                  </button>
                </div>
                {item.type === "object" ? (
                  <DataForm specs={item.props ?? []} value={(v ?? {}) as Json} onChange={(next) => onChange(items.map((x, j) => (j === i ? next : x)))} path={`${path}-${i}`} />
                ) : (
                  <Field spec={{ ...item, name: `${spec.name.replace(/s$/, "")} ${i + 1}` }} value={v} onChange={(next) => onChange(items.map((x, j) => (j === i ? next : x)))} path={`${path}-${i}`} />
                )}
              </li>
            ))}
          </ol>
          <button type="button" className="cl-tool" disabled={full} onClick={() => onChange([...items, emptyValue(item)])} data-testid={`data-${path}-add`}>
            Add {words(spec.name.replace(/s$/, "")).toLowerCase()}
          </button>
          {full && <p className="cl-dim">The most this list allows is {spec.maxItems}.</p>}
        </fieldset>
      );
    }
    default:
      return <JsonField spec={spec} value={value} onChange={onChange} path={path} />;
  }
}

/** Fields for an object's declared properties, in declaration order. */
export function DataForm({ specs, value, onChange, path = "" }: { specs: Spec[]; value: Json; onChange: (v: Json) => void; path?: string }) {
  return (
    <div className="cl-form">
      {specs.map((spec) => (
        <Field
          key={spec.name}
          spec={spec}
          value={value[spec.name]}
          path={path ? `${path}-${spec.name}` : spec.name}
          onChange={(v) => {
            const next = { ...value };
            if (v === undefined) delete next[spec.name];
            else next[spec.name] = v;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

/**
 * Edits are applied asynchronously, one at a time. While a field has focus it keeps what was typed, so a
 * change still being applied never pulls the text back; it follows the stored value again once it loses focus.
 */
export function useTyped<T>(value: T): [T, (v: T) => void, RefObject<HTMLInputElement | HTMLTextAreaElement | null>] {
  const [local, setLocal] = useState(value);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (typeof document === "undefined" || document.activeElement !== ref.current) setLocal(value);
  }, [value]);
  return [local, setLocal, ref];
}

function TextValue({ id, value, maxLength, onChange, testid }: { id: string; value: string; maxLength?: number; onChange: (v: string) => void; testid: string }) {
  const [text, setText, ref] = useTyped(value);
  return (
    <input
      ref={ref as RefObject<HTMLInputElement>}
      onBlur={() => setText(value)}
      id={id}
      className="af-input cl-input"
      value={text}
      maxLength={maxLength}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
      data-testid={testid}
    />
  );
}

function NumberValue({ id, value, min, max, onChange, testid }: { id: string; value: number | undefined; min?: number; max?: number; onChange: (v: number | undefined) => void; testid: string }) {
  const [text, setText, ref] = useTyped(value === undefined ? "" : String(value));
  return (
    <input
      ref={ref as RefObject<HTMLInputElement>}
      id={id}
      className="af-input cl-input cl-input--number"
      type="number"
      inputMode="numeric"
      step={1}
      min={min}
      max={max}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value === "") onChange(undefined);
        else if (/^-?\d+$/.test(e.target.value)) onChange(Number(e.target.value));
      }}
      data-testid={testid}
    />
  );
}

/** A field the form cannot express, edited as JSON in place. */
function JsonField({ spec, value, onChange, path }: { spec: Spec; value: unknown; onChange: (v: unknown) => void; path: string }) {
  return (
    <div className="cl-field">
      <span className="cl-field__label">{words(spec.name)}</span>
      <JsonData value={value ?? null} onApply={onChange} label={`${words(spec.name)} as JSON`} testid={`data-${path}-json`} />
    </div>
  );
}

/**
 * JSON for one value, applied explicitly. A parse error is said in words and nothing is applied; a value that
 * parses but does not fit the declarations is applied and reported by the example's own checks.
 */
export function JsonData({ value, onApply, label, testid }: { value: unknown; onApply: (v: any) => void; label: string; testid: string }) {
  const id = useId();
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(JSON.stringify(value, null, 2));
    setError(null);
  }, [value]);
  const apply = () => {
    try {
      const parsed = JSON.parse(text);
      setError(null);
      onApply(parsed);
    } catch (e) {
      setError(`This is not valid JSON yet: ${e instanceof Error ? e.message.replace(/^JSON\.parse: /, "") : "it could not be read"}. Nothing was applied.`);
    }
  };
  return (
    <div className="cl-json">
      <label className="cl-field__label" htmlFor={id}>
        {label}
      </label>
      <textarea id={id} className="af-input cl-input cl-json__text" rows={8} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={error ? `${id}-error` : undefined} aria-invalid={!!error} data-testid={testid} />
      {error && (
        <p className="cl-field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      <button type="button" className="cl-tool" onClick={apply} data-testid={`${testid}-apply`}>
        Apply JSON
      </button>
    </div>
  );
}
