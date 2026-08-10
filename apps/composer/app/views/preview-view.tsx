"use client";

/**
 * Preview: the emitted catalog rendered through a registry. Wireframe is the
 * universal honest fallback — per COMPONENT inside a native surface (a name
 * with no native visual draws as wireframe, never as raw placeholder text),
 * and as the whole-registry inspection mode. Partial native coverage is a
 * first-class state, stated plainly, not an error.
 */
import { useMemo, useState } from "react";
import { A2uiCanvas, type A2uiClientAction, type Registry } from "@dspack-studio/a2ui-ingest";
import { useComposer } from "../state";
import { ViewHeader } from "../ui";
import { registryFor, canvasScopeFor, isNativeRegistry, wireframeFallbackNames, type PreviewRegistryId } from "../registries";

type RegistryId = "wireframe" | PreviewRegistryId;

/**
 * Export the emitted artifacts as a downloadable JSON bundle: the A2UI
 * catalog (the vocabulary an A2UI/AG-UI client consumes) plus every emitted
 * surface's messages (worked AG-UI payloads). Pure browser download — works
 * in demo mode and agent mode alike, with no filesystem round-trip, so a
 * hosted user can actually take the catalog away and use it.
 */
function exportBundle(emit: NonNullable<ReturnType<typeof useComposer>["emit"]>, name: string): void {
  const bundle = {
    a2uiCatalog: emit.catalog,
    surfaces: (emit.surfaces ?? [])
      .filter((s) => s.messages)
      .map((s) => ({ name: s.name, messages: s.messages })),
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "a2ui"}-catalog.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function PreviewView() {
  const { emit, manifest, referenceExampleIds } = useComposer();
  const [registryId, setRegistryId] = useState<RegistryId>("wireframe");
  const [canvasMode, setCanvasMode] = useState<"light" | "dark">("light");
  const [surfaceName, setSurfaceName] = useState<string | null>(null);
  const [actions, setActions] = useState<A2uiClientAction[]>([]);

  const catalog = emit?.catalog;
  const surfaces = (emit?.surfaces ?? []).filter((s) => s.messages);
  // Ownership first: the project's OWN surfaces (accepted builds, authored
  // scenarios) vs the design-system reference's worked examples. They are
  // never mixed into one anonymous list, and Preview opens on the project's
  // LATEST surface — what the user just built — not a reference example.
  const yours = referenceExampleIds ? surfaces.filter((s) => !referenceExampleIds.has(s.name)) : surfaces;
  const referenceSurfaces = referenceExampleIds ? surfaces.filter((s) => referenceExampleIds.has(s.name)) : [];
  const active = surfaces.find((s) => s.name === surfaceName) ?? yours.at(-1) ?? null;

  // The registry choices are wireframe (always) + the project's native design
  // system, whichever it is. A stale selection from a previous project clamps
  // back to wireframe rather than rendering the wrong catalog.
  const nativeId = isNativeRegistry(manifest?.previewRegistry) ? manifest.previewRegistry : undefined;
  const registryChoices: RegistryId[] = nativeId ? ["wireframe", nativeId] : ["wireframe"];
  const activeRegistryId: RegistryId = registryChoices.includes(registryId) ? registryId : "wireframe";

  const registry: Registry | null = useMemo(() => {
    if (!catalog) return null;
    return registryFor(activeRegistryId, catalog);
  }, [catalog, activeRegistryId]);

  // Honest coverage comes from the PRE-merge native registry: the rendered
  // registry covers every name (wireframe fills the gaps), so the caption's
  // job is to say which components are wireframe stand-ins, not to alarm.
  const fallbackNames = useMemo(() => wireframeFallbackNames(activeRegistryId, catalog), [activeRegistryId, catalog]);

  if (!catalog || !registry) {
    return <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>No emitted catalog yet — run Emit from the Validate view (or load the demo).</p>;
  }

  const failed = (emit?.surfaces ?? []).filter((s) => s.error);

  return (
    <section>
      <ViewHeader
        eyebrow="Preview"
        lead="Your emitted surfaces, rendered through the design system — or the wireframe, the universal fallback. Export the catalog to take it anywhere."
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>registry:</span>
        {registryChoices.map((id) => (
          <button key={id} className={`st-btn${activeRegistryId === id ? " st-btn--active" : ""}`} onClick={() => setRegistryId(id)} data-testid={`registry-${id}`}>
            {id}
          </button>
        ))}
        {activeRegistryId === "shadcn" && (
          <button className="st-btn st-btn--dashed" onClick={() => setCanvasMode(canvasMode === "light" ? "dark" : "light")}>
            canvas: {canvasMode}
          </button>
        )}
        <span style={{ fontSize: 12, color: "var(--fg-dim)" }} data-testid="registry-coverage">
          {!isNativeRegistry(activeRegistryId) ? (
            "wireframe — covers every component"
          ) : fallbackNames.length === 0 ? (
            "full native coverage"
          ) : (
            <>
              {fallbackNames.length} of {Object.keys(catalog.components ?? {}).length} components render as wireframe (no native{" "}
              {activeRegistryId} visual yet)
              <span title={fallbackNames.join(", ")}> — hover for the list</span>
            </>
          )}
        </span>
        <button
          className="st-btn st-btn--dashed"
          style={{ marginLeft: "auto" }}
          onClick={() => emit && exportBundle(emit, manifest?.name ?? "a2ui")}
          data-testid="export-catalog"
          title="Download the emitted A2UI catalog + surface messages as JSON"
        >
          ↓ export catalog
        </button>
      </div>

      <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="af-label" style={{ margin: 0 }}>
            {referenceExampleIds ? "Your surfaces" : "Project surfaces"}
          </span>
          {yours.length === 0 ? (
            <span style={{ fontSize: 12, color: "var(--fg-dim)" }} data-testid="preview-no-project-surfaces">
              none yet — build something in Build, then “Add to project”.
            </span>
          ) : (
            yours.map((s) => (
              <button key={s.name} className={`st-btn${(active?.name ?? "") === s.name ? " st-btn--active" : ""}`} onClick={() => setSurfaceName(s.name)} data-testid={`surface-${s.name}`}>
                {s.name}
              </button>
            ))
          )}
        </div>
        {referenceSurfaces.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="preview-reference-surfaces">
            <span className="af-label" style={{ margin: 0, color: "var(--fg-dim)" }}>
              Reference examples · {manifest?.name ?? "design system"}
            </span>
            {referenceSurfaces.map((s) => (
              <button
                key={s.name}
                className={`st-btn st-btn--dashed${(active?.name ?? "") === s.name ? " st-btn--active" : ""}`}
                onClick={() => setSurfaceName(s.name)}
                data-testid={`surface-${s.name}`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        {failed.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {failed.map((s) => (
              <span key={s.name} title={s.error} style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--err)" }} data-testid={`surface-refused-${s.name}`}>
                {s.name}: refused
              </span>
            ))}
          </div>
        )}
      </div>

      {active?.messages ? (
        <>
          {referenceExampleIds?.has(active.name) && (
            <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: "0 0 6px" }}>
              Reference example from {manifest?.name ?? "the design system"} — teaching material, not part of your project&rsquo;s work.
            </p>
          )}
          <div
            {...canvasScopeFor(activeRegistryId, canvasMode).attrs}
            data-project-canvas="composer"
            style={{
              border: "1px solid var(--line)",
              borderRadius: 4,
              padding: 20,
              background: canvasScopeFor(activeRegistryId, canvasMode).background,
            }}
          >
            <A2uiCanvas
              key={`${active.name}:${activeRegistryId}`}
              catalog={catalog}
              registry={registry}
              messages={active.messages}
              onAction={(action) => setActions((prev) => [...prev, action])}
            />
          </div>
        </>
      ) : (
        <div className="af-empty" data-testid="preview-empty">
          <p className="af-empty__title">No project surfaces yet</p>
          <p className="af-empty__body">
            Build something first — describe what you want in Build, and a passing result&rsquo;s &ldquo;Add to
            project&rdquo; lands it here.{referenceSurfaces.length > 0 && " The reference examples above are open for inspection."}
          </p>
        </div>
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
