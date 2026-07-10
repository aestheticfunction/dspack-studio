"use client";

/**
 * The studio shell: scenario-driven. A scenario contributes only data
 * (intent, seed prompts, curated fixtures); the experience — replay with the
 * timeline, live streaming, gate ticker, failure panel, inspection — is the
 * same substrate for every scenario. Planned scenarios appear on the shelf
 * with what they are waiting on, stated honestly.
 */
import { useState } from "react";
import { Theme } from "@astryxdesign/core";
import { A2uiCanvas, type A2uiClientAction } from "@dspack-studio/a2ui-ingest";
import { astryxRegistry, themes, themeNames, type ThemeName } from "@dspack-studio/astryx-renderers";
import { readyScenarios, scenarios, type Scenario } from "@dspack-studio/scenarios";
import catalogJson from "@dspack-studio/contracts/out/catalog.v0_9_1.json";
import surfaceJson from "@dspack-studio/contracts/out/delete-project-confirmation.surface.json";
import { importFixture, parseFixture, MAX_IMPORT_BYTES, type ReplayFixture } from "@dspack-studio/replay";
import { RunView } from "./run-view";
import { LiveView } from "./live-view";

const btnStyle = (active: boolean): React.CSSProperties => ({
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: active ? "#0f172a" : "transparent",
  color: active ? "#fff" : "inherit",
  cursor: "pointer",
  font: "inherit",
  fontSize: 13,
});

