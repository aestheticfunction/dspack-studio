"use client";

/**
 * Restyle it (FM-5): the ACTIVE scenario's surface, spun through the Astryx
 * themes. The surface is the final A2UI state of the scenario's default
 * recording — reconstructed through the same reducer the replay canvas uses —
 * so the structure, events, and audit never change here; only the theme does.
 */
import { useEffect, useMemo, useState } from "react";
import { Theme } from "@astryxdesign/core";
import { A2uiCanvas, type A2uiClientAction } from "@dspack-studio/a2ui-ingest";
import { astryxRegistry, themes, themeNames, type ThemeName } from "@dspack-studio/astryx-renderers";
import type { Scenario } from "@dspack-studio/scenarios";
import { a2uiMessagesAt, parseFixture } from "@dspack-studio/replay";
import catalogJson from "@dspack-studio/contracts/out/catalog.v0_9_1.json";
import { btnClass } from "./ui";

export function RestyleView({ scenario }: { scenario: Scenario }) {
  const [actions, setActions] = useState<A2uiClientAction[]>([]);
  const [themeName, setThemeName] = useState<ThemeName>("default");
  const [mode, setMode] = useState<"light" | "dark">("light");

  // The scenario's canonical surface: its default recording's ending.
  const messages = useMemo(() => {
    const ref = scenario.fixtures[0];
    if (!ref) return [];
    const fixture = parseFixture(ref.fixture);
    return a2uiMessagesAt({ events: fixture.events }, fixture.events.length - 1);
  }, [scenario]);

  // A new scenario is a new surface: its predecessor's actions are not its own.
  useEffect(() => setActions([]), [scenario.id]);

  const theme = themes[themeName];

  if (messages.length === 0) {
    return (
      <p data-testid="restyle-empty" style={{ fontSize: 13, color: "var(--fg-dim)" }}>
        No recorded surface for this scenario yet: run it live and download a session, or pick a scenario with a
        recording.
      </p>
    );
  }

  const canvas = (
    <A2uiCanvas
      key={scenario.id}
      catalog={catalogJson as any}
      registry={astryxRegistry}
      messages={messages}
      onAction={(action) => setActions((prev) => [...prev, action])}
    />
  );

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
        {themeNames.map((name) => (
          <button key={name} onClick={() => setThemeName(name)} className={btnClass(name === themeName)}>
            {name}
          </button>
        ))}
        <button
          onClick={() => setMode((m) => (m === "light" ? "dark" : "light"))}
          className={btnClass()}
          style={{ marginLeft: "auto" }}
        >
          {mode === "light" ? "dark mode" : "light mode"}
        </button>
      </div>

      {/* The artboard: a deliberately light surface framed by the dark
          chrome. colorScheme pins Astryx's light-dark() tokens to the
          same resolution the studio always shipped, independent of the
          visitor's OS scheme; the <Theme> wrapper inside still owns its
          own subtree when the dial is used. */}
      <section data-canvas style={{ border: "1px dashed var(--line)", borderRadius: 6, padding: 24, background: "#fff", colorScheme: "light", color: "#0f172a" }}>
        {theme ? (
          <Theme theme={theme as any} mode={mode}>
            {canvas}
          </Theme>
        ) : (
          canvas
        )}
      </section>

      <p data-testid="fm5-caption" style={{ fontSize: 13, color: "var(--fg-dim)", margin: "12px 0 0" }}>
        Nothing about this interface changed. Only the design system&apos;s theme did.
      </p>

      <section style={{ marginTop: 20, fontSize: 13, color: "var(--fg-dim)" }}>
        <strong>Dispatched actions</strong> (A2UI → host):{" "}
        {actions.length === 0 ? (
          <em>none yet: act on the surface above</em>
        ) : (
          <code>
            {actions.map((a: any) => `${a?.name ?? "?"} (from ${a?.sourceComponentId ?? "?"})`).join(", ")}
          </code>
        )}
      </section>
    </>
  );
}
