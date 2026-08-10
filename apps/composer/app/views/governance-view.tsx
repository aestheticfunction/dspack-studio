"use client";

/**
 * Governance authoring: intents and the four typed rules as pure form
 * projections (the spec has no expression language by design — every rule is
 * identifiers and value lists, so forms ARE the editor).
 *
 * Owner authorship is structural: the rationale field gates saving ("write
 * the rationale first; if you cannot say why, it is not yet a rule" —
 * ADOPTING.md), governance sections are human-authored in the ledger by
 * construction, and every save re-lints all worked examples so the author
 * sees immediately what a rule fires on.
 */
import { useMemo, useState } from "react";
import { buildVocabulary } from "@aestheticfunction/dspack-spec/lib/validate.mjs";
import { useComposer } from "../state";
import { ViewHeader } from "../ui";
import { contractSurfaces, lintOneSurface } from "../validation";

const field = {
  fontFamily: "var(--mono)",
  fontSize: 12,
  background: "var(--bg-1)",
  border: "1px solid var(--line)",
  color: "var(--fg)",
  padding: "4px 6px",
  borderRadius: 2,
} as const;
const label = { fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color: "var(--fg-dim)" } as const;

const RULE_TYPES = ["component-choice", "required-composition", "forbidden-composition", "required-props"] as const;
type RuleType = (typeof RULE_TYPES)[number];

const EMPTY_RULE = {
  id: "",
  type: "component-choice" as RuleType,
  severity: "must" as "must" | "should",
  appliesTo: [] as string[],
  require: [] as string[],
  forbid: [] as string[],
  component: "",
  within: "",
  requiredText: false,
  textScope: "self" as "self" | "subtree",
  requiredProps: [] as Array<{ on?: string; prop: string; oneOf?: string }>,
  forbiddenDescendants: [] as string[],
  requiredSubComponents: [] as Array<{ id: string; min: number }>,
  rationale: "",
  examples: [] as string[],
};

type Draft = typeof EMPTY_RULE;

/** Draft -> spec rule object (only the fields the type defines). */
function toRule(draft: Draft): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: draft.id.startsWith("rule.") ? draft.id : `rule.${draft.id}`,
    type: draft.type,
    severity: draft.severity,
    rationale: draft.rationale.trim(),
  };
  if (draft.appliesTo.length) base.appliesTo = { intents: draft.appliesTo };
  if (draft.examples.length) base.examples = draft.examples;
  const props = (rows: Draft["requiredProps"], withOn: boolean) =>
    rows
      .filter((r) => r.prop)
      .map((r) => ({
        ...(withOn && r.on ? { on: r.on } : {}),
        prop: r.prop,
        ...(r.oneOf?.trim() ? { oneOf: r.oneOf.split(",").map((v) => v.trim()).filter(Boolean) } : {}),
      }));
  switch (draft.type) {
    case "component-choice":
      if (draft.require.length) base.require = draft.require;
      if (draft.forbid.length) base.forbid = draft.forbid;
      break;
    case "required-composition":
      base.component = draft.component;
      if (draft.requiredSubComponents.length) base.requiredSubComponents = draft.requiredSubComponents;
      if (draft.requiredProps.length) base.requiredProps = props(draft.requiredProps, true);
      break;
    case "forbidden-composition":
      base.component = draft.component;
      if (draft.forbiddenDescendants.length) base.forbiddenDescendants = draft.forbiddenDescendants;
      break;
    case "required-props":
      base.component = draft.component;
      if (draft.within) base.within = draft.within;
      if (draft.requiredText) {
        base.requiredText = true;
        base.textScope = draft.textScope;
      }
      if (draft.requiredProps.length) base.requiredProps = props(draft.requiredProps, false);
      break;
  }
  return base;
}

/** Spec rule -> editable draft (for edit-in-place). */
function toDraft(rule: Record<string, any>): Draft {
  return {
    ...EMPTY_RULE,
    id: rule.id ?? "",
    type: rule.type,
    severity: rule.severity ?? "must",
    appliesTo: rule.appliesTo?.intents ?? [],
    require: rule.require ?? [],
    forbid: rule.forbid ?? [],
    component: rule.component ?? "",
    within: rule.within ?? "",
    requiredText: rule.requiredText === true,
    textScope: rule.textScope ?? "self",
    requiredProps: (rule.requiredProps ?? []).map((r: any) => ({
      on: r.on,
      prop: r.prop,
      oneOf: Array.isArray(r.oneOf) ? r.oneOf.join(", ") : undefined,
    })),
    forbiddenDescendants: rule.forbiddenDescendants ?? [],
    requiredSubComponents: rule.requiredSubComponents ?? [],
    rationale: rule.rationale ?? "",
    examples: rule.examples ?? [],
  };
}