function ReplayPane({ scenario }: { scenario: Scenario }) {
  const [key, setKey] = useState(scenario.fixtures[0]?.key);
  const [imported, setImported] = useState<ReplayFixture | null>(null);
  const [importSeq, setImportSeq] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setImportError(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — fixtures are small JSON documents (limit 5 MB)`);
      return;
    }
    const result = importFixture(await file.text(), file.size);
    if (!result.ok) {
      setImportError(`"${file.name}": ${result.error}`);
      return;
    }
    setImported(result.fixture);
    setImportSeq((n) => n + 1);
    setKey("__imported__");
  };

  const ref = key === "__imported__" && imported ? null : (scenario.fixtures.find((f) => f.key === key) ?? scenario.fixtures[0]);
  const fixture = ref ? parseFixture(ref.fixture) : imported;

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) void handleFile(file);
      }}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
        {scenario.fixtures.map((f) => (
          <button key={f.key} data-testid={`fixture-${f.key}`} style={btnStyle(f.key === ref?.key)} onClick={() => setKey(f.key)}>
            {f.label}
          </button>
        ))}
        {imported && (
          <button data-testid="fixture-imported" style={btnStyle(key === "__imported__")} onClick={() => setKey("__imported__")}>
            imported session
          </button>
        )}
        <label style={{ ...btnStyle(false), marginLeft: "auto" }} data-testid="import-label">
          open a session file…
          <input
            data-testid="import-input"
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {importError && (
        <p data-testid="import-error" style={{ fontSize: 13, color: "#dc2626", margin: "0 0 10px" }}>
          could not import: {importError}
        </p>
      )}
      {ref && <p style={{ fontSize: 13, opacity: 0.7, margin: "0 0 14px" }}>{ref.blurb}</p>}
      {!ref && imported && (
        <p style={{ fontSize: 13, opacity: 0.7, margin: "0 0 14px" }}>
          Imported session — recorded {imported.recordedAt || "(unknown time)"}, prompt: “{imported.prompt || "—"}”. Drag another
          file anywhere here to replace it.
        </p>
      )}
      {fixture ? (
        <RunView
          events={fixture.events}
          resetKey={ref ? `${scenario.id}:${ref.key}` : `imported-${importSeq}`}
          label={`${fixture.name} — ${fixture.mode} run, ${fixture.adapterId}, ${fixture.events.length} events${ref ? "" : " (imported)"}`}
        />
      ) : (
        <p style={{ opacity: 0.6 }}>No recordings yet for this scenario — open a session file, or run it live and download one.</p>
      )}
    </div>
  );
}

export function Studio() {
  const [scenarioId, setScenarioId] = useState(readyScenarios[0]?.id);
  const [view, setView] = useState<"replay" | "live" | "canvas">("replay");
  const [actions, setActions] = useState<A2uiClientAction[]>([]);
  const [themeName, setThemeName] = useState<ThemeName>("default");
  const [mode, setMode] = useState<"light" | "dark">("light");

  const scenario = scenarios.find((s) => s.id === scenarioId) ?? readyScenarios[0];
  const theme = themes[themeName];

  const staticCanvas = (
    <A2uiCanvas
      catalog={catalogJson as any}
      registry={astryxRegistry}
      messages={(surfaceJson as any).messages}
      onAction={(action) => setActions((prev) => [...prev, action])}
    />
  );

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>dspack-studio</h1>
        <p style={{ fontSize: 14, opacity: 0.75, margin: "6px 0 0" }}>
          An agent builds interfaces under a design-system contract — streamed over AG-UI as A2UI
          surfaces, rendered with Astryx. Replay it, run it live, rewind it. Nothing here is staged.
        </p>
      </header>

      {/* The scenario shelf. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        {scenarios.map((s) =>
          s.status === "ready" ? (
            <button key={s.id} data-testid={`scenario-${s.id}`} style={btnStyle(s.id === scenario?.id)} onClick={() => setScenarioId(s.id)}>
              {s.name}
            </button>
          ) : (
            <span
              key={s.id}
              title={`Planned. Needs: ${(s.needs ?? []).join("; ")}`}
              style={{ ...btnStyle(false), opacity: 0.45, cursor: "help" }}
            >
              {s.name} <em style={{ fontSize: 11 }}>(planned)</em>
            </span>
          ),
        )}
      </div>
      {scenario && <p style={{ fontSize: 13, opacity: 0.7, margin: "0 0 16px" }}>{scenario.tagline}</p>}

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button data-testid="view-replay" style={btnStyle(view === "replay")} onClick={() => setView("replay")}>
          replay a recorded run
        </button>
        <button data-testid="view-live" style={btnStyle(view === "live")} onClick={() => setView("live")}>
          run it live
        </button>
        <button data-testid="view-canvas" style={btnStyle(view === "canvas")} onClick={() => setView("canvas")}>
          worked example + themes
        </button>
      </div>

      {view === "replay" && scenario && <ReplayPane key={scenario.id} scenario={scenario} />}
      {view === "live" && scenario && <LiveView key={scenario.id} scenario={scenario} />}
      {view === "canvas" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
            {themeNames.map((name) => (
              <button key={name} onClick={() => setThemeName(name)} style={btnStyle(name === themeName)}>
                {name}
              </button>
            ))}
            <button
              onClick={() => setMode((m) => (m === "light" ? "dark" : "light"))}
              style={{ ...btnStyle(false), marginLeft: "auto" }}
            >
              {mode === "light" ? "dark mode" : "light mode"}
            </button>
          </div>

          <section data-canvas style={{ border: "1px dashed #cbd5e1", borderRadius: 12, padding: 24 }}>
            {theme ? (
              <Theme theme={theme as any} mode={mode}>
                {staticCanvas}
              </Theme>
            ) : (
              staticCanvas
            )}
          </section>

          <section style={{ marginTop: 20, fontSize: 13, opacity: 0.8 }}>
            <strong>Dispatched actions</strong> (A2UI → host):{" "}
            {actions.length === 0 ? (
              <em>none yet — press the confirm button in the dialog</em>
            ) : (
              <code>
                {actions.map((a: any) => `${a?.name ?? "?"} (from ${a?.sourceComponentId ?? "?"})`).join(", ")}
              </code>
            )}
          </section>
        </>
      )}
    </main>
  );
}
