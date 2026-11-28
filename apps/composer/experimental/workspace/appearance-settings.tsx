"use client";

/**
 * Settings, Appearance, in the experimental build (T4): the existing governed themes, the two neutral ones, a custom
 * appearance chosen with the shared compiler's own enums, and the workspace choices. A choice applies only if it
 * compiles under the compiler's constraint set; otherwise nothing changes and the reason is shown. What is kept
 * is the choice (a closed-enum proposal), never generated values.
 */
import { useEffect, useId, useState } from "react";
import { applyAppearance, BASES, CUSTOM_ENUMS, initialRecord, NEUTRAL_WORKSPACE, resolveAppearance, WORKSPACE_ENUMS, type AppearanceRecord, type Base, type Resolved } from "./appearance";
import { readRecord, writeRecord } from "./storage";

const BASE_LABEL: Record<Base, { title: string; note: string }> = {
  default: { title: "Aesthetic Function", note: "The brand's own dark appearance." },
  ember: { title: "Ember", note: "Warm, from the brand's themes." },
  slate: { title: "Slate", note: "Cool, from the brand's themes." },
  "neutral-dark": { title: "Neutral dark", note: "Quiet surfaces for long sessions; the brand's olive accent, held back." },
  "neutral-light": { title: "Neutral light", note: "The same, on light surfaces." },
  custom: { title: "Custom", note: "Choose surfaces, ink and accent; the compiler checks the contrast." },
};

const CUSTOM_LABEL: Record<keyof typeof CUSTOM_ENUMS, string> = {
  scheme: "Scheme",
  surfaceHue: "Surface hue",
  tint: "Surface tint",
  depth: "Surface depth",
  warmth: "Ink warmth",
  contrast: "Ink contrast",
  accentHue: "Accent hue",
  chroma: "Accent strength",
  presence: "Accent presence",
  weight: "Heading weight",
  elevation: "Elevation",
};

const WORKSPACE_LABEL: Record<keyof typeof WORKSPACE_ENUMS, { title: string; options: Record<string, string> }> = {
  density: { title: "Density", options: { comfortable: "Comfortable", compact: "Compact" } },
  textScale: { title: "Text size", options: { standard: "Standard", large: "Large" } },
  labelCase: { title: "Labels", options: { sentence: "Sentence case", capitals: "Capitals" } },
  display: { title: "Header", options: { brand: "Brand type", plain: "Plain type" } },
  surround: { title: "Canvas surround", options: { workspace: "Same as workspace", light: "Neutral light", dark: "Neutral dark" } },
};

const words = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

