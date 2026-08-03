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
import { ledgerStatus, type ComposerFinding, type LedgerStatus, type ProjectManifest } from "@dspack-studio/composer-core";
import {
  agentConnect,
  agentDiscover,
  agentEmit,
  agentSave,
  agentValidate,
  probeAgent,
  type EmitPayload,
  type ValidatePayload,
} from "./agent-client";
import { DEMO_CONTRACT, DEMO_EMIT, DEMO_MANIFEST, DEMO_PROFILE } from "./demo-data";

export type Mode = "demo" | "agent";

export interface ComposerState {
  mode: Mode;
  agentUp: boolean;
  projectPath: string;
  manifest: ProjectManifest | null;
  contract: Record<string, any> | null;
  profile: Record<string, any> | null;
  ledger: LedgerStatus | null;
  emit: EmitPayload | null;
  validate: ValidatePayload | null;
  busy: string | null;
  notice: string | null;
  selected: string | null; // contract component id
  setSelected: (id: string | null) => void;
  connect: (path: string) => Promise<void>;
  loadDemo: () => void;
  discover: () => Promise<void>;
  saveContract: (doc: Record<string, any>) => Promise<ComposerFinding[] | { savedInMemory: true }>;
  saveProfile: (doc: Record<string, any>) => Promise<ComposerFinding[] | { savedInMemory: true }>;
  runEmit: () => Promise<void>;
  runValidate: () => Promise<void>;
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
  const [emit, setEmit] = useState<EmitPayload | null>(null);
  const [validate, setValidate] = useState<ValidatePayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    void probeAgent().then(setAgentUp);
  }, []);

  const refreshLedger = useCallback(async (doc: Record<string, any> | null) => {
    setLedger(doc ? await ledgerStatus(doc) : null);
  }, []);

  const loadDemo = useCallback(() => {
    setMode("demo");
    setProjectPath("");
    setManifest(DEMO_MANIFEST as ProjectManifest);
    setContract(structuredClone(DEMO_CONTRACT));
    setProfile(structuredClone(DEMO_PROFILE));
    setEmit(structuredClone(DEMO_EMIT) as EmitPayload);
    setValidate(null);
    setSelected(null);
    setNotice("Demo project loaded (pre-emitted at build time). Edits stay in memory; run the local agent to work on real files.");
    void refreshLedger(DEMO_CONTRACT);
  }, [refreshLedger]);

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
      setContract((v.contract as Record<string, any>) ?? null);
      setProfile((v.profile as Record<string, any>) ?? null);
      setLedger(v.ledger);
      setEmit(null);
      setValidate(null);
      setSelected(null);
      setNotice(v.profileIssue ? `Connected. Profile issue: ${v.profileIssue}` : `Connected to ${path}.`);
    },
    [],
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
    setNotice(`Discovery complete: ${result.value.log}`);
  }, [mode, projectPath]);

  const saveContract = useCallback(
    async (doc: Record<string, any>) => {
      setContract(doc);
      void refreshLedger(doc);
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

  const runValidate = useCallback(async () => {
    if (mode === "agent") {
      setBusy("validating");
      const result = await agentValidate(projectPath);
      setBusy(null);
      if (!result.ok) {
        setNotice(`Validate failed: ${result.error}`);
        return;
      }
      setValidate(result.value);
      return;
    }
    // Demo mode: S1–S3 run IN the browser (dspack-gen/core is pure); the
    // contract harness needs the local agent and is listed as such.
    setBusy("validating");
    try {
      const { lintSurface } = await import("@aestheticfunction/dspack-gen/core");
      const findings: ComposerFinding[] = [
        {
          gate: "document",
          code: "requires-agent",
          severity: "info",
          target: "",
          message: "The dspack-validate harness runs on your machine; connect through the local agent to include it.",
        },
      ];
      const surfaces: Array<{ name: string; surface: unknown }> = [];
      for (const example of contract?.examples ?? []) {
        if (example.surface) surfaces.push({ name: example.id ?? "example", surface: example.surface });
      }
      for (const { name, surface } of surfaces) {
        const report = lintSurface(surface, contract as never);
        for (const gate of report.gates) {
          if (gate.status === "FAIL") {
            for (const error of gate.errors ?? []) {
              findings.push({ gate: gate.gate as ComposerFinding["gate"], code: "lint", severity: "error", target: name, message: error });
            }
          }
        }
        for (const f of report.findings) {
          findings.push({
            gate: "S3",
            code: f.ruleId,
            severity: f.level === "error" ? "error" : "warn",
            target: `${name} ${f.location.path}`,
            message: `${f.message} — ${f.rationale}`,
          });
        }
      }
      setValidate({ ok: findings.every((f) => f.severity !== "error"), findings });
    } finally {
      setBusy(null);
    }
  }, [mode, projectPath, contract]);

  const value = useMemo<ComposerState>(
    () => ({
      mode,
      agentUp,
      projectPath,
      manifest,
      contract,
      profile,
      ledger,
      emit,
      validate,
      busy,
      notice,
      selected,
      setSelected,
      connect,
      loadDemo,
      discover,
      saveContract,
      saveProfile,
      runEmit,
      runValidate,
    }),
    [mode, agentUp, projectPath, manifest, contract, profile, ledger, emit, validate, busy, notice, selected, connect, loadDemo, discover, saveContract, saveProfile, runEmit, runValidate],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
