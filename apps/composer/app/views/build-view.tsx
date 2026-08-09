"use client";

/**
 * Build — chat-driven creation from approved components (Phase 3 slice).
 *
 * Each turn: the ask → the streamed governed pipeline (attempts, S1–S3,
 * bounded repair, emit) → the surface rendered through the project's
 * trusted registry → explicit Accept / Refine. Refinement seeds the prior
 * surface and regenerates a COMPLETE surface through every gate; prior
 * turns stay in the thread for comparison and audit. Failures stay honest:
 * findings verbatim, and an ask that needs components the owner has not
 * approved is named as a VOCABULARY GAP (the future Component Workshop
 * hook), never silently invented.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { A2uiCanvas } from "@dspack-studio/a2ui-ingest";
import { wireframeRegistryFor } from "@dspack-studio/wireframe-renderers";
import { shadcnRegistry } from "@dspack-studio/shadcn-renderers";
import { buildFailure, canAcceptTurn, canRefineTurn } from "@dspack-studio/composer-core";
import type { BuildTurn } from "../state";
import { useComposer } from "../state";
import { browserEmit } from "../validation";

const GATE_COLOR: Record<string, string> = { PASS: "var(--ok)", FAIL: "var(--err)", SKIPPED: "var(--fg-dim)" };

/** Render one finished turn's surface through the trusted registry. */
function TurnCanvas({ turn }: { turn: BuildTurn }) {
  const { contract, profile, manifest } = useComposer();
  const emitted = useMemo(() => {
    if (!contract || !profile || !turn.progress.surface) return null;
    try {
      const result = browserEmit(contract, profile, [{ name: `build-${turn.id}`, surface: turn.progress.surface }]);
      const messages = result.surfaces[0]?.messages;
      return messages && messages.length ? { messages, catalog: result.catalog } : null;
    } catch {
      return null;
    }
  }, [contract, profile, turn.id, turn.progress.surface]);

  if (!emitted) return null;
  const registry = manifest?.previewRegistry === "shadcn" ? shadcnRegistry : wireframeRegistryFor(emitted.catalog as never);
  return (
    <div data-testid={`build-canvas-${turn.id}`} data-project-canvas="build" style={{ border: "1px solid var(--line)", borderRadius: 2, padding: 12, marginTop: 8 }}>
      <A2uiCanvas catalog={emitted.catalog as never} registry={registry} messages={emitted.messages as never} onAction={() => undefined} />
    </div>
  );
}

