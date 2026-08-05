/**
 * Build (chat-driven creation) — the pure logic under the composer's Build
 * view: readiness gating and the fold from a streamed AG-UI event list to a
 * renderable turn. No transport, no React, no @ag-ui imports — events are
 * treated as plain JSON shaped by @dspack-studio/agui-bridge's mapper
 * (RUN_STARTED / STEP_* / CUSTOM dspack.* / RUN_FINISHED).
 */
import { gatesSummary, type ComposerFinding } from "./findings";

/* ------------------------------------------------------------------ */
/* Readiness: the catalog is setup for building. Every reason names    */
/* the exact remaining work and the view where it happens.             */
/* ------------------------------------------------------------------ */

export interface BuildReadiness {
  ready: boolean;
  /** Present when not ready: the exact blocking condition, user-worded. */
  reason?: string;
}

export function buildReadiness(args: {
  contract: Record<string, any> | null;
  profile: Record<string, any> | null;
  /** Latest emit findings (null when emit has not produced a result yet). */
  findings: ComposerFinding[] | null;
  emitOk: boolean;
}): BuildReadiness {
  const { contract, profile, findings, emitOk } = args;
  if (!contract) return { ready: false, reason: "no contract yet — connect a project and run discovery" };
  if (!profile) return { ready: false, reason: "no mapping profile — the project needs its A2UI profile" };

  const intents = (contract.intents ?? []) as Array<{ id: string }>;
  if (intents.length === 0) {
    return { ready: false, reason: "no intents authored — author one in Governance (generation is scoped by intent)" };
  }

  const components = Object.keys((contract.components ?? {}) as Record<string, unknown>);
  const planned = new Set(((profile.components ?? []) as Array<{ dspackId?: string }>).map((p) => p.dspackId));
  const casualties = new Set(((profile.casualtyComponents ?? []) as Array<{ dspackId?: string }>).map((c) => c.dspackId));
  const unmapped = components.filter((id) => !planned.has(id) && !casualties.has(id));
  if (unmapped.length > 0) {
    return { ready: false, reason: `${unmapped.length} component(s) unmapped — finish the Mapper (${unmapped.slice(0, 3).join(", ")}${unmapped.length > 3 ? ", …" : ""})` };
  }

  if (findings === null) return { ready: false, reason: "emit has not run — open Validate once" };
  const gates = gatesSummary(findings, true);
  if (!emitOk || !gates.done) return { ready: false, reason: `gates not green — ${gates.detail}` };

  const examples = (contract.examples ?? []) as unknown[];
  if (examples.length === 0) {
    return { ready: false, reason: "no worked example yet — save one scenario first (it seeds generation and the zero-model path)" };
  }
  return { ready: true };
}

/* ------------------------------------------------------------------ */
/* Folding a streamed run into a turn view.                            */
/* ------------------------------------------------------------------ */

export interface TurnGate {
  gate: string;
  name?: string;
  status: string;
  errors?: string[];
}

export interface TurnAttempt {
  index: number;
  gates: TurnGate[];
  /** The repair message the linter sent AFTER this attempt, verbatim. */
  repair?: string;
}

export interface BuildTurnProgress {
  status: "streaming" | "finished" | "error";
  attempts: TurnAttempt[];
  /** Emit-time validations (A-gates) as reported by the pipeline. */
  emit?: { validations?: unknown; warnings?: unknown };
  outcome?: string;
  exitCode?: number;
  /** The complete audit report from dspack-gen (the artifact of record). */
  report?: Record<string, any>;
  /** The final generated surface (last attempt), when the run produced one. */
  surface?: Record<string, any>;
  error?: string;
}

/** Fold mapper-shaped AG-UI events (plain JSON) into a turn view. */
export function foldBuildEvents(events: Array<Record<string, any>>): BuildTurnProgress {
  const progress: BuildTurnProgress = { status: "streaming", attempts: [] };
  for (const event of events) {
    const type = String(event.type ?? "");
    if (type === "STEP_STARTED" && String(event.stepName ?? "").startsWith("attempt-")) {
      progress.attempts.push({ index: Number(String(event.stepName).slice("attempt-".length)), gates: [] });
      continue;
    }
    if (type === "CUSTOM") {
      const name = String(event.name ?? "");
      const value = (event.value ?? {}) as Record<string, any>;
      if (name === "dspack.gates") {
        const attempt = progress.attempts.at(-1);
        if (attempt) attempt.gates = (value.gates ?? []) as TurnGate[];
      } else if (name === "dspack.repair") {
        const attempt = progress.attempts.find((a) => a.index === Number(value.index));
        if (attempt) attempt.repair = String(value.message ?? "");
      } else if (name === "dspack.emit") {
        progress.emit = { validations: value.validations, warnings: value.warnings };
      } else if (name === "dspack.audit") {
        progress.outcome = String(value.outcome ?? "");
        progress.exitCode = Number(value.exitCode ?? -1);
        progress.report = value.report as Record<string, any>;
        const surface = value.report?.attempts?.at?.(-1)?.surface;
        if (surface && typeof surface === "object") progress.surface = surface as Record<string, any>;
      } else if (name === "dspack.error") {
        progress.status = "error";
        progress.error = String(value.message ?? "run failed");
      }
      continue;
    }
    if (type === "RUN_FINISHED") progress.status = progress.status === "error" ? "error" : "finished";
    if (type === "RUN_ERROR") {
      progress.status = "error";
      progress.error = String(event.message ?? "run failed");
    }
  }
  return progress;
}

/**
 * Distinguish a VOCABULARY GAP (the ask needs components the owner has not
 * approved) from a model-formatting failure — the honest-failure contract
 * and the future Component Workshop hook. A gap is evidenced structurally:
 * S2 (contract-vocabulary) gate failures on the final attempt.
 */
export function vocabularyGap(progress: BuildTurnProgress): string[] {
  const last = progress.attempts.at(-1);
  if (!last) return [];
  const s2 = last.gates.find((g) => g.gate === "S2" && g.status === "FAIL");
  if (!s2) return [];
  const ids = new Set<string>();
  for (const error of s2.errors ?? []) {
    for (const match of error.matchAll(/component '([^']+)'/g)) ids.add(match[1]);
  }
  return [...ids];
}
