"use client";

import { useEffect, useRef, useState } from "react";
import { ComposerProvider, useComposer } from "./state";
import { BuildView } from "./views/build-view";
import { ProjectView } from "./views/project-view";
import { InventoryView } from "./views/inventory-view";
import { ComponentView } from "./views/component-view";
import { MapperView } from "./views/mapper-view";
import { GovernanceView } from "./views/governance-view";
import { ScenarioView } from "./views/scenario-view";
import { PreviewView } from "./views/preview-view";
import { ValidateView } from "./views/validate-view";

export type View = "build" | "project" | "inventory" | "component" | "mapper" | "governance" | "scenarios" | "preview" | "validate";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "build", label: "Build" },
  { id: "project", label: "Project" },
  { id: "inventory", label: "Inventory" },
  { id: "component", label: "Component" },
  { id: "mapper", label: "Mapper" },
  { id: "governance", label: "Governance" },
  { id: "scenarios", label: "Scenarios" },
  { id: "preview", label: "Preview" },
  { id: "validate", label: "Validate" },
];

function Shell() {
  const [view, setView] = useState<View>("project");
  const state = useComposer();
  // Build-first: once a connected project's setup passes, Build is the
  // default working view (the catalog is setup FOR building).
  const autoOpened = useRef(false);
  useEffect(() => {
    if (state.mode === "agent" && state.readiness.ready && !autoOpened.current) {
      autoOpened.current = true;
      setView("build");
    }
    if (state.mode !== "agent") autoOpened.current = false;
  }, [state.mode, state.readiness.ready]);
  // Build stays visible when setup is incomplete, but says exactly why.
  const buildBlocked = state.mode === "agent" && !state.readiness.ready ? state.readiness.reason : undefined;

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 20px 80px" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
        <h1 style={{ fontFamily: "var(--hl)", fontSize: 22, letterSpacing: "0.02em", color: "var(--fg)", margin: 0, textTransform: "uppercase" }}>
          Catalog Composer
        </h1>
        <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-dim)" }}>
          {state.manifest ? state.manifest.name : "no project"}
          {" · "}
          {state.mode === "demo" ? "demo project" : state.projectPath}
        </span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: state.agentUp ? "var(--ok)" : "var(--fg-faint)", marginLeft: "auto" }}>
          agent: {state.agentUp ? "connected" : "not running"}
        </span>
      </header>

      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0 18px" }}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`st-btn${view === v.id ? " st-btn--active" : ""}`}
            onClick={() => setView(v.id)}
            disabled={v.id === "build" && !!buildBlocked}
            title={v.id === "build" && buildBlocked ? `Not ready to build: ${buildBlocked}` : undefined}
            aria-label={v.id === "build" && buildBlocked ? `Build (not ready: ${buildBlocked})` : undefined}
            data-testid={`nav-${v.id}`}
          >
            {v.label}
          </button>
        ))}
        {state.busy && (
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--warn)", alignSelf: "center" }}>{state.busy}…</span>
        )}
      </nav>

      {state.notice && (
        <p
          data-testid="notice"
          role="status"
          aria-live="polite"
          style={{ fontSize: 13, color: "var(--fg-dim)", border: "1px solid var(--line)", borderRadius: 2, padding: "8px 12px" }}>
          {state.notice}
        </p>
      )}

      {view === "build" && <BuildView />}
      {view === "project" && <ProjectView onNavigate={setView} />}
      {view === "inventory" && <InventoryView onOpen={() => setView("component")} />}
      {view === "component" && <ComponentView />}
      {view === "mapper" && <MapperView />}
      {view === "governance" && <GovernanceView />}
      {view === "scenarios" && <ScenarioView />}
      {view === "preview" && <PreviewView />}
      {view === "validate" && <ValidateView />}
    </div>
  );
}

export function Composer() {
  return (
    <ComposerProvider>
      <Shell />
    </ComposerProvider>
  );
}
