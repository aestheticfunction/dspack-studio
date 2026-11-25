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
    return { ready: false, reason: "no surfaces yet — save one in Surfaces first (it seeds generation and the zero-model path)" };
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
  /**
   * dspack-gen >= 0.4: the attempt was judged unrepresentable under the
   * catalog (`{ pass: false, refusal }`). Feature-detected from the audit
   * report during reconciliation; absent on 0.3 reports.
   */
  representability?: { pass?: boolean; refusal?: string };
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
  /**
   * Interface blocks (experimental): the block phase's trace, delivered as a
   * CUSTOM dspack.block event before the pipeline starts. Default builds
   * never emit it. Its outcome "invariant-failure" is a Composer-side
   * outcome: the run never reached runPipeline, so there is no audit report.
   */
  block?: Record<string, any>;
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
              // dspack-gen >= 0.4 (feature-detected): carried so the Build
              // view can label representability repairs and refusals.
              ...(attempt.representability && typeof attempt.representability === "object"
                ? { representability: attempt.representability as TurnAttempt["representability"] }
                : {}),
            };
          });
        }
        const surface = value.report?.attempts?.at?.(-1)?.surface;
        if (surface && typeof surface === "object") progress.surface = surface as Record<string, any>;
      } else if (name === "dspack.block") {
        progress.block = value;
        if (value.outcome === "invariant-failure") progress.outcome = "invariant-failure";
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

export type BuildFailureKind = "lint" | "repair-exhausted" | "emit-refusal" | "emit-gate" | "adapter" | "invariant" | "unknown";

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

/**
 * Catalog-gate (A-gate) reasons from the emit validations, deduped by
 * (gate, code, message). The emitter runs BOTH A2UI versions over the same
 * surface, so most failures arrive twice with identical wording — one field
 * case rendered ~100 rows for ~25 distinct facts. A reason seen under both
 * versions renders ONCE, targeted "both A2UI versions"; identical-message
 * repetition within one version collapses the same way. Nothing is lost:
 * the full audit report stays on the turn for inspection.
 */
function emitGateReasons(emitted: Record<string, any> | undefined): BuildFailureReason[] {
  const merged = new Map<string, { reason: BuildFailureReason; versions: Set<string> }>();
  for (const validation of (emitted?.validations ?? []) as Array<Record<string, any>>) {
    const version = validation.a2uiVersion ? String(validation.a2uiVersion) : "";
    for (const gate of (validation.gates ?? []) as Array<Record<string, any>>) {
      if (gate.pass) continue;
      for (const error of (gate.errors ?? ["gate failed"]) as string[]) {
        const key = `${gate.gate} ${gate.name ?? ""} ${error}`;
        const entry = merged.get(key);
        if (entry) {
          if (version) entry.versions.add(version);
          continue;
        }
        merged.set(key, {
          reason: { gate: String(gate.gate), code: String(gate.name ?? ""), message: error },
          versions: new Set(version ? [version] : []),
        });
      }
    }
  }
  return [...merged.values()].map(({ reason, versions }) => ({
    ...reason,
    ...(versions.size > 1
      ? { target: "both A2UI versions" }
      : versions.size === 1
        ? { target: `a2ui@${[...versions][0]}` }
        : {}),
  }));
}

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
export function buildFailure(progress: BuildTurnProgress, options: { calls?: ReadonlyArray<{ operation: string; source: string }> } = {}): BuildFailure | null {
  if (progress.status === "error") {
    return {
      kind: "adapter",
      headline: "The run did not complete — the agent stream ended early.",
      stoppedAt: "stream",
      reasons: [{ message: progress.error ?? "the stream ended without a result" }],
    };
  }
  if (!progress.outcome || progress.outcome === "passed") return null;

  // A block template defect never reaches the pipeline: the expansion failed
  // a deterministic check, so the block is disabled and nothing was generated.
  if (progress.outcome === "invariant-failure") {
    return {
      kind: "invariant",
      headline: "The block template produced an invalid surface; the block is disabled for this session.",
      stoppedAt: "block phase · expansion",
      reasons: ((progress.block?.invariant ?? []) as string[]).map((message) => ({ code: "invariant", message })),
    };
  }

  const report = (progress.report ?? {}) as Record<string, any>;
  const attempts = (report.attempts ?? []) as Array<Record<string, any>>;
  const last = attempts.at(-1);
  const emitted = report.emitted as Record<string, any> | undefined;
  // After a block phase, the budget the pipeline had left is part of the why.
  // Calls are counted from the recorder when the turn has one (a replayed
  // provider failure is an attempt that made no call); else from the trace
  // and the report's attempts.
  const provider = (options.calls ?? []).filter((c) => c.source === "provider");
  const blockCalls = options.calls ? provider.filter((c) => c.operation === "block" || c.operation === "block-repair").length : Number(progress.block?.providerCalls ?? 0);
  const surfaceCalls = options.calls
    ? provider.filter((c) => c.operation === "generate" || c.operation === "refine" || c.operation === "repair").length
    : attempts.filter((a) => a.usage !== undefined || a.adapterError !== undefined).length - (progress.block?.outcome === "block" ? 0 : 0);
  const budgetNote = progress.block
    ? `${blockCalls + surfaceCalls} model calls used: ${blockCalls} block, ${surfaceCalls} surface`
    : "";

  if (progress.outcome === "failed-adapter") {
    const message = String(last?.adapterError ?? "the model adapter failed without a message");
    const duringBlock = progress.block?.outcome === "provider-failure";
    const spent = /budget/.test(message) && !!progress.block;
    return {
      kind: "adapter",
      headline: spent
        ? "The model-call budget was spent before a surface could pass."
        : duringBlock
          ? "The model provider failed during the block call — nothing was generated."
          : "The model provider could not produce a result — nothing was generated.",
      stoppedAt: duringBlock ? `block · call ${(progress.block?.attempts as unknown[] | undefined)?.length ?? 1}` : `attempt ${(last?.index ?? 0) + 1} · provider`,
      reasons: [
        { code: report.generation?.adapterId, message },
        ...(duringBlock && progress.block?.providerError ? [{ code: String(progress.block.providerError.classification), message: String(progress.block.providerError.message) }] : []),
        ...(progress.block ? [{ code: "block", message: `${blockCalls} block call${blockCalls === 1 ? "" : "s"} preceded this run (${progress.block.outcome}); ${budgetNote}` }] : []),
      ],
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
    const aReasons = emitGateReasons(emitted);
    if (aReasons.length > 0) {
      // S-first layering: when the last attempt's own S-gate reasons exist,
      // they already explain the failure — the A-gate wall collapses to one
      // honest summary and the Checks view carries the per-instance detail.
      const sReasons = attemptReasons(last);
      if (sReasons.length > 0) {
        const n = aReasons.length;
        return {
          kind: "emit-gate",
          headline: "The surface violates the contract and failed the catalog gates.",
          stoppedAt: `emit · ${aReasons[0].gate}`,
          reasons: [
            ...sReasons,
            { gate: "emit", message: `${n} catalog-gate ${n === 1 ? "finding" : "findings"} — see Checks for detail` },
          ],
        };
      }
      return {
        kind: "emit-gate",
        headline: "The surface passed governance but failed the catalog gates.",
        stoppedAt: `emit · ${aReasons[0].gate}`,
        reasons: aReasons,
      };
    }
  }

  const reasons = attemptReasons(last);
  // dspack-gen >= 0.4 (feature-detected): a representability refusal is the
  // structured WHY for runs that exhausted repair without any S-gate error —
  // previously reported as "unknown, without structured evidence".
  const representability = last?.representability as Record<string, any> | undefined;
  const refused = progress.outcome === "failed-lint-exhausted" && representability && typeof representability === "object" && representability.pass === false;
  if (refused) {
    reasons.push({
      code: "representability",
      message:
        typeof representability.refusal === "string" && representability.refusal
          ? representability.refusal
          : "the attempt was refused as unrepresentable, without a message",
    });
  }
  const failedGate = ((last?.gates ?? []) as TurnGate[]).find((g) => g.status === "FAIL");
  const stoppedAtStage = failedGate ? GATE_LABEL[failedGate.gate] ?? failedGate.gate : refused ? "representability" : "generation";
  const stoppedAt = `attempt ${(last?.index ?? 0) + 1} · ${stoppedAtStage}`;
  const exhausted = progress.outcome === "failed-lint-exhausted" && (attempts.length > 1 || !!progress.block);
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
      ? `Bounded repair was exhausted after ${attempts.length} attempt${attempts.length === 1 ? "" : "s"} — the last attempt still violates the contract.${budgetNote ? ` ${budgetNote}.` : ""}`
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

/**
 * The saved surface a Demo replay (scripted mode) plays for an intent: the
 * LAST worked example of that intent, because accepted results join the
 * corpus at the end. One function for the browser, the agent and the
 * experimental runtime, so all three replay the same surface and the turn
 * can name what it replayed.
 */
export interface ReplaySource {
  /** The ROOT sample's id (or `block:<id>` for a block's example call): never a saved copy of a replay. */
  id: string;
  name?: string;
  prompt?: string;
}

/** The description every saved demo replay carries, and how it is read back. */
const REPLAY_DESCRIPTION = /^Saved from a demo replay of (\S+?)\. It was not generated from a request\.$/;
export function replayDescription(rootId: string): string {
  return `Saved from a demo replay of ${rootId}. It was not generated from a request.`;
}
/** The root sample a saved replay copy names in its description, if any. */
export function replayRootOf(description: unknown): string | null {
  return typeof description === "string" ? (REPLAY_DESCRIPTION.exec(description)?.[1] ?? null) : null;
}

export function scriptedReplaySource<E extends { id?: unknown; intent?: unknown; name?: unknown; prompt?: unknown; description?: unknown }>(
  examples: readonly E[] | undefined,
  intent: string,
): (ReplaySource & { example: E }) | null {
  const all = examples ?? [];
  const example = all.filter((e) => e.intent === intent).at(-1);
  if (!example) return null;
  // The PLAYED example may itself be a saved replay copy. Name the sample it
  // copies instead, so a replay of a replay neither stacks "(demo replay)"
  // nor points at the copy. Bounded: a cycle cannot loop.
  let root: E = example;
  for (let hops = 0; hops < all.length; hops++) {
    const rootId = replayRootOf(root.description);
    const next = rootId ? all.find((e) => e.id === rootId) : undefined;
    if (!next || next === root) break;
    root = next;
  }
  return {
    id: String(root.id ?? ""),
    ...(typeof root.name === "string" && root.name.trim() ? { name: root.name } : {}),
    ...(typeof root.prompt === "string" && root.prompt.trim() ? { prompt: root.prompt } : {}),
    example,
  };
}

/** How a saved surface is named in the UI when it came from a replay. */
export function replayLabel(source: ReplaySource): string {
  return source.name ?? source.id;
}

/** `text` cut so that `suffix` always fits inside `max` characters. */
function withSuffix(text: string, suffix: string, max = 80): string {
  return `${text.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

/** One turn of a build thread, oldest first, as recorded when it is accepted. */
export interface ThreadTurn {
  /** The words typed: the goal for the first turn, an instruction for a refinement. */
  prompt: string;
  /** Whether a model applied those words. False for Demo replay (scripted mode), which never reads them. */
  applied: boolean;
}

/**
 * The worked-example entry an accepted build turn becomes.
 *
 * dspack-gen uses an example's `prompt ?? description ?? id` as the few-shot
 * user turn paired with its surface, so the prompt must only contain words
 * that actually produced the surface. Two facts decide the record:
 *
 * - whether each turn's words were APPLIED (a model read them) or not (Demo
 *   replay never reads them: a fresh replay plays a saved surface, a scripted
 *   "refinement" only marks the previous result);
 * - the ROOT sample, when the thread began with a Demo replay.
 *
 * Cases:
 * - generated from a request: the request plus the applied refinements (as before);
 * - a replay with no applied words since: the root sample's own prompt, named
 *   "<sample> (demo replay)", described as a replay;
 * - a model refined a replay: the root sample's prompt plus the applied
 *   instructions, named "<sample> (refined)", described as refined from that
 *   sample. It is a model's work, so it is not labelled a replay; the request
 *   typed before the replay is never recorded.
 * Instructions a replay skipped are never recorded as applied; the
 * description says how many were skipped.
 */
export function acceptedExampleEntry(input: {
  id: string;
  intent: string;
  thread: ThreadTurn[];
  surface: unknown;
  /** The sample a Demo replay at the start of the thread played. */
  root?: ReplaySource;
}): { id: string; intent: string; name: string; prompt: string; description?: string; surface: unknown } {
  const { id, intent, thread, surface, root } = input;
  const later = thread.slice(1);
  const applied = later.filter((t) => t.applied).map((t) => t.prompt);
  const skipped = later.filter((t) => !t.applied).length;
  const skippedNote = skipped === 0 ? "" : ` ${skipped === 1 ? "One demo-replay edit" : `${skipped} demo-replay edits`} did not apply ${skipped === 1 ? "its instruction" : "their instructions"}.`;
  const first = thread[0];
  if (!root && first && first.applied) {
    return {
      id,
      intent,
      name: first.prompt.slice(0, 80),
      prompt: examplePromptFor([first.prompt, ...applied]),
      ...(skippedNote ? { description: skippedNote.trim() } : {}),
      surface,
    };
  }
  const sample = root ?? { id: "an earlier surface" };
  const label = replayLabel(sample);
  const base = sample.prompt ?? label;
  if (applied.length === 0) {
    return { id, intent, name: withSuffix(label, " (demo replay)"), prompt: base, description: replayDescription(sample.id), surface };
  }
  return {
    id,
    intent,
    name: withSuffix(label, " (refined)"),
    prompt: examplePromptFor([base, ...applied]),
    description: `Refined by a model from the demo sample ${sample.id}. The request typed before that sample was not applied.${skippedNote}`,
    surface,
  };
}

/**
 * Canonical JSON for comparing surfaces: key order and undefined values do
 * not matter. With `stripMarkers`, the scripted refinement marker that
 * scripted mode APPENDS to the first text node (" (refined)", " (refined N)")
 * is removed from the end of strings, and a top-level `id` that scripted
 * mode set to "refined"/"refined N" (a surface with no text node) is ignored.
 */
function canonical(value: unknown, stripMarkers = false, top = true): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v, stripMarkers, false)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([k, v]) => v !== undefined && !(stripMarkers && top && k === "id" && typeof v === "string" && /^refined(?: \d+)?$/.test(v)))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v, stripMarkers, false)}`).join(",")}}`;
  }
  if (typeof value === "string" && stripMarkers) return JSON.stringify(value.replace(/ \(refined(?: \d+)?\)$/, ""));
  return JSON.stringify(value);
}

/**
 * The example of `intent` whose surface is exactly `surface`, if the project
 * already has one. Saving a Demo replay of it would add the same surface
 * again under a second prompt: a duplicate few-shot pairing (dspack-gen does
 * not de-duplicate), so the caller offers nothing to save.
 */
export function existingExampleFor<E extends { id?: unknown; intent?: unknown; surface?: unknown }>(
  examples: readonly E[] | undefined,
  intent: string,
  surface: unknown,
): E | null {
  const key = canonical(surface);
  return (examples ?? []).find((e) => e.intent === intent && canonical(e.surface) === key) ?? null;
}

/**
 * Probable demo replays already saved in a project (M0 example integrity).
 *
 * Before the replay fix, accepting a scripted build saved a copy of an
 * existing example under the typed request. Such an entry is recognisable
 * without guessing at wording. All of these hold:
 * - its surface, with scripted-refinement markers removed, is canonically
 *   identical to an EARLIER example of the same purpose;
 * - it carries Build's accept signature: an id Build minted (`ex.chat-N`),
 *   or a prompt that begins with its name (Build records the goal as both);
 * - its prompt differs from that earlier example's.
 * An author who deliberately pairs one surface with a second wording (a
 * paraphrase example with its own id and name) is therefore not flagged.
 * Entries saved after the fix carry a "demo replay of" description and are
 * reported as labelled, never flagged. Packaged reference examples are never
 * examined. Accepted examples are appended, so a copy always follows its
 * source. Pure and read-only: it reports, the person decides.
 */
export interface ReplayFinding {
  id: string;
  /** The earlier example whose surface it repeats. */
  source: string;
  kind: "probable-replay" | "labelled-replay";
}

export function findProbableReplays(
  examples: ReadonlyArray<{ id: string; intent?: unknown; name?: unknown; prompt?: unknown; description?: unknown; surface?: unknown }>,
  baseIds: Iterable<string> = [],
): ReplayFinding[] {
  const base = new Set(baseIds);
  const seen: Array<{ id: string; intent: unknown; prompt: unknown; key: string }> = [];
  const findings: ReplayFinding[] = [];
  for (const example of examples) {
    const key = canonical(example.surface, true);
    if (!base.has(example.id)) {
      const source = seen.find((s) => s.intent === example.intent && s.key === key);
      if (source) {
        const fromBuild =
          /^ex\.chat-\d+$/.test(example.id) ||
          (typeof example.name === "string" && example.name.length > 0 && typeof example.prompt === "string" && example.prompt.startsWith(example.name));
        if (replayRootOf(example.description)) findings.push({ id: example.id, source: source.id, kind: "labelled-replay" });
        else if (fromBuild && example.prompt !== source.prompt) findings.push({ id: example.id, source: source.id, kind: "probable-replay" });
      }
    }
    seen.push({ id: example.id, intent: example.intent, prompt: example.prompt, key });
  }
  return findings;
}
