"use client";

import { useEffect, useRef, useState } from "react";
import { ComposerProvider, useComposer } from "./state";
import { BuildView } from "./views/build-view";
import { ProjectsView } from "./views/projects-view";
import { ProjectView } from "./views/project-view";
import { RepositoryView } from "./views/repository-view";
import { SettingsView } from "./views/settings-view";
import { InventoryView } from "./views/inventory-view";
import { ComponentView } from "./views/component-view";
import { MapperView } from "./views/mapper-view";
import { GovernanceView } from "./views/governance-view";
import { ScenarioView } from "./views/scenario-view";
import { PreviewView } from "./views/preview-view";
import { ValidateView } from "./views/validate-view";
import { AfMark } from "./ui";
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
  | "connect"
  | "repository";

/** The working views, shown in the nav only when a project is open. Their order
 *  is the product's, not the pipeline's: build, look, then the vocabulary and
 *  rules behind it. Catalog is the inventory; Components/Mapper drill in from it;
 *  Scenarios and Checks hang off Governance and Build. */
const WORK_NAV: Array<{ id: View; label: string }> = [
  { id: "build", label: "Build" },
  { id: "preview", label: "Preview" },
  { id: "inventory", label: "Catalog" },
  { id: "governance", label: "Governance" },
  { id: "scenarios", label: "Scenarios" },
  { id: "validate", label: "Checks" },
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
  const isAgentProject = state.activeProject?.source.kind === "agent" || state.mode === "agent";
  // The chip answers "what am I looking at" — the project's SOURCE, in the
  // same words the hub uses (execution mode is Settings' concern, not identity).
  const source = state.activeProject?.source;
  const sourceKind =
    source?.kind === "agent"
      ? "Local repository"
      : source?.kind === "imported"
        ? "Imported"
        : source?.kind === "reference"
          ? state.references.find((r) => r.id === source.referenceId)?.label ?? source.referenceId
          : "";

  return (
    <div>
      <header className="af-top">
        <div className="af-top__in">
          {/* Quiet ecosystem identity: the canonical Aesthetic Function mark
              beside the app name. [ AF ] COMPOSER, not "Aesthetic Function Composer". */}
          <button
            className="af-brand"
            onClick={() => setView("projects")}
            data-testid="brand-home"
            aria-label="Aesthetic Function Composer — projects home"
            title="Projects"
          >
            <AfMark decorative />
            <span className="af-brand__name">Composer</span>
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
                  aria-label={v.id === "build" && buildBlocked ? `Build — not ready: ${buildBlocked}` : undefined}
                  data-testid={`nav-${v.id}`}
                >
                  {v.label}
                </button>
              ))}
            {hasProject && isAgentProject && (
              <button
                className={`af-nav__link${view === "repository" ? " af-nav__link--active" : ""}`}
                onClick={() => setView("repository")}
                data-testid="nav-repository"
              >
                Repository
              </button>
            )}
          </nav>

          <div className="af-spacer" />

          {state.activeProject && (
            <span className="af-ctx" data-testid="project-context" title={state.activeProject.description || state.activeProject.name}>
              <span className="af-ctx__name">{state.activeProject.name}</span>
              <span className="af-ctx__src">{sourceKind}</span>
            </span>
          )}
          {state.activeProject && (
            /* Build → Preview → Export, without a trip back to Projects. The
               same portable file as the hub card's Export. */
            <button
              className="af-nav__link"
              onClick={() => state.exportProject(state.activeProject!.id)}
              title="Download this project as a portable file"
              data-testid="project-export"
            >
              Export
            </button>
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

        {/* Working views require a project; EVERY working route falls back to
            the hub otherwise — never a blank page. */}
        {!hasProject && view !== "projects" && view !== "connect" && view !== "settings" && (
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
            {view === "repository" && <RepositoryView onNavigate={(v) => setView(v as View)} />}
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
