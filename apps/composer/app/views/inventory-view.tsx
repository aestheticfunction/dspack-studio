"use client";

import { useComposer } from "../state";
import { ViewHeader } from "../ui";

/**
 * The component inventory. Lifecycle is DERIVED, never stored: described
 * (has whenToUse), mapped (a ComponentPlan exists), casualty (declared in
 * the profile), renderable/validated read from the latest emit.
 */
export function InventoryView({ onOpen }: { onOpen: () => void }) {
  const { contract, profile, emit, ledger, setSelected } = useComposer();
  if (!contract) return <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>No contract loaded.</p>;

  const components = Object.entries((contract.components ?? {}) as Record<string, any>);
  // Ledger v2 only: per-entry ownership (v1 documents show section-level
  // ownership on the Project view instead of inventing entry states here).
  const ownership = new Map((ledger?.componentEntries ?? []).map((e) => [e.id, e]));
  const plans = new Map<string, any>((profile?.components ?? []).map((p: any) => [p.dspackId, p]));
  const casualties = new Map<string, any>((profile?.casualtyComponents ?? []).map((c: any) => [c.dspackId, c]));
  const coverageFindings = new Set((emit?.findings ?? []).filter((f) => f.gate === "coverage").map((f) => f.target));

  const chip = (text: string, color: string) => (
    <span style={{ fontFamily: "var(--mono)", fontSize: 10, textTransform: "uppercase", border: `1px solid ${color}`, color, borderRadius: 3, padding: "1px 6px", marginRight: 6 }}>
      {text}
    </span>
  );

  return (
    <>
      <ViewHeader
        eyebrow="Catalog"
        lead="The governed component vocabulary available to this project — the components Composer is allowed to use when it builds, each with how it maps to the design system. Select one to enrich it."
      />
      <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: "0 0 12px" }} data-testid="catalog-summary">
        {components.length} component{components.length === 1 ? "" : "s"} available from {(contract.name as string) ?? "this design system"} ·{" "}
        {plans.size} mapped to A2UI · {casualties.size} declared casualt{casualties.size === 1 ? "y" : "ies"} (components the mapping honestly
        can&rsquo;t represent yet).
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ textAlign: "left", fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color: "var(--fg-dim)" }}>
          <th style={{ padding: "6px 8px" }}>id</th>
          <th style={{ padding: "6px 8px" }}>props</th>
          <th style={{ padding: "6px 8px" }}>state</th>
          <th style={{ padding: "6px 8px" }}>mapping</th>
        </tr>
      </thead>
      <tbody>
        {components.map(([id, entry]) => {
          const plan = plans.get(id);
          const casualty = casualties.get(id);
          const props = Object.keys(entry.props ?? {});
          const subs = (entry.composition?.subComponents ?? []).length;
          return (
            <tr
              key={id}
              onClick={() => {
                setSelected(id);
                onOpen();
              }}
              style={{ borderTop: "1px solid var(--line-soft)", cursor: "pointer" }}
              data-testid={`inventory-${id}`}
            >
              <td style={{ padding: "8px" }}>
                <span style={{ fontFamily: "var(--mono)", color: "var(--fg)" }}>{id}</span>
                <span style={{ color: "var(--fg-dim)", marginLeft: 8, fontSize: 12 }}>{entry.name}</span>
              </td>
              <td style={{ padding: "8px", fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-body)" }}>
                {props.join(", ") || "—"}
                {subs > 0 && <span style={{ color: "var(--fg-dim)" }}> · {subs} subs</span>}
              </td>
              <td style={{ padding: "8px" }}>
                {entry.whenToUse ? chip("described", "var(--ok)") : chip("bare", "var(--fg-dim)")}
                {props.length === 0 && chip("needs props", "var(--warn)")}
                {(() => {
                  const own = ownership.get(id);
                  if (!own) return null;
                  const label = own.state === "unattributed" ? "yours" : own.state === "human-owned" ? "yours" : own.state;
                  return (
                    <>
                      {chip(label, own.state === "tool-owned" ? "var(--info)" : "var(--ok)")}
                      {own.alsoTombstoned && chip("tombstoned", "var(--warn)")}
                    </>
                  );
                })()}
              </td>
              <td style={{ padding: "8px" }}>
                {casualty
                  ? chip("casualty", "var(--err)")
                  : plan
                    ? coverageFindings.has(id)
                      ? chip("unclassified", "var(--err)")
                      : chip(`→ ${plan.a2ui}`, "var(--info)")
                    : chip("unmapped", "var(--warn)")}
              </td>
            </tr>
          );
        })}
      </tbody>
      </table>
    </>
  );
}
