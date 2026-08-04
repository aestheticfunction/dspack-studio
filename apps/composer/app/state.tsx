"use client";

/**
 * Composer state: one context holding the project documents plus the latest
 * emit/validate results. Two modes, stated plainly in the UI:
 *   - "agent": a local project directory via the agent; saves persist.
 *   - "demo":  the shipped Acme UI demo project (pre-emitted at build time);
 *              edits live in memory only.
 * Files are the source of truth; this state is a view of them.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  addTombstone,
  applyFreshFact,
  ledgerStatus,
  removeTombstone,
  restoreComponent,
  type ComposerFinding,
  type FreshFact,
  type LedgerStatus,
  type ProjectManifest,
} from "@dspack-studio/composer-core";
import {
  agentConnect,
  agentDiscover,
  agentEmit,
  agentRediscover,
  agentSave,
  probeAgent,
  type EmitPayload,
  type RediscoverReport,
  type ValidatePayload,
} from "./agent-client";
import { browserEmit, contractSurfaces, lintOneSurface, validateContract } from "./validation";
import { DEMO_CONTRACT, DEMO_EXTRA_SURFACES, DEMO_MANIFEST, DEMO_PROFILE } from "./demo-data";

export type Mode = "demo" | "agent";

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
  clearTombstone: (id: string) => Promise<void>;
  /** Explicit acceptance of one fresh-side fact into a human-owned entry. */
  acceptFreshFact: (componentId: string, fact: FreshFact) => Promise<void>;
  runEmit: () => Promise<void>;
  runValidate: () => void;
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
    setNotice("Demo project loaded. Edits stay in memory and every gate runs live in this browser; run the local agent to work on real files.");
    void refreshLedger(doc);
  }, [refreshLedger, recomputeEmit]);

  useEffect(() => {
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
      if (!contract) return;
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
    },
    [contract, saveContract],
  );

  const clearTombstone = useCallback(
    async (id: string) => {
      if (!contract) return;
      const result = removeTombstone(contract, id);
      if (!result.ok) {
        setNotice(`Cannot remove tombstone '${id}': ${result.reason}`);
        return;
      }
      await saveContract(result.document);
      setNotice(`Tombstone removed: the next rediscovery may re-add '${id}'.`);
    },
    [contract, saveContract],
  );

  const acceptFreshFact = useCallback(
    async (componentId: string, fact: FreshFact) => {
      if (!contract) return;
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
    },
    [contract, saveContract],
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
      clearTombstone,
      acceptFreshFact,
      runEmit,
      runValidate,
    }),
    [mode, agentUp, projectPath, manifest, contract, profile, ledger, rediscovery, emit, validate, busy, notice, selected, connect, loadDemo, discover, rediscover, saveContract, saveProfile, resolveDeletion, clearTombstone, acceptFreshFact, runEmit, runValidate],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
