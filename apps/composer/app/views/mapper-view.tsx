"use client";

/**
 * The mapper: edits the selected component's ComponentPlan in the JSON
 * profile — a2ui name, per-prop projections (name, kind, targetEnum,
 * valueMap), or a declared casualty with an authored reason. The fidelity
 * rail on the right is the emit result filtered to this component: the
 * profile proposes, the emitter judges.
 */
import { useState } from "react";
import { useComposer } from "../state";

/**
 * A contract enum member is either a plain string (v1) or a
 * `{ value, description }` object (v3). Everything that treats an enum value
 * as text — labels, valueMap keys, React children — must go through this;
 * rendering the object directly is React error #31.
 */
const enumLabel = (v: unknown): string =>
  typeof v === "string" ? v : v && typeof v === "object" && "value" in v ? String((v as { value: unknown }).value) : String(v);

const field = {
  fontFamily: "var(--mono)",
  fontSize: 12,
  background: "var(--bg-1)",
  border: "1px solid var(--line)",
  color: "var(--fg)",
  padding: "4px 6px",
  borderRadius: 2,
} as const;

export function MapperView() {
  const { contract, profile, selected, saveProfile, runEmit, emit, mode, busy } = useComposer();
  const [issue, setIssue] = useState<string | null>(null);

  if (!contract || !profile) return <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>No project loaded.</p>;
  if (!selected) return <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>Pick a component in the Inventory.</p>;

  const plans: any[] = profile.components ?? [];
  const plan = plans.find((p) => p.dspackId === selected);
  const casualty = (profile.casualtyComponents ?? []).find((c: any) => c.dspackId === selected);
  const contractProps = Object.entries((contract.components?.[selected]?.props ?? {}) as Record<string, any>);

  const save = async (mutate: (draft: any) => void) => {
    const draft = structuredClone(profile);
    mutate(draft);
    const result = await saveProfile(draft);
    setIssue(Array.isArray(result) && result.length > 0 ? result[0].message : null);
    if (mode === "agent") void runEmit();
  };

  const relevantFindings = (emit?.findings ?? []).filter(
    (f) => f.target.includes(selected) || (plan && f.target.includes(plan.a2ui)),
  );

  return (
    <section style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(380px, 3fr) minmax(240px, 2fr)" }}>
      <div>
        <h2 style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--fg)" }}>{selected}</h2>

        {casualty ? (
          <div>
            <p style={{ fontSize: 13, color: "var(--err)" }}>Declared casualty ({casualty.class}): {casualty.reason}</p>
            <button
              className="st-btn"
              onClick={() => void save((d) => {
                d.casualtyComponents = d.casualtyComponents.filter((c: any) => c.dspackId !== selected);
              })}
            >
              Un-declare casualty
            </button>
          </div>
        ) : !plan ? (
          <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>
            Not mapped. Add a ComponentPlan in the profile (scaffoldProfile seeds one mechanically), or declare a casualty
            below.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "var(--fg-body)" }}>
              maps to <span style={{ fontFamily: "var(--mono)", color: "var(--info)" }}>{plan.a2ui}</span>
              {" · required: "}
              <span style={{ fontFamily: "var(--mono)" }}>{(plan.required ?? []).join(", ") || "—"}</span>
            </p>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color: "var(--fg-dim)" }}>
                  <th style={{ padding: "4px 6px" }}>contract prop</th>
                  <th style={{ padding: "4px 6px" }}>a2ui prop</th>
                  <th style={{ padding: "4px 6px" }}>kind</th>
                  <th style={{ padding: "4px 6px" }}>projection</th>
                </tr>
              </thead>
              <tbody>
                {contractProps.map(([name, cprop]) => {
                  const pp = plan.propMap?.[name];
                  return (
                    <tr key={name} style={{ borderTop: "1px solid var(--line-soft)" }}>
                      <td style={{ padding: "6px", fontFamily: "var(--mono)" }}>
                        {name}
                        {cprop.values && <div style={{ fontSize: 11, color: "var(--fg-dim)" }}>[{cprop.values.map(enumLabel).join(", ")}]</div>}
                      </td>
                      {pp ? (
                        <>
                          <td style={{ padding: "6px" }}>
                            <input
                              style={field}
                              defaultValue={pp.a2ui}
                              size={10}
                              data-testid={`map-${name}`}
                              onBlur={(e) => {
                                if (e.target.value !== pp.a2ui) {
                                  void save((d) => {
                                    d.components.find((p: any) => p.dspackId === selected).propMap[name].a2ui = e.target.value;
                                  });
                                }
                              }}
                            />
                          </td>
                          <td style={{ padding: "6px", fontFamily: "var(--mono)", fontSize: 12 }}>{pp.kind}</td>
                          <td style={{ padding: "6px" }}>
                            {pp.kind === "enum" && cprop.values ? (
                              <div style={{ display: "grid", gap: 3 }}>
                                {cprop.values.map((raw: unknown) => {
                                  // v3 contracts carry enum members as {value, description};
                                  // v1 carries plain strings. Normalise to the value string —
                                  // rendering the object directly is React error #31.
                                  const v = enumLabel(raw);
                                  return (
                                  <span key={v} style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                                    {v} →{" "}
                                    <select
                                      style={field}
                                      value={pp.valueMap?.[v] ?? v}
                                      onChange={(e) =>
                                        void save((d) => {
                                          const target = d.components.find((p: any) => p.dspackId === selected).propMap[name];
                                          target.valueMap = { ...(target.valueMap ?? {}), [v]: e.target.value };
                                        })
                                      }
                                    >
                                      {(pp.targetEnum ?? [v]).map((t: string) => (
                                        <option key={t}>{t}</option>
                                      ))}
                                    </select>
                                  </span>
                                  );
                                })}
                                <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>target: [{(pp.targetEnum ?? []).join(", ")}]</span>
                              </div>
                            ) : (
                              <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-dim)" }}>verbatim</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <td colSpan={3} style={{ padding: "6px", fontSize: 12, color: "var(--warn)" }}>
                          unmapped — the emitter reports its disposition in coverage
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        {!casualty && (
          <CasualtyForm
            onDeclare={(reason) =>
              void save((d) => {
                d.components = d.components.filter((p: any) => p.dspackId !== selected);
                d.casualtyComponents.push({ dspackId: selected, attempted: plan?.a2ui ?? "(none)", class: "cannot-represent", reason });
              })
            }
          />
        )}
        {issue && <p style={{ fontSize: 12, color: "var(--err)" }}>{issue}</p>}
        {mode === "demo" && (
          <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
            Demo mode: profile edits stay in memory and the fidelity rail shows the build-time emit. Connect through the
            local agent for live re-emission on every edit.
          </p>
        )}
      </div>

      <aside>
        <h3 style={{ fontFamily: "var(--hl)", fontSize: 13, textTransform: "uppercase", color: "var(--fg)" }}>
          Fidelity <button className="st-btn" style={{ marginLeft: 8 }} disabled={busy !== null || mode !== "agent"} onClick={() => void runEmit()}>re-emit</button>
        </h3>
        {relevantFindings.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>No findings for this component in the last emit.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, fontSize: 12 }}>
            {relevantFindings.map((f, i) => (
              <li key={i} style={{ borderLeft: `2px solid ${f.severity === "error" ? "var(--err)" : f.severity === "warn" ? "var(--warn)" : "var(--line)"}`, padding: "4px 8px", margin: "6px 0" }}>
                <span style={{ fontFamily: "var(--mono)", color: "var(--fg-dim)" }}>
                  {f.gate} {f.code}
                </span>
                <div style={{ color: "var(--fg-body)" }}>{f.message}</div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </section>
  );
}

function CasualtyForm({ onDeclare }: { onDeclare: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--line-soft)", paddingTop: 10 }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color: "var(--fg-dim)" }}>
        declare casualty (write the reason first)
      </span>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <input
          style={{ ...field, flex: 1 }}
          placeholder="why this component cannot be represented in the catalog"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="casualty-reason"
        />
        <button className="st-btn" disabled={reason.trim().length < 10} onClick={() => onDeclare(reason.trim())} data-testid="declare-casualty">
          Declare
        </button>
      </div>
    </div>
  );
}
