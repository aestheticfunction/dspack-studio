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
  | "ledger";

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
