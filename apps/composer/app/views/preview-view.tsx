"use client";

/**
 * Preview: the emitted catalog rendered through a registry. Wireframe is the
 * universal honest fallback (visuals derived from the catalog itself, zero
 * user code); shadcn is the native path where names align. Coverage comes
 * from planRegistry — partial coverage is a first-class state, not an error.
 */
import { useMemo, useState } from "react";
import { A2uiCanvas, planRegistry, type A2uiClientAction, type Registry } from "@dspack-studio/a2ui-ingest";
import { shadcnRegistry } from "@dspack-studio/shadcn-renderers";
import { wireframeRegistryFor } from "@dspack-studio/wireframe-renderers";
import { useComposer } from "../state";

type RegistryId = "wireframe" | "shadcn";

export function PreviewView() {
  const { emit } = useComposer();
  const [registryId, setRegistryId] = useState<RegistryId>("wireframe");
  const [canvasMode, setCanvasMode] = useState<"light" | "dark">("light");
  const [surfaceName, setSurfaceName] = useState<string | null>(null);
  const [actions, setActions] = useState<A2uiClientAction[]>([]);

  const catalog = emit?.catalog;
  const surfaces = (emit?.surfaces ?? []).filter((s) => s.messages);
  const active = surfaces.find((s) => s.name === surfaceName) ?? surfaces[0];

  const registry: Registry | null = useMemo(() => {
    if (!catalog) return null;
    return registryId === "wireframe" ? wireframeRegistryFor(catalog) : shadcnRegistry;
  }, [catalog, registryId]);

  const coverage = useMemo(() => {
    if (!catalog || !registry) return null;
    return planRegistry(Object.keys(catalog.components ?? {}), registry);
  }, [catalog, registry]);

  if (!catalog || !registry) {
    return <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>No emitted catalog yet — run Emit from the Validate view (or load the demo).</p>;
  }

  const failed = (emit?.surfaces ?? []).filter((s) => s.error);

  return (
    <section>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>registry:</span>
        {(["wireframe", "shadcn"] as const).map((id) => (
          <button key={id} className={`st-btn${registryId === id ? " st-btn--active" : ""}`} onClick={() => setRegistryId(id)} data-testid={`registry-${id}`}>
            {id}
          </button>
        ))}
        {registryId === "shadcn" && (
          <button className="st-btn st-btn--dashed" onClick={() => setCanvasMode(canvasMode === "light" ? "dark" : "light")}>
            canvas: {canvasMode}
          </button>
        )}
        <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>
          {coverage && coverage.unimplemented.length > 0
            ? `${coverage.unimplemented.length} of ${Object.keys(catalog.components).length} names unimplemented in this registry: ${coverage.unimplemented.join(", ")}`
            : "full native coverage"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>surface:</span>
        {surfaces.map((s) => (
          <button key={s.name} className={`st-btn${(active?.name ?? "") === s.name ? " st-btn--active" : ""}`} onClick={() => setSurfaceName(s.name)} data-testid={`surface-${s.name}`}>
            {s.name}
          </button>
        ))}
        {failed.map((s) => (
          <span key={s.name} title={s.error} style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--err)" }} data-testid={`surface-refused-${s.name}`}>
            {s.name}: refused
          </span>
        ))}
      </div>

      {active?.messages ? (
        <div
          {...(registryId === "shadcn" ? { "data-design-system": "shadcn", "data-mode": canvasMode } : {})}
          data-project-canvas="composer"
          style={{
            border: "1px solid var(--line)",
            borderRadius: 4,
            padding: 20,
            background: registryId === "shadcn" ? (canvasMode === "dark" ? "#0c0a09" : "#ffffff") : "var(--bg-1)",
          }}
        >
          <A2uiCanvas
            key={`${active.name}:${registryId}`}
            catalog={catalog}
            registry={registry}
            messages={active.messages}
            onAction={(action) => setActions((prev) => [...prev, action])}
          />
        </div>
      ) : (
        <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>No emittable surface.</p>
      )}

      {active && active.warnings.length > 0 && (
        <details style={{ marginTop: 10, fontSize: 12, color: "var(--fg-dim)" }}>
          <summary style={{ cursor: "pointer" }}>{active.warnings.length} emit warnings (nothing is silent)</summary>
          <ul style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
            {active.warnings.map((w, i) => (
              <li key={i}>
                {w.code}: {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {actions.length > 0 && (
        <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-dim)", marginTop: 8 }} data-testid="action-log">
          actions dispatched: {actions.map((a) => (a as { name?: string }).name ?? "action").join(", ")}
        </p>
      )}
    </section>
  );
}
