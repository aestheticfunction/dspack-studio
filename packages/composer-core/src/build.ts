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
        // The report is the artifact of record: reconcile the streamed
        // attempts against it so every consumer (gap detection, failure
        // presentation) reads ONE authoritative source, even if a progress
        // event was dropped mid-stream. Repair messages already folded are
        // kept — they are indexed the same way.
        const reported = (value.report?.attempts ?? []) as Array<Record<string, any>>;
        if (reported.length > 0) {
          progress.attempts = reported.map((attempt, i) => {
            const reportedGates = (attempt.gates ?? []) as TurnGate[];
            const streamed = progress.attempts[i];
            return {
              index: Number(attempt.index ?? i),
              // Prefer the report's gates; fall back to what streamed, so a
              // reconciliation never LOSES detail either direction.
              gates: reportedGates.length > 0 ? reportedGates : (streamed?.gates ?? []),
              ...(streamed?.repair ? { repair: streamed.repair } : {}),
            };
          });
        }
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


/* ------------------------------------------------------------------ */
/* Structured failure presentation (#41).                              */
/*                                                                     */
/* A failed turn must say WHY, from the structured fields the pipeline */
/* already reports — never a bare outcome word, and never a cause      */
/* inferred from message wording. Every reason is lifted verbatim:     */
/*   S1/S2  -> attempt.gates[].errors  (those gates carry no findings) */
/*   S3     -> attempt.findings[]      (ruleId + message + the         */
/*                                      owner-authored rationale)      */
/*   emit   -> emitted.refusal, else emitted.validations[].gates[]     */
/*   adapter-> attempt.adapterError                                    */
/* The full report stays on the turn for inspection either way.        */
/* ------------------------------------------------------------------ */

export type BuildFailureKind = "lint" | "repair-exhausted" | "emit-refusal" | "emit-gate" | "adapter" | "unknown";

export interface BuildFailureReason {
  /** S1 | S2 | S3 | A1 | A2 | A3 when the reason belongs to a gate. */
  gate?: string;
  /** Rule id, emitter gate name, or other structured code. */
  code?: string;
  /** Surface path, component id, or catalog version the reason points at. */
  target?: string;
  message: string;
  /** Owner-authored rationale — S3 findings only; never synthesized. */
  rationale?: string;
}

export interface BuildFailure {
  kind: BuildFailureKind;
  /** One honest sentence naming what stopped the run. */
  headline: string;
  /** Where the pipeline stopped, e.g. "attempt 2 · S3 governance". */
  stoppedAt: string;
  reasons: BuildFailureReason[];
}

const GATE_LABEL: Record<string, string> = {
  S1: "S1 surface schema",
  S2: "S2 contract vocabulary",
  S3: "S3 governance",
};

/** Reasons from one attempt's gates and findings, in gate order. */
function attemptReasons(attempt: Record<string, any> | undefined): BuildFailureReason[] {
  if (!attempt) return [];
  const reasons: BuildFailureReason[] = [];
  for (const gate of (attempt.gates ?? []) as TurnGate[]) {
    if (gate.status !== "FAIL") continue;
    if (gate.gate === "S3") continue; // S3 speaks through findings
    for (const error of gate.errors ?? []) {
      reasons.push({ gate: gate.gate, code: gate.name, message: error });
    }
  }
  for (const finding of (attempt.findings ?? []) as Array<Record<string, any>>) {
    if (finding.level && finding.level !== "error") continue;
    reasons.push({
      gate: "S3",
      code: String(finding.ruleId ?? ""),
      target: String(finding.location?.path ?? finding.location?.component ?? ""),
      message: String(finding.message ?? ""),
      ...(finding.rationale ? { rationale: String(finding.rationale) } : {}),
    });
  }
  return reasons;
}

/**
 * The structured failure for a finished turn, or null when it passed (or has
 * not finished). Never invents a cause: an outcome with no structured
 * evidence returns kind "unknown" and says so plainly.
 */
