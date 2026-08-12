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
import { buildFailure, canAcceptTurn, canRefineTurn, intentLabel, type FlowPlan } from "@dspack-studio/composer-core";
import { mintStepId, nextFlowId, type StepBinding } from "../flows";
import { planFlow } from "../planning";
import type { BuildTurn, FlowBuildState } from "../state";
import { useComposer } from "../state";
import { blockingFindings, surfaceEntriesById, surfaceTitle } from "../surface-identity";
import { Eyebrow } from "../ui";
import { browserEmit } from "../validation";

const GATE_COLOR: Record<string, string> = { PASS: "var(--ok)", FAIL: "var(--err)", SKIPPED: "var(--fg-dim)" };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Spacing between sequential flow-step builds (the P3a burst finding): the
 *  driver NEVER fires two builds concurrently, and model providers get 8s of
 *  air between steps. Scripted is deterministic with zero model calls — no
 *  provider to protect — so it runs back-to-back (still strictly sequential). */
const stepSpacingMs = (modelRef: string): number => (modelRef === "scripted" ? 0 : 8000);

const field = {
  fontFamily: "var(--mono)",
  fontSize: 12,
  background: "var(--bg-1)",
  border: "1px solid var(--line)",
  color: "var(--fg)",
  padding: "4px 6px",
  borderRadius: 2,
} as const;

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
          Scripted mode replays a surface this project already has for this context — switch to a hosted or local model
          to generate for your exact words.
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

function TurnBlock({ turn, intoFlowStep }: { turn: BuildTurn; intoFlowStep?: StepBinding }) {
  const { acceptBuildTurn, buildBusy, busy, mode, isExample, contract } = useComposer();
  // What the saved surface is CALLED — read back from the project's own
  // record, so the confirmation says exactly what Preview and Surfaces say.
  const savedTitle = turn.accepted
    ? surfaceTitle(surfaceEntriesById(contract?.examples).get(turn.accepted), turn.accepted, 64)
    : "";
  // Accept targeting: the header "flow step" select (an explicit choice)
  // wins; otherwise a "Build a flow" turn is PRE-TARGETED to the step it was
  // built for (Phase C driver hint). Plain accepts stay plain.
  const binding =
    intoFlowStep ?? (turn.flowStepHint ? { flowId: turn.flowStepHint.flowId, stepId: turn.flowStepHint.stepId } : undefined);
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
                  {attempt.representability?.pass === false && (
                    <span
                      data-testid={`build-representability-${turn.id}-${attempt.index}`}
                      style={{ color: GATE_COLOR.FAIL, marginRight: 8 }}
                      title={attempt.representability.refusal ?? ""}
                    >
                      representability FAIL
                    </span>
                  )}
                  {attempt.repair && (
                    <details style={{ marginTop: 2 }}>
                      <summary style={{ cursor: "pointer", color: "var(--warn)" }}>
                        repair sent{attempt.representability?.pass === false ? " — representability" : ""}
                      </summary>
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
            This surface was refused — it is not saved to your project.
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

      {canAcceptTurn(turn.progress) && !turn.accepted && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={exampleId}
              onChange={(e) => setExampleId(e.target.value)}
              placeholder="(an id is minted for you)"
              aria-label={`Surface id for turn ${turn.id} — leave blank to mint a collision-free id`}
              style={{ fontFamily: "var(--mono)", fontSize: 12, background: "var(--bg-1)", border: "1px solid var(--line)", color: "var(--fg)", padding: "5px 8px", borderRadius: 2 }}
              data-testid={`build-example-id-${turn.id}`}
            />
            <button
              className="st-btn"
              disabled={locked}
              aria-label={`Accept turn ${turn.id} into the project${exampleId ? ` with id ${exampleId}` : ""}`}
              onClick={() => void acceptBuildTurn(turn.id, exampleId.trim() || undefined, binding)}
              data-testid={`build-accept-${turn.id}`}
            >
              Add to project
            </button>
          </div>
          <p data-testid={`build-accept-note-${turn.id}`} style={{ fontSize: 12, color: "var(--fg-dim)", marginTop: 6 }}>
            {mode === "agent"
              ? "Saves this surface into your repository's contract on disk."
              : isExample
                ? "Kept for this session only — duplicate this example into your projects to keep what you build."
                : "Saves this surface to your project in your browser — it appears in Preview, Surfaces, and any flow you compose, and it becomes context the next build learns from."}
            {!intoFlowStep && turn.flowStepHint && (
              <> Accepting also points flow step &ldquo;{turn.flowStepHint.title}&rdquo; at this surface.</>
            )}
          </p>
        </div>
      )}
      {turn.accepted && (
        <p ref={accepted} tabIndex={-1} data-testid={`build-accepted-${turn.id}`} style={{ fontSize: 12, color: "var(--ok)" }}>
          Saved as &ldquo;{savedTitle}&rdquo; <code>{turn.accepted}</code>
          {turn.acceptedIntoStep && <> — flow step &ldquo;{turn.acceptedIntoStep}&rdquo; now shows this surface</>} — it is one of
          your project&rsquo;s surfaces, and context the next build learns from.
        </p>
      )}
    </article>
  );
}