function TurnBlock({ turn }: { turn: BuildTurn }) {
  const { acceptBuildTurn, buildBusy, busy, mode } = useComposer();
  // Blank by default: identity is minted from the contract ON DISK, so a
  // reload or a second tab can never collide with saved work (#42).
  const [exampleId, setExampleId] = useState("");
  const locked = buildBusy || busy !== null;
  // The Accept button unmounts on success; a keyboard user's focus must
  // land on the confirmation, never fall to the document body.
  const accepted = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (turn.accepted) accepted.current?.focus();
  }, [turn.accepted]);

  return (
    <article data-testid={`build-turn-${turn.id}`} style={{ borderTop: "1px solid var(--line)", padding: "14px 0" }} aria-label={`Turn ${turn.id}: ${turn.prompt}`}>
      <p style={{ fontSize: 13, color: "var(--fg)" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color: "var(--fg-dim)" }}>
          {turn.refinement ? "refine" : "ask"} · {turn.intent} · {turn.modelRef}
        </span>
        <br />
        {turn.prompt}
      </p>

      <ol data-testid={`build-pipeline-${turn.id}`} style={{ listStyle: "none", padding: 0, fontSize: 12, fontFamily: "var(--mono)" }}>
        {turn.progress.attempts.map((attempt) => (
          <li key={attempt.index} style={{ padding: "3px 0" }}>
            attempt {attempt.index + 1}:{" "}
            {attempt.gates.map((g) => (
              <span key={g.gate} style={{ color: GATE_COLOR[g.status] ?? "var(--fg-body)", marginRight: 8 }} title={(g.errors ?? []).join("; ")}>
                {g.gate} {g.status}
              </span>
            ))}
            {attempt.repair && (
              <details style={{ marginTop: 2 }}>
                <summary style={{ cursor: "pointer", color: "var(--warn)" }}>repair sent</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "var(--fg-dim)", maxHeight: 160, overflow: "auto" }}>{attempt.repair}</pre>
              </details>
            )}
          </li>
        ))}
        {turn.progress.emit && <li style={{ color: "var(--info)" }}>emit: A-gates reported</li>}
        {turn.progress.outcome && (
          <li data-testid={`build-outcome-${turn.id}`} style={{ color: turn.progress.outcome === "passed" ? "var(--ok)" : "var(--err)" }}>
            outcome: {turn.progress.outcome}
          </li>
        )}
        {turn.progress.error && <li style={{ color: "var(--err)" }}>{turn.progress.error}</li>}
      </ol>

      {(() => {
        const failure = buildFailure(turn.progress);
        if (!failure) return null;
        return (
          <div data-testid={`build-failure-${turn.id}`} style={{ border: "1px solid var(--err)", borderRadius: 2, padding: "8px 10px", marginTop: 8 }}>
            <p style={{ fontSize: 13, color: "var(--err)", margin: 0 }}>{failure.headline}</p>
            <p style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--fg-dim)", margin: "2px 0 6px" }}>
              stopped at {failure.stoppedAt}
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12 }}>
              {failure.reasons.map((reason, i) => (
                <li key={i} style={{ padding: "3px 0", borderTop: i ? "1px solid var(--line-soft)" : undefined }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--warn)" }}>
                    {[reason.gate, reason.code].filter(Boolean).join(" ")}
                    {reason.target ? ` · ${reason.target}` : ""}
                  </span>
                  <br />
                  <span style={{ color: "var(--fg-body)" }}>{reason.message}</span>
                  {reason.rationale && (
                    <>
                      <br />
                      <span data-testid={`build-rationale-${turn.id}`} style={{ color: "var(--fg-dim)", fontStyle: "italic" }}>
                        Why this rule exists: {reason.rationale}
                      </span>
                    </>
                  )}
                </li>
              ))}
              {failure.reasons.length === 0 && (
                <li style={{ color: "var(--fg-dim)" }}>No structured reason was reported; the full audit report is below.</li>
              )}
            </ul>
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--fg-dim)" }}>full audit report</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 10, color: "var(--fg-dim)", maxHeight: 220, overflow: "auto" }}>
                {JSON.stringify(turn.progress.report ?? {}, null, 1)}
              </pre>
            </details>
          </div>
        );
      })()}

      {turn.acceptFindings && turn.acceptFindings.length > 0 && (
        <div data-testid={`build-accept-findings-${turn.id}`} style={{ border: "1px solid var(--err)", borderRadius: 2, padding: "8px 10px", marginTop: 8 }}>
          <p style={{ fontSize: 13, color: "var(--err)", margin: "0 0 4px" }}>
            The agent refused to save this surface as a worked example.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12 }}>
            {turn.acceptFindings.map((f, i) => (
              <li key={i} style={{ padding: "2px 0" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--warn)" }}>
                  {f.gate} {f.code}
                  {f.target ? ` · ${f.target}` : ""}
                </span>{" "}
                <span style={{ color: "var(--fg-body)" }}>{f.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {turn.gaps.length > 0 && (
        <p data-testid={`build-gap-${turn.id}`} style={{ fontSize: 12, color: "var(--warn)", border: "1px dashed var(--warn)", borderRadius: 2, padding: "6px 10px" }}>
          Vocabulary gap: this ask needs {turn.gaps.map((g) => `'${g}'`).join(", ")}, which no approved component provides. Building
          never invents components — recorded here as a gap for a future Component Workshop; the Catalog is where the
          vocabulary grows.
        </p>
      )}

      <TurnCanvas turn={turn} />

      {canAcceptTurn(turn.progress) && !turn.accepted && mode === "agent" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
          <input
            value={exampleId}
            onChange={(e) => setExampleId(e.target.value)}
            placeholder="(agent mints a free id)"
            aria-label={`Example id for turn ${turn.id} — leave blank to let the agent mint a collision-free id`}
            style={{ fontFamily: "var(--mono)", fontSize: 12, background: "var(--bg-1)", border: "1px solid var(--line)", color: "var(--fg)", padding: "5px 8px", borderRadius: 2 }}
            data-testid={`build-example-id-${turn.id}`}
          />
          <button
            className="st-btn"
            disabled={locked}
            aria-label={`Accept turn ${turn.id} as a worked example${exampleId ? ` with id ${exampleId}` : ""}`}
            onClick={() => void acceptBuildTurn(turn.id, exampleId.trim() || undefined)}
            data-testid={`build-accept-${turn.id}`}
          >
            Accept as worked example
          </button>
        </div>
      )}
      {canAcceptTurn(turn.progress) && !turn.accepted && mode !== "agent" && (
        <p data-testid={`build-accept-note-${turn.id}`} style={{ fontSize: 12, color: "var(--fg-dim)", marginTop: 10 }}>
          This surface passed every gate in your browser. Accepting it as a reusable worked example writes to a project on
          disk — connect the local agent (<code>pnpm --filter agent dev</code>) to keep it and have it seed future
          generation for <code>{turn.intent}</code>.
        </p>
      )}
      {turn.accepted && (
        <p ref={accepted} tabIndex={-1} data-testid={`build-accepted-${turn.id}`} style={{ fontSize: 12, color: "var(--ok)" }}>
          Accepted as <code>{turn.accepted}</code> — now part of this intent's few-shot corpus.
        </p>
      )}
    </article>
  );
}

export function BuildView() {
  const { mode, agentUp, contract, readiness, buildTurns, buildBusy, buildModels, runBuild } = useComposer();
  const [prompt, setPrompt] = useState("");
  const [modelRef, setModelRef] = useState("scripted");
  const intents = ((contract?.intents ?? []) as Array<{ id: string }>).map((i) => i.id);
  const [intent, setIntent] = useState<string>("");
  // In the hosted demo (no agent), default to an intent that already has a
  // worked example so the scripted path is runnable on first landing. Agent
  // mode keeps the original default (intents[0]) — a model runs for any intent.
  const intentsWithExample = new Set(((contract?.examples ?? []) as Array<{ intent?: string }>).map((e) => e.intent));
  const runnableDefault = mode !== "agent" ? intents.find((i) => intentsWithExample.has(i)) : undefined;
  const activeIntent = intent || runnableDefault || intents[0] || "";
  const streamStatus = useRef<HTMLParagraphElement>(null);
  const canRefine = buildTurns.some((t) => canRefineTurn(t.progress));
  // Scripted replays THIS intent's own example; a model runs without few-shot
  // context. Either way the absence is stated, never papered over (#43).
  const examplesForIntent = ((contract?.examples ?? []) as Array<{ intent?: string }>).filter((e) => e.intent === activeIntent).length;

  const submit = (refine: boolean) => {
    if (!prompt.trim() || buildBusy) return;
    void runBuild({ prompt: prompt.trim(), intent: activeIntent, modelRef, refine });
    setPrompt("");
  };

  if (!readiness.ready) {
    return (
      <section>
        <h2 style={{ fontFamily: "var(--hl)", fontSize: 15, textTransform: "uppercase", color: "var(--fg)" }}>Build</h2>
        <p style={{ fontSize: 13, color: "var(--warn)" }} data-testid="build-not-ready">
          Not ready to build yet: {readiness.reason}
        </p>
        <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>Set up your design system in the Catalog views, then build with it.</p>
      </section>
    );
  }

  return (
    <section style={{ maxWidth: 860 }}>
      <h2 style={{ fontFamily: "var(--hl)", fontSize: 15, textTransform: "uppercase", color: "var(--fg)" }}>Build</h2>
      <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
        Describe an interface; it is generated from this project's approved components only, validated in front of you,
        and rendered through the trusted registry.{" "}
        <span data-testid="build-privacy">
          Provider: <code>{modelRef}</code> —{" "}
          {modelRef === "scripted"
            ? "deterministic, zero model calls; nothing leaves this machine."
            : modelRef.startsWith("ollama:")
              ? "local Ollama; contract-derived context and your ask go to your local model only."
              : "keys live in the agent's environment; contract-derived context and your ask go to the provider."}
        </span>
      </p>

      {mode !== "agent" && (
        <p
          data-testid="build-hosted-note"
          style={{ fontSize: 12, color: "var(--fg-body)", border: "1px solid var(--line)", borderRadius: 2, padding: "8px 10px", margin: "10px 0" }}
        >
          You&rsquo;re building in the hosted demo: the governed pipeline runs <em>entirely in this browser</em> against
          the shipped demo project — no install, and nothing leaves your machine. <code>scripted</code> replays each
          intent&rsquo;s worked example so you can watch a surface get proposed, checked against S1&ndash;S3, repaired,
          and rendered. To generate with a live model, or to build against <em>your own</em> component library, run the
          local agent (<code>pnpm --filter agent dev</code>) and connect a project
          {agentUp ? " — detected, connect from Project" : "."}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "10px 0" }}>
        <label style={{ fontSize: 12, color: "var(--fg-dim)" }}>
          intent{" "}
          <select value={activeIntent} onChange={(e) => setIntent(e.target.value)} data-testid="build-intent" aria-label="Intent" style={{ fontFamily: "var(--mono)", fontSize: 12, background: "var(--bg-1)", color: "var(--fg)", border: "1px solid var(--line)", padding: "4px 6px" }}>
            {intents.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--fg-dim)" }}>
          model{" "}
          <select value={modelRef} onChange={(e) => setModelRef(e.target.value)} data-testid="build-model" aria-label="Model" style={{ fontFamily: "var(--mono)", fontSize: 12, background: "var(--bg-1)", color: "var(--fg)", border: "1px solid var(--line)", padding: "4px 6px" }}>
            {buildModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      {examplesForIntent === 0 && (
        <p data-testid="build-no-fewshot" style={{ fontSize: 12, color: "var(--warn)" }}>
          No worked example for <code>{activeIntent}</code> yet. <code>scripted</code> replays this intent's own example, so it
          cannot run; a model generates from the scoped contract with no few-shot context. Accepting a build here creates the
          first one.
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit(false)}
          placeholder="Describe the interface to build…"
          aria-label="Describe the interface to build"
          style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 13, background: "var(--bg-1)", border: "1px solid var(--line)", color: "var(--fg)", padding: "8px 10px", borderRadius: 2 }}
          data-testid="build-prompt"
        />
        <button className="st-btn" disabled={buildBusy || !prompt.trim()} onClick={() => submit(false)} aria-label="Build a new surface from this ask" data-testid="build-run">
          Build
        </button>
        <button
          className="st-btn st-btn--dashed"
          disabled={buildBusy || !prompt.trim() || !canRefine}
          onClick={() => submit(true)}
          aria-label="Refine the previous surface with this ask"
          title={canRefine ? "Sends the previous surface plus this instruction; regenerates completely and re-runs every gate" : "Run a build first"}
          data-testid="build-refine"
        >
          Refine
        </button>
      </div>

      <p ref={streamStatus} role="status" aria-live="polite" data-testid="build-status" style={{ fontSize: 12, color: buildBusy ? "var(--warn)" : "var(--fg-dim)", minHeight: 18 }}>
        {buildBusy
          ? "generating — attempts, gates, and repairs stream below"
          : buildTurns.length
            ? `${buildTurns.length} turn(s); latest outcome: ${buildTurns.at(-1)?.progress.outcome ?? buildTurns.at(-1)?.progress.status}`
            : "no turns yet"}
      </p>

      <div>
        {buildTurns.map((turn) => (
          <TurnBlock key={turn.id} turn={turn} />
        ))}
      </div>
    </section>
  );
}
