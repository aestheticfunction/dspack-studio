"use client";

/**
 * The studio shell (Phase 2 v1): two views over the same substrate.
 *  - replay: fixture-001 played/scrubbed through the FM-2 timeline engine.
 *  - canvas: the contract's worked example, statically rendered (Phase 1),
 *    with the FM-5 theme dial.
 * Both render through the identical catalog -> Astryx registry path.
 */
import { useState } from "react";
import { Theme } from "@astryxdesign/core";
import { A2uiCanvas, type A2uiClientAction } from "@dspack-studio/a2ui-ingest";
import { astryxRegistry, themes, themeNames, type ThemeName } from "@dspack-studio/astryx-renderers";
import catalogJson from "@dspack-studio/contracts/out/catalog.v0_9_1.json";
import surfaceJson from "@dspack-studio/contracts/out/delete-project-confirmation.surface.json";
import fixture001 from "@dspack-studio/replay/fixtures/fixture-001.json";
import fixture002 from "@dspack-studio/replay/fixtures/fixture-002.json";
import fixture003 from "@dspack-studio/replay/fixtures/fixture-003.json";
import { ReplayView } from "./replay-view";

const FIXTURES = {
  "argues-back": {
    json: fixture001,
    label: "the interface argues back",
    blurb: "Two governed repairs: the model omits the AlertDialog, then labels the action 'OK'. The design system wins.",
  },
  clean: {
    json: fixture002,
    label: "clean first pass",
    blurb: "No violations: one attempt, straight through the gates to a rendered surface.",
  },
  refusal: {
    json: fixture003,
    label: "the emitter refuses",
    blurb: "Lint-clean surface uses a component the protocol profile cannot project — the pipeline refuses, with receipts.",
  },
} as const;

type FixtureKey = keyof typeof FIXTURES;

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

export function Studio() {
  const [view, setView] = useState<"replay" | "canvas">("replay");
  const [fixtureKey, setFixtureKey] = useState<FixtureKey>("argues-back");
  const [actions, setActions] = useState<A2uiClientAction[]>([]);
  const [themeName, setThemeName] = useState<ThemeName>("default");
  const [mode, setMode] = useState<"light" | "dark">("light");

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
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>dspack-studio</h1>
        <p style={{ fontSize: 14, opacity: 0.75, margin: "6px 0 0" }}>
          An agent builds interfaces under a design-system contract — streamed over AG-UI as A2UI
          surfaces, rendered with Astryx. Rewind it. X-ray it. Nothing here is staged.
        </p>
      </header>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button style={btnStyle(view === "replay")} onClick={() => setView("replay")}>
          replay a recorded run
        </button>
        <button style={btnStyle(view === "canvas")} onClick={() => setView("canvas")}>
          worked example + themes
        </button>
      </div>

      {view === "replay" ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {(Object.keys(FIXTURES) as FixtureKey[]).map((key) => (
              <button
                key={key}
                data-testid={`fixture-${key}`}
                style={btnStyle(key === fixtureKey)}
                onClick={() => setFixtureKey(key)}
              >
                {FIXTURES[key].label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 13, opacity: 0.7, margin: "0 0 14px" }}>{FIXTURES[fixtureKey].blurb}</p>
          <ReplayView fixtureJson={FIXTURES[fixtureKey].json} />
        </>
      ) : (
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
