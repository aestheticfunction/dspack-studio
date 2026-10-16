"use client";

import { useEffect, useState } from "react";
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

  const catalog = (
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
  // Interface blocks (experimental): the read-only Blocks catalog follows the
  // components. The default build folds this branch away and returns the
  // catalog exactly as before.
  if (process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL === "1") {
    return (
      <>
        {catalog}
        <BlocksCatalogSection />
      </>
    );
  }
  return catalog;
}

/**
 * Interface blocks (experimental; docs/blocks/PHASE-2-RELEASE-PLAN.md, §7 H3):
 * every block this build bundles, read-only. Rendered only in an experimental
 * build: the literal flag check above folds this away in the default build,
 * and the catalog is read through the guarded import. Nothing in it can be
 * pressed: a block's actions are host-owned, and Composer executes none.
 */
function BlocksCatalogSection() {
  const { activeProject } = useComposer();
  const projectReferenceId = activeProject?.source.kind === "reference" ? activeProject.source.referenceId : null;
  type Catalog = Array<{
    referenceId: string;
    label: string;
    reference: { name: string; dspack: string; version: string } | null;
    binding: string;
    sidecarStatus: string | null;
    withheld?: string;
    issues: string[];
    blocks: Array<{ id: string; name: string; version: number; status: string; disabled: string[]; intents: string[]; actions: string[]; streamingText: string }>;
  }>;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL === "1") {
      void import("../../experimental/blocks-runtime")
        .then(async (runtime) => {
          const next = await runtime.blocksCatalog();
          if (!cancelled) setCatalog(next);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, []);
  const cell = { padding: "6px 8px", verticalAlign: "top" } as const;
  return (
    <section aria-labelledby="blocks-catalog-h" data-testid="blocks-catalog" style={{ marginTop: "clamp(32px,5vw,52px)" }}>
      <h2 id="blocks-catalog-h" className="af-h2" style={{ marginBottom: 6 }}>
        Interface blocks
      </h2>
      <p style={{ fontSize: 13, color: "var(--fg-body)", maxWidth: 720, margin: "0 0 12px" }}>
        Every block this experimental build bundles, read-only. A block&rsquo;s declared actions are host-owned: Composer never executes them,
        and a host binds and authorizes each one on its own server.
      </p>
      {catalog === null && <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>Reading the blocks…</p>}
      {(catalog ?? []).map((ref) => {
        const headingId = `blocks-catalog-${ref.referenceId}-h`;
        return (
          <div key={ref.referenceId} data-testid={`blocks-catalog-ref-${ref.referenceId}`} style={{ marginTop: 18 }}>
            <h3 id={headingId} style={{ fontSize: 14, margin: "0 0 4px", color: "var(--fg)" }}>
              {ref.reference ? `${ref.reference.name} ${ref.reference.version}` : ref.label}
              {ref.referenceId === projectReferenceId && <span style={{ fontWeight: 400, color: "var(--fg-body)" }}> · this project&rsquo;s reference</span>}
            </h3>
            <p style={{ fontSize: 12, color: "var(--fg-body)", margin: "0 0 6px" }}>
              Sidecar {ref.sidecarStatus ?? "unreadable"} · binding {ref.binding}
              {ref.withheld && <> · {ref.withheld}</>}
            </p>
            {ref.issues.map((issue) => (
              <p key={issue} style={{ fontSize: 12, color: "var(--err)", margin: "0 0 6px" }}>
                {issue}
              </p>
            ))}
            {ref.blocks.length > 0 && (
              <table aria-labelledby={headingId} style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color: "var(--fg-body)" }}>
                    <th scope="col" style={cell}>Block</th>
                    <th scope="col" style={cell}>Version</th>
                    <th scope="col" style={cell}>Status</th>
                    <th scope="col" style={cell}>Intents</th>
                    <th scope="col" style={cell}>Declared actions (host-owned)</th>
                    <th scope="col" style={cell}>Streaming policy</th>
                  </tr>
                </thead>
                <tbody>
                  {ref.blocks.map((b) => (
                    <tr key={b.id} style={{ borderTop: "1px solid var(--line-soft)" }} data-testid={`blocks-catalog-${ref.referenceId}-${b.id}`}>
                      <th scope="row" style={{ ...cell, textAlign: "left", fontWeight: 400 }}>
                        <span style={{ fontFamily: "var(--mono)", color: "var(--fg)" }}>{b.id}</span>
                        <span style={{ display: "block", fontSize: 12, color: "var(--fg-body)" }}>{b.name}</span>
                      </th>
                      <td style={{ ...cell, fontFamily: "var(--mono)", fontSize: 12 }}>v{b.version}</td>
                      <td style={{ ...cell, fontSize: 12 }}>
                        {b.status}
                        {b.disabled.length > 0 && <span style={{ display: "block", color: "var(--err)" }}>disabled at load: {b.disabled.join("; ")}</span>}
                      </td>
                      <td style={{ ...cell, fontFamily: "var(--mono)", fontSize: 12 }}>{b.intents.join(", ")}</td>
                      <td style={{ ...cell, fontFamily: "var(--mono)", fontSize: 12 }}>{b.actions.join(", ")}</td>
                      <td style={{ ...cell, fontSize: 12 }}>{b.streamingText}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </section>
  );
}
