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
import { registryFor, canvasScopeFor } from "../registries";
import { buildFailure, canAcceptTurn, canRefineTurn, intentLabel } from "@dspack-studio/composer-core";
import type { BuildTurn } from "../state";
import { useComposer } from "../state";
import { Eyebrow } from "../ui";
import { browserEmit } from "../validation";

const GATE_COLOR: Record<string, string> = { PASS: "var(--ok)", FAIL: "var(--err)", SKIPPED: "var(--fg-dim)" };

/** Governance in plain language — S1/S2/S3 are implementation codes; a first-time
 *  user reads outcomes. The deterministic evidence is unchanged; the raw gates,
 *  rule ids, and rationales stay one expander away (advanced detail). */
const GATE_MEANING: Record<string, string> = {
  S1: "Structurally valid",
  S2: "Uses only approved components",
  S3: "Follows your design-system rules",
};

/** One-line, honest privacy/provenance note per provider. */
function providerCopy(modelRef: string): string {
  if (modelRef === "scripted") return "deterministic, zero model calls — nothing leaves this machine.";
  if (modelRef === "hosted-ai") return "managed Claude Haiku via the governed AI Gateway (no API key in your browser); every proposal is validated here before you see it.";
  if (modelRef.startsWith("ollama:")) return "your local Ollama model — nothing leaves your machine.";
  if (modelRef.startsWith("openai:")) return "your OpenAI-compatible endpoint through the agent — any key stays on your machine, never in the browser.";
  return "keys live in the agent's environment; contract-derived context and your goal go to the provider.";
}

/** A friendly one-line provider label, e.g. "Local · qwen3:30b". */
function providerLabel(ref: string): string {
  if (ref === "hosted-ai") return "Hosted · Claude Haiku";
  if (ref === "scripted") return "Scripted";
  if (ref.startsWith("ollama:")) return `Local · ${ref.slice("ollama:".length)}`;
  if (ref.startsWith("openai:")) return `Local · ${ref.slice("openai:".length)}`;
  return ref;
}

/** The translated governance summary for a settled turn. */
function GateSummary({ turn }: { turn: BuildTurn }) {
  const last = turn.progress.attempts.at(-1);
  if (!turn.progress.outcome || !last) return null;
  const byGate = new Map(last.gates.map((g) => [g.gate, g.status] as const));
  const passed = turn.progress.outcome === "passed";
  const row = (gate: string) => {
    const status = byGate.get(gate) ?? "SKIPPED";
    const mark = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : "–";
    const color = status === "PASS" ? "var(--ok)" : status === "FAIL" ? "var(--err)" : "var(--fg-dim)";
    return (
      <span key={gate} style={{ color, marginRight: 14, fontSize: 12 }}>
        {mark} {GATE_MEANING[gate]}
      </span>
    );
  };
  return (
    <div data-testid={`build-gate-summary-${turn.id}`} style={{ margin: "8px 0", display: "flex", flexWrap: "wrap", alignItems: "center" }}>
      {["S1", "S2", "S3"].map(row)}
      {passed && turn.progress.emit && <span style={{ color: "var(--ok)", fontSize: 12, marginRight: 14 }}>✓ Renders in your design system</span>}
    </div>
  );
}

/** The inferred governed context, shown AFTER the goal (never selected before it). */
function ContextChip({ turn, onChange }: { turn: BuildTurn; onChange?: () => void }) {
  const { contract } = useComposer();
  if (turn.planPending) {
    return (
      <p data-testid={`build-plan-pending-${turn.id}`} style={{ fontSize: 12, color: "var(--warn)", margin: "2px 0" }}>
        Understanding your request…
      </p>
    );
  }
  if (!turn.plan || !turn.intent) return null;
  const label = intentLabel((contract ?? {}) as Record<string, unknown>, turn.intent);
  const also = turn.plan.alsoConsidered.map((i) => intentLabel((contract ?? {}) as Record<string, unknown>, i));
  return (
    <p data-testid={`build-context-${turn.id}`} style={{ fontSize: 12, color: "var(--fg-dim)", margin: "2px 0 8px" }}>
      <span style={{ fontFamily: "var(--mono)", textTransform: "uppercase", fontSize: 11 }}>Governance context:</span>{" "}
      <span style={{ color: "var(--info)" }}>{label}</span>
      {also.length > 0 && <span> (also touches {also.join(", ")})</span>}
      {turn.plan.reason && <span> — {turn.plan.reason}</span>}
      {turn.modelRef === "scripted" && !turn.refinement && (
        <span style={{ display: "block", color: "var(--warn)", marginTop: 2 }}>
          Scripted mode replays a representative example for this context — switch to a hosted or local model to generate
          for your exact words.
        </span>
      )}
      {onChange && (
        <>
          {" "}
          <button
            type="button"
            className="st-btn st-btn--dashed"
            style={{ fontSize: 11, padding: "1px 6px" }}
            onClick={onChange}
            data-testid={`build-context-change-${turn.id}`}
          >
            Change
          </button>
        </>
      )}
    </p>
  );
}

