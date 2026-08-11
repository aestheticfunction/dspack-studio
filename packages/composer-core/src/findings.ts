/**
 * The normalized finding shape every composer gate reports in.
 *
 * One shape for all of: dspack document validation (dspack-validate), surface
 * lint S1/S2/S3 (dspack-gen/core), emit gates A1/A2/A3 + coverage + fidelity
 * (dspack-emit), profile shape (loadProfile), registry coverage
 * (planRegistry), and ledger integrity. `target` is a JSON path into the
 * contract/profile, a surface node id, or a catalog component name — enough
 * for the UI to deep-link every finding to its fix location.
 */

export type FindingGate =
  | "manifest"
  | "document"
  | "profile"
  | "S1"
  | "S2"
  | "S3"
  | "A1"
  | "A2"
  | "A3"
  | "coverage"
  | "fidelity"
  | "registry"
  | "ledger"
  /** Flow-lint (P4): flows reference surfaces; this gate validates the
   *  REFERENCES (dangling surface/step targets, duplicate ids, advance
   *  names) — never the surfaces, whose own gates run unchanged. */
  | "flow";

export type FindingSeverity = "error" | "warn" | "info";

/**
 * An emit refusal the OWNER declared, with their written reason: a decision,
 * not an unresolved defect. Attached to (never in place of) the original
 * finding, so severity, code, target, message, and the authored reason all
 * remain available for inspection.
 */
export interface AcknowledgedCasualty {
  componentId: string;
  class: string;
  reason: string;
}

export interface ComposerFinding {
  gate: FindingGate;
  code: string;
  severity: FindingSeverity;
  /** JSON path, surface node id, component name, or "" for document-level. */
  target: string;
  message: string;
  /** Present only on refusals proven to be authored casualties (see below). */
  acknowledged?: AcknowledgedCasualty;
  /**
   * The COMPLETE raw error strings behind a capped `message`. A finding's
   * message stays readable (first few errors); nothing the gate reported is
   * ever dropped — the full record lives here for the advanced expander.
   */
  evidence?: string[];
}

export function finding(
  gate: FindingGate,
  code: string,
  severity: FindingSeverity,
  target: string,
  message: string,
): ComposerFinding {
  return { gate, code, severity, target, message };
}

/* ------------------------------------------------------------------ */
/* Catalog-gate findings: per-instance when the emitter says which     */
/* instance, capped-but-complete otherwise.                            */
/*                                                                     */
/* dspack-emit >= 0.7 attaches structured `errorDetails` to a failing  */
/* catalog gate — one entry per invalid component instance, carrying   */
/* the ajv error objects for that instance. Feature-detected here so   */
/* the same code serves 0.6 (strings only) unchanged. Shared by the    */
/* browser (apps/composer/app/validation.ts) and the agent             */
/* (apps/agent/src/project.ts) — the one-validator principle extends   */
/* to how a validator's verdict is REPORTED.                           */
/* ------------------------------------------------------------------ */

/** One ajv-shaped error from a gate's structured detail (all fields optional). */
export interface GateErrorDetailError {
  instancePath?: string;
  schemaPath?: string;
  keyword?: string;
  params?: unknown;
  message?: string;
}

/** Per-instance structured detail a failing catalog gate MAY carry. */
export interface GateErrorDetail {
  instance?: unknown;
  component?: string;
  id?: string;
  errors?: GateErrorDetailError[];
}

/** A failing gate as reported by dspack-emit's ValidationReport (0.6 or 0.7). */
export interface CatalogGateLike {
  name?: string;
  errors?: string[];
  /** dspack-emit >= 0.7; unknown here so 0.6 callers never depend on it. */
  errorDetails?: unknown;
}

/** How many error strings a finding MESSAGE shows before deferring to evidence. */
const MESSAGE_ERROR_CAP = 3;

/** Mirrors dspack-emit's own error wording: `${instancePath || "(root)"} ${message}`. */
function detailErrorString(e: GateErrorDetailError): string {
  const path = typeof e?.instancePath === "string" && e.instancePath ? e.instancePath : "(root)";
  return `${path} ${typeof e?.message === "string" ? e.message : ""}`.trim();
}

