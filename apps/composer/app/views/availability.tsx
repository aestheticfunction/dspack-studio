"use client";
/**
 * Whether this page can generate from a person's words right now, said
 * BEFORE they type (M0 trust fix b). When the only provider is the scripted
 * twin, every build is a demo replay of a saved surface; a newcomer must not
 * find that out from the result.
 */
import { useComposer } from "../state";

export function GenerationAvailability({ where }: { where: "hub" | "build" }) {
  const { generationAvailability, agentUp } = useComposer();
  if (generationAvailability !== "replay-only") return null;
  return (
    <p
      role="note"
      data-testid={`availability-${where}`}
      style={{ fontSize: 13, color: "var(--fg-body)", border: "1px solid var(--warn)", borderRadius: 2, padding: "8px 10px", margin: "10px 0", maxWidth: 720 }}
    >
      <strong style={{ color: "var(--warn)" }}>AI generation is not available here right now.</strong> Builds replay
      surfaces your project already has, so they show how the checks work but do not answer what you type.{" "}
      {agentUp
        ? "To generate from your own words, configure a local model in Settings."
        : "To generate from your own words, connect a local model through the local agent (Settings)."}
    </p>
  );
}
