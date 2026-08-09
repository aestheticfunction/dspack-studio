"use client";

/**
 * Connect a repository — the approachable path to building against your own
 * component library.
 *
 * A browser cannot read your filesystem, and it should not pretend to: the
 * local agent bridges Composer to your real files on your machine, and your
 * code and keys never leave it. So the honest, modern UX is recent workspaces
 * you can reopen in one click, plus a clear path field with guidance — not a
 * bare absolute-path box presented as the only way in. Connecting creates a
 * project bound to that repository.
 */
import { useState } from "react";
import { useComposer } from "../state";
import { Eyebrow, relativeTime } from "../ui";
import type { View } from "../composer";

function basename(path: string): string {
  const parts = path.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function ProjectView({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { agentUp, busy, projects, newProject, openProject } = useComposer();
  const [path, setPath] = useState("");

  // Recent workspaces = the projects already bound to a local repository.
  const recent = projects.filter((p) => p.source.kind === "agent").slice(0, 6);

  const connectPath = (p: string) => {
    const clean = p.trim();
    if (!clean) return;
    // Reuse an existing project for this path, else create one bound to it.
    const existing = projects.find((pr) => pr.source.kind === "agent" && pr.source.path === clean);
    if (existing) openProject(existing.id);
    else newProject({ name: basename(clean), source: { kind: "agent", path: clean } });
  };

  return (
    <div className="af-page af-page--prose">
      <header style={{ marginBottom: "clamp(22px,4vw,36px)" }}>
        <Eyebrow>Connect</Eyebrow>
        <h1 className="af-display" style={{ fontSize: "clamp(26px,3.4vw,40px)" }}>
          Build against your own repository
        </h1>
        <p className="af-lead" style={{ fontSize: 15 }}>
          The local agent runs on your machine and bridges Composer to your real files. Your components, your edits,
          and any provider keys stay on your machine &mdash; nothing is uploaded.
        </p>
      </header>

      <div style={{ marginBottom: 24 }}>
        <span className={`af-pill${agentUp ? " af-pill--ok" : ""}`} data-testid="connect-agent-status">
          <span className="af-pill__dot" />
          {agentUp ? "Agent connected" : "Agent not running"}
        </span>
      </div>

      {!agentUp && (
        <div style={{ border: "1px dashed var(--line)", borderRadius: 6, background: "var(--bg-1)", padding: 18, marginBottom: 24 }} data-testid="connect-onboarding">
          <p className="af-label" style={{ marginBottom: 8 }}>
            Start the agent
          </p>
          <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 7 }}>
            <li className="af-hint">
              In your project&rsquo;s repository, run <code>pnpm --filter agent dev</code> (or the packaged Composer
              agent).
            </li>
            <li className="af-hint">It serves on your machine at localhost and announces itself here automatically.</li>
            <li className="af-hint">Then open a workspace below.</li>
          </ol>
        </div>
      )}

      {recent.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 className="af-h2" style={{ fontSize: 15, marginBottom: 12 }}>
            Recent workspaces
          </h2>
          <div className="af-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))" }} data-testid="recent-workspaces">
            {recent.map((p) => (
              <button
                key={p.id}
                type="button"
                className="af-card"
                onClick={() => openProject(p.id)}
                disabled={!agentUp}
                title={p.source.kind === "agent" ? p.source.path : ""}
                data-testid={`recent-${p.id}`}
              >
                <span className="af-card__k">Local repository</span>
                <span className="af-card__title">{p.name}</span>
                {p.source.kind === "agent" && (
                  <span className="af-card__desc" style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-dim)", wordBreak: "break-all" }}>
                    {p.source.path}
                  </span>
                )}
                <span className="af-card__meta">Opened {relativeTime(p.lastOpenedAt)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="af-h2" style={{ fontSize: 15, marginBottom: 12 }}>
          Open a workspace
        </h2>
        <div className="af-field">
          <label className="af-label" htmlFor="connect-path">
            Project folder
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="connect-path"
              className="af-input af-input--mono"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && agentUp && connectPath(path)}
              placeholder="/path/to/your/project"
              disabled={!agentUp}
              style={{ flex: 1 }}
              data-testid="project-path"
            />
            <button
              className="st-btn st-btn--primary st-btn--lg"
              disabled={!agentUp || !path.trim() || busy !== null}
              onClick={() => connectPath(path)}
              data-testid="connect"
            >
              {busy === "connecting" ? "Connecting…" : "Open"}
            </button>
          </div>
          <p className="af-hint">
            The folder that holds your <code>project.json</code>, dspack contract, and mapping profile. The agent reads
            it in place; Composer never copies it out.
          </p>
        </div>

        <div className="af-btn-row" style={{ marginTop: 8 }}>
          <button className="st-btn st-btn--dashed" onClick={() => onNavigate("projects")} data-testid="connect-back">
            &larr; Back to projects
          </button>
        </div>
      </section>
    </div>
  );
}