/** A vocabulary gap: the goal is understood, but the approved catalog cannot
 *  express it. Surfaced conversationally (never a silent generation failure),
 *  and framed as the bridge toward catalog evolution — without inventing a
 *  component, which would break the governance guarantee. */
function VocabGap({ turn }: { turn: BuildTurn }) {
  const cap = turn.plan?.missingCapability;
  return (
    <div data-testid={`build-vocab-gap-${turn.id}`} style={{ border: "1px dashed var(--warn)", borderRadius: 2, padding: "10px 12px", marginTop: 8 }}>
      <p style={{ fontSize: 13, color: "var(--warn)", margin: 0 }}>Your current catalog can&rsquo;t express this yet.</p>
      <p style={{ fontSize: 13, color: "var(--fg-body)", margin: "6px 0 0" }}>
        This needs {cap ? <strong>{cap}</strong> : "a capability"}, and no approved component provides it. The Composer
        never invents components — that would break the guarantee that everything it builds is governed. To build this,
        the catalog has to grow: find a real component for it, map its semantics, and admit it under governance.
      </p>
      <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: "6px 0 0" }}>
        Evolving the catalog is the next authoring loop. In the meantime, try describing the outcome differently, or pick
        a goal your approved components already cover.
      </p>
    </div>
  );
}

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
  // Native design-system rendering is the default; wireframe is the universal
  // fallback/inspection mode. The project's previewRegistry picks which — no
  // per-design-system branching lives here (see ../registries).
  const registryId = manifest?.previewRegistry;
  const registry = registryFor(registryId, emitted.catalog);
  const scope = canvasScopeFor(registryId);
  return (
    <div
      data-testid={`build-canvas-${turn.id}`}
      data-project-canvas="build"
      {...scope.attrs}
      style={{ border: "1px solid var(--line)", borderRadius: 4, padding: 16, marginTop: 8, background: scope.background }}
    >
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
          {turn.refinement ? "refine" : "goal"} · {turn.modelRef}
        </span>
        <br />
        {turn.prompt}
      </p>

      <ContextChip turn={turn} />

      {turn.kind === "vocab-gap" ? (
        <VocabGap turn={turn} />
      ) : (
        <>
          <GateSummary turn={turn} />
          <details style={{ marginBottom: 4 }}>
            <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--fg-dim)" }}>validation detail (gates, repairs, emit)</summary>
            <ol data-testid={`build-pipeline-${turn.id}`} style={{ listStyle: "none", padding: "4px 0 0", fontSize: 12, fontFamily: "var(--mono)" }}>
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
          </details>
        </>
      )}

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
  const { mode, agentUp, contract, readiness, buildTurns, buildBusy, buildModels, selectableModels, runBuild, activeModel, setActiveModel } =
    useComposer();
  const [prompt, setPrompt] = useState("");
  // "" = auto: the governed context is INFERRED from the goal. A specific value
  // is an advanced override for catalog authors — never the normal prerequisite.
  const [intentOverride, setIntentOverride] = useState<string>("");
  const intents = ((contract?.intents ?? []) as Array<{ id: string }>).map((i) => i.id);
  const streamStatus = useRef<HTMLParagraphElement>(null);
  const canRefine = buildTurns.some((t) => canRefineTurn(t.progress));

  const submit = (refine: boolean) => {
    if (!prompt.trim() || buildBusy) return;
    void runBuild({ goal: prompt.trim(), modelRef: activeModel, refine, ...(intentOverride ? { intentOverride } : {}) });
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
    <section style={{ maxWidth: 840 }}>
      <Eyebrow>Build</Eyebrow>
      <p className="af-lead" style={{ marginTop: 0, fontSize: 15 }}>
        Describe what you want, in your own words. Composer works out the governed context, builds it from this
        project&rsquo;s approved components only, checks it in front of you, and renders it in your design system.
      </p>

      <div style={{ display: "flex", gap: 8, margin: "20px 0 8px" }}>
        <input
          className="af-input af-input--mono"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit(false)}
          placeholder="e.g. a form to invite teammates by email · a confirmation for deleting a project · a table of orders"
          aria-label="Describe what you want to build"
          style={{ flex: 1 }}
          data-testid="build-prompt"
        />
        <button className="st-btn st-btn--primary st-btn--lg" disabled={buildBusy || !prompt.trim()} onClick={() => submit(false)} aria-label="Build a governed surface for this goal" data-testid="build-run">
          Build
        </button>
        <button
          className="st-btn st-btn--dashed st-btn--lg"
          disabled={buildBusy || !prompt.trim() || !canRefine}
          onClick={() => submit(true)}
          aria-label="Refine the previous surface with this instruction"
          title={canRefine ? "Applies this instruction to the previous surface; re-runs every gate" : "Build something first"}
          data-testid="build-refine"
        >
          Refine
        </button>
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", margin: "2px 0 8px", fontSize: 12, color: "var(--fg-dim)" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="af-label" style={{ margin: 0 }}>
            provider
          </span>
          <select value={activeModel} onChange={(e) => setActiveModel(e.target.value)} data-testid="build-model" aria-label="Provider" style={{ fontFamily: "var(--mono)", fontSize: 12, background: "var(--bg-1)", color: "var(--fg)", border: "1px solid var(--line)", padding: "4px 6px", borderRadius: 2 }}>
            {selectableModels.map((m) => (
              <option key={m} value={m}>
                {providerLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="Advanced: force a governed context instead of inferring it from your goal.">
          <span className="af-label" style={{ margin: 0 }}>
            context
          </span>
          <select value={intentOverride} onChange={(e) => setIntentOverride(e.target.value)} data-testid="build-intent" aria-label="Governance context (advanced override)" style={{ fontFamily: "var(--mono)", fontSize: 12, background: "var(--bg-1)", color: "var(--fg)", border: "1px solid var(--line)", padding: "4px 6px", borderRadius: 2 }}>
            <option value="">auto — inferred from your goal</option>
            {intents.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
        <span data-testid="build-privacy">
          <code>{activeModel}</code>: {providerCopy(activeModel)}
        </span>
      </div>

      {mode !== "agent" && (
        <p
          data-testid="build-hosted-note"
          style={{ fontSize: 12, color: "var(--fg-body)", border: "1px solid var(--line)", borderRadius: 2, padding: "8px 10px", margin: "6px 0" }}
        >
          You&rsquo;re in the hosted demo — no install.{" "}
          {buildModels.includes("hosted-ai") ? (
            <>
              <code>hosted-ai</code> generates for your goal with managed Claude Haiku; the deterministic gates and
              rendering run <em>entirely in this browser</em>.
            </>
          ) : (
            <>
              the governed pipeline runs <em>entirely in this browser</em> against the shipped demo project.
            </>
          )}{" "}
          To build against <em>your own</em> component library, run the local agent (<code>pnpm --filter agent dev</code>)
          and connect a project{agentUp ? " — detected, connect from Project" : "."}
        </p>
      )}

      <p ref={streamStatus} role="status" aria-live="polite" data-testid="build-status" style={{ fontSize: 12, color: buildBusy ? "var(--warn)" : "var(--fg-dim)", minHeight: 18 }}>
        {buildBusy
          ? "working — understanding your goal, then building and checking it"
          : buildTurns.length
            ? buildTurns.at(-1)?.kind === "vocab-gap"
              ? `${buildTurns.length} build(s); latest: needs a new component`
              : `${buildTurns.length} build(s); latest outcome: ${buildTurns.at(-1)?.progress.outcome ?? buildTurns.at(-1)?.progress.status}`
            : "no builds yet"}
      </p>

      <div>
        {buildTurns.map((turn) => (
          <TurnBlock key={turn.id} turn={turn} />
        ))}
      </div>
    </section>
  );
}
