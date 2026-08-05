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
  type LedgerStatus,
  type ProjectManifest,
} from "@dspack-studio/composer-core";
import {
  agentConnect,
  agentDiscover,
  agentEmit,
  agentModels,
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
import { DEMO_CONTRACT, DEMO_EXTRA_SURFACES, DEMO_MANIFEST, DEMO_PROFILE } from "./demo-data";

export type Mode = "demo" | "agent";

/** One chat turn in the Build thread: the ask, its run, and its result. */
export interface BuildTurn {
  id: number;
  prompt: string;
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
  /** Setup completeness for building; reason names the exact remaining work. */
  readiness: BuildReadiness;
  runBuild: (input: { prompt: string; intent: string; modelRef: string; refine?: boolean }) => Promise<void>;
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

  const loadDemo = useCallback(() => {
    setMode("demo");
    setProjectPath("");
    setManifest(DEMO_MANIFEST as ProjectManifest);
    const doc = structuredClone(DEMO_CONTRACT);
    const prof = structuredClone(DEMO_PROFILE);
    setContract(doc);
    setProfile(prof);
    setExtraSurfaces(DEMO_EXTRA_SURFACES);
    recomputeEmit(doc, prof, DEMO_EXTRA_SURFACES);
    setRediscovery(null);
    setValidate(null);
    setSelected(null);
    clearBuildThread();
    setNotice("Demo project loaded. Edits stay in memory and every gate runs live in this browser; run the local agent to work on real files.");
    void refreshLedger(doc);
  }, [refreshLedger, recomputeEmit]);

  /**
   * The demo is the STARTING state, not a state to fall back into: this
   * effect must fire once. Tracking loadDemo's identity re-ran it whenever
   * its dependencies changed — including `extraSurfaces`, which `connect`
   * sets — so connecting to a real project snapped straight back to the
   * demo and agent mode was unreachable in the built app.
   */
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    loadDemo();
  }, [loadDemo]);

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
  const buildStream = useRef<{ cancel(): void } | null>(null);
  const turnSeq = useRef(0);

  useEffect(() => {
    if (agentUp) void agentModels().then(setBuildModels);
  }, [agentUp]);

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
   * One chat turn: stream the governed pipeline for the ask. A refinement
   * seeds the conversation with the PRIOR turn's ask + generated surface —
   * the model regenerates a COMPLETE surface; every gate runs again; prior
   * turns stay in the thread for comparison and audit.
   */
  const runBuild = useCallback(
    async (input: { prompt: string; intent: string; modelRef: string; refine?: boolean }) => {
      if (mode !== "agent") {
        setNotice("Building runs generation on your machine — connect a project through the local agent first.");
        return;
      }
      if (buildBusy) return;
      // Only a completed, passing turn can seed a refinement (#43): a failed
      // turn still carries its last attempt's surface, and seeding that
      // regenerates from something the contract already rejected.
      const prior = input.refine ? [...buildTurns].reverse().find((t) => canRefineTurn(t.progress)) : undefined;
      if (input.refine && !prior) {
        setNotice("Nothing to refine yet — refinement starts from a completed build that passed its gates.");
        return;
      }
      setBuildBusy(true);
      const id = ++turnSeq.current;
      const turn: BuildTurn = {
        id,
        prompt: input.prompt,
        intent: input.intent,
        modelRef: input.modelRef,
        refinement: !!prior,
        ...(prior ? { parentId: prior.id } : {}),
        progress: { status: "streaming", attempts: [] },
        gaps: [],
      };
      setBuildTurns((prev) => [...prev, turn]);
      const events: Array<Record<string, unknown>> = [];
      const update = () => {
        const progress = foldBuildEvents(events);
        setBuildTurns((prev) => prev.map((t) => (t.id === id ? { ...t, progress, gaps: vocabularyGap(progress) } : t)));
      };
      await new Promise<void>((resolve) => {
        buildStream.current = streamProjectRun(
          {
            path: projectPath,
            prompt: input.prompt,
            intent: input.intent,
            modelRef: input.modelRef,
            ...(prior
              ? { conversation: [
                  { role: "user" as const, content: prior.prompt },
                  { role: "assistant" as const, content: JSON.stringify(prior.progress.surface) },
                ] }
              : {}),
          },
          {
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
          },
        );
      });
      buildStream.current = null;
      setBuildBusy(false);
    },
    [mode, projectPath, buildBusy, buildTurns],
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
      readiness,
      runBuild,
      acceptBuildTurn,
      clearBuildThread,
    }),
    [mode, agentUp, projectPath, manifest, contract, profile, ledger, rediscovery, emit, validate, busy, notice, selected, connect, loadDemo, discover, rediscover, saveContract, saveProfile, resolveDeletion, resolveConflict, clearTombstone, acceptFreshFact, runEmit, runValidate, buildTurns, buildBusy, buildModels, readiness, runBuild, acceptBuildTurn, clearBuildThread],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