export function BuildView({ onNavigate }: { onNavigate?: (view: "surfaces" | "validate") => void } = {}) {
  const {
    mode,
    agentUp,
    contract,
    emit,
    readiness,
    buildTurns,
    buildBusy,
    buildModels,
    selectableModels,
    runBuild,
    activeModel,
    setActiveModel,
    flows,
    saveFlows,
    flowComposition,
    setFlowComposition,
  } = useComposer();
  const [prompt, setPrompt] = useState("");
  // "" = auto: the governed context is INFERRED from the goal. A specific value
  // is an advanced override for catalog authors — never the normal prerequisite.
  const [intentOverride, setIntentOverride] = useState<string>("");
  // "" = accept normally. "<flowId>/<stepId>" = the NEXT accept also re-binds
  // that flow step to the minted surface (P4 Phase B). Generation itself is
  // untouched — this is an ACCEPT-time affordance on the intent-select pattern.
  const [intoStepKey, setIntoStepKey] = useState<string>("");
  /* ---- "Build a flow" (P4 Phase C) — OPT-IN; the default single-surface
     path renders and behaves exactly as before until the toggle.

     The mode, the goal, the plan and the plan's per-step build state live in
     the PROVIDER, not here: this view unmounts on every navigation, and the
     product's own pending-step copy sends people away mid-composition ("build
     it from Build and accept into this step"). Held locally, that round trip
     destroyed the plan and re-planning minted a second flow. `planBusy` stays
     local on purpose — it is a transient in-flight flag, and the plan it is
     waiting on lands in the provider either way. ---- */
  const { mode: buildMode, goal: flowGoal, plan: flowPlan, build: flowBuild } = flowComposition;
  const setBuildMode = (mode: "surface" | "flow") => setFlowComposition((c) => ({ ...c, mode }));
  const setFlowGoal = (goal: string) => setFlowComposition((c) => ({ ...c, goal }));
  const setFlowPlan = (next: FlowPlan | null | ((prev: FlowPlan | null) => FlowPlan | null)) =>
    setFlowComposition((c) => ({ ...c, plan: typeof next === "function" ? next(c.plan) : next }));
  const setFlowBuild = (
    next: FlowBuildState | null | ((prev: FlowBuildState | null) => FlowBuildState | null),
  ) => setFlowComposition((c) => ({ ...c, build: typeof next === "function" ? next(c.build) : next }));
  const [planBusy, setPlanBusy] = useState(false);
  const intents = ((contract?.intents ?? []) as Array<{ id: string }>).map((i) => i.id);
  const streamStatus = useRef<HTMLParagraphElement>(null);
  const canRefine = buildTurns.some((t) => canRefineTurn(t.progress));

  // The step target is per-accept, not a standing mode: once an accept lands,
  // clear it so the NEXT accept never silently re-binds the same step.
  const acceptedCount = buildTurns.filter((t) => t.accepted).length;
  useEffect(() => {
    setIntoStepKey("");
  }, [acceptedCount]);

  const intoFlowStep = useMemo<StepBinding | undefined>(() => {
    const at = intoStepKey.indexOf("/");
    if (at <= 0) return undefined;
    return { flowId: intoStepKey.slice(0, at), stepId: intoStepKey.slice(at + 1) };
  }, [intoStepKey]);

  const submit = (refine: boolean) => {
    if (!prompt.trim() || buildBusy) return;
    void runBuild({ goal: prompt.trim(), modelRef: activeModel, refine, ...(intentOverride ? { intentOverride } : {}) });
    setPrompt("");
  };

  /* ---------------- "Build a flow" planning + sequential driver ---------------- */

  const planTheFlow = async () => {
    if (!contract || !flowGoal.trim() || planBusy) return;
    setPlanBusy(true);
    setFlowBuild(null); // a fresh plan starts a fresh composition session
    try {
      setFlowPlan(await planFlow(flowGoal.trim(), activeModel, contract));
    } finally {
      setPlanBusy(false);
    }
  };

  const patchPlanStep = (at: number, patch: Partial<FlowPlan["steps"][number]>) =>
    setFlowPlan((p) => (p ? { ...p, steps: p.steps.map((s, i) => (i === at ? { ...s, ...patch } : s)) } : p));

  const movePlanStep = (at: number, delta: -1 | 1) =>
    setFlowPlan((p) => {
      if (!p) return p;
      const to = at + delta;
      if (to < 0 || to >= p.steps.length) return p;
      const steps = p.steps.slice();
      [steps[at], steps[to]] = [steps[to], steps[at]];
      return { ...p, steps };
    });

  const removePlanStep = (at: number) => setFlowPlan((p) => (p ? { ...p, steps: p.steps.filter((_, i) => i !== at) } : p));

  const addPlanStep = () =>
    setFlowPlan((p) => (p ? { ...p, steps: [...p.steps, { title: `Step ${p.steps.length + 1}`, goal: "", intent: intents[0] ?? "" }] } : p));

  /** ONE step's ordinary build, tagged with the step it builds for. Used by
   *  the sequential driver and by the per-step resume/re-run buttons. */
  const driveStep = async (at: number, flowId: string, stepIds: string[], plan: FlowPlan) => {
    const step = plan.steps[at];
    const stepId = stepIds[at];
    if (!step || !stepId) return "not-run" as const;
    return runBuild({
      goal: step.goal.trim() || step.title,
      modelRef: activeModel,
      intentOverride: step.intent,
      flowStepHint: { flowId, stepId, title: step.title },
    });
  };

  /**
   * Create the flow IMMEDIATELY with every step PENDING (it exists, previews
   * as an outline, exports, lints as pending), then drive the step builds
   * SEQUENTIALLY — never two in flight, spaced for model providers (the P3a
   * burst finding). Each result arrives as an ordinary turn with the normal
   * Accept, pre-targeted to its step; a failure stops the drive and the
   * remaining steps stay pending (resume per step below).
   */
  const acceptPlan = async () => {
    if (!flowPlan || flowPlan.steps.length === 0 || planBusy || buildBusy || flowBuild?.running) return;
    const plan = flowPlan; // frozen for this drive; the editor locks while running
    const flowId = nextFlowId(flows.map((f) => f.id));
    const taken = new Set<string>();
    const flowSteps = plan.steps.map((s) => {
      const stepId = mintStepId(s.title, taken);
      taken.add(stepId);
      return { id: stepId, title: s.title, surfaceId: "" };
    });
    saveFlows([...flows, { id: flowId, name: plan.name.trim() || "Untitled flow", description: flowGoal.trim().slice(0, 240), steps: flowSteps }]);
    const stepIds = flowSteps.map((s) => s.id);
    setFlowBuild({ flowId, stepIds, running: true, at: 0 });
    for (let i = 0; i < plan.steps.length; i++) {
      if (i > 0 && stepSpacingMs(activeModel) > 0) await sleep(stepSpacingMs(activeModel));
      setFlowBuild((fb) => (fb ? { ...fb, at: i } : fb));
      const outcome = await driveStep(i, flowId, stepIds, plan);
      if (outcome !== "passed") break; // the failure turn tells the story; later steps stay pending
    }
    setFlowBuild((fb) => (fb ? { ...fb, running: false, at: null } : fb));
  };

  if (!readiness.ready) {
    // A count is not a fix. When findings are what is blocking, name them:
    // the surface's own title, its canonical id, the gate's verbatim reason,
    // and the way to the thing itself. Grouped by the thing they are about —
    // one surface with three findings is one problem, not three — and capped,
    // because Checks is where the exhaustive list belongs.
    const blockers = blockingFindings(emit?.findings ?? [], contract?.examples);
    const byTarget = new Map<string, typeof blockers>();
    for (const b of blockers) byTarget.set(b.id, [...(byTarget.get(b.id) ?? []), b]);
    const shown = [...byTarget.entries()].slice(0, 6);
    const hidden = byTarget.size - shown.length;
    return (
      <section>
        <h2 style={{ fontFamily: "var(--hl)", fontSize: 15, textTransform: "uppercase", color: "var(--fg)" }}>Build</h2>
        <p style={{ fontSize: 13, color: "var(--warn)" }} data-testid="build-not-ready">
          Not ready to build yet: {readiness.reason}
        </p>
        {shown.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", fontSize: 12 }} data-testid="build-blockers">
            {shown.map(([id, group]) => (
              <li
                key={id || "document"}
                data-testid={id ? `build-blocker-${id}` : "build-blocker-document"}
                style={{ borderTop: "1px solid var(--line-soft)", padding: "6px 0" }}
              >
                <span style={{ color: "var(--fg)" }}>{group[0].title || "This project’s contract"}</span>
                {id && <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-dim)", marginLeft: 8 }}>{id}</span>}
                {group[0].isSurface && onNavigate && (
                  <button
                    className="st-link"
                    style={{ marginLeft: 8, fontSize: 12 }}
                    onClick={() => onNavigate("surfaces")}
                    title={`Open Surfaces, where “${group[0].title}” is listed`}
                    data-testid={`build-blocker-open-${id}`}
                  >
                    open in Surfaces
                  </button>
                )}
                {group.map((b, i) => (
                  <p key={`${b.gate}-${b.code}-${i}`} style={{ margin: "2px 0 0" }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--warn)" }}>
                      {b.gate} {b.code}
                    </span>{" "}
                    <span style={{ color: "var(--fg-body)" }}>{b.message}</span>
                  </p>
                ))}
              </li>
            ))}
            {hidden > 0 && (
              <li style={{ borderTop: "1px solid var(--line-soft)", padding: "6px 0", color: "var(--fg-dim)" }} data-testid="build-blockers-more">
                and {hidden} more — Checks lists every one.
              </li>
            )}
          </ul>
        )}
        <p style={{ fontSize: 12, color: "var(--fg-dim)", marginTop: 10 }}>
          {blockers.length > 0 ? (
            <>
              Fix or remove what&rsquo;s listed above — {onNavigate ? <button className="st-link" style={{ fontSize: 12 }} onClick={() => onNavigate("validate")} data-testid="build-blockers-checks">Checks</button> : "Checks"} runs the same gates over the whole project.
            </>
          ) : (
            <>Set up your design system in Catalog and Governance, then build with it.</>
          )}
        </p>
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
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <button
          className={`st-btn st-btn--dashed${buildMode === "flow" ? " st-btn--active" : ""}`}
          onClick={() => setBuildMode(buildMode === "flow" ? "surface" : "flow")}
          aria-pressed={buildMode === "flow"}
          title="Decompose one workflow goal into an editable plan of steps, each built through the ordinary governed pipeline."
          data-testid="build-mode-flow"
        >
          {buildMode === "flow" ? "← back to single surface" : "Build a flow…"}
        </button>
        {buildMode === "flow" && (
          <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>
            one workflow goal → an editable plan → ordinary per-step builds. Nothing new is generated in one shot.
          </span>
        )}
      </div>

      {buildMode === "surface" ? (
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
      ) : (
        <div style={{ border: "1px dashed var(--line)", borderRadius: 4, padding: "12px 14px", margin: "20px 0 8px" }} data-testid="flow-composer">
          <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: "0 0 8px" }}>
            Describe the whole journey. Composer proposes an editable outline; every step then builds through the ordinary
            governed pipeline — same gates, same Accept, one step at a time.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <textarea
              className="af-input af-input--mono"
              rows={3}
              value={flowGoal}
              onChange={(e) => setFlowGoal(e.target.value)}
              placeholder="e.g. Browse the service catalog. Create an estimate for the chosen package. Review and confirm the order. See the created project."
              aria-label="Describe the workflow to compose"
              style={{ flex: 1, resize: "vertical" }}
              data-testid="build-flow-goal"
            />
            <button
              className="st-btn st-btn--primary"
              disabled={planBusy || !flowGoal.trim()}
              onClick={() => void planTheFlow()}
              data-testid="flow-plan-run"
            >
              {planBusy ? "planning…" : "Plan the flow"}
            </button>
          </div>
          {flowPlan && (
            <div style={{ marginTop: 10 }} data-testid="flow-plan-editor">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="af-label" style={{ margin: 0 }}>
                  flow name
                </span>
                <input
                  style={{ ...field, minWidth: 220 }}
                  value={flowPlan.name}
                  onChange={(e) => setFlowPlan((p) => (p ? { ...p, name: e.target.value } : p))}
                  disabled={flowBuild?.running === true}
                  aria-label="Flow name"
                  data-testid="flow-plan-name"
                />
                <span style={{ fontSize: 12, color: "var(--fg-dim)" }} data-testid="flow-plan-source">
                  {flowPlan.source === "scripted"
                    ? flowPlan.reason || "Deterministic outline — no model call."
                    : "Proposed by the model — edit anything before building."}
                </span>
              </div>
              {flowPlan.steps.map((step, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-dim)" }}>{i + 1}.</span>
                  <input
                    style={{ ...field, minWidth: 140 }}
                    value={step.title}
                    onChange={(e) => patchPlanStep(i, { title: e.target.value })}
                    disabled={flowBuild?.running === true}
                    aria-label={`Step ${i + 1} title`}
                    data-testid={`flow-plan-title-${i}`}
                  />
                  <input
                    style={{ ...field, flex: 1, minWidth: 200 }}
                    value={step.goal}
                    onChange={(e) => patchPlanStep(i, { goal: e.target.value })}
                    disabled={flowBuild?.running === true}
                    placeholder="what this step's screen should do, in your words"
                    aria-label={`Step ${i + 1} generation goal`}
                    data-testid={`flow-plan-goal-${i}`}
                  />
                  <select
                    style={field}
                    value={step.intent}
                    onChange={(e) => patchPlanStep(i, { intent: e.target.value })}
                    disabled={flowBuild?.running === true}
                    aria-label={`Step ${i + 1} governed context`}
                    data-testid={`flow-plan-intent-${i}`}
                  >
                    {intents.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                  {flowBuild === null ? (
                    <>
                      <button className="st-link" disabled={i === 0} onClick={() => movePlanStep(i, -1)} aria-label={`Move step ${i + 1} up`} data-testid={`flow-plan-up-${i}`}>
                        ↑
                      </button>
                      <button
                        className="st-link"
                        disabled={i === flowPlan.steps.length - 1}
                        onClick={() => movePlanStep(i, 1)}
                        aria-label={`Move step ${i + 1} down`}
                        data-testid={`flow-plan-down-${i}`}
                      >
                        ↓
                      </button>
                      <button className="st-link" style={{ color: "var(--err)" }} onClick={() => removePlanStep(i)} aria-label={`Remove step ${i + 1}`} data-testid={`flow-plan-remove-${i}`}>
                        remove
                      </button>
                    </>
                  ) : (
                    <button
                      className="st-btn"
                      disabled={flowBuild.running || buildBusy}
                      onClick={() => void driveStep(i, flowBuild.flowId, flowBuild.stepIds, flowPlan)}
                      title="Build (or re-build) just this step; accept the resulting turn into its step below."
                      data-testid={`flow-build-step-${i}`}
                    >
                      build step
                    </button>
                  )}
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                {flowBuild === null && (
                  <button className="st-btn st-btn--dashed" onClick={addPlanStep} data-testid="flow-plan-add">
                    + add step
                  </button>
                )}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: "var(--fg-dim)" }} data-testid="flow-drive-status">
                  {flowBuild === null
                    ? `${flowPlan.steps.length} step${flowPlan.steps.length === 1 ? "" : "s"} — builds run one at a time${stepSpacingMs(activeModel) > 0 ? ", spaced 8s" : ""}.`
                    : flowBuild.running
                      ? `building step ${(flowBuild.at ?? 0) + 1} of ${flowBuild.stepIds.length} — sequential, never concurrent…`
                      : "steps ran — accept each turn below (pre-targeted to its step), or re-build a step."}
                </span>
                {flowBuild === null && (
                  <button
                    className="st-btn st-btn--primary"
                    disabled={flowPlan.steps.length === 0 || planBusy || buildBusy}
                    onClick={() => void acceptPlan()}
                    data-testid="flow-plan-accept"
                  >
                    Create flow &amp; build steps
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

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
        {flows.some((f) => f.steps.length > 0) && (
          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            title="Optional: accepting the next build also re-points this flow step at the accepted surface. Cleared after each accept."
          >
            <span className="af-label" style={{ margin: 0 }}>
              flow step
            </span>
            <select
              value={intoStepKey}
              onChange={(e) => setIntoStepKey(e.target.value)}
              data-testid="build-flow-step"
              aria-label="Flow step to re-bind on accept (optional)"
              style={{ fontFamily: "var(--mono)", fontSize: 12, background: "var(--bg-1)", color: "var(--fg)", border: "1px solid var(--line)", padding: "4px 6px", borderRadius: 2 }}
            >
              <option value="">none — accept without binding</option>
              {flows.flatMap((f) =>
                f.steps.map((s) => (
                  <option key={`${f.id}/${s.id}`} value={`${f.id}/${s.id}`}>
                    {f.name} → {s.title}
                  </option>
                )),
              )}
            </select>
          </label>
        )}
        <span data-testid="build-privacy">
          <code>{activeModel}</code>: {providerCopy(activeModel)}
        </span>
      </div>

      {mode !== "agent" && (
        <p
          data-testid="build-hosted-note"
          style={{ fontSize: 12, color: "var(--fg-body)", border: "1px solid var(--line)", borderRadius: 2, padding: "8px 10px", margin: "6px 0" }}
        >
          This project runs in your browser — no install.{" "}
          {buildModels.includes("hosted-ai") ? (
            <>
              <code>hosted-ai</code> generates for your goal with managed Claude Haiku; the deterministic gates and
              rendering run <em>entirely in this browser</em>.
            </>
          ) : (
            <>
              the governed pipeline — gates, rendering, checks — runs <em>entirely in this browser</em>.
            </>
          )}{" "}
          To build against <em>your own</em> component library, run the local agent (<code>pnpm --filter agent dev</code>)
          and connect it{agentUp ? " — detected: Projects → Connect a repository." : "."}
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
          <TurnBlock key={turn.id} turn={turn} intoFlowStep={intoFlowStep} />
        ))}
      </div>
    </section>
  );
}
