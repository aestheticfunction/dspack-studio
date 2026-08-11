"use client";

/**
 * Composer state: one context holding the project documents plus the latest
 * emit/validate results. Two EXECUTION modes (never identity — a browser
 * project is the user's project, not a demo):
 *   - "agent": a local project directory via the agent; saves write to disk.
 *   - "demo":  the project runs entirely in this browser — the working
 *              contract is base vocabulary + the project's persisted authored
 *              delta; other edits are session-only, stated plainly per view.
 * Files (or the delta store) are the source of truth; this state is a view.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addTombstone,
  applyFreshFact,
  buildReadiness,
  canRefineTurn,
  examplePromptFor,
  foldBuildEvents,
  ledgerStatus,
  removeTombstone,
  restoreComponent,
  vocabularyGap,
  type BuildReadiness,
  type BuildTurnProgress,
  type ComposerFinding,
  type FreshFact,
  type GoalPlan,
  type LedgerStatus,
  type ProjectManifest,
} from "@dspack-studio/composer-core";
import {
  agentConnect,
  agentDiscover,
  agentEmit,
  agentModels,
  hostedModels,
  agentRediscover,
  agentSave,
  agentSaveExample,
  probeAgent,
  streamProjectRun,
  streamAgentInline,
  type EmitPayload,
  type RediscoverReport,
  type ValidatePayload,
} from "./agent-client";
import { browserEmit, contractSurfaces, lintOneSurface, validateContract } from "./validation";
import { streamHostedBuild } from "./hosted-build";
import {
  loadStoredProviders,
  saveStoredProviders,
  isLocalRef,
  localKindOf,
  modelOf,
  type StoredProviders,
  type ProviderConfig,
  type LocalKind,
} from "./providers";
import { planGoal } from "./planning";
import { emittedActionsBySurface, flowLint, loadFlows as loadFlowsStore, saveFlows as saveFlowsStore, type Flow } from "./flows";
import { buildProjectExport, downloadProjectExport, parseProjectImport } from "./project-portability";
import { REFERENCES, REFERENCE_LIST, DEFAULT_REFERENCE, type Reference } from "./demo-data";
import {
  createProject,
  listProjects,
  getProject,
  touchProject,
  duplicateProject as dupStoredProject,
  removeProject as rmStoredProject,
  renameProject as renameStoredProject,
  getLastOpened,
  setLastOpened,
  saveVocab,
  loadVocab,
  saveExamplesDelta,
  loadExamplesDelta,
  mergeExamples,
  examplesDelta,
  nextChatExampleId,
  type ExampleEntry,
  type StoredProject,
  type ProjectSource,
  type ProjectVocab,
  type PreviewRegistry,
} from "./projects";

export type Mode = "demo" | "agent";

/** One chat turn in the Build thread: the ask, its run, and its result. */
export interface BuildTurn {
  id: number;
  /** The user's GOAL, in their own words — not our intent taxonomy. */
  prompt: string;
  /** The governed context, INFERRED from the goal (or overridden in advanced). */
  intent: string;
  modelRef: string;
  /** True when this turn refined the previous surface (seed supplied). */
  refinement: boolean;
  /** The turn this one refined, for truthful example provenance (#42). */
  parentId?: number;
  progress: BuildTurnProgress;
  /** Component ids the ask needed but the owner has not approved (S2 evidence). */
  gaps: string[];
  accepted?: string; // the saved example id
  /** Structured findings from a refused Accept, rendered in place (#41). */
  acceptFindings?: ComposerFinding[];
  /** The inferred governed context + feasibility for this turn (goal-first). */
  plan?: GoalPlan;
  /** While the goal is being routed to a governed context. */
  planPending?: boolean;
  /** "surface" = a governed surface was generated; "vocab-gap" = the approved
   *  vocabulary cannot express the goal (the bridge toward catalog evolution). */
  kind?: "surface" | "vocab-gap";
}

export interface ComposerState {
  mode: Mode;
  agentUp: boolean;
  projectPath: string;
  manifest: ProjectManifest | null;
  contract: Record<string, any> | null;
  profile: Record<string, any> | null;
  ledger: LedgerStatus | null;
  /** The last rediscovery's full report; review surface, never auto-acted. */
  rediscovery: RediscoverReport | null;
  emit: EmitPayload | null;
  validate: ValidatePayload | null;
  busy: string | null;
  notice: string | null;
  selected: string | null; // contract component id
  setSelected: (id: string | null) => void;
  connect: (path: string) => Promise<void>;
  /** The governed design system the current demo/blank project builds from. */
  referenceId: string;
  /** Start a blank project from a packaged reference (shadcn/ui or Astryx). */
  loadReference: (id: string) => void;
  /** Example ids that come FROM the packaged reference (teaching material),
   *  for reference-sourced projects; null when every example is the project's
   *  own (imported bundles, agent repositories). Views group by this — the
   *  reference corpus must never masquerade as authored project content. */
  referenceExampleIds: Set<string> | null;
  /** Every packaged reference the project-start picker can offer. */
  references: Reference[];
  /* ---- Projects (first-class objects) ---- */
  /** All saved projects, most-recently-opened first. */
  projects: StoredProject[];
  /** The open project, or null on the hub (first run / after closing). */
  activeProject: StoredProject | null;
  /** Create a named project from a governed source and open it. */
  newProject: (input: { name: string; description?: string; source: ProjectSource }) => StoredProject;
  /** Open a saved project by id (loads its vocabulary). */
  openProject: (id: string) => void;
  /** Return to the hub without a project loaded. */
  closeProject: () => void;
  renameProject: (id: string, name: string) => void;
  duplicateProject: (id: string) => StoredProject | null;
  deleteProject: (id: string) => void;
  /** Import a project from an exported file (validates, stores, opens). */
  importProject: (text: string) => { ok: true; name: string } | { ok: false; error: string };
  /** Export a project to a downloadable, portable file. */
  exportProject: (id: string) => void;
  /** Open a packaged reference as a read-only EXAMPLE workspace (ephemeral —
   *  never in "Your projects", pristine on every open, session edits only). */
  openExample: (referenceId: string) => void;
  /** True while an example workspace is open. */
  isExample: boolean;
  /** Make the open example a real project (session-accepted work carried). */
  duplicateExample: () => StoredProject | null;
  discover: () => Promise<void>;
  rediscover: () => Promise<void>;
  saveContract: (doc: Record<string, any>) => Promise<ComposerFinding[] | { savedInMemory: true }>;
  saveProfile: (doc: Record<string, any>) => Promise<ComposerFinding[] | { savedInMemory: true }>;
  /** Explicit deletion decisions (ledger v2): restore or tombstone an id. */
  resolveDeletion: (id: string, decision: "restore" | "tombstone") => Promise<void>;
  /** Explicit restoredConflict decisions, phrased as intent (ratified). */
  resolveConflict: (id: string, decision: "keep-nested" | "restore-top-level") => Promise<void>;
  clearTombstone: (id: string) => Promise<void>;
  /** Explicit acceptance of one fresh-side fact into a human-owned entry. */
  acceptFreshFact: (componentId: string, fact: FreshFact) => Promise<void>;
  runEmit: () => Promise<void>;
  runValidate: () => void;
  /* ---- Flows (P4: multi-step experiences over existing surfaces) ---- */
  /** The open project's flows. Phase A: browser projects only — agent-mode
   *  and example workspaces load none, and the Flows UI stays hidden there. */
  flows: Flow[];
  /** The single save funnel: sets state and persists through the per-project
   *  store, quota-honest (same notice pattern as the examples delta). */
  saveFlows: (next: Flow[]) => void;
  /* ---- Build (chat-driven creation) ---- */
  buildTurns: BuildTurn[];
  buildBusy: boolean;
  buildModels: string[];
  /** Everything Build's model switch can offer (auto list + configured local). */
  selectableModels: string[];
  /** The active provider/model, shared between Settings and Build. */
  activeModel: string;
  setActiveModel: (m: string) => void;
  /** The run-time config for a configured local provider (null = hosted/scripted). */
  providerConfig: ProviderConfig | null;
  /** Remembered local-provider endpoints + models (no secrets). */
  configuredProviders: StoredProviders;
  /** The OpenAI-compatible credential, held in memory for the session only. */
  openaiKey: string;
  setOpenaiKey: (k: string) => void;
  /** Configure a local provider (remember endpoint + model, make it active). */
  configureLocalProvider: (kind: LocalKind, baseUrl: string, model: string) => void;
  /** Setup completeness for building; reason names the exact remaining work. */
  readiness: BuildReadiness;
  runBuild: (input: { goal: string; modelRef: string; refine?: boolean; intentOverride?: string }) => Promise<void>;
  /** Accept a turn as a worked example; the agent mints the id (#42). */
  acceptBuildTurn: (turnId: number, exampleId?: string) => Promise<void>;
  clearBuildThread: () => void;
}

