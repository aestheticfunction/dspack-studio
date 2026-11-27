"use client";

/**
 * The inspector's editors for a draft (M1 authoring, A2): its details, its declared parameters and its
 * examples. Each change is one edit through editDraft (authoring.ts), validated by the packaged loader; a
 * change that would not be a valid composition is not applied, and the field says why. The composition
 * document itself is never the primary surface: JSON appears only for an example's data, on request.
 *
 * Not here, by decision: templates and structure, inputs and actions. They stay read-only.
 */
import { useId, useState, type ReactNode, type RefObject } from "react";
import type { CompositionDefinition, Scenario } from "@dspack-studio/composer-core/compositions";
import { emptyData, exampleId, exampleIssues, refusalOptions } from "./authoring";
import { DataForm, JsonData, useTyped } from "./data-form";

type Json = Record<string, any>;
export type Edit = (edit: (draft: CompositionDefinition) => void) => Promise<string | null>;

const words = (name: string) => {
  const w = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** A text field that applies each change as an edit and shows why one was refused. */
function TextEdit({ label, value, apply, multiline, maxLength, hint, testid }: { label: string; value: string; apply: (v: string) => Promise<string | null>; multiline?: boolean; maxLength?: number; hint?: string; testid: string }) {
  const id = useId();
  const [text, setText, ref] = useTyped(value);
  const [error, setError] = useState<string | null>(null);
  const onChange = async (v: string) => {
    setText(v);
    setError(await apply(v));
  };
  const common = {
    id,
    className: "af-input cl-input",
    value: text,
    maxLength,
    "aria-invalid": !!error,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
    "data-testid": testid,
    onBlur: () => !error && setText(value),
  };
  return (
    <div className="cl-field">
      <label className="cl-field__label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea {...common} ref={ref as RefObject<HTMLTextAreaElement>} rows={3} onChange={(e) => void onChange(e.target.value)} />
      ) : (
        <input {...common} ref={ref as RefObject<HTMLInputElement>} onChange={(e) => void onChange(e.target.value)} />
      )}
      {hint && !error && (
        <p className="cl-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="cl-field__error" id={`${id}-error`} role="alert">
          Not applied: {error}
        </p>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cl-section">
      <h3 className="cl-label">{title}</h3>
      {children}
    </section>
  );
}

/** Name and summary. */
export function DetailsEditor({ definition, edit }: { definition: CompositionDefinition; edit: Edit }) {
  return (
    <Group title="What it is">
      <TextEdit label="Name" value={definition.name} maxLength={80} apply={(v) => edit((d) => void (d.name = v))} testid="edit-name" />
      <TextEdit label="Summary" value={definition.summary} maxLength={240} multiline hint="One or two sentences: what the screen is for." apply={(v) => edit((d) => void (d.summary = v))} testid="edit-summary" />
    </Group>
  );
}

/** Declared parameters: their description, whether they are required, and their type's bounds. */
export function ParametersEditor({ definition, edit }: { definition: CompositionDefinition; edit: Edit }) {
  return (
    <Group title="Parameters">
      {definition.parameters.length === 0 ? (
        <p className="cl-dim" data-testid="no-parameters">
          This composition declares no parameters: everything it shows comes from its data.
        </p>
      ) : (
        <>
          <p className="cl-dim">A parameter is fixed when the composition is used. Changing its declaration changes what values it accepts.</p>
          {definition.parameters.map((p, i) => (
            <fieldset key={String(p.name)} className="cl-fieldset" data-testid={`param-${String(p.name)}`}>
              <legend>
                {words(String(p.name))} <span className="cl-field__hint">({typeName(p as Json)})</span>
              </legend>
              <TextEdit label="Description" value={String((p as Json).description ?? "")} maxLength={200} apply={(v) => edit((d) => void (v ? ((d.parameters[i] as Json).description = v) : delete (d.parameters[i] as Json).description))} testid={`param-${String(p.name)}-description`} />
              <CheckEdit label="Required" checked={!!(p as Json).required} apply={(v) => edit((d) => void (v ? ((d.parameters[i] as Json).required = true) : delete (d.parameters[i] as Json).required))} testid={`param-${String(p.name)}-required`} />
              {(p as Json).type === "string" && (
                <div className="cl-pair">
                  <NumberEdit label="Shortest" value={(p as Json).minLength} min={0} apply={(v) => edit((d) => setOrDelete(d.parameters[i] as Json, "minLength", v))} testid={`param-${String(p.name)}-minLength`} />
                  <NumberEdit label="Longest" value={(p as Json).maxLength} min={1} apply={(v) => edit((d) => setOrDelete(d.parameters[i] as Json, "maxLength", v))} testid={`param-${String(p.name)}-maxLength`} />
                </div>
              )}
              {(p as Json).type === "integer" && (
                <div className="cl-pair">
                  <NumberEdit label="Smallest" value={(p as Json).minimum} apply={(v) => edit((d) => setOrDelete(d.parameters[i] as Json, "minimum", v))} testid={`param-${String(p.name)}-minimum`} />
                  <NumberEdit label="Largest" value={(p as Json).maximum} apply={(v) => edit((d) => setOrDelete(d.parameters[i] as Json, "maximum", v))} testid={`param-${String(p.name)}-maximum`} />
                </div>
              )}
              {(p as Json).type === "enum" && (
                <TextEdit
                  label="Choices, separated by commas"
                  value={((p as Json).values ?? []).join(", ")}
                  apply={(v) => edit((d) => void ((d.parameters[i] as Json).values = v.split(",").map((x) => x.trim()).filter(Boolean)))}
                  testid={`param-${String(p.name)}-values`}
                />
              )}
            </fieldset>
          ))}
        </>
      )}
    </Group>
  );
}

const setOrDelete = (o: Json, k: string, v: number | undefined) => void (v === undefined ? delete o[k] : (o[k] = v));

function typeName(spec: Json): string {
  return spec.type === "string" ? "text" : spec.type === "integer" ? "a whole number" : spec.type === "enum" ? "one of a set of choices" : spec.type === "boolean" ? "yes or no" : spec.type === "array" ? "a list" : "a group of values";
}

function CheckEdit({ label, checked, apply, testid }: { label: string; checked: boolean; apply: (v: boolean) => Promise<string | null>; testid: string }) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="cl-field cl-field--check">
      <input id={id} type="checkbox" checked={checked} onChange={async (e) => setError(await apply(e.target.checked))} data-testid={testid} />
      <label className="cl-field__label" htmlFor={id}>
        {label}
      </label>
      {error && (
        <p className="cl-field__error" role="alert">
          Not applied: {error}
        </p>
      )}
    </div>
  );
}

