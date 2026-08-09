"use client";

/**
 * Settings — provider configuration and appearance, as preferences.
 *
 * Provider choice changes ONLY how a proposal is generated; the governance and
 * rendering are identical, so this reads as application preferences, not
 * implementation. It states honestly what runs where: managed hosted AI needs
 * no key in the browser; local models and your own provider keys run through
 * the local agent and never touch the browser. Appearance offers the governed
 * Aesthetic Function themes.
 */
import { useEffect, useState } from "react";
import { useComposer } from "../state";
import { Eyebrow } from "../ui";
import { THEMES, getStoredTheme, applyTheme, type ThemeId } from "../appearance";

function modelLabel(m: string): { provider: string; name: string; note: string } {
  if (m === "hosted-ai") return { provider: "Hosted", name: "Claude Haiku", note: "Managed via the AI Gateway" };
  if (m === "scripted") return { provider: "Scripted", name: "Worked example", note: "Deterministic tour, no model" };
  if (m.startsWith("ollama:")) return { provider: "Local", name: m.slice("ollama:".length), note: "Ollama, on your machine" };
  if (m.includes(":")) {
    const [p, n] = m.split(":");
    return { provider: "Local", name: n, note: p };
  }
  return { provider: "Model", name: m, note: "" };
}

export function SettingsView() {
  const { buildModels, activeModel, setActiveModel, agentUp, mode } = useComposer();
  const [theme, setTheme] = useState<ThemeId>("default");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  const hostedAvailable = buildModels.includes("hosted-ai");
  const localModels = buildModels.filter((m) => m.startsWith("ollama:") || (m.includes(":") && !m.startsWith("hosted")));

  const pickTheme = (id: ThemeId) => {
    setTheme(id);
    applyTheme(id);
  };

  return (
    <div className="af-page af-page--prose">
      <header style={{ marginBottom: "clamp(24px,4vw,40px)" }}>
        <Eyebrow>Preferences</Eyebrow>
        <h1 className="af-display" style={{ fontSize: "clamp(26px,3.4vw,40px)" }}>
          Settings
        </h1>
      </header>

      {/* How AI runs */}
      <section aria-labelledby="providers-h" style={{ marginBottom: "clamp(32px,5vw,52px)" }}>
        <h2 id="providers-h" className="af-h2" style={{ marginBottom: 6 }}>
          How AI runs
        </h2>
        <p className="af-lead" style={{ marginTop: 6, fontSize: 14 }}>
          The provider generates the first proposal. Every proposal is then checked and rendered the same way, so the
          result is governed no matter which you choose.
        </p>

        <p className="af-label" style={{ margin: "22px 0 10px" }}>
          Active provider
        </p>
        <div className="af-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))" }} data-testid="provider-models">
          {buildModels.map((m) => {
            const l = modelLabel(m);
            return (
              <button
                key={m}
                type="button"
                className={`af-choice${activeModel === m ? " af-choice--active" : ""}`}
                onClick={() => setActiveModel(m)}
                aria-pressed={activeModel === m}
                data-testid={`provider-model-${m}`}
              >
                <span className="af-card__k">{l.provider}</span>
                <span className="af-choice__title">{l.name}</span>
                <span className="af-choice__desc">{l.note}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 22 }}>
          {/* Hosted */}
          <article style={{ border: "1px solid var(--line)", borderRadius: 5, background: "var(--bg-1)", padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span className="af-h2" style={{ fontSize: 15 }}>
                Hosted AI
              </span>
              <span className={`af-pill${hostedAvailable && mode !== "agent" ? " af-pill--ok" : ""}`}>
                {mode === "agent" ? "Using local agent" : hostedAvailable ? "Available" : "Unavailable"}
              </span>
            </div>
            <p className="af-hint">
              Managed Claude through the governed AI Gateway. No API key ever enters your browser, and the deterministic
              checks run entirely in this browser. This is the default when you have no local agent connected.
            </p>
          </article>

          {/* Local */}
          <article style={{ border: "1px solid var(--line)", borderRadius: 5, background: "var(--bg-1)", padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span className="af-h2" style={{ fontSize: 15 }}>
                Local AI &amp; your own provider
              </span>
              <span className={`af-pill${agentUp ? " af-pill--ok" : ""}`} data-testid="agent-status">
                <span className="af-pill__dot" />
                {agentUp ? "Agent connected" : "Agent not running"}
              </span>
            </div>
            <p className="af-hint" style={{ marginBottom: 10 }}>
              Run models on your own machine through the local agent. A browser can&rsquo;t reach a model on{" "}
              <code>localhost</code> by itself &mdash; the agent is the bridge. Your endpoint and provider keys live in
              the agent&rsquo;s environment (for example <code>OLLAMA_URL</code> or <code>ANTHROPIC_API_KEY</code>); the
              browser never stores a secret. Same pipeline, same governance.
            </p>
            {agentUp && localModels.length > 0 ? (
              <p className="af-hint" data-testid="local-models">
                Detected: {localModels.map((m) => modelLabel(m).name).join(", ")}.
              </p>
            ) : (
              <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 7 }} data-testid="local-onboarding">
                <li className="af-hint">
                  Install a local runner: <code>Ollama</code> (ollama.com) or <code>LM Studio</code>, or point at any
                  OpenAI-compatible endpoint.
                </li>
                <li className="af-hint">
                  Start the Composer agent beside your project: <code>pnpm --filter agent dev</code>.
                </li>
                <li className="af-hint">
                  To use a hosted provider with your own key, set it in the agent&rsquo;s environment (for example{" "}
                  <code>ANTHROPIC_API_KEY</code>) &mdash; it stays on your machine.
                </li>
                <li className="af-hint">Reconnect from Settings; detected models appear as providers above.</li>
              </ol>
            )}
          </article>

          {/* Scripted */}
          <article style={{ border: "1px solid var(--line)", borderRadius: 5, background: "var(--bg-1)", padding: 16 }}>
            <span className="af-h2" style={{ fontSize: 15 }}>
              Scripted
            </span>
            <p className="af-hint" style={{ marginTop: 6 }}>
              Replays a worked example behind one deliberately-wrong first attempt &mdash; a deterministic tour of the
              governance actually working, with no model call.
            </p>
          </article>
        </div>
      </section>

      {/* Appearance */}
      <section aria-labelledby="appearance-h">
        <h2 id="appearance-h" className="af-h2" style={{ marginBottom: 6 }}>
          Appearance
        </h2>
        <p className="af-lead" style={{ marginTop: 6, fontSize: 14 }}>
          The governed themes Composer is rendered in. A choice, not a demonstration.
        </p>
        <div className="af-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", marginTop: 16 }} data-testid="appearance">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`af-choice${theme === t.id ? " af-choice--active" : ""}`}
              onClick={() => pickTheme(t.id)}
              aria-pressed={theme === t.id}
              data-testid={`theme-${t.id}`}
            >
              <span className="af-choice__title">{t.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