/** First `MESSAGE_ERROR_CAP` errors joined, honest about what was elided. */
function cappedMessage(errors: string[], fallback: string): string {
  if (errors.length === 0) return fallback;
  const shown = errors.slice(0, MESSAGE_ERROR_CAP).join("; ");
  const hidden = errors.length - MESSAGE_ERROR_CAP;
  return hidden > 0 ? `${shown} (+${hidden} more)` : shown;
}

const withEvidence = (f: ComposerFinding, evidence: string[]): ComposerFinding =>
  evidence.length > 0 ? { ...f, evidence } : f;

/**
 * Findings for ONE failing catalog gate.
 *
 * With structured `errorDetails` (feature-detected): one finding PER
 * component instance, targeted `Component#id` so the UI can deep-link the
 * fix location — never a joined wall of text under a catalog-version target.
 * Without them: the single finding keeps `fallbackTarget`, its message is
 * capped the same way, and EVERY raw string the gate reported stays on
 * `evidence`. Errors are layered, never dropped.
 */
export function catalogGateFindings(
  gateId: FindingGate,
  gate: CatalogGateLike,
  fallbackTarget: string,
): ComposerFinding[] {
  const code = gate.name ?? "";
  const details = Array.isArray(gate.errorDetails) ? (gate.errorDetails as GateErrorDetail[]) : [];
  if (details.length > 0) {
    return details.map((detail) => {
      const target =
        typeof detail?.component === "string" && typeof detail?.id === "string"
          ? `${detail.component}#${detail.id}`
          : fallbackTarget;
      const evidence = (detail?.errors ?? []).map(detailErrorString);
      return withEvidence(finding(gateId, code, "error", target, cappedMessage(evidence, code || "gate failed")), evidence);
    });
  }
  const evidence = gate.errors ?? [];
  return [withEvidence(finding(gateId, code, "error", fallbackTarget, cappedMessage(evidence, code || "gate failed")), evidence)];
}

export function countBySeverity(findings: ComposerFinding[]): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}


/* ------------------------------------------------------------------ */
/* Acknowledged casualties (#30).                                      */
/*                                                                     */
/* THE RULE, and why it is shaped this way. A surface emit refusal is  */
/* an acknowledged casualty when, using STRUCTURED data only:          */
/*                                                                     */
/*   unresolvable = (ids the surface references)                       */
/*                − (ids the profile maps to a component plan)         */
/*                − (ids the contract declares as sub-components,      */
/*                   which compound parents consume and which never    */
/*                   carry a plan of their own)                        */
/*                                                                     */
/*   ...and every id in `unresolvable` is declared in the profile's    */
/*   casualtyComponents with a non-empty authored reason, and there is */
/*   at least one such id.                                             */
/*                                                                     */
/* Any other shape stays unresolved: an unknown component, a casualty  */
/* declared without a reason, a mix of the two (cause ambiguous), or   */
/* a refusal with nothing unresolvable at all (some other defect).     */
/*                                                                     */
/* Why not read the refusal itself: dspack-emit's EmitSurfaceError     */
/* carries only `message` and `path`. Parsing the message is forbidden */
/* — it is prose that may change — and `path` indexes the emitter's    */
/* NORMALIZED child list, not the surface document, so it cannot be    */
/* resolved back to a node (in the shipped demo it points at the       */
/* compound child, not at the casualty). Until the emitter exposes a   */
/* structured cause, the owner's own declaration is the only sound     */
/* evidence — and it is the right authority anyway: acknowledgement is */
/* the profile author's decision, recorded in the profile.             */
/* ------------------------------------------------------------------ */

interface CasualtyDeclaration {
  dspackId?: unknown;
  class?: unknown;
  reason?: unknown;
}