const Ctx = createContext<ComposerState | null>(null);
export const useComposer = (): ComposerState => {
  const state = useContext(Ctx);
  if (!state) throw new Error("useComposer outside provider");
  return state;
};

export function ComposerProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("demo");
  // The governed design system a demo/blank project builds from. Selecting a
  // different one loads that reference; it never forks the pipeline.
  const [referenceId, setReferenceId] = useState<string>(DEFAULT_REFERENCE);
  // Which example ids are the packaged reference's teaching material (vs the
  // project's own work). Null = every example belongs to the project.
  const [referenceExampleIds, setReferenceExampleIds] = useState<Set<string> | null>(null);
  // Projects are the entry point. `activeProjectId === null` means no project is
  // open — the app shows the Projects hub (first run / after closing).
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  // An open EXAMPLE workspace: a read-only reference project, held ephemeral —
  // never written to storage, never in "Your projects", pristine on every
  // open. Play is allowed (edits are session-only, as the banner says); the
  // way to keep anything is to duplicate it into your projects.
  const [exampleProject, setExampleProject] = useState<StoredProject | null>(null);
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [agentUp, setAgentUp] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
  const [contract, setContract] = useState<Record<string, any> | null>(null);
  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  const [ledger, setLedger] = useState<LedgerStatus | null>(null);
  const [rediscovery, setRediscovery] = useState<RediscoverReport | null>(null);
  const [emit, setEmit] = useState<EmitPayload | null>(null);
  const [validate, setValidate] = useState<ValidatePayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [extraSurfaces, setExtraSurfaces] = useState<Array<{ name: string; surface: unknown }>>([]);
  // The open project's flows (P4). Loaded per project id beside the examples
  // delta; [] for agent projects and example workspaces (Phase A).
  const [flows, setFlows] = useState<Flow[]>([]);
  // Serializes the ledger-decision actions: two rapid clicks would otherwise
  // both compute from the same stale contract closure and the second save
  // would silently drop the first decision. A ref, not state — the guard
  // must hold before React re-renders the disabled buttons.
  const decisionLock = useRef(false);

  useEffect(() => {
    void probeAgent().then(setAgentUp);
  }, []);

  const refreshLedger = useCallback(async (doc: Record<string, any> | null) => {
    setLedger(doc ? await ledgerStatus(doc) : null);
  }, []);

  /**
   * The live loop: every contract/profile change re-emits IN THE BROWSER
   * (the same published implementations the agent runs) so gates, coverage,
   * and fidelity are instant in both modes. The agent's emit remains the
   * twin that writes out/ on save.
   */
  const recomputeEmit = useCallback((doc: Record<string, any> | null, prof: Record<string, any> | null, extras: Array<{ name: string; surface: unknown }> = extraSurfaces) => {
    if (!doc || !prof) {
      setEmit(null);
      return;
    }
    try {
      setEmit(browserEmit(doc, prof, [...contractSurfaces(doc), ...extras]) as EmitPayload);
    } catch (e) {
      setNotice(`Emit failed in the browser: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [extraSurfaces]);

  /**
   * Start a project from a packaged governed design system (shadcn/ui or
   * Astryx). The reference supplies the base vocabulary — contract, profile,
   * and its worked examples as internal generation/teaching context — and the
   * PROJECT owns its authored delta (accepted builds, authored scenarios),
   * merged on top when a projectId is given. The canonical reference is never
   * mutated; the SAME in-browser pipeline runs over whichever reference is
   * chosen — the design system is data, not a code path.
   */
  const loadReference = useCallback((id: string, projectId?: string) => {
    const ref: Reference = REFERENCES[id] ?? REFERENCES[DEFAULT_REFERENCE];
    setReferenceId(ref.id);
    setMode("demo");
    setProjectPath("");
    setManifest(ref.manifest as ProjectManifest);
    const doc = structuredClone(ref.contract);
    const prof = structuredClone(ref.profile);
    const base = ((doc.examples as ExampleEntry[] | undefined) ?? []) as ExampleEntry[];
    setReferenceExampleIds(new Set(base.map((e) => e.id)));
    if (projectId) {
      doc.examples = mergeExamples(base, loadExamplesDelta(projectId));
    }
    // Flows are the project's own work, like the examples delta; an example
    // workspace (no projectId) correctly gets none.
    setFlows(projectId ? loadFlowsStore(projectId) : []);
    setContract(doc);
    setProfile(prof);
    setExtraSurfaces(ref.extraSurfaces);
    recomputeEmit(doc, prof, ref.extraSurfaces);
    setRediscovery(null);
    setValidate(null);
    setSelected(null);
    clearBuildThread();
    void refreshLedger(doc);
  }, [refreshLedger, recomputeEmit]);

  /**
   * Open an imported project: its governed vocabulary travelled in a file and
   * lives inline (keyed by project id). Same in-browser pipeline as a reference
   * — the design system is data — but sourced from the import rather than a
   * bundled reference. A missing/corrupt payload lands on the hub, not a crash.
   */
  const loadImported = useCallback(
    (id: string, name: string) => {
      const vocab = loadVocab(id);
      if (!vocab) {
        setNotice("This imported project’s data could not be read — it may have been cleared. Re-import the file to restore it.");
        setActiveProjectId(null);
        setLastOpened(null);
        return;
      }
      setReferenceId(id);
      setMode("demo");
      setProjectPath("");
      setManifest({
        composerProject: "0.1",
        name,
        adapter: "imported",
        catalogIdBase: "https://composer.aesthetic-function.com/imported",
        contractPath: "contract.dspack.json",
        profilePath: "profile.json",
        outDir: "out",
        previewRegistry: vocab.previewRegistry,
      } as ProjectManifest);
      const doc = structuredClone(vocab.contract) as Record<string, any>;
      const prof = structuredClone(vocab.profile) as Record<string, any>;
      // Everything an imported bundle carries is the project's own; work
      // authored HERE since the import lives in the delta, merged on top.
      setReferenceExampleIds(null);
      doc.examples = mergeExamples(((doc.examples as ExampleEntry[] | undefined) ?? []) as ExampleEntry[], loadExamplesDelta(id));
      setFlows(loadFlowsStore(id));
      setContract(doc);
      setProfile(prof);
      setExtraSurfaces([]);
      recomputeEmit(doc, prof, []);
      setRediscovery(null);
      setValidate(null);
      setSelected(null);
      clearBuildThread();
      setNotice(`Opened “${name}”. This project was imported; it works in this browser. Export again to move it on.`);
      void refreshLedger(doc);
    },
    [refreshLedger, recomputeEmit],
  );

  const connect = useCallback(
    async (path: string) => {
      setBusy("connecting");
      const result = await agentConnect(path);
      setBusy(null);
      if (!result.ok) {
        setNotice(`Connect failed: ${result.error}`);
        return;
      }
      const v = result.value;
      setMode("agent");
      setProjectPath(path);
      setReferenceExampleIds(null); // the contract on disk is the project's own
      // Phase A: flows are a browser-project feature; agent parity (manifest
      // flows + a save-flow route) is Phase B, and the Flows UI hides here.
      setFlows([]);
      setManifest(v.manifest);
      const doc = (v.contract as Record<string, any>) ?? null;
      const prof = (v.profile as Record<string, any>) ?? null;
      setContract(doc);
      setProfile(prof);
      setLedger(v.ledger);
      setExtraSurfaces(v.extraSurfaces ?? []);
      recomputeEmit(doc, prof, v.extraSurfaces ?? []);
      setRediscovery(null);
      setValidate(null);
      setSelected(null);
      clearBuildThread();
      setNotice(v.profileIssue ? `Connected. Profile issue: ${v.profileIssue}` : `Connected to ${path}.`);
    },
    [recomputeEmit],
  );

  /* ---------------- Projects (first-class objects) ---------------- */

  /** Open a stored project by loading the vocabulary its source describes: a
   *  packaged reference is cloned fresh in the browser; an agent project is
   *  reconnected on the user's machine. Identity + recency persist. */
  const openProject = useCallback(
    (id: string) => {
      const p = getProject(id);
      if (!p) {
        setNotice("That project could not be found.");
        return;
      }
      setExampleProject(null);
      setActiveProjectId(p.id);
      setLastOpened(p.id);
      touchProject(p.id);
      setProjects(listProjects());
      if (p.source.kind === "agent") {
        void connect(p.source.path);
      } else if (p.source.kind === "imported") {
        loadImported(p.id, p.name);
      } else {
        loadReference(p.source.referenceId, p.id);
        setNotice(`Opened “${p.name}”. This project works in your browser; connect the local agent to work on real files.`);
      }
    },
    [connect, loadReference, loadImported],
  );

  const newProject = useCallback(
    (input: { name: string; description?: string; source: ProjectSource }) => {
      const p = createProject(input);
      setProjects(listProjects());
      openProject(p.id);
      return p;
    },
    [openProject],
  );

  /**
   * Open a packaged reference as an EXAMPLE workspace: teaching material, not
   * the user's project. Ephemeral by design — no StoredProject, no lastOpened
   * (a reload lands wherever you actually work), pristine on every open, and
   * clearly labeled by the shell. Explore and edit freely; nothing is kept.
   */
  const openExample = useCallback(
    (refId: string) => {
      const ref = REFERENCES[refId];
      if (!ref) return;
      setActiveProjectId(null);
      setLastOpened(null);
      setExampleProject({
        id: `example-${ref.id}`,
        name: `${ref.label} example`,
        description: ref.blurb,
        source: { kind: "reference", referenceId: ref.id },
        createdAt: 0,
        updatedAt: 0,
        lastOpenedAt: 0,
      });
      loadReference(ref.id); // no projectId: pristine, no delta
      setNotice(`${ref.label} example opened — a read-only reference. Explore freely; duplicate it into your projects to keep anything.`);
    },
    [loadReference],
  );

  /**
   * Make the open example yours: a real project on the same reference. Work
   * accepted during the example session (its in-memory examples delta) comes
   * along — "duplicate to keep what you build" is a promise, not a reset.
   */
  const duplicateExample = useCallback(() => {
    const refId = exampleProject?.source.kind === "reference" ? exampleProject.source.referenceId : null;
    const ref = refId ? REFERENCES[refId] : null;
    if (!ref || !refId) return null;
    const base = ((ref.contract.examples as ExampleEntry[] | undefined) ?? []) as ExampleEntry[];
    const live = ((contract?.examples as ExampleEntry[] | undefined) ?? base) as ExampleEntry[];
    const delta = examplesDelta(base, live);
    const p = createProject({ name: `My ${ref.label} project`, description: "", source: { kind: "reference", referenceId: refId } });
    if (delta.length > 0) saveExamplesDelta(p.id, delta);
    setProjects(listProjects());
    openProject(p.id); // clears the example workspace, merges the delta
    return p;
  }, [exampleProject, contract, openProject]);

  /**
   * Import a project from an exported file: validate it (fail-closed — the
   * profile must load), store its governed vocabulary inline, and open it.
   * Returns a typed result so the hub can state a refusal in plain words.
   */
  const importProject = useCallback(
    (text: string): { ok: true; name: string } | { ok: false; error: string } => {
      const parsed = parseProjectImport(text);
      if (!parsed.ok) return parsed;
      const p = createProject({ name: parsed.name, description: parsed.description, source: { kind: "imported" } });
      if (!saveVocab(p.id, parsed.vocab)) {
        rmStoredProject(p.id);
        return { ok: false, error: "This project is too large to keep in the browser, or local storage is full." };
      }
      // Flows travelled in the file (P4): persist them beside the vocabulary.
      // The same rollback applies — rmStoredProject clears vocab AND flows —
      // so a failed import never leaves a project missing part of its work.
      if (parsed.flows.length > 0 && !saveFlowsStore(p.id, parsed.flows)) {
        rmStoredProject(p.id);
        return { ok: false, error: "This project is too large to keep in the browser, or local storage is full." };
      }
      setProjects(listProjects());
      openProject(p.id);
      return { ok: true, name: parsed.name };
    },
    [openProject],
  );

  /**
   * Export a project to a downloadable file — its identity plus its governed
   * vocabulary, nothing machine-specific. The OPEN project exports exactly
   * what's loaded (this session's edits included); a reference or imported
   * project can export from its source without opening; an agent project must
   * be open, because its vocabulary lives on your machine through the agent.
   */
  const exportProject = useCallback(
    (id: string) => {
      const p = getProject(id);
      if (!p) {
        setNotice("That project could not be found.");
        return;
      }
      let vocab: ProjectVocab | null = null;
      if (id === activeProjectId && contract && profile) {
        // The live working contract is already base + authored delta.
        vocab = { contract, profile, previewRegistry: (manifest?.previewRegistry ?? "wireframe") as PreviewRegistry };
      } else if (p.source.kind === "reference") {
        const ref = REFERENCES[p.source.referenceId];
        if (ref) {
          // A closed project still takes its authored work with it: base
          // reference + the persisted delta, exactly what opening would show.
          const base = ((ref.contract.examples as ExampleEntry[] | undefined) ?? []) as ExampleEntry[];
          const merged = { ...ref.contract, examples: mergeExamples(base, loadExamplesDelta(id)) };
          vocab = { contract: merged, profile: ref.profile, previewRegistry: (ref.manifest?.previewRegistry ?? "wireframe") as PreviewRegistry };
        }
      } else if (p.source.kind === "imported") {
        const stored = loadVocab(id);
        if (stored) {
          const base = ((stored.contract.examples as ExampleEntry[] | undefined) ?? []) as ExampleEntry[];
          vocab = { ...stored, contract: { ...stored.contract, examples: mergeExamples(base, loadExamplesDelta(id)) } };
        }
      }
      if (!vocab) {
        setNotice("Open this project first to export it — its vocabulary lives on your machine, through the agent.");
        return;
      }
      // Flows ride along (F6, additive on 0.1): the OPEN project exports its
      // live flows exactly as it exports its live contract; a closed one
      // exports what its store holds — the same work opening would show.
      const projectFlows = id === activeProjectId ? flows : loadFlowsStore(id);
      downloadProjectExport(
        buildProjectExport({ name: p.name, description: p.description, vocab, exportedAt: new Date().toISOString(), flows: projectFlows }),
      );
    },
    [activeProjectId, contract, profile, manifest, flows],
  );

  /** Return to the hub without loading a project (ends an example session). */
  const closeProject = useCallback(() => {
    setActiveProjectId(null);
    setExampleProject(null);
    setLastOpened(null);
    setFlows([]);
    clearBuildThread();
  }, []);

  const renameProject = useCallback((id: string, name: string) => {
    renameStoredProject(id, name);
    setProjects(listProjects());
  }, []);

  const duplicateProject = useCallback((id: string) => {
    const dup = dupStoredProject(id);
    setProjects(listProjects());
    return dup;
  }, []);

  const deleteProject = useCallback(
    (id: string) => {
      rmStoredProject(id);
      setProjects(listProjects());
      if (id === activeProjectId) {
        setActiveProjectId(null);
        setLastOpened(null);
        setFlows([]);
        clearBuildThread();
      }
    },
    [activeProjectId],
  );

  /**
   * The single flows save funnel (P4): state first (the session always keeps
   * working), then the per-project store — the same quota-honest pattern as
   * the examples delta in saveContract. Phase A persists browser projects
   * only; agent-mode flows (manifest + save-flow route) are Phase B, and the
   * Flows UI is hidden there, so nothing routes here in agent mode.
   */
  const saveFlows = useCallback(
    (next: Flow[]) => {
      setFlows(next);
      const p = activeProjectId ? getProject(activeProjectId) : null;
      if (p && p.source.kind !== "agent") {
        if (!saveFlowsStore(p.id, next)) {
          setNotice("Saved for this session, but this browser's storage is full — your flows won't survive a reload. Export the project to keep them.");
        }
      }
    },
    [activeProjectId],
  );

  /** Entry point: reopen the last project if there is one; otherwise land on
   *  the hub with nothing loaded (first run). Projects replaced the auto-demo. */
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    setProjects(listProjects());
    const last = getLastOpened();
    if (last && getProject(last)) openProject(last);
  }, [openProject]);

  const discover = useCallback(async () => {
    if (mode !== "agent") {
      setNotice("Discovery runs dspack-export on your machine — connect a project through the local agent first.");
      return;
    }
    setBusy("discovering");
    const result = await agentDiscover(projectPath);
    setBusy(null);
    if (!result.ok) {
      // dspack-export's refusal table speaks verbatim (e.g. human-owned sections).
      setNotice(`Discovery refused: ${result.error}`);
      return;
    }
    setContract(result.value.contract as Record<string, any>);
    setLedger(result.value.ledger);
    setRediscovery(null);
    recomputeEmit(result.value.contract as Record<string, any>, profile);
    setNotice(`Discovery complete: ${result.value.log}`);
  }, [mode, projectPath, profile, recomputeEmit]);

  /**
   * Section-scoped rediscovery (dspack-export regenerateSections): refresh
   * tool-owned sections, preserve human-owned + governance, add newly
   * discovered components. Refusals are the tool's own words.
   */
  const rediscover = useCallback(async () => {
    if (mode !== "agent") {
      setNotice("Rediscovery re-runs dspack-export on your machine; connect through the local agent first.");
      return;
    }
    setBusy("rediscovering");
    const result = await agentRediscover(projectPath);
    setBusy(null);
    if (!result.ok) {
      setNotice(`Rediscovery refused: ${result.error}`);
      return;
    }
    const v = result.value;
    setContract(v.contract as Record<string, any>);
    setLedger(v.ledger);
    setRediscovery(v.report);
    recomputeEmit(v.contract as Record<string, any>, profile);
    const c = v.report.components;
    const decisions = c.deletedAwaitingDecision.length + c.restoredConflict.length;
    setNotice(
      `Rediscovery merged per entry: ${c.added.length} added, ${c.refreshed.length} refreshed, ${c.unchanged.length} unchanged, ` +
        `${c.preservedEnriched.length} preserved human-owned, ${c.removedWithSource.length} removed with source` +
        (v.report.migration ? ` (ledger migrated to v2, ${v.report.migration} section)` : "") +
        (decisions ? ` — ${decisions} decision(s) awaiting you below.` : "."),
    );
  }, [mode, projectPath, profile, recomputeEmit]);

  const saveContract = useCallback(
    async (doc: Record<string, any>) => {
      setContract(doc);
      void refreshLedger(doc);
      recomputeEmit(doc, profile);
      if (mode !== "agent") {
        // The project's authored delta — worked examples added or edited on
        // top of its base vocabulary — persists per project id. Recomputed
        // fresh from live-vs-base on every save; the canonical reference (or
        // imported snapshot) is never mutated. Everything else about a
        // browser project's contract stays session-only, as the views say.
        const p = activeProjectId ? getProject(activeProjectId) : null;
        if (p && p.source.kind !== "agent") {
          const base =
            p.source.kind === "reference"
              ? (((REFERENCES[p.source.referenceId]?.contract.examples as ExampleEntry[] | undefined) ?? []) as ExampleEntry[])
              : (((loadVocab(p.id)?.contract.examples as ExampleEntry[] | undefined) ?? []) as ExampleEntry[]);
          const live = ((doc.examples as ExampleEntry[] | undefined) ?? []) as ExampleEntry[];
          if (!saveExamplesDelta(p.id, examplesDelta(base, live))) {
            setNotice("Saved for this session, but this browser's storage is full — your work won't survive a reload. Export the project to keep it.");
          }
        }
        return { savedInMemory: true as const };
      }
      const result = await agentSave(projectPath, "contract", doc);
      if (!result.ok) {
        setNotice(`Save failed: ${result.error}`);
        return [];
      }
      if (!result.value.ok) {
        return result.value.findings.map((f) => ({
          gate: "document" as const,
          code: "save",
          severity: "error" as const,
          target: f.target ?? f.path ?? "",
          message: f.message,
        }));
      }
      if (result.value.ledger) setLedger(result.value.ledger);
      setNotice("Contract saved.");
      return [];
    },
    [mode, projectPath, refreshLedger, recomputeEmit, profile, activeProjectId],
  );

  const saveProfile = useCallback(
    async (doc: Record<string, any>) => {
      setProfile(doc);
      recomputeEmit(contract, doc);
      if (mode !== "agent") return { savedInMemory: true as const };
      const result = await agentSave(projectPath, "profile", doc);
      if (!result.ok) {
        setNotice(`Save failed: ${result.error}`);
        return [];
      }
      if (!result.value.ok) {
        return result.value.findings.map((f) => ({
          gate: "profile" as const,
          code: "save",
          severity: "error" as const,
          target: f.target ?? f.path ?? "",
          message: f.message,
        }));
      }
      setNotice("Profile saved.");
      return [];
    },
    [mode, projectPath],
  );

  /**
   * Ledger-v2 decisions. Every one is a named human action on the contract
   * document — the tool computes the edit, the person authorizes it, the
   * ordinary save path (ledger-preserving, shape-gated) persists it.
   */
  const resolveDeletion = useCallback(
    async (id: string, decision: "restore" | "tombstone") => {
      if (!contract || decisionLock.current) return;
      decisionLock.current = true;
      setBusy(decision === "restore" ? "restoring" : "tombstoning");
      try {
      const result = decision === "restore" ? restoreComponent(contract, id) : addTombstone(contract, id);
      if (!result.ok) {
        setNotice(`Cannot ${decision} '${id}': ${result.reason}`);
        return;
      }
      await saveContract(result.document);
      setRediscovery((r) =>
        r
          ? {
              ...r,
              components: {
                ...r.components,
                deletedAwaitingDecision: r.components.deletedAwaitingDecision.filter((d) => d !== id),
                ...(decision === "tombstone" ? { suppressed: [...r.components.suppressed, id] } : {}),
              },
            }
          : r,
      );
      setNotice(
        decision === "restore"
          ? `'${id}' will be restored from source on the next rediscovery (deletion memory cleared).`
          : `'${id}' tombstoned: rediscovery will never re-add it. Remove the tombstone in the Repository view to undo.`,
      );
      } finally {
        decisionLock.current = false;
        setBusy(null);
      }
    },
    [contract, saveContract],
  );

  /**
   * The ratified restoredConflict outcomes, phrased as intent:
   * - keep nested: tombstone the id + retire the memory (a document edit
   *   saved through the ordinary ledger-preserving path); the conflict
   *   stops reporting on subsequent rediscoveries.
   * - restore top-level: a one-shot explicit intent passed to the tool —
   *   the entry returns from fresh extraction as tool-owned alongside the
   *   nested authored one. Refusals are the tool's words verbatim.
   * Not calling either is the third outcome: nothing changes, the memory
   * and the report persist.
   */
  const resolveConflict = useCallback(
    async (id: string, decision: "keep-nested" | "restore-top-level") => {
      if (!contract || decisionLock.current) return;
      decisionLock.current = true;
      setBusy(decision === "keep-nested" ? "keeping nested" : "restoring");
      try {
      if (decision === "keep-nested") {
        const result = addTombstone(contract, id);
        if (!result.ok) {
          setNotice(`Cannot keep '${id}' nested: ${result.reason}`);
          return;
        }
        await saveContract(result.document);
        setRediscovery((r) =>
          r
            ? {
                ...r,
                components: {
                  ...r.components,
                  restoredConflict: r.components.restoredConflict.filter((c) => c.id !== id),
                  suppressed: [...r.components.suppressed, id],
                },
              }
            : r,
        );
        setNotice(`Keeping '${id}' nested: rediscovery will never re-add the top-level entry (tombstoned; removable in the Repository view).`);
        return;
      }
      if (mode !== "agent") {
        setNotice("Restoring the top-level entry re-runs dspack-export on your machine; connect through the local agent first.");
        return;
      }
      const result = await agentRediscover(projectPath, [id]);
      if (!result.ok) {
        setNotice(`Restore refused: ${result.error}`);
        return;
      }
      const v = result.value;
      setContract(v.contract as Record<string, any>);
      setLedger(v.ledger);
      setRediscovery(v.report);
      recomputeEmit(v.contract as Record<string, any>, profile);
      setNotice(`'${id}' restored as a top-level component (tool-owned); your nested representation is untouched — both now exist.`);
      } finally {
        decisionLock.current = false;
        setBusy(null);
      }
    },
    [contract, mode, projectPath, profile, recomputeEmit, saveContract],
  );

  const clearTombstone = useCallback(
    async (id: string) => {
      if (!contract || decisionLock.current) return;
      decisionLock.current = true;
      setBusy("removing tombstone");
      try {
      const result = removeTombstone(contract, id);
      if (!result.ok) {
        setNotice(`Cannot remove tombstone '${id}': ${result.reason}`);
        return;
      }
      await saveContract(result.document);
      setNotice(`Tombstone removed: the next rediscovery may re-add '${id}'.`);
      } finally {
        decisionLock.current = false;
        setBusy(null);
      }
    },
    [contract, saveContract],
  );

  const acceptFreshFact = useCallback(
    async (componentId: string, fact: FreshFact) => {
      if (!contract || decisionLock.current) return;
      decisionLock.current = true;
      setBusy("accepting");
      try {
      const result = applyFreshFact(contract, componentId, fact);
      if (!result.ok) {
        setNotice(`Cannot accept ${fact.path} on '${componentId}': ${result.reason}`);
        return;
      }
      await saveContract(result.document);
      setRediscovery((r) =>
        r
          ? {
              ...r,
              components: {
                ...r.components,
                preservedEnriched: r.components.preservedEnriched.map((p) =>
                  p.id === componentId ? { ...p, freshDelta: p.freshDelta.filter((f) => f.path !== fact.path) } : p,
                ),
              },
            }
          : r,
      );
      setNotice(`Accepted ${fact.path} into '${componentId}' (the entry stays human-owned).`);
      } finally {
        decisionLock.current = false;
        setBusy(null);
      }
    },
    [contract, saveContract],
  );

  /* ---------------- Build (chat-driven creation) ---------------- */
  const [buildTurns, setBuildTurns] = useState<BuildTurn[]>([]);
  const [buildBusy, setBuildBusy] = useState(false);
  const [buildModels, setBuildModels] = useState<string[]>(["scripted"]);
  // The auto-select correction below must NOT run against the ["scripted"]
  // placeholder before the first real fetch: that list omits "hosted-ai", so
  // correcting against it would silently downgrade a stored, deliberately-
  // chosen Hosted to scripted on every reload. Flip once a real fetch lands.
  const modelsLoaded = useRef(false);
  // Configured local providers (remembered endpoint + model per provider; NO
  // secret) and the active model ref persist across reloads. The OpenAI-
  // compatible key is held in memory for the session only — never written to
  // storage, never leaves for anywhere but the agent.
  const [storedProviders, setStoredProviders] = useState<StoredProviders>(() => loadStoredProviders());
  const [openaiKey, setOpenaiKey] = useState<string>("");
  const [activeModel, setActiveModelRaw] = useState<string>(() => loadStoredProviders().active ?? "");
  const buildStream = useRef<{ cancel(): void } | null>(null);
  const turnSeq = useRef(0);

  // Selecting a model persists it, so a reload reopens the same provider.
  const setActiveModel = useCallback((ref: string) => {
    setActiveModelRaw(ref);
    setStoredProviders((s) => {
      const next = { ...s, active: ref };
      saveStoredProviders(next);
      return next;
    });
  }, []);

  // Configure a local provider from Settings: remember its endpoint + model and
  // make it active. Any credential stays in memory via setOpenaiKey.
  const configureLocalProvider = useCallback((kind: LocalKind, baseUrl: string, model: string) => {
    const ref = `${kind}:${model}`;
    setStoredProviders((s) => {
      const next: StoredProviders = { ...s, [kind]: { baseUrl, model }, active: ref };
      saveStoredProviders(next);
      return next;
    });
    setActiveModelRaw(ref);
  }, []);

  // The run-time provider config is DERIVED from the active ref + the remembered
  // endpoint + the in-memory key — one source of truth, nothing to keep in sync.
  const providerConfig = useMemo<ProviderConfig | null>(() => {
    const kind = localKindOf(activeModel);
    if (!kind) return null;
    const remembered = kind === "ollama" ? storedProviders.ollama : storedProviders.openai;
    return {
      kind,
      model: modelOf(activeModel),
      ...(remembered?.baseUrl ? { baseUrl: remembered.baseUrl } : {}),
      ...(kind === "openai" && openaiKey ? { apiKey: openaiKey } : {}),
    };
  }, [activeModel, storedProviders, openaiKey]);

  useEffect(() => {
    // Both providers can be reachable at once, so offer the UNION. The hosted
    // ORIGIN alone decides whether "hosted-ai" is available (scripted alone, or
    // scripted + hosted-ai when the deployed AI Gateway Worker is live) — that
    // answer is independent of the agent, so hostedModels() is always consulted.
    // When the agent is up, its models (scripted + any local Ollama) join the
    // list. Net effect: Hosted stays selectable alongside Local whenever both
    // are reachable, instead of dropping out the moment the agent connects.
    let cancelled = false;
    const sources = agentUp ? [hostedModels(), agentModels()] : [hostedModels()];
    void Promise.all(sources).then((lists) => {
      if (cancelled) return;
      modelsLoaded.current = true;
      setBuildModels([...new Set(lists.flat())]);
    });
    return () => {
      cancelled = true;
    };
  }, [agentUp]);

  // Keep the active model valid: a configured LOCAL provider (any local ref) is
  // honored even when absent from the auto-discovered list; a valid current
  // choice (Hosted included, now that the union keeps it in the list) is left
  // alone; otherwise fall back to hosted (the wow moment) or scripted. Skip the
  // pre-fetch placeholder: correcting against ["scripted"] would clobber a
  // deliberately chosen Hosted before the real list arrives.
  useEffect(() => {
    if (!modelsLoaded.current) return;
    setActiveModelRaw((cur) => {
      if (cur && (buildModels.includes(cur) || isLocalRef(cur))) return cur;
      if (mode !== "agent" && buildModels.includes("hosted-ai")) return "hosted-ai";
      if (agentUp && buildModels.some((m) => m.startsWith("ollama:"))) return buildModels.find((m) => m.startsWith("ollama:"))!;
      return buildModels[0] ?? "scripted";
    });
  }, [buildModels, mode, agentUp]);

  // What Build's model switch offers: the auto list plus any configured local
  // provider and the current active ref (so an OpenAI/custom model is present).
  const selectableModels = useMemo(() => {
    const set = new Set<string>(buildModels);
    if (storedProviders.ollama) set.add(`ollama:${storedProviders.ollama.model}`);
    if (storedProviders.openai) set.add(`openai:${storedProviders.openai.model}`);
    if (activeModel) set.add(activeModel);
    return [...set];
  }, [buildModels, storedProviders, activeModel]);

  const readiness = useMemo(
    () => buildReadiness({ contract, profile, findings: emit ? emit.findings : null, emitOk: emit?.ok ?? false }),
    [contract, profile, emit],
  );

  const clearBuildThread = useCallback(() => {
    buildStream.current?.cancel();
    buildStream.current = null;
    setBuildTurns([]);
    setBuildBusy(false);
  }, []);

  /**
   * One chat turn, GOAL-FIRST: the user describes an outcome; the Composer
   * (1) infers the governed context (intent) + judges whether the approved
   * vocabulary can express it, then (2) runs the unchanged deterministic
   * pipeline under that context. Intent is inferred, never a prerequisite. A
   * vocabulary gap becomes a conversational turn (loop #2), not a silent
   * failure. A refinement preserves the ORIGINAL goal's context and seeds the
   * prior surface; every gate runs again; prior turns stay for audit.
   */
  const runBuild = useCallback(
    async (input: { goal: string; modelRef: string; refine?: boolean; intentOverride?: string }) => {
      if (buildBusy) return;
      if (!contract || !profile) {
        setNotice("No project loaded yet.");
        return;
      }
      // A local provider runs through the agent; without it, don't silently
      // fall back to a different provider — say so and stop.
      if (isLocalRef(input.modelRef) && !agentUp) {
        setNotice("This model runs on your machine through the local agent, which isn’t running. Start it (pnpm --filter agent dev), or choose Hosted or Scripted in Settings.");
        return;
      }
      // Only a completed, passing turn can seed a refinement (#43).
      const prior = input.refine ? [...buildTurns].reverse().find((t) => canRefineTurn(t.progress)) : undefined;
      if (input.refine && !prior) {
        setNotice("Nothing to refine yet — refinement starts from a completed build that passed its gates.");
        return;
      }
      setBuildBusy(true);
      const id = ++turnSeq.current;
      const turn: BuildTurn = {
        id,
        prompt: input.goal,
        intent: prior?.intent ?? "",
        modelRef: input.modelRef,
        refinement: !!prior,
        ...(prior ? { parentId: prior.id } : {}),
        progress: { status: "streaming", attempts: [] },
        gaps: [],
        kind: "surface",
        planPending: !prior,
      };
      setBuildTurns((prev) => [...prev, turn]);

      // --- ROUTE: infer the governed context (fresh builds only; a refinement
      // keeps the original goal's context so it never re-routes mid-thread) ---
      let plan: GoalPlan;
      if (prior?.plan) {
        plan = prior.plan;
      } else {
        plan = await planGoal(input.goal, input.modelRef, contract);
        if (input.intentOverride) plan = { ...plan, intent: input.intentOverride, source: "model" };
      }
      const intent = input.intentOverride ?? plan.intent;
      setBuildTurns((prev) => prev.map((t) => (t.id === id ? { ...t, plan, intent, planPending: false } : t)));

      // --- GAP: the approved vocabulary cannot express this goal. No generation
      // is attempted (inventing a component would violate governance); the gap
      // is surfaced conversationally as the bridge toward catalog evolution. ---
      if (!prior && plan.feasible === false && plan.missingCapability) {
        setBuildTurns((prev) =>
          prev.map((t) => (t.id === id ? { ...t, kind: "vocab-gap", progress: { status: "finished", attempts: [] } } : t)),
        );
        buildStream.current = null;
        setBuildBusy(false);
        return;
      }

      // --- GENERATE: the SAME deterministic pipeline, now under the inferred
      // context. Two homes (agent over your files; browser over the demo);
      // both stream identical AG-UI events into foldBuildEvents. ---
      const events: Array<Record<string, unknown>> = [];
      const update = () => {
        const progress = foldBuildEvents(events);
        setBuildTurns((prev) => prev.map((t) => (t.id === id ? { ...t, progress, gaps: vocabularyGap(progress) } : t)));
      };
      const runInput = {
        path: projectPath,
        // Fresh builds generate from the model's clean restatement of the goal;
        // refinements carry the raw instruction against the prior surface.
        prompt: prior ? input.goal : plan.restated,
        intent,
        modelRef: input.modelRef,
        // A configured LOCAL provider (Ollama/OpenAI-compatible) rides along so
        // the agent runs the request against your own model.
        ...(providerConfig ? { provider: providerConfig } : {}),
        ...(prior
          ? { conversation: [
              { role: "user" as const, content: prior.prompt },
              { role: "assistant" as const, content: JSON.stringify(prior.progress.surface) },
            ] }
          : {}),
      };
      // Route by PROVIDER first, so the invariant holds wherever a ref is
      // selectable. Hosted became offerable alongside local models the moment
      // the agent is up (the union above), and it must ALWAYS run through the
      // in-browser AI Gateway twin (/api/propose) — never the agent, which has
      // no "hosted-ai" adapter and would fail on it. One pipeline, four homes:
      //   • hosted-ai              → the in-browser twin (/api/propose), any mode;
      //   • agent project          → the agent over your files (/project/run);
      //   • hosted/reference + LOCAL → the agent over the browser-supplied
      //     vocabulary (/generate) — how a hosted project runs your own model;
      //   • hosted/reference + scripted → the in-browser twin.
      const inBrowser = (inp: typeof runInput, handlers: Parameters<typeof streamHostedBuild>[1]) =>
        streamHostedBuild(inp, handlers, { contract, profile });
      const runStream =
        input.modelRef === "hosted-ai"
          ? inBrowser
          : mode === "agent"
            ? streamProjectRun
            : isLocalRef(input.modelRef)
              ? (inp: typeof runInput, handlers: Parameters<typeof streamHostedBuild>[1]) =>
                  streamAgentInline(inp, handlers, { contract, profile })
              : inBrowser;
      await new Promise<void>((resolve) => {
        buildStream.current = runStream(runInput, {
          onEvent: (event) => {
            events.push(event);
            update();
          },
          onError: (message) => {
            events.push({ type: "RUN_ERROR", message });
            update();
            resolve();
          },
          onComplete: () => resolve(),
        });
      });
      buildStream.current = null;
      setBuildBusy(false);
    },
    [mode, projectPath, buildBusy, buildTurns, contract, profile, providerConfig, agentUp],
  );

  /**
   * Accept = the server-side fail-closed save: the agent re-lints the
   * surface and refuses anything unresolved; a passing save lands the
   * result as a worked example bound to the turn's intent — the ONLY save
   * format — and immediately joins that intent's few-shot corpus.
   */
  const acceptBuildTurn = useCallback(
    async (turnId: number, exampleId?: string) => {
      if (!contract || decisionLock.current) return;
      const turn = buildTurns.find((t) => t.id === turnId);
      if (!turn?.progress.surface || turn.progress.outcome !== "passed") {
        setNotice("Only a fully completed, gate-green run can be accepted.");
        return;
      }
      decisionLock.current = true;
      setBusy("accepting build result");
      try {
        // Truthful provenance: walk back to the ORIGINAL ask and record the
        // refinements that shaped this surface (#42).
        const chain: string[] = [];
        for (let t: BuildTurn | undefined = turn; t; t = t.parentId ? buildTurns.find((x) => x.id === t!.parentId) : undefined) {
          chain.unshift(t.prompt);
        }
        const prompt = examplePromptFor(chain);

        if (mode !== "agent") {
          // Browser projects accept in the browser: the same deterministic
          // gate the agent applies, run here — S1–S3 over the project
          // contract, an authored intent, a collision-free id — then the
          // surface joins the project's authored delta (persisted per
          // project; the canonical reference is never touched). The agent is
          // for writing to a real repository on disk, not a prerequisite for
          // owning browser-authored work.
          const intents = ((contract.intents as Array<{ id: string }> | undefined) ?? []).map((i) => i.id);
          if (!intents.includes(turn.intent)) {
            setNotice(`Accept refused: '${turn.intent}' is not an intent this project's contract authors (${intents.join(", ") || "none"}).`);
            return;
          }
          const existing = (((contract.examples as ExampleEntry[] | undefined) ?? []) as ExampleEntry[]).map((e) => e.id);
          const requested = exampleId?.trim() ?? "";
          if (requested && !/^ex\.[a-z0-9][a-z0-9-]*$/.test(requested)) {
            setNotice("Accept refused: the example id must be kebab-case with the 'ex.' prefix.");
            return;
          }
          if (requested && existing.includes(requested)) {
            setNotice(`Accept refused: '${requested}' already exists in this project; accepting never overwrites an example. Choose another id, or leave it blank.`);
            return;
          }
          const id = requested || nextChatExampleId(existing);
          const findings = lintOneSurface(id, turn.progress.surface, contract).filter((f) => f.severity === "error");
          if (findings.length > 0) {
            setNotice(`Accept refused: ${findings.map((f) => `${f.gate} ${f.code}: ${f.message}`).join(" · ").slice(0, 400)}`);
            setBuildTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, acceptFindings: findings } : t)));
            return;
          }
          const entry: ExampleEntry = {
            id,
            intent: turn.intent,
            name: `Chat: ${chain[0].slice(0, 60)}`,
            prompt,
            surface: turn.progress.surface,
          };
          const doc = structuredClone(contract);
          doc.examples = [...(((doc.examples as ExampleEntry[] | undefined) ?? []) as ExampleEntry[]), entry];
          await saveContract(doc);
          setBuildTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, accepted: id, acceptFindings: undefined } : t)));
          setNotice(
            activeProjectId
              ? `Accepted as '${id}' — saved to this project in your browser; it now seeds generation for '${turn.intent}'.`
              : `Accepted as '${id}' for this session — duplicate this example into your projects to keep it.`,
          );
          return;
        }

        const result = await agentSaveExample(projectPath, {
          ...(exampleId ? { id: exampleId } : {}), // omitted ⇒ the agent mints a collision-free id
          intent: turn.intent,
          name: `Chat: ${chain[0].slice(0, 60)}`,
          prompt,
          surface: turn.progress.surface,
        });
        if (!result.ok) {
          // Structured gate reasons, never a bare HTTP status (#41).
          const detail = result.findings?.length
            ? result.findings.map((f) => `${f.gate} ${f.code}: ${f.message}`).join(" · ")
            : result.error;
          setNotice(`Accept refused: ${detail}`);
          setBuildTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, acceptFindings: result.findings ?? [] } : t)));
          return;
        }
        if (!result.value.ok) {
          setNotice(`Accept refused: ${result.value.findings.map((f) => `${f.gate} ${f.code}: ${f.message}`).join(" · ").slice(0, 400)}`);
          setBuildTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, acceptFindings: result.value.findings } : t)));
          return;
        }
        if (result.value.ledger) setLedger(result.value.ledger);
        const doc = structuredClone(contract);
        const examples = ((doc.examples as unknown[] | undefined) ?? []) as Array<{ id: string }>;
        const at = examples.findIndex((e) => e.id === exampleId);
        if (at >= 0) examples[at] = result.value.example as never;
        else examples.push(result.value.example as never);
        doc.examples = examples;
        setContract(doc);
        recomputeEmit(doc, profile);
        const savedId = result.value.example?.id ?? exampleId ?? "";
        setBuildTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, accepted: savedId, acceptFindings: undefined } : t)));
        setNotice(`Accepted as worked example '${savedId}' — it now seeds generation for '${turn.intent}'.`);
      } finally {
        decisionLock.current = false;
        setBusy(null);
      }
    },
    [contract, profile, projectPath, buildTurns, recomputeEmit, mode, saveContract, activeProjectId],
  );

  const runEmit = useCallback(async () => {
    if (mode !== "agent") {
      setNotice("The catalog re-emits automatically in this browser on every change. Connect the local agent to write the emitted files into your repository.");
      return;
    }
    setBusy("emitting");
    const result = await agentEmit(projectPath);
    setBusy(null);
    if (!result.ok) {
      setNotice(`Emit failed: ${result.error}`);
      return;
    }
    setEmit(result.value);
    setNotice(result.value.ok ? "Emitted: catalog gates green." : "Emitted with failures — see Checks.");
  }, [mode, projectPath]);

  /**
   * Validation runs FULLY in the browser in both modes now: the dspack
   * harness is importable (spec lib), S1–S3 come from dspack-gen/core, and
   * the wording is the CLI's by construction. Synchronous and instant.
   */
  const runValidate = useCallback(() => {
    if (!contract) return;
    const findings: ComposerFinding[] = [...validateContract(contract)];
    for (const { name, surface } of contractSurfaces(contract)) {
      findings.push(...lintOneSurface(name, surface, contract));
    }
    // Flow-lint (P4): validates the project's flows as REFERENCES over the
    // emit corpus — dangling surfaces, duplicate ids, reserved `on` targets,
    // advance names against emitted actions. Additive: with no flows, the
    // findings are byte-identical to before flows existed.
    if (flows.length > 0) {
      const corpus = emit?.surfaces ?? contractSurfaces(contract);
      findings.push(
        ...flowLint(flows, {
          exampleIds: new Set(corpus.map((s) => s.name)),
          actionsBySurface: emittedActionsBySurface(emit?.surfaces ?? []),
        }),
      );
    }
    setValidate({ ok: findings.every((f) => f.severity !== "error"), findings });
  }, [contract, emit, flows]);

  const activeProject: StoredProject | null =
    exampleProject ?? (activeProjectId ? projects.find((p) => p.id === activeProjectId) ?? getProject(activeProjectId) : null);

  const value = useMemo<ComposerState>(
    () => ({
      mode,
      agentUp,
      projectPath,
      manifest,
      contract,
      profile,
      ledger,
      rediscovery,
      emit,
      validate,
      busy,
      notice,
      selected,
      setSelected,
      connect,
      referenceId,
      loadReference,
      referenceExampleIds,
      references: REFERENCE_LIST,
      projects,
      activeProject,
      newProject,
      openProject,
      closeProject,
      renameProject,
      duplicateProject,
      deleteProject,
      importProject,
      exportProject,
      openExample,
      isExample: exampleProject !== null,
      duplicateExample,
      discover,
      rediscover,
      saveContract,
      saveProfile,
      resolveDeletion,
      resolveConflict,
      clearTombstone,
      acceptFreshFact,
      runEmit,
      runValidate,
      flows,
      saveFlows,
      buildTurns,
      buildBusy,
      buildModels,
      selectableModels,
      activeModel,
      setActiveModel,
      providerConfig,
      configuredProviders: storedProviders,
      openaiKey,
      setOpenaiKey,
      configureLocalProvider,
      readiness,
      runBuild,
      acceptBuildTurn,
      clearBuildThread,
    }),
    [mode, agentUp, projectPath, manifest, contract, profile, ledger, rediscovery, emit, validate, busy, notice, selected, connect, referenceId, loadReference, referenceExampleIds, projects, activeProject, newProject, openProject, closeProject, renameProject, duplicateProject, deleteProject, importProject, exportProject, openExample, exampleProject, duplicateExample, discover, rediscover, saveContract, saveProfile, resolveDeletion, resolveConflict, clearTombstone, acceptFreshFact, runEmit, runValidate, flows, saveFlows, buildTurns, buildBusy, buildModels, selectableModels, activeModel, setActiveModel, providerConfig, storedProviders, openaiKey, configureLocalProvider, readiness, runBuild, acceptBuildTurn, clearBuildThread],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
