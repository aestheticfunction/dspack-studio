/**
 * Surface identity: what a person READS, and what the product AUDITS.
 *
 * A surface is stored under a canonical id (`ex.chat-1`, `ex.support-ticket-
 * queue`) — that id is the contract's, the export's, and every flow step's
 * reference, and none of that changes here. What changes is which of the two
 * leads: a person meets their own work by the words that produced it, with
 * the id kept beside it, small, for audit. `ex.chat-1` is a filename, not a
 * title.
 *
 * Ownership is the other half. Every picker in the product orders the same
 * way: the project's own surfaces first and primary, the design system's
 * reference surfaces second and quieter, and refusals grouped by OWNER —
 * yours stay in front of you, the reference's collapse behind one honest
 * disclosure. Nothing is ever hidden; the hierarchy is what changes.
 */

/** The fields a `contract.examples` entry can carry a human title in. */
export interface SurfaceEntry {
  id?: string;
  name?: string;
  prompt?: string;
  description?: string;
}

/** Title, then id — what every surface label renders. */
export interface SurfaceIdentity {
  title: string;
  id: string;
}

const DEFAULT_MAX = 48;

/** Trim, collapse internal whitespace, and clamp on a whole-word boundary
 *  where one is close enough to look deliberate. */
function tidy(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The human title for one surface: an authored name first (someone chose
 * it), then the goal that produced it, then the design system's own
 * description. Empty-safe by construction — a surface with nothing readable
 * falls back to its id, so a label is never blank.
 */
export function surfaceTitle(entry: SurfaceEntry | null | undefined, id: string, max = DEFAULT_MAX): string {
  for (const candidate of [entry?.name, entry?.prompt, entry?.description]) {
    if (typeof candidate !== "string") continue;
    const text = tidy(candidate, max);
    if (text) return text;
  }
  return tidy(id, max) || id;
}

/** The pair every label renders: the title leads, the id stays for audit. */
export function surfaceIdentity(entry: SurfaceEntry | null | undefined, id: string, max = DEFAULT_MAX): SurfaceIdentity {
  return { title: surfaceTitle(entry, id, max), id };
}

/** Index a contract's `examples` by id for O(1) title lookup; junk entries
 *  (a malformed delta, a hand-edited file) are skipped, never thrown on. */
export function surfaceEntriesById(examples: unknown): Map<string, SurfaceEntry> {
  const byId = new Map<string, SurfaceEntry>();
  if (!Array.isArray(examples)) return byId;
  for (const entry of examples) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as SurfaceEntry).id;
    if (typeof id === "string" && id) byId.set(id, entry as SurfaceEntry);
  }
  return byId;
}

/**
 * What is actually blocking a build, by name.
 *
 * Readiness answers with a COUNT ("gates not green — 1 error finding"), which
 * is true and useless: a person cannot fix a count. Every unresolved error
 * finding already carries the thing it is about in `target` — a surface id for
 * emit refusals and S-gate findings, a component id for coverage, "" for
 * document-level — so the row a person needs is one resolution away.
 *
 * Acknowledged casualties are decisions, not blockers, and never appear here
 * (the same rule `gatesSummary` counts by); warnings and info never block.
 */
export interface BlockingFinding {
  /** The surface/component id the finding is about, or "" for the document. */
  id: string;
  /** The surface's human title when the id names one; the id otherwise. */
  title: string;
  /** True when the id resolves to one of this project's own surfaces. */
  isSurface: boolean;
  gate: string;
  code: string;
  message: string;
}

/**
 * S3 findings target `"<surface id> <node path>"`; everything else targets a
 * bare id. Take the first token either way — a node path never contains a
 * space, and a surface id never does.
 */
const targetId = (target: string): string => target.trim().split(/\s+/)[0] ?? "";

export function blockingFindings(
  findings: ReadonlyArray<{ gate: string; code: string; severity: string; target: string; message: string; acknowledged?: unknown }>,
  examples: unknown,
): BlockingFinding[] {
  const byId = surfaceEntriesById(examples);
  const rows: BlockingFinding[] = [];
  for (const f of findings) {
    if (f.severity !== "error" || f.acknowledged !== undefined) continue;
    const id = targetId(f.target ?? "");
    const entry = byId.get(id);
    rows.push({
      id,
      title: entry ? surfaceTitle(entry, id, 64) : id,
      isSurface: entry !== undefined,
      gate: f.gate,
      code: f.code,
      message: f.message,
    });
  }
  return rows;
}

/** Anything a picker lists: an emitted surface, or a flow-step candidate. */
export interface OwnedSurface {
  name: string;
  error?: string;
}

export interface SurfaceGroups<T> {
  /** The project's own surfaces that render — visually primary. */
  yours: T[];
  /** The project's own surfaces the emitter refused — the user's problem to
   *  see, kept in front of them. */
  yoursRefused: T[];
  /** The design system's reference surfaces that render — clearly secondary. */
  reference: T[];
  /** Reference surfaces the emitter refused — demoted behind a disclosure. */
  referenceRefused: T[];
  /** Every surface in picker order: yours (rendering, then refused), then the
   *  reference corpus (rendering, then refused). */
  ordered: T[];
}

/**
 * Partition a project's emitted surfaces by OWNERSHIP first, then by whether
 * they render. `referenceIds` is null when every surface is the project's own
 * (an imported bundle, a repository); an EXAMPLE workspace owns everything it
 * shows, because the reference corpus IS the content on display there.
 */
export function partitionSurfaces<T extends OwnedSurface>(
  surfaces: readonly T[],
  { referenceIds, isExample = false }: { referenceIds: Set<string> | null; isExample?: boolean },
): SurfaceGroups<T> {
  const yours: T[] = [];
  const yoursRefused: T[] = [];
  const reference: T[] = [];
  const referenceRefused: T[] = [];
  for (const surface of surfaces) {
    const isReference = !isExample && referenceIds !== null && referenceIds.has(surface.name);
    const refused = Boolean(surface.error);
    if (isReference) (refused ? referenceRefused : reference).push(surface);
    else (refused ? yoursRefused : yours).push(surface);
  }
  return { yours, yoursRefused, reference, referenceRefused, ordered: [...yours, ...yoursRefused, ...reference, ...referenceRefused] };
}
