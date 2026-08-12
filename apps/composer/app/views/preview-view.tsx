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
 * `focus="flows"` is the Flows entry in the primary navigation: the same
 * view, opened on flow mode — one implementation, not two canvases.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { A2uiCanvas, type A2uiClientAction, type Registry } from "@dspack-studio/a2ui-ingest";
import { useComposer } from "../state";
import { ViewHeader } from "../ui";
import { isPendingStep, mintStepId, missingSurfaceMessage, nextFlowId, pendingStepMessage, type Flow, type FlowStep } from "../flows";
import { partitionSurfaces, surfaceEntriesById, surfaceTitle } from "../surface-identity";
import {
  registryFor,
  canvasScopeFor,
  isNativeRegistry,
  resolveRegistryId,
  wireframeFallbackNames,
  type PreviewRegistryId,
} from "../registries";

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

export function PreviewView({ focus }: { focus?: "flows" } = {}) {
  const { contract, emit, manifest, referenceExampleIds, isExample, mode, activeProject, projectPath, flows, saveFlows } = useComposer();
  // null = "no explicit choice yet" — the project's own design system draws
  // it. An explicit pick survives until the project changes (B5).
  const [registryId, setRegistryId] = useState<RegistryId | null>(null);
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
  // A surface a person reads by its TITLE — the goal that produced it, or the
  // name someone authored — with `ex.chat-1` kept beside it for audit (B7).
  const entriesById = useMemo(() => surfaceEntriesById(contract?.examples), [contract]);
  const titleOf = (id: string) => surfaceTitle(entriesById.get(id), id);
  // Ownership first: the project's OWN surfaces (accepted builds, surfaces
  // authored here) vs the design system's reference surfaces. They are never
  // mixed into one anonymous list, refusals are demoted by owner rather than
  // hidden, and Preview opens on the project's LATEST surface — what the user
  // just built. In an EXAMPLE workspace the reference gallery IS the content.
  const groups = useMemo(
    () =>
      partitionSurfaces(
        (emit?.surfaces ?? []).map((s) => (s.messages ? s : { ...s, error: s.error ?? "the emitter produced nothing for this surface" })),
        { referenceIds: referenceExampleIds, isExample },
      ),
    [emit, referenceExampleIds, isExample],
  );
  const yours = groups.yours;
  const referenceSurfaces = groups.reference;

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

  // Switching projects must never carry a stale walk, draft, or registry
  // choice across — including reconnecting to a DIFFERENT repository
  // (projectPath changes). The next project opens as itself.
  const projectId = activeProject?.id ?? null;
  useEffect(() => {
    setFlowPos(null);
    setDraft(null);
    setPickSurface("");
    setRegistryId(null);
  }, [projectId, projectPath]);

  // The Flows nav entry opens this view on flow mode: the first flow starts
  // walking straight away, so "Flows" lands on a flow rather than on a hint.
  const firstFlowId = flows[0]?.id;
  useEffect(() => {
    if (focus !== "flows" || !firstFlowId) return;
    setFlowPos((pos) => pos ?? { flowId: firstFlowId, stepIndex: 0 });
  }, [focus, firstFlowId]);

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

  // The registry choices are the project's own design system (when it has
  // one) and wireframe, in that order — a project previews as ITSELF, and
  // wireframe is the inspection mode you switch INTO. A stale selection from
  // a previous project clamps to this project's default (B5).
  const nativeId = isNativeRegistry(manifest?.previewRegistry) ? manifest.previewRegistry : undefined;
  const registryChoices: RegistryId[] = nativeId ? [nativeId, "wireframe"] : ["wireframe"];
  const activeRegistryId: RegistryId = resolveRegistryId(registryId, manifest?.previewRegistry);

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
  // The corpus a flow step may reference: every emitted surface, refused ones
  // included (a step over a refusal renders the refusal) — offered in the
  // same ownership order as every other picker (B8).
  const pickedSurface = pickSurface || groups.ordered[0]?.name || "";
  /** One option row in the step picker: the title leads, the id follows. */
  const stepOption = (s: { name: string; error?: string }) => (
    <option key={s.name} value={s.name}>
      {titleOf(s.name)} · {s.name}
      {s.error ? " (can't be emitted)" : ""}
    </option>
  );

  /** One surface in a picker: the human title leads, the canonical id stays
   *  beside it, small — readable at a glance, auditable without a click. */
  const surfaceButton = (name: string, isReference = false) => (
    <button
      key={name}
      className={`st-btn${isReference ? " st-btn--dashed" : ""}${!currentFlow && (active?.name ?? "") === name ? " st-btn--active" : ""}`}
      onClick={() => {
        setFlowPos(null); // choosing a surface leaves flow mode
        setSurfaceName(name);
      }}
      data-testid={`surface-${name}`}
      title={name}
      style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}
    >
      {/* The title is prose, so it opts out of the button language's mono
          uppercase; the id keeps it, small and quiet, as metadata. */}
      <span style={{ fontFamily: "var(--sans)", fontSize: 13, textTransform: "none", letterSpacing: 0 }}>{titleOf(name)}</span>
      <span style={{ fontSize: 10, opacity: 0.6 }}>{name}</span>
    </button>
  );

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
          Reference surface from {manifest?.name ?? "the design system"} — teaching material, not part of your project&rsquo;s work.
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
        eyebrow={focus === "flows" ? "Flows" : "Preview"}
        lead={
          focus === "flows"
            ? "Your surfaces, composed into a walkable workflow. Pick a flow to walk it step by step, or compose a new one from the surfaces you have built."
            : "Your surfaces, drawn in your own design system — or in the wireframe, the universal fallback. Export the catalog to take it anywhere."
        }
      />
      {/* The honest 1.0 boundary, stated once where it applies (C10b). */}
      <p data-testid="preview-boundary" style={{ fontSize: 12, color: "var(--fg-dim)", margin: "-8px 0 12px", maxWidth: 720 }}>
        What you walk here is a governed <em>representation</em>: real components, real rules, real emitted actions. Binding
        those actions to live data and carrying state between steps is the next thing being built — today a flow tells the
        story rather than running it.
      </p>
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
            {flows.length === 0 && focus !== "flows" && (
              <span style={{ fontSize: 12, color: "var(--fg-dim)" }} data-testid="flows-empty">
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="preview-your-surfaces">
          <span className="af-label" style={{ margin: 0 }}>
            {isExample ? "Example surfaces" : "Your surfaces"}
          </span>
          {yours.length === 0 ? (
            <span style={{ fontSize: 12, color: "var(--fg-dim)" }} data-testid="preview-no-project-surfaces">
              none yet — build something in Build, then “Add to project”.
            </span>
          ) : (
            yours.map((s) => surfaceButton(s.name))
          )}
          {/* The project's OWN refusals stay in front of the person whose work
              they are — demoted never means hidden. */}
          {groups.yoursRefused.map((s) => (
            <span
              key={s.name}
              title={s.error}
              style={{ fontSize: 12, color: "var(--err)" }}
              data-testid={`surface-refused-${s.name}`}
            >
              {titleOf(s.name)} — can&rsquo;t be emitted
            </span>
          ))}
        </div>
        {referenceSurfaces.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="preview-reference-surfaces">
            <span className="af-label" style={{ margin: 0, color: "var(--fg-dim)" }}>
              Reference surfaces · {manifest?.name ?? "design system"}
            </span>
            {referenceSurfaces.map((s) => surfaceButton(s.name, true))}
          </div>
        )}
        {/* Reference refusals are the design system's own gaps, not the
            user's work: one honest line that opens, rather than a wall of red
            at first contact (B8). */}
        {groups.referenceRefused.length > 0 && (
          <details style={{ fontSize: 12, color: "var(--fg-dim)" }}>
            <summary style={{ cursor: "pointer" }} data-testid="preview-reference-refused">
              {groups.referenceRefused.length} reference surfaces can&rsquo;t be emitted — why?
            </summary>
            <ul style={{ listStyle: "none", padding: "4px 0 0", margin: 0 }}>
              {groups.referenceRefused.map((s) => (
                <li key={s.name} style={{ padding: "2px 0" }} data-testid={`surface-refused-${s.name}`}>
                  <span style={{ color: "var(--fg-body)" }}>{titleOf(s.name)}</span>{" "}
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{s.name}</span>
                  <br />
                  <span style={{ color: "var(--warn)" }}>{s.error}</span>
                </li>
              ))}
            </ul>
          </details>
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
              <span style={{ fontSize: 12, color: "var(--fg-dim)" }} title={`The surface this step renders: ${step.surfaceId}`}>
                {step.surfaceId === "" ? (
                  "not built yet"
                ) : (
                  <>
                    {titleOf(step.surfaceId)} <span style={{ fontFamily: "var(--mono)", fontSize: 10, opacity: 0.6 }}>{step.surfaceId}</span>
                  </>
                )}
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
            {/* The step picker follows the same ownership order as every
                other picker: your surfaces first, the reference corpus after,
                each named by its title with the id beside it (B7/B8). */}
            <select style={field} value={pickedSurface} onChange={(e) => setPickSurface(e.target.value)} data-testid="flow-step-surface" aria-label="Surface for the next step">
              {[...groups.yours, ...groups.yoursRefused].length > 0 && (
                <optgroup label={isExample ? "Example surfaces" : "Your surfaces"}>
                  {[...groups.yours, ...groups.yoursRefused].map(stepOption)}
                </optgroup>
              )}
              {[...groups.reference, ...groups.referenceRefused].length > 0 && (
                <optgroup label={`Reference surfaces · ${manifest?.name ?? "design system"}`}>
                  {[...groups.reference, ...groups.referenceRefused].map(stepOption)}
                </optgroup>
              )}
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

      {/* Flows, opened from the primary navigation, with nothing to walk yet:
          the invitation belongs here, not a blank canvas (C9). */}
      {focus === "flows" && flowsVisible && flows.length === 0 && !draft && (
        <div className="af-empty" data-testid="flows-empty">
          <p className="af-empty__title">No flows yet</p>
          <p className="af-empty__body">
            A flow is an ordered set of your surfaces that tells one story — sign in, choose a plan, confirm. Build a few
            surfaces, then compose them here; or describe the whole journey at once with &ldquo;Build a flow&hellip;&rdquo; in
            Build.
          </p>
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
                disabled={isPendingStep(step)}
                title={isPendingStep(step) ? "not built yet — build it from Build" : `${titleOf(step.surfaceId)} · ${step.surfaceId}`}
                style={i < flowPos.stepIndex ? { color: "var(--ok)" } : undefined}
              >
                {i + 1}. {step.title}
                {isPendingStep(step) ? " · pending" : i < flowPos.stepIndex ? " ✓" : ""}
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
          ) : flowStep && isPendingStep(flowStep) ? (
            // A planned-but-unbuilt step is an OUTLINE state, not a defect: a
            // flow of only pending steps previews as its outline this way.
            <div className="af-empty" data-testid="flow-step-pending">
              <p className="af-empty__title">This step isn&rsquo;t built yet</p>
              <p className="af-empty__body">{pendingStepMessage(flowStep)}.</p>
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
          <p className="af-empty__title">No surfaces yet</p>
          <p className="af-empty__body">
            Build something first — describe what you want in Build, and a passing result&rsquo;s &ldquo;Add to
            project&rdquo; lands it here.{referenceSurfaces.length > 0 && " The reference surfaces above are open for inspection."}
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