/** Every `component` id referenced anywhere in a surface document. */
function referencedComponentIds(surface: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(surface)) {
    for (const item of surface) referencedComponentIds(item, into);
    return into;
  }
  if (surface && typeof surface === "object") {
    const node = surface as Record<string, unknown>;
    if (typeof node.component === "string") into.add(node.component);
    for (const value of Object.values(node)) referencedComponentIds(value, into);
  }
  return into;
}

/** Sub-component ids the contract declares (consumed by compound parents). */
function subComponentIds(contract: Record<string, any> | null | undefined): Set<string> {
  const ids = new Set<string>();
  for (const entry of Object.values((contract?.components ?? {}) as Record<string, any>)) {
    for (const sub of entry?.composition?.subComponents ?? []) {
      const id = typeof sub === "string" ? sub : sub?.id;
      if (typeof id === "string") ids.add(id);
    }
  }
  return ids;
}

const authoredReason = (c: CasualtyDeclaration): string | null =>
  typeof c.reason === "string" && c.reason.trim().length > 0 ? c.reason : null;

/**
 * Classify ONE surface's emit refusal. Returns the acknowledged casualty, or
 * null when the refusal is not provably one (the conservative default).
 *
 * SCOPE BOUNDARY. Acknowledgement applies to that single surface-level
 * emission refusal and to nothing else. Schema, mapping, coverage, lint,
 * generation, and every other finding — including ones targeting the SAME
 * surface — stay unclassified and keep counting as unresolved work. A
 * surface carrying both an acknowledged casualty and a genuine failure
 * leaves the project failed, with both categories reported.
 */
export function classifySurfaceRefusal(
  surface: unknown,
  contract: Record<string, any> | null | undefined,
  profile: Record<string, any> | null | undefined,
): AcknowledgedCasualty | null {
  const planned = new Set(
    ((profile?.components ?? []) as Array<{ dspackId?: unknown }>)
      .map((p) => p?.dspackId)
      .filter((id): id is string => typeof id === "string"),
  );
  const subs = subComponentIds(contract);
  const casualties = new Map<string, CasualtyDeclaration>();
  for (const c of (profile?.casualtyComponents ?? []) as CasualtyDeclaration[]) {
    if (typeof c?.dspackId === "string") casualties.set(c.dspackId, c);
  }

  const unresolvable = [...referencedComponentIds(surface)].filter((id) => !planned.has(id) && !subs.has(id));
  if (unresolvable.length === 0) return null;

  const declared = unresolvable.map((id) => {
    const c = casualties.get(id);
    const reason = c ? authoredReason(c) : null;
    return c && reason ? { componentId: id, class: typeof c.class === "string" ? c.class : "", reason } : null;
  });
  // Every unresolvable id must be an authored casualty, or the cause is not
  // provably the acknowledgement.
  return declared.every((d) => d !== null) ? declared[0]! : null;
}

/** Findings that still need work: acknowledged casualties are decisions. */
export function unresolvedErrors(findings: ComposerFinding[]): ComposerFinding[] {
  return findings.filter((f) => f.severity === "error" && f.acknowledged === undefined);
}

export function acknowledgedCasualties(findings: ComposerFinding[]): ComposerFinding[] {
  return findings.filter((f) => f.acknowledged !== undefined);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The project-home "Gates green" row. An acknowledged casualty never turns a
 * failing project green, and never counts as unfinished work on a passing one.
 */
export function gatesSummary(findings: ComposerFinding[], emitted: boolean): { done: boolean; detail: string } {
  if (!emitted) return { done: false, detail: "emit has not run" };
  const errors = unresolvedErrors(findings).length;
  const acked = acknowledgedCasualties(findings).length;
  const ackText = acked > 0 ? plural(acked, "acknowledged casualty", "acknowledged casualties") : "";
  if (errors > 0) {
    const errText = plural(errors, "error finding", "error findings");
    return { done: false, detail: ackText ? `${errText} · ${ackText}` : errText };
  }
  return { done: true, detail: ackText ? `Gates pass · ${ackText}` : "document, S-gates, and catalog gates pass" };
}
