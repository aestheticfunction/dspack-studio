"use client";

/**
 * Composer state: one context holding the project documents plus the latest
 * emit/validate results. Two modes, stated plainly in the UI:
 *   - "agent": a local project directory via the agent; saves persist.
 *   - "demo":  the shipped Acme UI demo project (pre-emitted at build time);
 *              edits live in memory only.
 * Files are the source of truth; this state is a view of them.
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
  type EmitPayload,
  type RediscoverReport,
  type ValidatePayload,
} from "./agent-client";
import { browserEmit, contractSurfaces, lintOneSurface, validateContract } from "./validation";
import { streamHostedBuild } from "./hosted-build";
import { planGoal } from "./planning";
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
  loadDemo: () => void;
  /** The governed design system the current demo/blank project builds from. */
  referenceId: string;
  /** Start a blank project from a packaged reference (shadcn/ui or Astryx). */
  loadReference: (id: string) => void;
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
  /* ---- Build (chat-driven creation) ---- */
  buildTurns: BuildTurn[];
  buildBusy: boolean;
  buildModels: string[];
  /** The active provider/model, shared between Settings and Build. */
  activeModel: string;
  setActiveModel: (m: string) => void;
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
  // Projects are the entry point. `activeProjectId === null` means no project is
  // open — the app shows the Projects hub (first run / after closing).
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
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
   * Start a blank project from a packaged governed design system (shadcn/ui or
   * Astryx). "Blank" is a NEW project seeded with that reference's vocabulary —
   * never empty. The SAME in-browser pipeline runs over whichever reference is
   * chosen; the design system is data, not a code path.
   */
  const loadReference = useCallback((id: string) => {
    const ref: Reference = REFERENCES[id] ?? REFERENCES[DEFAULT_REFERENCE];
    setReferenceId(ref.id);
    setMode("demo");
    setProjectPath("");
    setManifest(ref.manifest as ProjectManifest);
    const doc = structuredClone(ref.contract);
    const prof = structuredClone(ref.profile);
    setContract(doc);
    setProfile(prof);
    setExtraSurfaces(ref.extraSurfaces);
    recomputeEmit(doc, prof, ref.extraSurfaces);
    setRediscovery(null);
    setValidate(null);
    setSelected(null);
    clearBuildThread();
    setNotice(
      `${ref.label} project loaded. Edits stay in memory and every gate runs live in this browser; run the local agent to work on real files.`,
    );
    void refreshLedger(doc);
  }, [refreshLedger, recomputeEmit]);

  // Load a reference's vocabulary directly (used by openProject and quick-start).
  const loadDemo = useCallback(() => loadReference(DEFAULT_REFERENCE), [loadReference]);

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
      setContract(doc);
      setProfile(prof);
      setExtraSurfaces([]);
      recomputeEmit(doc, prof, []);
      setRediscovery(null);
      setValidate(null);
      setSelected(null);
      clearBuildThread();
      setNotice(`Opened “${name}”. This project was imported; edits stay in this browser. Export again to move it on.`);
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
      setActiveProjectId(p.id);
      setLastOpened(p.id);
      touchProject(p.id);
      setProjects(listProjects());
      if (p.source.kind === "agent") {
        void connect(p.source.path);
      } else if (p.source.kind === "imported") {
        loadImported(p.id, p.name);
      } else {
        loadReference(p.source.referenceId);
        setNotice(`Opened “${p.name}”. Edits stay in this browser; connect the local agent to work on real files.`);
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
        vocab = { contract, profile, previewRegistry: (manifest?.previewRegistry ?? "wireframe") as PreviewRegistry };
      } else if (p.source.kind === "reference") {
        const ref = REFERENCES[p.source.referenceId];
        if (ref) vocab = { contract: ref.contract, profile: ref.profile, previewRegistry: (ref.manifest?.previewRegistry ?? "wireframe") as PreviewRegistry };
      } else if (p.source.kind === "imported") {
        vocab = loadVocab(id);
      }
      if (!vocab) {
        setNotice("Open this project first to export it — its vocabulary lives on your machine, through the agent.");
        return;
      }
      downloadProjectExport(buildProjectExport({ name: p.name, description: p.description, vocab, exportedAt: new Date().toISOString() }));
    },
    [activeProjectId, contract, profile, manifest],
  );

  /** Return to the hub without loading a project. */
  const closeProject = useCallback(() => {
    setActiveProjectId(null);
    setLastOpened(null);
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
        clearBuildThread();
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
      if (mode !== "agent") return { savedInMemory: true as const };
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
    [mode, projectPath, refreshLedger],
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
          : `'${id}' tombstoned: rediscovery will never re-add it. Remove the tombstone from the Ownership panel to undo.`,
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
        setNotice(`Keeping '${id}' nested: rediscovery will never re-add the top-level entry (tombstoned; removable in the Ownership panel).`);
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
  // The active provider/model — shared so Settings configures it and Build
  // reflects it. Provider choice changes proposal generation, never the product.
  const [activeModel, setActiveModel] = useState<string>("");
  const buildStream = useRef<{ cancel(): void } | null>(null);
  const turnSeq = useRef(0);

  useEffect(() => {
    // Agent up → the agent's models (scripted + any local Ollama). Otherwise the
    // hosted origin decides: scripted alone, or scripted + hosted-ai when the
    // deployed AI Gateway Worker is live.
    if (agentUp) void agentModels().then(setBuildModels);
    else void hostedModels().then(setBuildModels);
  }, [agentUp]);

  // Keep the active model valid and defaulted to the best available: managed
  // hosted AI is the wow moment; agent + offline fall back to scripted.
  useEffect(() => {
    setActiveModel((cur) => {
      if (cur && buildModels.includes(cur)) return cur;
      if (mode !== "agent" && buildModels.includes("hosted-ai")) return "hosted-ai";
      if (agentUp && buildModels.some((m) => m.startsWith("ollama:"))) return buildModels.find((m) => m.startsWith("ollama:"))!;
      return buildModels[0] ?? "scripted";
    });
  }, [buildModels, mode, agentUp]);

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
        ...(prior
          ? { conversation: [
              { role: "user" as const, content: prior.prompt },
              { role: "assistant" as const, content: JSON.stringify(prior.progress.surface) },
            ] }
          : {}),
      };
      // Same signature, same events, same downstream pipeline. The hosted twin
      // gets the ACTIVE reference's documents so any design system traverses it;
      // the agent runs over the connected project's own files.
      const runStream =
        mode === "agent"
          ? streamProjectRun
          : (inp: typeof runInput, handlers: Parameters<typeof streamHostedBuild>[1]) =>
              streamHostedBuild(inp, handlers, { contract, profile });
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
    [mode, projectPath, buildBusy, buildTurns, contract, profile],
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
    [contract, profile, projectPath, buildTurns, recomputeEmit],
  );

  const runEmit = useCallback(async () => {
    if (mode !== "agent") {
      setNotice("Live re-emission runs dspack-emit on your files — the demo shows the build-time emit. Connect through the local agent to re-emit.");
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
    setNotice(result.value.ok ? "Emitted: catalog gates green." : "Emitted with failures — see Validate.");
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
    setValidate({ ok: findings.every((f) => f.severity !== "error"), findings });
  }, [contract]);

  const activeProject: StoredProject | null = activeProjectId
    ? projects.find((p) => p.id === activeProjectId) ?? getProject(activeProjectId)
    : null;

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
      loadDemo,
      referenceId,
      loadReference,
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
      buildTurns,
      buildBusy,
      buildModels,
      activeModel,
      setActiveModel,
      readiness,
      runBuild,
      acceptBuildTurn,
      clearBuildThread,
    }),
    [mode, agentUp, projectPath, manifest, contract, profile, ledger, rediscovery, emit, validate, busy, notice, selected, connect, loadDemo, referenceId, loadReference, projects, activeProject, newProject, openProject, closeProject, renameProject, duplicateProject, deleteProject, importProject, exportProject, discover, rediscover, saveContract, saveProfile, resolveDeletion, resolveConflict, clearTombstone, acceptFreshFact, runEmit, runValidate, buildTurns, buildBusy, buildModels, activeModel, readiness, runBuild, acceptBuildTurn, clearBuildThread],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