export function WorkspaceAppearance() {
  const [record, setRecord] = useState<AppearanceRecord | null>(null);
  const [status, setStatus] = useState<{ resolved: Resolved; saved: boolean } | null>(null);

  useEffect(() => {
    const stored = readRecord("appearance");
    setRecord(stored.status === "ok" ? stored.value : initialRecord());
  }, []);

  const choose = (next: AppearanceRecord) => {
    const resolved = resolveAppearance(next);
    if (!resolved.ok) {
      // Nothing is applied or kept: the appearance on screen stays the last one that compiled.
      setStatus({ resolved, saved: false });
      return;
    }
    applyAppearance(next);
    const saved = writeRecord("appearance", next).ok;
    setRecord(next);
    setStatus({ resolved, saved });
  };

  if (!record) return null;
  const pickBase = (base: Base) => choose({ ...record, base, workspace: base.startsWith("neutral") && !record.base.startsWith("neutral") ? { ...NEUTRAL_WORKSPACE, ...pickedWorkspace(record) } : record.workspace });

  return (
    <section aria-labelledby="appearance-h" data-testid="workspace-appearance">
      <h2 id="appearance-h" className="af-h2" style={{ marginBottom: 6 }}>
        Appearance
      </h2>
      <p className="af-lead" style={{ marginTop: 6, fontSize: 14 }}>
        How Composer&rsquo;s workspace looks to you. It never changes a composition, its checks, its design system or the canvas. Neutral and custom appearances are compiled by the shared theme compiler, which checks every text colour against the contrast rules.
      </p>
      <div className="af-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", marginTop: 16 }} data-testid="appearance" role="group" aria-label="Appearance">
        {BASES.map((b) => (
          <button key={b} type="button" className={`af-choice${record.base === b ? " af-choice--active" : ""}`} onClick={() => pickBase(b)} aria-pressed={record.base === b} data-testid={`theme-${b}`}>
            <span className="af-choice__title">{BASE_LABEL[b].title}</span>
            <span style={{ display: "block", fontSize: 13, color: "var(--fg-body)", marginTop: 4, textTransform: "none", letterSpacing: 0, fontFamily: "var(--sans)" }}>{BASE_LABEL[b].note}</span>
          </button>
        ))}
      </div>

      {record.base === "custom" && (
        <fieldset style={fieldset} data-testid="custom-direction">
          <legend style={legend}>Custom appearance</legend>
          <div style={grid}>
            {(Object.keys(CUSTOM_ENUMS) as Array<keyof typeof CUSTOM_ENUMS>).map((k) => (
              <Choice key={k} label={CUSTOM_LABEL[k]} value={record.custom[k]} options={CUSTOM_ENUMS[k] as readonly string[]} render={words} onChange={(v) => choose({ ...record, custom: { ...record.custom, [k]: v } as AppearanceRecord["custom"] })} testid={`custom-${k}`} />
            ))}
          </div>
        </fieldset>
      )}

      <fieldset style={fieldset} data-testid="workspace-choices">
        <legend style={legend}>Workspace</legend>
        <div style={grid}>
          {(Object.keys(WORKSPACE_ENUMS) as Array<keyof typeof WORKSPACE_ENUMS>).map((k) => (
            <Choice key={k} label={WORKSPACE_LABEL[k].title} value={record.workspace[k]} options={WORKSPACE_ENUMS[k] as readonly string[]} render={(v) => WORKSPACE_LABEL[k].options[v] ?? v} onChange={(v) => choose({ ...record, workspace: { ...record.workspace, [k]: v } as AppearanceRecord["workspace"] })} testid={`ws-${k}`} />
          ))}
        </div>
      </fieldset>

      {status && (
        <p role={status.resolved.ok ? "status" : "alert"} data-testid="appearance-status" data-ok={status.resolved.ok ? "true" : "false"} style={{ fontSize: 14, marginTop: 12, color: status.resolved.ok ? "var(--fg-body)" : "var(--err)" }}>
          {!status.resolved.ok
            ? `Not applied: ${status.resolved.reasons[0] ?? "this combination does not meet the contrast rules"}. The previous appearance stays.`
            : status.resolved.mode === "compiled"
              ? `Applied. ${status.resolved.constraints} contrast checks pass${status.resolved.repairs ? `, ${status.resolved.repairs} adjusted to pass` : ""}.${status.saved ? "" : " Kept for this session only: browser storage is unavailable."}`
              : `Applied.${status.saved ? "" : " Kept for this session only: browser storage is unavailable."}`}
        </p>
      )}
    </section>
  );
}

/** The workspace choices a person has made themselves, so switching to a neutral base keeps them. */
function pickedWorkspace(record: AppearanceRecord): Partial<AppearanceRecord["workspace"]> {
  const out: Partial<AppearanceRecord["workspace"]> = {};
  for (const [k, v] of Object.entries(record.workspace)) if (v !== (WORKSPACE_ENUMS as Record<string, readonly string[]>)[k]![0]) (out as Record<string, string>)[k] = v;
  return out;
}

function Choice({ label, value, options, render, onChange, testid }: { label: string; value: string; options: readonly string[]; render: (v: string) => string; onChange: (v: string) => void; testid: string }) {
  const id = useId();
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", fontFamily: "var(--sans)" }}>
        {label}
      </label>
      <select id={id} className="af-select" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} style={{ minHeight: 36 }}>
        {options.map((o) => (
          <option key={o} value={o}>
            {render(o)}
          </option>
        ))}
      </select>
    </div>
  );
}

const fieldset = { border: "1px solid var(--line)", borderRadius: 6, padding: "12px 14px", marginTop: 16 } as const;
const legend = { fontSize: 14, fontWeight: 600, color: "var(--fg)", padding: "0 4px", fontFamily: "var(--sans)" } as const;
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 12 } as const;
