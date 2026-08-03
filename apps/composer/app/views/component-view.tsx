"use client";

/**
 * Component detail: the enrichment step. Prose (description / whenToUse /
 * whenNotToUse) AND props — the spike proved discovery is variant-centric
 * (plain interface props like `label` are not extracted), so adding props is
 * a required capability, not polish. Edits go through the ledger-honoring
 * save; in demo mode they stay in memory (stated).
 */
import { useState } from "react";
import { useComposer } from "../state";

const field = {
  width: "100%",
  fontFamily: "var(--sans)",
  fontSize: 13,
  background: "var(--bg-1)",
  border: "1px solid var(--line)",
  color: "var(--fg)",
  padding: "6px 8px",
  borderRadius: 2,
} as const;
const label = { fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color: "var(--fg-dim)" } as const;

export function ComponentView() {
  const { contract, selected, saveContract, mode } = useComposer();
  const [newProp, setNewProp] = useState({ name: "", type: "string", values: "", required: false, description: "" });
  const [saved, setSaved] = useState<string | null>(null);

  if (!contract || !selected || !contract.components?.[selected]) {
    return <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>Pick a component in the Inventory.</p>;
  }
  const entry = contract.components[selected];

  const update = async (mutate: (draft: any) => void) => {
    const draft = structuredClone(contract);
    mutate(draft.components[selected]);
    const result = await saveContract(draft);
    setSaved(Array.isArray(result) && result.length > 0 ? result[0].message : mode === "demo" ? "kept in memory (demo)" : "saved");
  };

  const addProp = () =>
    void update((c) => {
      c.props ??= {};
      c.props[newProp.name] = {
        type: newProp.type,
        ...(newProp.type === "enum" ? { values: newProp.values.split(",").map((v) => v.trim()).filter(Boolean) } : {}),
        ...(newProp.required ? { required: true } : {}),
        ...(newProp.description ? { description: newProp.description } : {}),
      };
    });

  return (
    <section style={{ maxWidth: 720 }}>
      <h2 style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--fg)" }}>
        {selected} <span style={{ color: "var(--fg-dim)" }}>· {entry.name}</span>
      </h2>

      {(["description", "whenToUse", "whenNotToUse"] as const).map((key) => (
        <div key={key} style={{ margin: "10px 0" }}>
          <span style={label}>{key}</span>
          <textarea
            style={{ ...field, minHeight: 44 }}
            defaultValue={entry[key] ?? ""}
            data-testid={`field-${key}`}
            onBlur={(e) => {
              if (e.target.value !== (entry[key] ?? "")) void update((c) => (c[key] = e.target.value));
            }}
          />
        </div>
      ))}

      <h3 style={{ ...label, marginTop: 18 }}>props</h3>
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <tbody>
          {Object.entries((entry.props ?? {}) as Record<string, any>).map(([name, p]) => (
            <tr key={name} style={{ borderTop: "1px solid var(--line-soft)" }}>
              <td style={{ padding: "6px 8px", fontFamily: "var(--mono)" }}>{name}</td>
              <td style={{ padding: "6px 8px", fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-body)" }}>
                {p.type}
                {p.values ? ` [${p.values.join(", ")}]` : ""}
                {p.required ? " · required" : ""}
              </td>
              <td style={{ padding: "6px 8px", fontSize: 12, color: "var(--fg-dim)" }}>{p.description ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 1fr 90px", gap: 8, marginTop: 10, alignItems: "center" }}>
        <input style={field} placeholder="prop name" value={newProp.name} onChange={(e) => setNewProp({ ...newProp, name: e.target.value })} data-testid="new-prop-name" />
        <select style={field} value={newProp.type} onChange={(e) => setNewProp({ ...newProp, type: e.target.value })}>
          {["string", "boolean", "number", "enum", "array"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input style={field} placeholder={newProp.type === "enum" ? "values, comma separated" : "description"} value={newProp.type === "enum" ? newProp.values : newProp.description} onChange={(e) => setNewProp(newProp.type === "enum" ? { ...newProp, values: e.target.value } : { ...newProp, description: e.target.value })} />
        <button className="st-btn" disabled={!newProp.name} onClick={addProp} data-testid="add-prop">
          Add prop
        </button>
      </div>
      <label style={{ fontSize: 12, color: "var(--fg-dim)", display: "block", marginTop: 6 }}>
        <input type="checkbox" checked={newProp.required} onChange={(e) => setNewProp({ ...newProp, required: e.target.checked })} /> required
        (contract-required props reach the constrained-decoding grammar)
      </label>

      {saved && (
        <p style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--fg-dim)" }} data-testid="save-state">
          {saved}
        </p>
      )}
    </section>
  );
}
