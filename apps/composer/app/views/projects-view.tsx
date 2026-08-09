"use client";

/**
 * The Projects hub — the entry point, replacing the always-on demo.
 *
 * A person creates a named project from a governed source (a packaged design
 * system, or their own repository), returns to recent work, and manages
 * projects as first-class objects. First run is a welcome, not an empty error.
 * Written in the Aesthetic Function language: editorial masthead, the identity
 * marks, cards that lift and corner-check, sage green only where something has
 * aligned.
 */
import { useState } from "react";
import { useComposer } from "../state";
import { Marks, Eyebrow, relativeTime } from "../ui";
import type { StoredProject } from "../projects";

type SourceChoice = { kind: "reference"; id: string } | { kind: "connect" } | null;

function sourceLabel(p: StoredProject, referenceLabel: (id: string) => string): string {
  if (p.source.kind === "reference") return referenceLabel(p.source.referenceId);
  return "Local repository";
}

export function ProjectsView({ onOpen, onConnect }: { onOpen: () => void; onConnect: () => void }) {
  const { projects, references, newProject, openProject, duplicateProject, deleteProject, renameProject } = useComposer();
  const referenceLabel = (id: string) => references.find((r) => r.id === id)?.label ?? id;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState<SourceChoice>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const readySource = source?.kind === "reference";
  const canCreate = readySource && name.trim().length > 0;

  const create = () => {
    if (source?.kind !== "reference") return;
    newProject({ name: name.trim() || "Untitled project", description, source: { kind: "reference", referenceId: source.id } });
    setName("");
    setDescription("");
    setSource(null);
    onOpen();
  };

  const commitRename = (id: string) => {
    if (renameValue.trim()) renameProject(id, renameValue.trim());
    setRenamingId(null);
  };

  return (
    <div className="af-page">
      <header style={{ marginBottom: "clamp(28px,4vw,44px)" }}>
        <Eyebrow>
          <Marks trueCount={3} /> Aesthetic Function · Composer
        </Eyebrow>
        <h1 className="af-display">
          Describe it. <span className="af-accent">Keep it aligned.</span>
        </h1>
        <p className="af-lead">
          Composer turns a plain goal into an interface built only from your design system&rsquo;s approved
          components, checked as it goes. Start a project from a governed design system, or connect your own repository.
        </p>
      </header>

      {/* New project */}
      <section aria-labelledby="new-project-h" style={{ marginBottom: "clamp(32px,5vw,56px)" }} data-testid="new-project">
        <h2 id="new-project-h" className="af-h2" style={{ marginBottom: 14 }}>
          New project
        </h2>
        <div style={{ border: "1px solid var(--line)", borderRadius: 6, background: "var(--bg-1)", padding: "clamp(18px,3vw,26px)" }}>
          <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(0,1fr)", maxWidth: 560 }}>
            <div className="af-field" style={{ margin: 0 }}>
              <label className="af-label" htmlFor="np-name">
                Project name
              </label>
              <input
                id="np-name"
                className="af-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canCreate && create()}
                placeholder="e.g. Billing settings"
                data-testid="new-project-name"
              />
            </div>
            <div className="af-field" style={{ margin: 0 }}>
              <label className="af-label" htmlFor="np-desc">
                Description <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--fg-dim)" }}>· optional</span>
              </label>
              <textarea
                id="np-desc"
                className="af-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this project for?"
                data-testid="new-project-description"
                rows={2}
              />
            </div>
          </div>

          <p className="af-label" style={{ margin: "22px 0 10px" }}>
            Governed design system
          </p>
          <div className="af-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))" }}>
            {references.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`af-choice${source?.kind === "reference" && source.id === r.id ? " af-choice--active" : ""}`}
                onClick={() => setSource({ kind: "reference", id: r.id })}
                aria-pressed={source?.kind === "reference" && source.id === r.id}
                data-testid={`new-source-${r.id}`}
              >
                <span className="af-choice__title">{r.label}</span>
                <span className="af-choice__desc">{r.blurb}</span>
              </button>
            ))}
            <button
              type="button"
              className={`af-choice${source?.kind === "connect" ? " af-choice--active" : ""}`}
              onClick={() => setSource({ kind: "connect" })}
              aria-pressed={source?.kind === "connect"}
              data-testid="new-source-connect"
            >
              <span className="af-choice__title">Connect a repository</span>
              <span className="af-choice__desc">
                Import your own component library and build against real files, through the local agent.
              </span>
            </button>
          </div>

          <div className="af-btn-row" style={{ marginTop: 20 }}>
            {source?.kind === "connect" ? (
              <button className="st-btn st-btn--primary st-btn--lg" onClick={onConnect} data-testid="new-project-connect">
                Connect a repository &rarr;
              </button>
            ) : (
              <button className="st-btn st-btn--primary st-btn--lg" disabled={!canCreate} onClick={create} data-testid="new-project-create">
                Create &amp; build
              </button>
            )}
            {!readySource && source?.kind !== "connect" && (
              <span className="af-hint">Choose a design system to start, or connect your repository.</span>
            )}
          </div>
        </div>
      </section>

      {/* Your projects */}
      <section aria-labelledby="your-projects-h">
        <h2 id="your-projects-h" className="af-h2" style={{ marginBottom: 14 }}>
          Your projects
        </h2>
        {projects.length === 0 ? (
          <div className="af-empty" data-testid="projects-empty">
            <Marks />
            <p className="af-empty__title">No projects yet</p>
            <p className="af-empty__body">
              Name a project above and pick a governed design system to begin. Everything you build is checked against
              that system&rsquo;s rules as you go.
            </p>
          </div>
        ) : (
          <div className="af-grid" data-testid="projects-grid">
            {projects.map((p) => (
              <div key={p.id} className="af-card" data-testid={`project-${p.id}`} style={{ cursor: "default" }}>
                <span className="af-card__k">{sourceLabel(p, referenceLabel)}</span>
                {renamingId === p.id ? (
                  <input
                    className="af-input"
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(p.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    data-testid={`project-rename-input-${p.id}`}
                  />
                ) : (
                  <button
                    className="af-card__title"
                    style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit" }}
                    onClick={() => {
                      openProject(p.id);
                      onOpen();
                    }}
                    data-testid={`project-open-${p.id}`}
                  >
                    {p.name}
                  </button>
                )}
                {p.description && <span className="af-card__desc">{p.description}</span>}
                <div className="af-card__meta">
                  <span title={new Date(p.lastOpenedAt).toLocaleString()}>Opened {relativeTime(p.lastOpenedAt)}</span>
                </div>
                <div className="af-btn-row" style={{ marginTop: 4 }}>
                  <button
                    className="st-btn"
                    onClick={() => {
                      openProject(p.id);
                      onOpen();
                    }}
                    data-testid={`project-build-${p.id}`}
                  >
                    Open
                  </button>
                  <button
                    className="st-btn st-btn--dashed"
                    onClick={() => {
                      setRenamingId(p.id);
                      setRenameValue(p.name);
                    }}
                    data-testid={`project-rename-${p.id}`}
                  >
                    Rename
                  </button>
                  <button className="st-btn st-btn--dashed" onClick={() => duplicateProject(p.id)} data-testid={`project-duplicate-${p.id}`}>
                    Duplicate
                  </button>
                  {confirmDelete === p.id ? (
                    <button
                      className="st-btn"
                      style={{ borderColor: "var(--err-line)", color: "var(--err)" }}
                      onClick={() => {
                        deleteProject(p.id);
                        setConfirmDelete(null);
                      }}
                      onBlur={() => setConfirmDelete(null)}
                      data-testid={`project-delete-confirm-${p.id}`}
                    >
                      Really remove?
                    </button>
                  ) : (
                    <button
                      className="st-btn st-btn--dashed"
                      onClick={() => setConfirmDelete(p.id)}
                      data-testid={`project-delete-${p.id}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
