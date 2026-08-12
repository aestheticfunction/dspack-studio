"use client";

/**
 * Settings — provider configuration and appearance, as preferences.
 *
 * The conceptual model is small and honest: Hosted AI, or Local AI as Ollama or
 * any OpenAI-compatible server, or Scripted. Local AI is CONFIGURED here — an
 * endpoint, an optional credential, a connection test, model discovery, model
 * choice — but the browser is only a client: it can't reach localhost by
 * itself, so the local agent is the bridge, and it owns the endpoint and any
 * secret. The browser never stores a credential. Provider choice changes only
 * how a proposal is generated; the governance and rendering are identical.
 */
import { useEffect, useState } from "react";
import { useComposer } from "../state";
import { Eyebrow } from "../ui";
import { agentTestProvider } from "../agent-client";
import { OLLAMA_DEFAULT_URL, OPENAI_DEFAULT_URL, modelOf, localKindOf, type LocalKind } from "../providers";
import { THEMES, getStoredTheme, applyTheme, type ThemeId } from "../appearance";

type TestState = { status: "idle" | "testing" | "ok" | "error"; models: string[]; error?: string };
const IDLE: TestState = { status: "idle", models: [] };

export function SettingsView() {
  const {
    buildModels,
    activeModel,
    setActiveModel,
    providerConfig,
    configuredProviders,
    openaiKey,
    setOpenaiKey,
    configureLocalProvider,
    agentUp,
    mode,
  } = useComposer();
  const [theme, setTheme] = useState<ThemeId>("default");
  useEffect(() => setTheme(getStoredTheme()), []);
  const pickTheme = (id: ThemeId) => {
    setTheme(id);
    applyTheme(id);
  };

  const hostedAvailable = buildModels.includes("hosted-ai");
  const activeKind = localKindOf(activeModel); // "ollama" | "openai" | null

  // Local form state (endpoints persist as you configure; the key is memory-only).
  const [ollamaUrl, setOllamaUrl] = useState(configuredProviders.ollama?.baseUrl ?? OLLAMA_DEFAULT_URL);
  const [openaiUrl, setOpenaiUrl] = useState(configuredProviders.openai?.baseUrl ?? OPENAI_DEFAULT_URL);
  const [openaiManual, setOpenaiManual] = useState("");
  const [ollamaTest, setOllamaTest] = useState<TestState>(IDLE);
  const [openaiTest, setOpenaiTest] = useState<TestState>(IDLE);

  const runTest = async (kind: LocalKind) => {
    const set = kind === "ollama" ? setOllamaTest : setOpenaiTest;
    set({ status: "testing", models: [] });
    const res =
      kind === "ollama"
        ? await agentTestProvider("ollama", ollamaUrl)
        : await agentTestProvider("openai", openaiUrl, openaiKey || undefined);
    set(res.ok ? { status: "ok", models: res.models } : { status: "error", models: [], error: res.error });
  };

  const activeLabel = (() => {
    if (activeModel === "hosted-ai") return "Hosted · Claude Haiku";
    if (activeModel === "scripted") return "Scripted · replays a surface";
    if (activeKind) return `Local · ${modelOf(activeModel)} (${activeKind})`;
    return activeModel || "—";
  })();

  return (
    <div className="af-page af-page--prose">
      <header style={{ marginBottom: "clamp(24px,4vw,40px)" }}>
        <Eyebrow>Preferences</Eyebrow>
        <h1 className="af-display" style={{ fontSize: "clamp(26px,3.4vw,40px)" }}>
          Settings
        </h1>
      </header>

      <section aria-labelledby="providers-h" style={{ marginBottom: "clamp(32px,5vw,52px)" }}>
        <h2 id="providers-h" className="af-h2" style={{ marginBottom: 6 }}>
          How AI runs
        </h2>
        <p className="af-lead" style={{ marginTop: 6, fontSize: 14 }}>
          The provider generates the first proposal. Every proposal is then checked and rendered the same way — the
          result is governed no matter which you choose.
        </p>
        <p className="af-hint" data-testid="active-provider" style={{ marginTop: 10 }}>
          Active: <strong style={{ color: "var(--fg)" }}>{activeLabel}</strong>
        </p>

        <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
          {/* Hosted */}
          <article style={{ border: "1px solid var(--line)", borderRadius: 5, background: "var(--bg-1)", padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
              <span className="af-h2" style={{ fontSize: 15 }}>
                Hosted AI
              </span>
              <span className={`af-pill${hostedAvailable ? " af-pill--ok" : ""}`} data-testid="hosted-availability">
                {hostedAvailable ? "Available" : "Unavailable"}
              </span>
              <button
                className={`st-btn${activeModel === "hosted-ai" ? " st-btn--active" : ""}`}
                style={{ marginLeft: "auto" }}
                disabled={!hostedAvailable}
                onClick={() => setActiveModel("hosted-ai")}
                data-testid="provider-use-hosted"
              >
                {activeModel === "hosted-ai" ? "In use" : "Use hosted"}
              </button>
            </div>
            <p className="af-hint">
              Managed Claude through the governed AI Gateway. No API key ever enters your browser, and the deterministic
              checks run entirely in this browser. Immediate — nothing to set up.
            </p>
          </article>

          {/* Local */}
          <article style={{ border: "1px solid var(--line)", borderRadius: 5, background: "var(--bg-1)", padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
              <span className="af-h2" style={{ fontSize: 15 }}>
                Local AI &amp; your own provider
              </span>
              <span className={`af-pill${agentUp ? " af-pill--ok" : ""}`} data-testid="agent-status">
                <span className="af-pill__dot" />
                {agentUp ? "Agent connected" : "Agent not running"}
              </span>
            </div>
            <p className="af-hint" style={{ marginBottom: 4 }}>
              Run models on your own machine. A browser can&rsquo;t reach <code>localhost</code> by itself — the local
              agent is the bridge, and it holds the endpoint and any key. Configure a provider below; the browser never
              stores a secret.
            </p>

            {!agentUp && (
              <ol style={{ margin: "10px 0 0", paddingLeft: 18, display: "grid", gap: 7 }} data-testid="local-onboarding">
                <li className="af-hint">
                  Install a runner — <code>Ollama</code> (ollama.com), <code>LM Studio</code>, llama.cpp, vLLM, or any
                  OpenAI-compatible server.
                </li>
                <li className="af-hint">
                  Start the Composer agent beside your project: <code>pnpm --filter agent dev</code>.
                </li>
                <li className="af-hint">The configuration below activates once the agent is connected.</li>
              </ol>
            )}

            {/* Ollama */}
            <fieldset
              disabled={!agentUp}
              style={{ border: "1px solid var(--line-soft)", borderRadius: 4, padding: 14, marginTop: 14, opacity: agentUp ? 1 : 0.55 }}
              data-testid="provider-ollama"
            >
              <legend style={{ fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color: "var(--fg-dim)", padding: "0 6px" }}>
                Ollama
              </legend>
              <div className="af-field" style={{ margin: 0 }}>
                <label className="af-label" htmlFor="ollama-url">
                  Endpoint
                </label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    id="ollama-url"
                    className="af-input af-input--mono"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    placeholder={OLLAMA_DEFAULT_URL}
                    style={{ flex: 1, minWidth: 220 }}
                    data-testid="ollama-url"
                  />
                  <button className="st-btn" onClick={() => void runTest("ollama")} data-testid="ollama-test">
                    {ollamaTest.status === "testing" ? "Testing…" : "Test connection"}
                  </button>
                </div>
              </div>
              <ProviderResult
                test={ollamaTest}
                testId="ollama"
                activeModel={activeKind === "ollama" ? modelOf(activeModel) : null}
                onPick={(m) => configureLocalProvider("ollama", ollamaUrl, m)}
              />
            </fieldset>

            {/* OpenAI-compatible */}
            <fieldset
              disabled={!agentUp}
              style={{ border: "1px solid var(--line-soft)", borderRadius: 4, padding: 14, marginTop: 12, opacity: agentUp ? 1 : 0.55 }}
              data-testid="provider-openai"
            >
              <legend style={{ fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color: "var(--fg-dim)", padding: "0 6px" }}>
                OpenAI-compatible · LM Studio, llama.cpp, vLLM, LocalAI
              </legend>
              <div className="af-field" style={{ margin: 0 }}>
                <label className="af-label" htmlFor="openai-url">
                  Base URL
                </label>
                <input
                  id="openai-url"
                  className="af-input af-input--mono"
                  value={openaiUrl}
                  onChange={(e) => setOpenaiUrl(e.target.value)}
                  placeholder={OPENAI_DEFAULT_URL}
                  data-testid="openai-url"
                />
              </div>
              <div className="af-field" style={{ margin: "10px 0 0" }}>
                <label className="af-label" htmlFor="openai-key">
                  API key <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--fg-dim)" }}>· optional, most local servers need none</span>
                </label>
                <input
                  id="openai-key"
                  className="af-input af-input--mono"
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="sk-… (stays in memory; sent only to the agent)"
                  data-testid="openai-key"
                />
              </div>
              <div style={{ marginTop: 10 }}>
                <button className="st-btn" onClick={() => void runTest("openai")} data-testid="openai-test">
                  {openaiTest.status === "testing" ? "Testing…" : "Test connection"}
                </button>
              </div>
              <ProviderResult
                test={openaiTest}
                testId="openai"
                activeModel={activeKind === "openai" ? modelOf(activeModel) : null}
                onPick={(m) => configureLocalProvider("openai", openaiUrl, m)}
              />
              {openaiTest.status === "ok" && openaiTest.models.length === 0 && (
                <div className="af-field" style={{ margin: "10px 0 0" }} data-testid="openai-manual">
                  <label className="af-label" htmlFor="openai-model">
                    This endpoint doesn&rsquo;t list models — enter one
                  </label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input
                      id="openai-model"
                      className="af-input af-input--mono"
                      value={openaiManual}
                      onChange={(e) => setOpenaiManual(e.target.value)}
                      placeholder="e.g. local-model"
                      style={{ flex: 1, minWidth: 200 }}
                      data-testid="openai-model-input"
                    />
                    <button
                      className="st-btn st-btn--primary"
                      disabled={!openaiManual.trim()}
                      onClick={() => configureLocalProvider("openai", openaiUrl, openaiManual.trim())}
                      data-testid="openai-model-use"
                    >
                      Use this model
                    </button>
                  </div>
                </div>
              )}
            </fieldset>
          </article>

          {/* Scripted */}
          <article style={{ border: "1px solid var(--line)", borderRadius: 5, background: "var(--bg-1)", padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
              <span className="af-h2" style={{ fontSize: 15 }}>
                Scripted
              </span>
              <button
                className={`st-btn${activeModel === "scripted" ? " st-btn--active" : ""}`}
                style={{ marginLeft: "auto" }}
                onClick={() => setActiveModel("scripted")}
                data-testid="provider-model-scripted"
              >
                {activeModel === "scripted" ? "In use" : "Use scripted"}
              </button>
            </div>
            <p className="af-hint">
              Replays a saved surface behind one deliberately-wrong first attempt — a deterministic tour of the
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

/** Connection-test result: an error, or discovered models as pick-able chips. */
function ProviderResult({
  test,
  testId,
  activeModel,
  onPick,
}: {
  test: TestState;
  testId: string;
  activeModel: string | null;
  onPick: (model: string) => void;
}) {
  if (test.status === "idle") return null;
  if (test.status === "testing") {
    return (
      <p className="af-hint" style={{ marginTop: 10 }}>
        Reaching the endpoint…
      </p>
    );
  }
  if (test.status === "error") {
    return (
      <p className="af-hint" data-testid={`${testId}-status`} style={{ marginTop: 10, color: "var(--err)" }}>
        {test.error ?? "Could not reach the endpoint."}
      </p>
    );
  }
  return (
    <div style={{ marginTop: 10 }} data-testid={`${testId}-status`}>
      <p className="af-hint" style={{ color: "var(--ok)", marginBottom: 8 }}>
        Connected{test.models.length ? ` — ${test.models.length} model${test.models.length === 1 ? "" : "s"}` : ""}. Choose one to use it.
      </p>
      {test.models.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} data-testid={`${testId}-models`}>
          {test.models.map((m) => (
            <button
              key={m}
              className={`af-choice${activeModel === m ? " af-choice--active" : ""}`}
              style={{ padding: "6px 10px" }}
              onClick={() => onPick(m)}
              aria-pressed={activeModel === m}
              data-testid={`${testId}-model-${m}`}
            >
              <span className="af-choice__title" style={{ fontSize: 13 }}>
                {m}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
