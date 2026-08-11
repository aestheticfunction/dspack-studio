"use client";

/**
 * Preview: the emitted catalog rendered through a registry. Wireframe is the
 * universal honest fallback — per COMPONENT inside a native surface (a name
 * with no native visual draws as wireframe, never as raw placeholder text),
 * and as the whole-registry inspection mode. Partial native coverage is a
 * first-class state, stated plainly, not an error.
 *
 * Flows (P4): a project's multi-step experiences, rendered as step navigation
 * OVER the exact single-surface path below — flow mode overrides which
 * surface is selected, and nothing else. Each step is today's Preview for one
 * surface: same lookup, same canvas, same key pattern, same registries.
 * Advance-on-action is pure view-state (the same emitted action object the
 * log already receives); nothing is persisted, nothing reaches the artifact.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { A2uiCanvas, type A2uiClientAction, type Registry } from "@dspack-studio/a2ui-ingest";
import { useComposer } from "../state";
import { ViewHeader } from "../ui";
import { mintStepId, missingSurfaceMessage, nextFlowId, type Flow, type FlowStep } from "../flows";
import { registryFor, canvasScopeFor, isNativeRegistry, wireframeFallbackNames, type PreviewRegistryId } from "../registries";

type RegistryId = "wireframe" | PreviewRegistryId;

/**
 * Export the emitted artifacts as a downloadable JSON bundle: the A2UI
 * catalog (the vocabulary an A2UI/AG-UI client consumes) plus every emitted
 * surface's messages (worked AG-UI payloads). Pure browser download — works
 * in demo mode and agent mode alike, with no filesystem round-trip, so a
 * hosted user can actually take the catalog away and use it.
 */
