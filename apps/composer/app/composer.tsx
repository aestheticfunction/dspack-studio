"use client";

import { useState } from "react";
import { ComposerProvider, useComposer } from "./state";
import { ProjectView } from "./views/project-view";
import { InventoryView } from "./views/inventory-view";
import { ComponentView } from "./views/component-view";
import { MapperView } from "./views/mapper-view";
import { PreviewView } from "./views/preview-view";
import { ValidateView } from "./views/validate-view";

type View = "project" | "inventory" | "component" | "mapper" | "preview" | "validate";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "project", label: "Project" },
  { id: "inventory", label: "Inventory" },
  { id: "component", label: "Component" },
  { id: "mapper", label: "Mapper" },
  { id: "preview", label: "Preview" },
  { id: "validate", label: "Validate" },
];

function Shell() {
  const [view, setView] = useState<View>("project");
  const state = useComposer();

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
          <button key={v.id} className={`st-btn${view === v.id ? " st-btn--active" : ""}`} onClick={() => setView(v.id)} data-testid={`nav-${v.id}`}>
            {v.label}
          </button>
        ))}
        {state.busy && (
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--warn)", alignSelf: "center" }}>{state.busy}…</span>
        )}
      </nav>

      {state.notice && (
        <p data-testid="notice" style={{ fontSize: 13, color: "var(--fg-dim)", border: "1px solid var(--line)", borderRadius: 2, padding: "8px 12px" }}>
          {state.notice}
        </p>
      )}

      {view === "project" && <ProjectView />}
      {view === "inventory" && <InventoryView onOpen={() => setView("component")} />}
      {view === "component" && <ComponentView />}
      {view === "mapper" && <MapperView />}
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