function NumberEdit({ label, value, min, apply, testid }: { label: string; value: number | undefined; min?: number; apply: (v: number | undefined) => Promise<string | null>; testid: string }) {
  const id = useId();
  const [text, setText, ref] = useTyped(value === undefined ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="cl-field">
      <label className="cl-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        ref={ref as RefObject<HTMLInputElement>}
        id={id}
        className="af-input cl-input cl-input--number"
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        value={text}
        aria-invalid={!!error}
        onChange={async (e) => {
          setText(e.target.value);
          if (e.target.value !== "" && !/^-?\d+$/.test(e.target.value)) return setError("a whole number is needed");
          setError(await apply(e.target.value === "" ? undefined : Number(e.target.value)));
        }}
        data-testid={testid}
      />
      {error && (
        <p className="cl-field__error" role="alert">
          Not applied: {error}
        </p>
      )}
    </div>
  );
}

/**
 * The examples: a list to choose from (the choice is also the canvas's), add, duplicate and remove, and an
 * editor for the chosen one: its name, what should happen, its state and its data.
 */
export function ExamplesEditor({
  definition,
  edit,
  selected,
  select,
  contract,
  ruleLabel,
  results,
  nameOf,
  refusingRule,
}: {
  definition: CompositionDefinition;
  edit: Edit;
  selected: Scenario | undefined;
  select: (id: string) => void;
  contract: Json;
  ruleLabel: (rule: string) => string;
  /** An example's human name: its title, or the sample's label for it. */
  nameOf: (s: Scenario) => string;
  /** The rule refusing the selected example now, if one is: the natural choice when it should be refused. */
  refusingRule?: string;
  /** The latest check's result per example, when the check is of this exact draft. */
  results: Map<string, { matches: boolean }> | null;
}) {
  const [listError, setListError] = useState<string | null>(null);
  const taken = definition.scenarios.map((s) => s.id);
  const add = async () => {
    const id = exampleId("New example", taken);
    const err = await edit((d) => void d.scenarios.push({ id, title: "New example", data: emptyData(d.data as Json[]), expect: "ok" }));
    setListError(err);
    if (!err) select(id);
  };
  const duplicate = async (s: Scenario, name: string) => {
    const title = `${name} (copy)`.slice(0, 60);
    const id = exampleId(title, taken);
    const err = await edit((d) => {
      const at = d.scenarios.findIndex((x) => x.id === s.id);
      d.scenarios.splice(at + 1, 0, { ...structuredClone(d.scenarios[at]!), id, title });
    });
    setListError(err);
    if (!err) select(id);
  };
  const remove = async (s: Scenario) => {
    const at = definition.scenarios.findIndex((x) => x.id === s.id);
    const err = await edit((d) => void d.scenarios.splice(at, 1));
    setListError(err);
    if (!err && selected?.id === s.id) select(definition.scenarios[at === 0 ? 1 : at - 1]!.id);
  };
  return (
    <>
      <Group title="Examples">
        <p className="cl-dim">Each example is data an agent might send. The checks show each one and compare what happens with what you expect.</p>
        <ul className="cl-examples" data-testid="examples-list">
          {definition.scenarios.map((s) => {
            const name = nameOf(s);
            const result = results?.get(s.id);
            return (
              <li key={s.id} className={`cl-examples__row${s.id === selected?.id ? " cl-examples__row--on" : ""}`}>
                <button className="cl-examples__pick" aria-current={s.id === selected?.id ? "true" : undefined} onClick={() => select(s.id)} data-testid={`example-${s.id}`}>
                  <span className="cl-examples__name">{name}</span>
                  <span className="cl-examples__meta">
                    {s.expect === "refused" ? "Should be refused" : "Should be shown"}
                    {result ? (result.matches ? " · ✓ as expected" : " · ✗ not as expected") : " · not checked"}
                  </span>
                </button>
                <span className="cl-examples__actions">
                  <button className="cl-tool" onClick={() => void duplicate(s, name)} aria-label={`Duplicate ${name}`} data-testid={`duplicate-${s.id}`}>
                    Duplicate
                  </button>
                  <button className="cl-tool" onClick={() => void remove(s)} disabled={definition.scenarios.length <= 1} aria-label={`Remove ${name}`} data-testid={`remove-${s.id}`}>
                    Remove
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        {definition.scenarios.length <= 1 && <p className="cl-dim">A composition keeps at least one example, so the last one cannot be removed.</p>}
        <button className="cl-tool" onClick={() => void add()} data-testid="add-example">
          Add example
        </button>
        {listError && (
          <p className="cl-field__error" role="alert">
            Not applied: {listError}
          </p>
        )}
      </Group>
      {selected && <ExampleEditor key={selected.id} definition={definition} scenario={selected} edit={edit} contract={contract} ruleLabel={ruleLabel} name={nameOf(selected)} refusingRule={refusingRule} />}
    </>
  );
}

function ExampleEditor({ definition, scenario, edit, contract, ruleLabel, name, refusingRule }: { definition: CompositionDefinition; scenario: Scenario; edit: Edit; contract: Json; ruleLabel: (rule: string) => string; name: string; refusingRule?: string }) {
  const at = definition.scenarios.findIndex((s) => s.id === scenario.id);
  const change = (f: (s: Scenario) => void) => edit((d) => f(d.scenarios[at]!));
  const issues = exampleIssues(definition, scenario, contract);
  const expectId = useId();
  const ruleId = useId();
  const stateId = useId();
  const [error, setError] = useState<string | null>(null);
  const run = async (f: (s: Scenario) => void) => setError(await change(f));
  return (
    <section className="cl-section cl-example-edit" aria-labelledby={`${expectId}-title`} data-testid="example-editor">
      <h3 className="cl-label" id={`${expectId}-title`}>
        Edit “{name}”
      </h3>
      <TextEdit label="Name" value={scenario.title ?? name} maxLength={60} hint="How designers will recognise this example." apply={(v) => change((s) => void (v.trim() ? (s.title = v) : delete s.title))} testid="edit-example-title" />
      <fieldset className="cl-fieldset cl-fieldset--plain">
        <legend id={expectId}>What should happen</legend>
        <label className="cl-field cl-field--check">
          <input type="radio" name={`${expectId}-expect`} checked={scenario.expect === "ok"} onChange={() => void run((s) => { s.expect = "ok"; delete s.refusedBy; })} data-testid="expect-shown" />
          <span className="cl-field__label">It is shown</span>
        </label>
        <label className="cl-field cl-field--check">
          <input type="radio" name={`${expectId}-expect`} checked={scenario.expect === "refused"} onChange={() => void run((s) => { s.expect = "refused"; s.refusedBy = s.refusedBy ?? refusingRule ?? refusalOptions(contract)[0]?.value; })} data-testid="expect-refused" />
          <span className="cl-field__label">It is refused by a rule</span>
        </label>
        {scenario.expect === "refused" && (
          <div className="cl-field">
            <label className="cl-field__label" htmlFor={ruleId}>
              The rule that refuses it
            </label>
            <select id={ruleId} className="af-select cl-input" value={scenario.refusedBy ?? ""} onChange={(e) => void run((s) => void (s.refusedBy = e.target.value))} data-testid="expect-rule">
              {refusalOptions(contract).map((o) => (
                <option key={o.value} value={o.value}>
                  {ruleLabel(o.value)}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>
      <div className="cl-field">
        <label className="cl-field__label" htmlFor={stateId}>
          State
        </label>
        <select id={stateId} className="af-select cl-input" value={scenario.state ?? ""} onChange={(e) => void run((s) => void (e.target.value ? (s.state = e.target.value) : delete s.state))} data-testid="example-state">
          <option value="">Chosen by the data</option>
          {definition.states.map((st) => (
            <option key={st.id} value={st.id}>
              {words(st.id)}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="cl-fieldset cl-fieldset--plain" data-testid="example-data">
        <legend>Data</legend>
        <DataForm specs={definition.data as Json[]} value={scenario.data as Json} onChange={(v) => void run((s) => void (s.data = v))} />
        <details className="cl-json-edit">
          <summary>Edit the data as JSON</summary>
          <JsonData value={scenario.data} onApply={(v) => (v && typeof v === "object" && !Array.isArray(v) ? void run((s) => void (s.data = v)) : setError("the data must be an object of declared fields"))} label="Data as JSON" testid="example-json" />
        </details>
      </fieldset>
      {error && (
        <p className="cl-field__error" role="alert">
          Not applied: {error}
        </p>
      )}
      {issues.length > 0 && (
        <div className="cl-issues-box" role="status" data-testid="example-issues">
          <p>
            <strong>{scenario.expect === "refused" && scenario.refusedBy === "data" ? "This data is refused, as this example expects:" : "Before the checks, this example has problems:"}</strong>
          </p>
          <ul>
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
