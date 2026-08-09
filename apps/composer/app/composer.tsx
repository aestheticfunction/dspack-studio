"use client";

import { useEffect, useRef, useState } from "react";
import { ComposerProvider, useComposer } from "./state";
import { BuildView } from "./views/build-view";
import { ProjectsView } from "./views/projects-view";
import { ProjectView } from "./views/project-view";
import { SettingsView } from "./views/settings-view";
import { InventoryView } from "./views/inventory-view";
import { ComponentView } from "./views/component-view";
import { MapperView } from "./views/mapper-view";
import { GovernanceView } from "./views/governance-view";
import { ScenarioView } from "./views/scenario-view";
import { PreviewView } from "./views/preview-view";
import { ValidateView } from "./views/validate-view";
import { Marks } from "./ui";
import { getStoredTheme, applyTheme } from "./appearance";

export type View =
  | "projects"
  | "build"
  | "preview"
  | "inventory"
  | "component"
  | "mapper"
  | "governance"
  | "scenarios"
  | "validate"
  | "settings"
  | "connect";

/** The working views, shown in the nav only when a project is open. Their order
 *  is the product's, not the pipeline's: build, look, then the vocabulary and
 *  rules behind it. Catalog is the inventory; Components/Mapper drill in from it;
 *  Scenarios and Checks hang off Governance and Build. */
const WORK_NAV: Array<{ id: View; label: string }> = [
  { id: "build", label: "Build" },
  { id: "preview", label: "Preview" },
  { id: "inventory", label: "Catalog" },
  { id: "governance", label: "Governance" },
];

function Shell() {
  const state = useComposer();
  const [view, setView] = useState<View>("projects");
  const hasProject = !!state.activeProject;

  // Apply the persisted appearance once on mount.
  useEffect(() => {
    applyTheme(getStoredTheme());
  }, []);

  // Follow the project lifecycle: opening a project lands on Build; closing (or
  // first run with none) lands on the hub. Fires only when the identity changes,
  // so navigation within a project is never yanked away.
  const prevProjectId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = state.activeProject?.id ?? null;
    if (prevProjectId.current !== undefined && prevProjectId.current === id) return;
    prevProjectId.current = id;
    setView(id ? "build" : "projects");
  }, [state.activeProject?.id]);

  const buildBlocked = state.mode === "agent" && !state.readiness.ready ? state.readiness.reason : undefined;
  const sourceKind = state.activeProject?.source.kind === "agent" ? "Local repository" : state.mode === "agent" ? "Local repository" : "Hosted";

  return (
    <div>
      <header className="af-top">
        <div className="af-top__in">
          <button className="af-brand" onClick={() => setView("projects")} data-testid="brand-home" aria-label="Composer — projects">
            <Marks trueCount={hasProject ? 3 : 0} />
            <span style={{ display: "grid", lineHeight: 1.1 }}>
              <span className="af-brand__name">Composer</span>
              <span className="af-brand__sub">Aesthetic Function</span>
            </span>
          </button>

          <nav className="af-nav" aria-label="Primary">
            <button
              className={`af-nav__link${view === "projects" ? " af-nav__link--active" : ""}`}
              onClick={() => setView("projects")}
              data-testid="nav-projects"
            >
              Projects
            </button>
            {hasProject &&
              WORK_NAV.map((v) => (
                <button
                  key={v.id}
                  className={`af-nav__link${view === v.id ? " af-nav__link--active" : ""}`}
                  onClick={() => setView(v.id)}
                  disabled={v.id === "build" && !!buildBlocked}
                  title={v.id === "build" && buildBlocked ? `Not ready to build: ${buildBlocked}` : undefined}
                  data-testid={`nav-${v.id}`}
                >
                  {v.label}
                </button>
              ))}
          </nav>

          <div className="af-spacer" />

          {state.activeProject && (
            <span className="af-ctx" data-testid="project-context" title={state.activeProject.description || state.activeProject.name}>
              <span className="af-ctx__name">{state.activeProject.name}</span>
              <span className="af-ctx__src">{sourceKind}</span>
            </span>
          )}
          <button
            className={`af-nav__link${view === "settings" ? " af-nav__link--active" : ""}`}
            onClick={() => setView("settings")}
            data-testid="nav-settings"
          >
            Settings
          </button>
        </div>
      </header>

      <main>
        {state.notice && (
          <div style={{ maxWidth: "var(--maxw,1180px)", margin: "0 auto", padding: "12px var(--gut,24px) 0" }}>
            <p
              data-testid="notice"
              role="status"
              aria-live="polite"
              style={{ fontSize: 13, color: "var(--fg-dim)", border: "1px solid var(--line)", borderRadius: 3, padding: "8px 12px", margin: 0 }}
            >
              {state.notice}
            </p>
          </div>
        )}

        {view === "projects" && <ProjectsView onOpen={() => setView("build")} onConnect={() => setView("connect")} />}
        {view === "connect" && <ProjectView onNavigate={(v) => setView(v as View)} />}
        {view === "settings" && <SettingsView />}

        {/* Working views require a project; fall back to the hub otherwise. */}
        {!hasProject && (view === "build" || view === "preview" || view === "inventory" || view === "governance") && (
          <ProjectsView onOpen={() => setView("build")} onConnect={() => setView("connect")} />
        )}
        {hasProject && (
          <div className="af-page" style={{ paddingTop: "clamp(20px,3vw,32px)" }}>
            {view === "build" && <BuildView />}
            {view === "preview" && <PreviewView />}
            {view === "inventory" && <InventoryView onOpen={() => setView("component")} />}
            {view === "component" && <ComponentView />}
            {view === "mapper" && <MapperView />}
            {view === "governance" && <GovernanceView />}
            {view === "scenarios" && <ScenarioView />}
            {view === "validate" && <ValidateView />}
          </div>
        )}
      </main>
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
