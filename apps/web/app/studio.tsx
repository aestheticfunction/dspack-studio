"use client";

/**
 * Phase 1 canvas: the contract's worked example (ex.delete-project-confirmation),
 * compiled by dspack-emit into A2UI messages, ingested against the generated
 * catalog, and rendered through the Astryx registry — with the theme dial (FM-5).
 *
 * Nothing on this page is hand-drawn: the vocabulary comes from the catalog,
 * the content from the emitted surface, the pixels from Astryx. The theme dial
 * changes only the design system's theme; the surface JSON never changes.
 */
import { useState } from "react";
import { Theme } from "@astryxdesign/core";
import { A2uiCanvas, type A2uiClientAction } from "@dspack-studio/a2ui-ingest";
import { astryxRegistry, themes, themeNames, type ThemeName } from "@dspack-studio/astryx-renderers";
import catalogJson from "@dspack-studio/contracts/out/catalog.v0_9_1.json";
import surfaceJson from "@dspack-studio/contracts/out/delete-project-confirmation.surface.json";

export function Studio() {
  const [actions, setActions] = useState<A2uiClientAction[]>([]);
  const [themeName, setThemeName] = useState<ThemeName>("default");
  const [mode, setMode] = useState<"light" | "dark">("light");

  const theme = themes[themeName];
  const canvas = (
    <A2uiCanvas
      catalog={catalogJson as any}
      registry={astryxRegistry}
      messages={(surfaceJson as any).messages}
      onAction={(action) => setActions((prev) => [...prev, action])}
    />
  );

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui" }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>dspack-studio</h1>
        <p style={{ fontSize: 14, opacity: 0.75, margin: "6px 0 0" }}>
          The contract&apos;s worked example, compiled to A2UI v0.9.1 and rendered through
          Astryx. Change the theme: the surface JSON does not change.
        </p>
      </header>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
        {themeNames.map((name) => (
          <button
            key={name}
            onClick={() => setThemeName(name)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: name === themeName ? "#0f172a" : "transparent",
              color: name === themeName ? "#fff" : "inherit",
              cursor: "pointer",
              font: "inherit",
              fontSize: 13,
            }}
          >
            {name}
          </button>
        ))}
        <button
          onClick={() => setMode((m) => (m === "light" ? "dark" : "light"))}
          style={{
            marginLeft: "auto",
            padding: "6px 12px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "transparent",
            cursor: "pointer",
            font: "inherit",
            fontSize: 13,
          }}
        >
          {mode === "light" ? "dark mode" : "light mode"}
        </button>
      </div>

      <section data-canvas style={{ border: "1px dashed #cbd5e1", borderRadius: 12, padding: 24 }}>
        {theme ? (
          <Theme theme={theme as any} mode={mode}>
            {canvas}
          </Theme>
        ) : (
          canvas
        )}
      </section>

      <section style={{ marginTop: 20, fontSize: 13, opacity: 0.8 }}>
        <strong>Dispatched actions</strong> (A2UI → host):{" "}
        {actions.length === 0 ? (
          <em>none yet — press the confirm button in the dialog</em>
        ) : (
          <code>
            {actions
              .map((a: any) => `${a?.name ?? "?"} (from ${a?.sourceComponentId ?? "?"})`)
              .join(", ")}
          </code>
        )}
      </section>
    </main>
  );
}