function MultiPick({ options, value, onChange, testid }: { options: string[]; value: string[]; onChange: (v: string[]) => void; testid?: string }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-testid={testid}>
      {options.map((o) => (
        <label key={o} style={{ fontFamily: "var(--mono)", fontSize: 11, border: "1px solid var(--line)", borderRadius: 3, padding: "1px 6px", cursor: "pointer", color: value.includes(o) ? "var(--green-bright)" : "var(--fg-dim)", borderColor: value.includes(o) ? "var(--green)" : "var(--line)" }}>
          <input type="checkbox" style={{ display: "none" }} checked={value.includes(o)} onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((v) => v !== o))} />
          {o}
        </label>
      ))}
    </div>
  );
}

export function GovernanceView() {
  const { contract, saveContract, mode } = useComposer();
  const [draft, setDraft] = useState<Draft>(EMPTY_RULE);
  const [intentDraft, setIntentDraft] = useState({ id: "", name: "", description: "" });
  const [impact, setImpact] = useState<Array<{ name: string; findings: string[] }> | null>(null);
  const [issue, setIssue] = useState<string | null>(null);

  const vocab = useMemo(() => (contract ? buildVocabulary(contract) : null), [contract]);
  if (!contract || !vocab) return <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>No contract loaded.</p>;

  const componentIds = [...vocab.components.keys()];
  const subIds = [...vocab.subComponents.keys()];
  const intents: Array<{ id: string; name?: string; description: string }> = contract.intents ?? [];
  const rules: Array<Record<string, any>> = contract.rules ?? [];
  const exampleIds: string[] = (contract.examples ?? []).map((e: any) => e.id);
  const propsOf = (id: string) => [...(vocab.components.get(id)?.props.keys() ?? [])];

  /** Save + live re-lint: the author sees what governance now fires on. */
  const commit = async (mutate: (doc: any) => void) => {
    const doc = structuredClone(contract);
    mutate(doc);
    const result = await saveContract(doc);
    if (Array.isArray(result) && result.length > 0) {
      setIssue(result.map((f) => f.message).join("; "));
      return false;
    }
    setIssue(null);
    setImpact(
      contractSurfaces(doc).map(({ name, surface }) => ({
        name,
        findings: lintOneSurface(name, surface, doc).map((f) => `${f.gate} ${f.code}: ${f.message}`),
      })),
    );
    return true;
  };

  const rationaleReady = draft.rationale.trim().length >= 20;
  const typeReady =
    draft.type === "component-choice"
      ? draft.require.length + draft.forbid.length > 0
      : draft.component !== "" &&
        (draft.type !== "required-props" || draft.requiredText || draft.requiredProps.some((r) => r.prop));

  const saveRule = () =>
    void commit((doc) => {
      const rule = toRule(draft);
      doc.rules = [...(doc.rules ?? []).filter((r: any) => r.id !== rule.id), rule];
    }).then((ok) => {
      if (ok) setDraft(EMPTY_RULE);
    });

  return (
    <>
      <ViewHeader
        eyebrow="Governance"
        lead="The design-system rules and intent context governing this project — why Composer is allowed, or not allowed, to generate certain things. Every build is checked against exactly this."
      />
      <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: "0 0 14px" }} data-testid="governance-summary">
        {intents.length} intent{intents.length === 1 ? "" : "s"} · {rules.length} rule{rules.length === 1 ? "" : "s"} govern this
        design system{contract.name ? ` (${contract.name})` : ""}.
      </p>
      <section style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(420px, 3fr) minmax(260px, 2fr)" }}>
      <div>
        <h2 style={{ fontFamily: "var(--hl)", fontSize: 15, textTransform: "uppercase", color: "var(--fg)" }}>Intents</h2>
        <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
          What a surface can be FOR. Generation reaches for one governed context per goal; rules select by it.
        </p>
        <ul style={{ listStyle: "none", padding: 0, fontSize: 13 }}>
          {intents.map((i) => (
            <li key={i.id} style={{ borderTop: "1px solid var(--line-soft)", padding: "8px 0" }} data-testid={`intent-${i.id}`}>
              <span style={{ color: "var(--fg)", fontWeight: 600 }}>{(i as { name?: string }).name ?? i.id}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-dim)", marginLeft: 8 }}>{i.id}</span>
              <span style={{ display: "block", color: "var(--fg-body)", marginTop: 2 }}>{i.description}</span>
            </li>
          ))}
        </ul>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <input style={field} placeholder="intent-id (kebab-case)" value={intentDraft.id} onChange={(e) => setIntentDraft({ ...intentDraft, id: e.target.value })} data-testid="intent-id" />
          <input style={field} placeholder="name" value={intentDraft.name} onChange={(e) => setIntentDraft({ ...intentDraft, name: e.target.value })} />
          <input style={{ ...field, gridColumn: "1 / -1" }} placeholder="what surfaces under this intent are FOR (one sentence)" value={intentDraft.description} onChange={(e) => setIntentDraft({ ...intentDraft, description: e.target.value })} data-testid="intent-description" />
        </div>
        <button
          className="st-btn"
          style={{ marginTop: 6 }}
          disabled={!/^[a-z][a-z0-9-]*$/.test(intentDraft.id) || intentDraft.description.trim().length < 10}
          onClick={() =>
            void commit((doc) => {
              doc.intents = [...(doc.intents ?? []).filter((i: any) => i.id !== intentDraft.id), { id: intentDraft.id, ...(intentDraft.name ? { name: intentDraft.name } : {}), description: intentDraft.description.trim() }];
            }).then((ok) => ok && setIntentDraft({ id: "", name: "", description: "" }))
          }
          data-testid="add-intent"
        >
          Add intent
        </button>

        <h2 style={{ fontFamily: "var(--hl)", fontSize: 15, textTransform: "uppercase", color: "var(--fg)", marginTop: 24 }}>Rules</h2>
        <ul style={{ listStyle: "none", padding: 0, fontSize: 13 }}>
          {rules.map((r) => (
            <li key={r.id} style={{ borderTop: "1px solid var(--line-soft)", padding: "6px 0" }} data-testid={`rule-${r.id}`}>
              <div>
                <span style={{ fontFamily: "var(--mono)", color: "var(--info)" }}>{r.id}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-dim)", marginLeft: 8 }}>
                  {r.type} · {r.severity}
                  {r.appliesTo?.intents ? ` · ${r.appliesTo.intents.join(", ")}` : ""}
                </span>
                <button className="st-link" style={{ marginLeft: 10, fontSize: 12 }} onClick={() => setDraft(toDraft(r))}>
                  edit
                </button>
                <button
                  className="st-link"
                  style={{ marginLeft: 8, fontSize: 12, color: "var(--err)" }}
                  onClick={() => void commit((doc) => (doc.rules = doc.rules.filter((x: any) => x.id !== r.id)))}
                >
                  remove
                </button>
              </div>
              <div style={{ fontSize: 12, color: "var(--fg-dim)" }}>{r.rationale}</div>
            </li>
          ))}
        </ul>

        <div style={{ border: "1px solid var(--line)", borderRadius: 4, padding: 12, marginTop: 10 }}>
          <span style={label}>rule builder</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 6, margin: "8px 0" }}>
            <input style={field} placeholder="rule.id" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} data-testid="rule-id" />
            <select style={field} value={draft.type} onChange={(e) => setDraft({ ...EMPTY_RULE, id: draft.id, rationale: draft.rationale, appliesTo: draft.appliesTo, type: e.target.value as RuleType })} data-testid="rule-type">
              {RULE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select style={field} value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value as "must" | "should" })}>
              <option>must</option>
              <option>should</option>
            </select>
          </div>

          <span style={label}>applies to intents (empty = every intent)</span>
          <MultiPick options={intents.map((i) => i.id)} value={draft.appliesTo} onChange={(v) => setDraft({ ...draft, appliesTo: v })} testid="rule-intents" />

          {draft.type === "component-choice" && (
            <>
              <span style={{ ...label, display: "block", marginTop: 8 }}>require (surface must contain)</span>
              <MultiPick options={componentIds} value={draft.require} onChange={(v) => setDraft({ ...draft, require: v })} testid="rule-require" />
              <span style={{ ...label, display: "block", marginTop: 8 }}>forbid (surface must not contain)</span>
              <MultiPick options={componentIds} value={draft.forbid} onChange={(v) => setDraft({ ...draft, forbid: v })} />
            </>
          )}

          {draft.type !== "component-choice" && (
            <div style={{ marginTop: 8 }}>
              <span style={label}>component</span>{" "}
              <select style={field} value={draft.component} onChange={(e) => setDraft({ ...draft, component: e.target.value })} data-testid="rule-component">
                <option value="">pick…</option>
                {(draft.type === "required-props" ? [...componentIds, ...subIds] : componentIds).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          {draft.type === "forbidden-composition" && (
            <>
              <span style={{ ...label, display: "block", marginTop: 8 }}>forbidden descendants</span>
              <MultiPick options={[...componentIds, ...subIds]} value={draft.forbiddenDescendants} onChange={(v) => setDraft({ ...draft, forbiddenDescendants: v })} />
            </>
          )}

          {draft.type === "required-props" && (
            <div style={{ marginTop: 8 }}>
              <label style={{ fontSize: 12, color: "var(--fg-body)" }}>
                <input type="checkbox" checked={draft.requiredText} onChange={(e) => setDraft({ ...draft, requiredText: e.target.checked })} data-testid="rule-required-text" /> requires text
              </label>
              {draft.requiredText && (
                <select style={{ ...field, marginLeft: 8 }} value={draft.textScope} onChange={(e) => setDraft({ ...draft, textScope: e.target.value as "self" | "subtree" })}>
                  <option value="self">on the node itself</option>
                  <option value="subtree">anywhere beneath it</option>
                </select>
              )}
            </div>
          )}

          {(draft.type === "required-composition" || draft.type === "required-props") && draft.component && (
            <div style={{ marginTop: 8 }}>
              <span style={label}>required props</span>
              {draft.requiredProps.map((row, i) => (
                <div key={i} style={{ display: "flex", gap: 6, margin: "4px 0" }}>
                  <select
                    style={field}
                    value={row.prop}
                    onChange={(e) => setDraft({ ...draft, requiredProps: draft.requiredProps.map((r, j) => (j === i ? { ...r, prop: e.target.value } : r)) })}
                    data-testid={`rule-prop-${i}`}
                  >
                    <option value="">prop…</option>
                    {propsOf(draft.component).map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                  <input
                    style={{ ...field, flex: 1 }}
                    placeholder="oneOf values, comma separated (empty = any value)"
                    value={row.oneOf ?? ""}
                    onChange={(e) => setDraft({ ...draft, requiredProps: draft.requiredProps.map((r, j) => (j === i ? { ...r, oneOf: e.target.value } : r)) })}
                  />
                  <button className="st-link" style={{ color: "var(--err)" }} onClick={() => setDraft({ ...draft, requiredProps: draft.requiredProps.filter((_, j) => j !== i) })}>
                    ×
                  </button>
                </div>
              ))}
              <button className="st-btn st-btn--dashed" onClick={() => setDraft({ ...draft, requiredProps: [...draft.requiredProps, { prop: "" }] })} data-testid="add-required-prop">
                Add prop requirement
              </button>
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <span style={label}>rationale — write it first; if you cannot say why, it is not yet a rule</span>
            <textarea
              style={{ ...field, width: "100%", minHeight: 48, fontFamily: "var(--sans)", fontSize: 13 }}
              value={draft.rationale}
              onChange={(e) => setDraft({ ...draft, rationale: e.target.value })}
              data-testid="rule-rationale"
            />
          </div>

          {exampleIds.length > 0 && (
            <>
              <span style={label}>worked examples this rule cites</span>
              <MultiPick options={exampleIds} value={draft.examples} onChange={(v) => setDraft({ ...draft, examples: v })} />
            </>
          )}

          <button className="st-btn" style={{ marginTop: 10 }} disabled={!rationaleReady || !typeReady || !/^(rule\.)?[a-z][a-z0-9.-]*$/.test(draft.id) || draft.id.length < 3} onClick={saveRule} data-testid="save-rule">
            Save rule
          </button>
          {!rationaleReady && draft.id && <span style={{ fontSize: 12, color: "var(--warn)", marginLeft: 8 }}>rationale first</span>}
          {issue && <p style={{ fontSize: 12, color: "var(--err)" }}>{issue}</p>}
          {mode === "demo" && <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>Intent and rule edits last this session — connect the local agent to save them to your repository.</p>}
        </div>
      </div>

      <aside>
        <h3 style={{ fontFamily: "var(--hl)", fontSize: 13, textTransform: "uppercase", color: "var(--fg)" }}>Governance impact</h3>
        <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
          Every save re-lints all worked examples (S1–S3, the same linter generation runs under).
        </p>
        {impact === null ? (
          <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>Save an intent or rule to see what it fires on.</p>
        ) : (
          impact.map(({ name, findings }) => (
            <div key={name} style={{ margin: "8px 0" }} data-testid={`impact-${name}`}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: findings.length ? "var(--warn)" : "var(--ok)" }}>
                {name}: {findings.length ? `${findings.length} finding(s)` : "clean"}
              </span>
              <ul style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--fg-body)", paddingLeft: 16 }}>
                {findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          ))
        )}
      </aside>
      </section>
    </>
  );
}
