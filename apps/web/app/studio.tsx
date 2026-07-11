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
import { capabilitiesByScenario, readyScenarios, resolveAction, scenarios, type Scenario } from "@dspack-studio/scenarios";
import catalogJson from "@dspack-studio/contracts/out/catalog.v0_9_1.json";
import surfaceJson from "@dspack-studio/contracts/out/delete-project-confirmation.surface.json";
import { forkFixture, importFixture, parseFixture, surfaceComponentsAt, MAX_IMPORT_BYTES, type ReplayFixture } from "@dspack-studio/replay";
import { dispatchAction } from "./action-dispatch";
import { RunView } from "./run-view";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8787";
import { LiveView } from "./live-view";
import { BreakView } from "./break-view";

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
  // FM-3: forked runs live beside the curated fixtures for this session.
  const [forks, setForks] = useState<ReplayFixture[]>([]);
  const [forkError, setForkError] = useState<string | null>(null);
  // Continuation: the fork id whose agent session has been rebuilt from its
  // prefix (deterministic responders) and now accepts NEW actions.
  const [continuingId, setContinuingId] = useState<string | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);

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

  const selectedFork = forks.find((f) => f.id === key) ?? null;
  const ref =
    selectedFork || (key === "__imported__" && imported)
      ? null
      : (scenario.fixtures.find((f) => f.key === key) ?? scenario.fixtures[0]);
  const fixture = ref ? parseFixture(ref.fixture) : (selectedFork ?? imported);

  const handleFork = (playhead: number) => {
    if (!fixture) return;
    setForkError(null);
    const result = forkFixture(fixture, playhead);
    if (!result.ok) {
      setForkError(result.reason);
      return;
    }
    setForks((prev) => [...prev, result.fixture]);
    setKey(result.fixture.id);
  };

  // POST the fork's prefix to the agent: reset scenario state, restore the
  // recorded grounding, replay accepted actions — then new actions continue
  // the branch. Refused (409) if a replay diverges; nothing is invented.
  const startContinuation = async (fork: ReplayFixture) => {
    setContinueError(null);
    try {
      const r = await fetch(`${AGENT_URL}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario: scenario.id, events: fork.events }),
      });
      const body = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !body.ok) throw new Error(body.error ?? `agent responded ${r.status}`);
      setContinuingId(fork.id);
    } catch (err) {
      setContinueError(err instanceof Error ? err.message : String(err));
    }
  };

  // Append a continuation event to the forked run (and only to it).
  const appendToFork = (forkId: string, event: Record<string, unknown>) => {
    setForks((prev) =>
      prev.map((f) =>
        f.id === forkId
          ? { ...f, events: [...f.events, { atMs: (f.events.at(-1)?.atMs ?? 0) + 1000, event: event as any }] }
          : f,
      ),
    );
  };

  const continuationAction = (fork: ReplayFixture) => (a: any) => {
    const components = surfaceComponentsAt({ events: fork.events }, fork.events.length - 1);
    const resolution = resolveAction(
      { name: a?.name ?? "unknown", sourceComponentId: a?.sourceComponentId, context: a?.context },
      components as any,
      capabilitiesByScenario[scenario.id] ?? [],
    );
    void dispatchAction(
      AGENT_URL,
      {
        scenario: scenario.id,
        name: a?.name ?? "unknown",
        capability: resolution.ok ? resolution.capability : undefined,
        surfaceId: a?.surfaceId,
        sourceComponentId: a?.sourceComponentId,
        context: resolution.ok ? resolution.context : a?.context,
        resolution: resolution as any,
      },
      (event) => appendToFork(fork.id, event),
    );
  };

  const downloadFork = (fork: ReplayFixture) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(fork, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fork.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
        {forks.map((f) => (
          <button
            key={f.id}
            data-testid={`fork-${f.fork?.forkIndex}`}
            style={{ ...btnStyle(f.id === key), borderStyle: "dashed" }}
            title={`forked from ${f.fork?.parentName ?? f.fork?.parentId} at event ${f.fork?.forkIndex}`}
            onClick={() => setKey(f.id)}
          >
            ⑂ fork @ {f.fork?.forkIndex}
          </button>
        ))}
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
      {forkError && (
        <p data-testid="fork-error" style={{ fontSize: 13, color: "#dc2626", margin: "0 0 10px" }}>
          cannot fork here: {forkError}
        </p>
      )}
      {ref && <p style={{ fontSize: 13, opacity: 0.7, margin: "0 0 14px" }}>{ref.blurb}</p>}
      {selectedFork && (
        <p style={{ fontSize: 13, color: "#475569", margin: "0 0 14px" }} data-testid="fork-blurb">
          A new run forked from “{selectedFork.fork?.parentName}” at event {selectedFork.fork?.forkIndex}: it shares
          history up to that moment and nothing after. The original is untouched.{" "}
          <button
            data-testid="fork-download"
            onClick={() => downloadFork(selectedFork)}
            style={{ font: "inherit", border: "none", background: "none", color: "#075985", cursor: "pointer", padding: 0, textDecoration: "underline" }}
          >
            download this fork
          </button>{" "}
          — it reopens like any session file, provenance included.
          {scenario.interactive && continuingId !== selectedFork.id && (
            <>
              {" "}
              <button
                data-testid="fork-continue"
                onClick={() => void startContinuation(selectedFork)}
                style={{ font: "inherit", border: "none", background: "none", color: "#075985", cursor: "pointer", padding: 0, textDecoration: "underline" }}
              >
                continue this fork
              </button>{" "}
              — the agent rebuilds its state from the prefix (deterministic responders), then your next actions
              diverge the branch for real.
            </>
          )}
          {continuingId === selectedFork.id && (
            <em data-testid="fork-continuing"> — continuation active: act on the surface to grow this branch.</em>
          )}
        </p>
      )}
      {continueError && (
        <p data-testid="continue-error" style={{ fontSize: 13, color: "#dc2626", margin: "0 0 10px" }}>
          cannot continue this fork: {continueError}
        </p>
      )}
      {!ref && !selectedFork && imported && (
        <p style={{ fontSize: 13, opacity: 0.7, margin: "0 0 14px" }}>
          Imported session — recorded {imported.recordedAt || "(unknown time)"}, prompt: “{imported.prompt || "—"}”. Drag another
          file anywhere here to replace it.
        </p>
      )}
      {fixture ? (
        <RunView
          events={fixture.events}
          resetKey={ref ? `${scenario.id}:${ref.key}` : selectedFork ? selectedFork.id : `imported-${importSeq}`}
          label={
            selectedFork
              ? `⑂ ${fixture.name} — ${fixture.mode} run, ${fixture.events.length} events`
              : `${fixture.name} — ${fixture.mode} run, ${fixture.adapterId}, ${fixture.events.length} events${ref ? "" : " (imported)"}`
          }
          onFork={handleFork}
          live={Boolean(selectedFork && continuingId === selectedFork.id)}
          onAction={selectedFork && continuingId === selectedFork.id ? continuationAction(selectedFork) : undefined}
        />
      ) : (
        <p style={{ opacity: 0.6 }}>No recordings yet for this scenario — open a session file, or run it live and download one.</p>
      )}
    </div>
  );
}

export function Studio() {
  const [scenarioId, setScenarioId] = useState(readyScenarios[0]?.id);
  const [view, setView] = useState<"replay" | "live" | "break" | "canvas">("replay");
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
              style={{ ...btnStyle(false), opacity: 0.62, cursor: "help" }}
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
        <button data-testid="view-break" style={btnStyle(view === "break")} onClick={() => setView("break")}>
          break it on purpose
        </button>
        <button data-testid="view-canvas" style={btnStyle(view === "canvas")} onClick={() => setView("canvas")}>
          worked example + themes
        </button>
      </div>

      {view === "replay" && scenario && <ReplayPane key={scenario.id} scenario={scenario} />}
      {view === "live" && scenario && <LiveView key={scenario.id} scenario={scenario} />}
      {view === "break" && <BreakView />}
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