function exportBundle(emit: NonNullable<ReturnType<typeof useComposer>["emit"]>, name: string): void {
  const bundle = {
    a2uiCatalog: emit.catalog,
    surfaces: (emit.surfaces ?? [])
      .filter((s) => s.messages)
      .map((s) => ({ name: s.name, messages: s.messages })),
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "a2ui"}-catalog.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const field = {
  fontFamily: "var(--mono)",
  fontSize: 12,
  background: "var(--bg-1)",
  border: "1px solid var(--line)",
  color: "var(--fg)",
  padding: "4px 6px",
  borderRadius: 2,
} as const;

/** One step in the flow editor: advanceOn edits as comma-separated text; the
 *  reserved `on` annotation and `terminal` ride through untouched (F4). */
interface DraftStep {
  id?: string;
  title: string;
  surfaceId: string;
  advanceOn: string;
  on?: FlowStep["on"];
  terminal?: boolean;
}

interface FlowDraft {
  id: string | null; // null = a new flow (id minted at save)
  name: string;
  description?: string;
  steps: DraftStep[];
}

const draftFrom = (flow: Flow): FlowDraft => ({
  id: flow.id,
  name: flow.name,
  ...(flow.description !== undefined ? { description: flow.description } : {}),
  steps: flow.steps.map((s) => ({
    id: s.id,
    title: s.title,
    surfaceId: s.surfaceId,
    advanceOn: (s.advanceOn ?? []).join(", "),
    ...(s.on !== undefined ? { on: s.on } : {}),
    ...(s.terminal !== undefined ? { terminal: s.terminal } : {}),
  })),
});

export function PreviewView() {
  const { emit, manifest, referenceExampleIds, isExample, mode, activeProject, projectPath, flows, saveFlows } = useComposer();
  const [registryId, setRegistryId] = useState<RegistryId>("wireframe");
  const [canvasMode, setCanvasMode] = useState<"light" | "dark">("light");
  const [surfaceName, setSurfaceName] = useState<string | null>(null);
  const [actions, setActions] = useState<A2uiClientAction[]>([]);
  // Flow mode is VIEW STATE: which flow is being walked and where. stepIndex
  // may sit one past the end — the quiet "flow complete" state.
  const [flowPos, setFlowPos] = useState<{ flowId: string; stepIndex: number } | null>(null);
  const [draft, setDraft] = useState<FlowDraft | null>(null);
  const [pickSurface, setPickSurface] = useState<string>("");

  const catalog = emit?.catalog;
  const surfaces = (emit?.surfaces ?? []).filter((s) => s.messages);
  // Ownership first: the project's OWN surfaces (accepted builds, authored
  // scenarios) vs the design-system reference's worked examples. They are
  // never mixed into one anonymous list, and Preview opens on the project's
  // LATEST surface — what the user just built — not a reference example.
  // In an EXAMPLE workspace the reference gallery IS the content on show.
  const yoursRaw = referenceExampleIds ? surfaces.filter((s) => !referenceExampleIds.has(s.name)) : surfaces;
  const refsRaw = referenceExampleIds ? surfaces.filter((s) => referenceExampleIds.has(s.name)) : [];
  const yours = isExample ? surfaces : yoursRaw;
  const referenceSurfaces = isExample ? [] : refsRaw;

  // Flows are a PROJECT feature: browser projects persist them in the
  // per-project store, connected repository projects in project.json through
  // the agent (Phase B). Example workspaces are ephemeral teaching material.
  const flowsVisible = !isExample && (activeProject !== null || (mode === "agent" && projectPath !== ""));
  const currentFlow = flowsVisible && flowPos ? flows.find((f) => f.id === flowPos.flowId) ?? null : null;
  const flowStep =
    currentFlow && flowPos && flowPos.stepIndex < currentFlow.steps.length ? currentFlow.steps[flowPos.stepIndex] : null;
  // "Complete" means walked PAST real steps — an empty flow is not complete,
  // it is unstarted (the navigator says so and the editor is one click away).
  const flowDone = currentFlow !== null && flowPos !== null && currentFlow.steps.length > 0 && flowPos.stepIndex >= currentFlow.steps.length;

  // Flow mode overrides the ONE selection point; everything downstream (the
  // canvas, registries, warnings, ownership notes) is the identical path.
  const active = currentFlow
    ? flowStep
      ? surfaces.find((s) => s.name === flowStep.surfaceId) ?? null
      : null
    : surfaces.find((s) => s.name === surfaceName) ?? (isExample ? yours[0] : yours.at(-1)) ?? null;

  // A2uiCanvas holds onAction stable for a surface's lifetime, so the advance
  // handler reads the CURRENT step through a ref — a closure would go stale.
  const advanceRef = useRef<{ flow: Flow | null; stepIndex: number }>({ flow: null, stepIndex: 0 });
  useEffect(() => {
    advanceRef.current = { flow: currentFlow, stepIndex: flowPos?.stepIndex ?? 0 };
  }, [currentFlow, flowPos]);

  // Switching projects must never carry a stale walk or draft across —
  // including reconnecting to a DIFFERENT repository (projectPath changes).
  const projectId = activeProject?.id ?? null;
  useEffect(() => {
    setFlowPos(null);
    setDraft(null);
    setPickSurface("");
  }, [projectId, projectPath]);

  /** Every action feeds the log exactly as before; in flow mode a name the
   *  CURRENT step listed in advanceOn also advances the walk (F2 — pure view
   *  state; a terminal or last step advances into "flow complete"). */
  const handleAction = (action: A2uiClientAction) => {
    setActions((prev) => [...prev, action]);
    const { flow, stepIndex } = advanceRef.current;
    const step = flow?.steps[stepIndex];
    if (!flow || !step?.advanceOn?.includes(action.name)) return;
    const nextIndex = step.terminal || stepIndex >= flow.steps.length - 1 ? flow.steps.length : stepIndex + 1;
    setFlowPos((pos) => (pos && pos.flowId === flow.id ? { ...pos, stepIndex: nextIndex } : pos));
  };

  // The registry choices are wireframe (always) + the project's native design
  // system, whichever it is. A stale selection from a previous project clamps
  // back to wireframe rather than rendering the wrong catalog.
  const nativeId = isNativeRegistry(manifest?.previewRegistry) ? manifest.previewRegistry : undefined;
  const registryChoices: RegistryId[] = nativeId ? ["wireframe", nativeId] : ["wireframe"];
  const activeRegistryId: RegistryId = registryChoices.includes(registryId) ? registryId : "wireframe";

  const registry: Registry | null = useMemo(() => {
    if (!catalog) return null;
    return registryFor(activeRegistryId, catalog);
  }, [catalog, activeRegistryId]);

  // Honest coverage comes from the PRE-merge native registry: the rendered
  // registry covers every name (wireframe fills the gaps), so the caption's
  // job is to say which components are wireframe stand-ins, not to alarm.
  const fallbackNames = useMemo(() => wireframeFallbackNames(activeRegistryId, catalog), [activeRegistryId, catalog]);

  if (!catalog || !registry) {
    return <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>Nothing to preview yet — open a project, then build something in Build.</p>;
  }

  const failed = (emit?.surfaces ?? []).filter((s) => s.error);
  // The merged corpus a flow step may reference: every emitted surface,
  // refused ones included (a step over a refusal renders the refusal).
  const corpus = (emit?.surfaces ?? []).map((s) => ({ name: s.name, refused: Boolean(s.error) }));
  const pickedSurface = pickSurface || corpus[0]?.name || "";

  const openEditorFor = (flow: Flow) => setDraft(draftFrom(flow));

  const addDraftStep = () => {
    if (!draft || !pickedSurface) return;
    setDraft({ ...draft, steps: [...draft.steps, { title: pickedSurface, surfaceId: pickedSurface, advanceOn: "" }] });
  };

  const patchDraftStep = (at: number, patch: Partial<DraftStep>) => {
    if (!draft) return;
    setDraft({ ...draft, steps: draft.steps.map((s, i) => (i === at ? { ...s, ...patch } : s)) });
  };

  const moveDraftStep = (at: number, delta: -1 | 1) => {
    if (!draft) return;
    const to = at + delta;
    if (to < 0 || to >= draft.steps.length) return;
    const steps = draft.steps.slice();
    [steps[at], steps[to]] = [steps[to], steps[at]];
    setDraft({ ...draft, steps });
  };

  const removeDraftStep = (at: number) => {
    if (!draft) return;
    setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== at) });
  };

  /** All writes go through the ONE save funnel. Ids: existing steps keep
   *  theirs; new steps mint step.<slug> collision-safe; a new flow mints the
   *  next flow.flow-N. */
  const saveDraft = () => {
    if (!draft) return;
    const id = draft.id ?? nextFlowId(flows.map((f) => f.id));
    const taken = new Set(draft.steps.map((s) => s.id).filter((v): v is string => Boolean(v)));
    const steps: FlowStep[] = draft.steps.map((s) => {
      let stepId = s.id;
      if (!stepId) {
        stepId = mintStepId(s.title.trim() || s.surfaceId, taken);
        taken.add(stepId);
      }
      const advanceOn = s.advanceOn
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      return {
        id: stepId,
        title: s.title.trim() || s.surfaceId,
        surfaceId: s.surfaceId,
        ...(advanceOn.length > 0 ? { advanceOn } : {}),
        ...(s.on !== undefined ? { on: s.on } : {}),
        ...(s.terminal !== undefined ? { terminal: s.terminal } : {}),
      };
    });
    const flow: Flow = {
      id,
      name: draft.name.trim() || "Untitled flow",
      ...(draft.description !== undefined ? { description: draft.description } : {}),
      steps,
    };
    const editing = flows.some((f) => f.id === id);
    saveFlows(editing ? flows.map((f) => (f.id === id ? flow : f)) : [...flows, flow]);
    setDraft(null);
    setFlowPos({ flowId: id, stepIndex: 0 });
  };

  const deleteFlow = (id: string) => {
    saveFlows(flows.filter((f) => f.id !== id));
    setFlowPos((pos) => (pos?.flowId === id ? null : pos));
    setDraft((d) => (d?.id === id ? null : d));
  };

  /** The step's surface through the IDENTICAL single-surface path (same
   *  canvas, same key pattern, same registry scope) — used by both modes. */
  const renderSurface = (surf: NonNullable<typeof active>) => (
    <>
      {!isExample && referenceExampleIds?.has(surf.name) && (
        <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: "0 0 6px" }}>
          Reference example from {manifest?.name ?? "the design system"} — teaching material, not part of your project&rsquo;s work.
        </p>
      )}
      <div
        {...canvasScopeFor(activeRegistryId, canvasMode).attrs}
        data-project-canvas="composer"
        style={{
          border: "1px solid var(--line)",
          borderRadius: 4,
          padding: 20,
          background: canvasScopeFor(activeRegistryId, canvasMode).background,
        }}
      >
        <A2uiCanvas
          key={`${surf.name}:${activeRegistryId}`}
          catalog={catalog}
          registry={registry}
          messages={surf.messages!}
          onAction={handleAction}
        />
      </div>
    </>
  );

  return (
    <section>
      <ViewHeader
        eyebrow="Preview"
        lead="Your emitted surfaces, rendered through the design system — or the wireframe, the universal fallback. Export the catalog to take it anywhere."
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>registry:</span>
        {registryChoices.map((id) => (
          <button key={id} className={`st-btn${activeRegistryId === id ? " st-btn--active" : ""}`} onClick={() => setRegistryId(id)} data-testid={`registry-${id}`}>
            {id}
          </button>
        ))}
        {activeRegistryId === "shadcn" && (
          <button className="st-btn st-btn--dashed" onClick={() => setCanvasMode(canvasMode === "light" ? "dark" : "light")}>
            canvas: {canvasMode}
          </button>
        )}
        <span style={{ fontSize: 12, color: "var(--fg-dim)" }} data-testid="registry-coverage">
          {!isNativeRegistry(activeRegistryId) ? (
            "wireframe — covers every component"
          ) : fallbackNames.length === 0 ? (
            "full native coverage"
          ) : (
            <>
              {fallbackNames.length} of {Object.keys(catalog.components ?? {}).length} components render as wireframe (no native{" "}
              {activeRegistryId} visual yet)
              <span title={fallbackNames.join(", ")}> — hover for the list</span>
            </>
          )}
        </span>
        <button
          className="st-btn st-btn--dashed"
          style={{ marginLeft: "auto" }}
          onClick={() => emit && exportBundle(emit, manifest?.name ?? "a2ui")}
          data-testid="export-catalog"
          title="Download the emitted A2UI catalog + surface messages as JSON"
        >
          ↓ export catalog
        </button>
      </div>

      <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        {flowsVisible && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="preview-flows">
            <span className="af-label" style={{ margin: 0 }}>
              Your flows
            </span>
            {flows.length === 0 && (
              <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>
                none yet — compose your surfaces into a walkable, multi-step experience.
              </span>
            )}
            {flows.map((f) => (
              <button
                key={f.id}
                className={`st-btn${currentFlow?.id === f.id ? " st-btn--active" : ""}`}
                onClick={() => setFlowPos({ flowId: f.id, stepIndex: 0 })}
                data-testid={`flow-${f.id}`}
                title={f.description || `${f.steps.length} step${f.steps.length === 1 ? "" : "s"}`}
              >
                {f.name}
              </button>
            ))}
            <button className="st-btn st-btn--dashed" onClick={() => setDraft({ id: null, name: "", steps: [] })} data-testid="new-flow">
              + new flow
            </button>
            {currentFlow && (
              <>
                <button className="st-btn st-btn--dashed" onClick={() => openEditorFor(currentFlow)} data-testid={`flow-edit-${currentFlow.id}`}>
                  edit
                </button>
                <button className="st-link" style={{ color: "var(--err)" }} onClick={() => deleteFlow(currentFlow.id)} data-testid={`flow-delete-${currentFlow.id}`}>
                  delete
                </button>
              </>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="af-label" style={{ margin: 0 }}>
            {isExample ? "Example surfaces" : referenceExampleIds ? "Your surfaces" : "Project surfaces"}
          </span>
          {yours.length === 0 ? (
            <span style={{ fontSize: 12, color: "var(--fg-dim)" }} data-testid="preview-no-project-surfaces">
              none yet — build something in Build, then “Add to project”.
            </span>
          ) : (
            yours.map((s) => (
              <button
                key={s.name}
                className={`st-btn${!currentFlow && (active?.name ?? "") === s.name ? " st-btn--active" : ""}`}
                onClick={() => {
                  setFlowPos(null); // choosing a surface leaves flow mode
                  setSurfaceName(s.name);
                }}
                data-testid={`surface-${s.name}`}
              >
                {s.name}
              </button>
            ))
          )}
        </div>
        {referenceSurfaces.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="preview-reference-surfaces">
            <span className="af-label" style={{ margin: 0, color: "var(--fg-dim)" }}>
              Reference examples · {manifest?.name ?? "design system"}
            </span>
            {referenceSurfaces.map((s) => (
              <button
                key={s.name}
                className={`st-btn st-btn--dashed${!currentFlow && (active?.name ?? "") === s.name ? " st-btn--active" : ""}`}
                onClick={() => {
                  setFlowPos(null); // choosing a surface leaves flow mode
                  setSurfaceName(s.name);
                }}
                data-testid={`surface-${s.name}`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        {failed.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {failed.map((s) => (
              <span key={s.name} title={s.error} style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--err)" }} data-testid={`surface-refused-${s.name}`}>
                {s.name}: refused
              </span>
            ))}
          </div>
        )}
      </div>

      {flowsVisible && draft && (
        <div style={{ border: "1px dashed var(--line)", borderRadius: 4, padding: "10px 12px", marginBottom: 14 }} data-testid="flow-editor">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color: "var(--fg-dim)" }}>
              {draft.id ? `editing ${draft.id}` : "new flow"}
            </span>
            <input
              style={{ ...field, minWidth: 200 }}
              placeholder="Name this flow"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              data-testid="flow-name"
              aria-label="Flow name"
            />
          </div>
          {draft.steps.map((step, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-dim)" }}>{i + 1}.</span>
              <input
                style={{ ...field, minWidth: 150 }}
                value={step.title}
                onChange={(e) => patchDraftStep(i, { title: e.target.value })}
                data-testid={`flow-step-title-${i}`}
                aria-label={`Step ${i + 1} title`}
              />
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-dim)" }} title="The surface this step renders">
                {step.surfaceId}
              </span>
              <input
                style={{ ...field, minWidth: 170 }}
                placeholder="advance on (action, action)"
                value={step.advanceOn}
                onChange={(e) => patchDraftStep(i, { advanceOn: e.target.value })}
                data-testid={`flow-step-advance-${i}`}
                aria-label={`Step ${i + 1} advance-on action names`}
                title="Emitted action names that complete this step in Preview (comma-separated)"
              />
              <button className="st-link" disabled={i === 0} onClick={() => moveDraftStep(i, -1)} data-testid={`flow-step-up-${i}`} aria-label={`Move step ${i + 1} up`}>
                ↑
              </button>
              <button
                className="st-link"
                disabled={i === draft.steps.length - 1}
                onClick={() => moveDraftStep(i, 1)}
                data-testid={`flow-step-down-${i}`}
                aria-label={`Move step ${i + 1} down`}
              >
                ↓
              </button>
              <button
                className="st-link"
                style={{ color: "var(--err)" }}
                onClick={() => removeDraftStep(i)}
                data-testid={`flow-step-remove-${i}`}
                aria-label={`Remove step ${i + 1}`}
              >
                remove
              </button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <select style={field} value={pickedSurface} onChange={(e) => setPickSurface(e.target.value)} data-testid="flow-step-surface" aria-label="Surface for the next step">
              {corpus.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                  {s.refused ? " (refused)" : ""}
                </option>
              ))}
            </select>
            <button className="st-btn" onClick={addDraftStep} disabled={!pickedSurface} data-testid="flow-add-step">
              + add step
            </button>
            <span style={{ flex: 1 }} />
            <button className="st-btn st-btn--primary" onClick={saveDraft} data-testid="flow-save">
              save flow
            </button>
            <button className="st-link" onClick={() => setDraft(null)} data-testid="flow-cancel">
              cancel
            </button>
          </div>
        </div>
      )}

      {currentFlow && flowPos ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }} data-testid="flow-navigator">
            <button
              className="st-btn"
              disabled={flowPos.stepIndex === 0}
              onClick={() => setFlowPos((pos) => pos && { ...pos, stepIndex: Math.min(Math.max(pos.stepIndex - 1, 0), currentFlow.steps.length - 1) })}
              data-testid="flow-prev"
            >
              ← prev
            </button>
            {currentFlow.steps.map((step, i) => (
              <button
                key={step.id}
                className={`st-btn${i === flowPos.stepIndex ? " st-btn--active" : ""}`}
                onClick={() => setFlowPos({ flowId: currentFlow.id, stepIndex: i })}
                data-testid={`flow-step-${step.id}`}
                title={step.surfaceId}
                style={i < flowPos.stepIndex ? { color: "var(--ok)" } : undefined}
              >
                {i + 1}. {step.title}
                {i < flowPos.stepIndex ? " ✓" : ""}
              </button>
            ))}
            <button
              className="st-btn"
              disabled={flowPos.stepIndex >= currentFlow.steps.length - 1}
              onClick={() => setFlowPos((pos) => pos && { ...pos, stepIndex: Math.min(pos.stepIndex + 1, currentFlow.steps.length - 1) })}
              data-testid="flow-next"
            >
              next →
            </button>
            {currentFlow.steps.length === 0 && (
              <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>this flow has no steps yet — edit it to add some.</span>
            )}
          </div>
          {flowDone ? (
            <div className="af-empty" data-testid="flow-complete">
              <p className="af-empty__title">Flow complete</p>
              <p className="af-empty__body">
                &ldquo;{currentFlow.name}&rdquo; walked every step. Pick a step above to revisit it, or choose a surface to leave the flow.
              </p>
            </div>
          ) : flowStep && !active ? (
            <div className="af-empty" data-testid="flow-step-unrenderable">
              <p className="af-empty__title">This step&rsquo;s surface can&rsquo;t render</p>
              <p className="af-empty__body">
                {failed.find((s) => s.name === flowStep.surfaceId)?.error ?? missingSurfaceMessage(flowStep)}
              </p>
            </div>
          ) : active?.messages ? (
            renderSurface(active)
          ) : null}
        </>
      ) : active?.messages ? (
        renderSurface(active)
      ) : (
        <div className="af-empty" data-testid="preview-empty">
          <p className="af-empty__title">No project surfaces yet</p>
          <p className="af-empty__body">
            Build something first — describe what you want in Build, and a passing result&rsquo;s &ldquo;Add to
            project&rdquo; lands it here.{referenceSurfaces.length > 0 && " The reference examples above are open for inspection."}
          </p>
        </div>
      )}

      {active && active.warnings.length > 0 && (
        <details style={{ marginTop: 10, fontSize: 12, color: "var(--fg-dim)" }}>
          <summary style={{ cursor: "pointer" }}>{active.warnings.length} emit warnings (nothing is silent)</summary>
          <ul style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
            {active.warnings.map((w, i) => (
              <li key={i}>
                {w.code}: {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {actions.length > 0 && (
        <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-dim)", marginTop: 8 }} data-testid="action-log">
          actions dispatched: {actions.map((a) => (a as { name?: string }).name ?? "action").join(", ")}
        </p>
      )}
    </section>
  );
}