export function buildFailure(progress: BuildTurnProgress): BuildFailure | null {
  if (progress.status === "error") {
    return {
      kind: "adapter",
      headline: "The run did not complete — the agent stream ended early.",
      stoppedAt: "stream",
      reasons: [{ message: progress.error ?? "the stream ended without a result" }],
    };
  }
  if (!progress.outcome || progress.outcome === "passed") return null;

  const report = (progress.report ?? {}) as Record<string, any>;
  const attempts = (report.attempts ?? []) as Array<Record<string, any>>;
  const last = attempts.at(-1);
  const emitted = report.emitted as Record<string, any> | undefined;

  if (progress.outcome === "failed-adapter") {
    const message = String(last?.adapterError ?? "the model adapter failed without a message");
    return {
      kind: "adapter",
      headline: "The model provider could not produce a result — nothing was generated.",
      stoppedAt: `attempt ${(last?.index ?? 0) + 1} · provider`,
      reasons: [{ code: report.generation?.adapterId, message }],
    };
  }

  if (progress.outcome === "failed-gate") {
    if (emitted?.refusal) {
      return {
        kind: "emit-refusal",
        headline: "The surface passed governance but the emitter refused it.",
        stoppedAt: "emit · refusal",
        reasons: [{ gate: "emit", message: String(emitted.refusal) }],
      };
    }
    const reasons: BuildFailureReason[] = [];
    for (const validation of (emitted?.validations ?? []) as Array<Record<string, any>>) {
      for (const gate of (validation.gates ?? []) as Array<Record<string, any>>) {
        if (gate.pass) continue;
        for (const error of (gate.errors ?? ["gate failed"]) as string[]) {
          reasons.push({ gate: String(gate.gate), code: String(gate.name ?? ""), target: validation.a2uiVersion ? `a2ui@${validation.a2uiVersion}` : undefined, message: error });
        }
      }
    }
    if (reasons.length > 0) {
      return {
        kind: "emit-gate",
        headline: "The surface passed governance but failed the catalog gates.",
        stoppedAt: `emit · ${reasons[0].gate}`,
        reasons,
      };
    }
  }

  const reasons = attemptReasons(last);
  const failedGate = ((last?.gates ?? []) as TurnGate[]).find((g) => g.status === "FAIL");
  const stoppedAt = `attempt ${(last?.index ?? 0) + 1} · ${failedGate ? GATE_LABEL[failedGate.gate] ?? failedGate.gate : "generation"}`;
  const exhausted = progress.outcome === "failed-lint-exhausted" && attempts.length > 1;
  if (reasons.length === 0) {
    return {
      kind: "unknown",
      headline: `The run ended as ${progress.outcome} without structured evidence — the full report is below.`,
      stoppedAt,
      reasons: [],
    };
  }
  return {
    kind: exhausted ? "repair-exhausted" : "lint",
    headline: exhausted
      ? `Bounded repair was exhausted after ${attempts.length} attempts — the last attempt still violates the contract.`
      : "The generated surface does not satisfy the contract.",
    stoppedAt,
    reasons,
  };
}

/** A turn offers Accept/Refine only when it finished, passed, and has a surface. */
export function canAcceptTurn(progress: BuildTurnProgress): boolean {
  return progress.status === "finished" && progress.outcome === "passed" && !!progress.surface;
}

export const canRefineTurn = canAcceptTurn;

/**
 * The worked example's prompt: the ORIGINAL build request, plus a concise
 * deterministic record of the refinements that shaped the accepted surface.
 * Truthful provenance — a reader (and the few-shot corpus) sees the ask that
 * produced this result, not merely the last edit instruction.
 */
export function examplePromptFor(chain: string[]): string {
  const [original, ...refinements] = chain.map((p) => p.trim()).filter(Boolean);
  if (!original) return "";
  return refinements.length === 0 ? original : `${original} — refined: ${refinements.join("; ")}`;
}
