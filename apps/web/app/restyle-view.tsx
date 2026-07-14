"use client";

/**
 * Restyle it (FM-5 + FM-10): the ACTIVE scenario's surface, spun through the
 * Astryx themes — and, one level up, through a different design system
 * entirely. The surface is the final A2UI state of the scenario's default
 * recording, reconstructed through the same reducer the replay canvas uses,
 * so the structure, events, and audit never change here; only the pixels do.
 *
 * The design-system choice is shell-level state: selecting shadcn here also
 * swaps the replay/live/break canvases, and the receipt hash provably does
 * not change (asserted by e2e).
 */
import { useEffect, useMemo, useState } from "react";
import { Theme } from "@astryxdesign/core";
import { A2uiCanvas, type A2uiClientAction } from "@dspack-studio/a2ui-ingest";
import { themes, themeNames, type ThemeName } from "@dspack-studio/astryx-renderers";
import type { Scenario } from "@dspack-studio/scenarios";
import { a2uiMessagesAt, parseFixture } from "@dspack-studio/replay";
import catalogJson from "@dspack-studio/contracts/out/catalog.v0_9_1.json";
import { canvasScopeProps, designSystemIds, DESIGN_SYSTEMS, type DesignSystemId } from "./design-system";
import { btnClass } from "./ui";

export function RestyleView({
  scenario,
  designSystem,
  onDesignSystemChange,
}: {
  scenario: Scenario;
  designSystem: DesignSystemId;
  onDesignSystemChange: (id: DesignSystemId) => void;
}) {
  const [actions, setActions] = useState<A2uiClientAction[]>([]);
  const [themeName, setThemeName] = useState<ThemeName>("default");
  const [mode, setMode] = useState<"light" | "dark">("light");
  const system = DESIGN_SYSTEMS[designSystem];

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
      key={`${scenario.id}:${designSystem}`}
      catalog={catalogJson as any}
      registry={system.registry}
      messages={messages}
      onAction={(action) => setActions((prev) => [...prev, action])}
    />
  );

  return (
    <>
      {/* FM-10: the design system is a plug-in above the theme dial. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>design system:</span>
        {designSystemIds.map((id) => (
          <button
            key={id}
            data-testid={`design-system-${id}`}
            onClick={() => onDesignSystemChange(id)}
            className={btnClass(id === designSystem)}
          >
            {DESIGN_SYSTEMS[id].label}
          </button>
        ))}
        <span data-testid="design-system-note" style={{ fontSize: 12, color: "var(--fg-dim)" }}>
          {system.note}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
        {designSystem === "astryx" &&
          themeNames.map((name) => (
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
          own subtree when the dial is used. The shadcn scope carries its
          own tokens and dark values under [data-design-system]. */}
      <section
        data-canvas
        {...canvasScopeProps(designSystem, mode)}
        style={{ border: "1px dashed var(--line)", borderRadius: 6, padding: 24, background: designSystem === "shadcn" && mode === "dark" ? "transparent" : "#fff", colorScheme: "light", color: "#0f172a" }}
      >
        {designSystem === "astryx" && theme ? (
          <Theme theme={theme as any} mode={mode}>
            {canvas}
          </Theme>
        ) : (
          canvas
        )}
      </section>

      <p data-testid="fm5-caption" style={{ fontSize: 13, color: "var(--fg-dim)", margin: "12px 0 0" }}>
        {designSystem === "astryx"
          ? "Nothing about this interface changed. Only the design system's theme did."
          : "Nothing about this interface changed. Only the design system did: same catalog, same events, same audit, same receipt."}
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
