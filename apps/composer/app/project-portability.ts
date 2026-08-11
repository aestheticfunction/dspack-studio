/**
 * Project portability — take a project with you.
 *
 * A Composer project is its IDENTITY plus its governed VOCABULARY (the dspack
 * contract + mapping profile + the design system it previews through). Those
 * three, with a name and description, are the smallest honest portable
 * artifact: enough to recreate the project and keep building, on another
 * machine or after clearing the browser. Deliberately excluded: the project
 * id (minted fresh on import, so a re-import never collides), any on-disk
 * path (machine-specific), and every credential or key (those never leave the
 * agent, let alone travel in a file).
 *
 * This is a DEDICATED project artifact, distinct from the Catalog export
 * (which carries only the emitted A2UI catalog + surfaces, not the governed
 * source). The exported file doubles as the vocabulary an on-disk dspack
 * project would hold, so a project authored in the hosted experience can move
 * into the local-agent workflow.
 */
import { loadProfile } from "@aestheticfunction/dspack-emit";
import { parseFlow, type Flow } from "./flows";
import type { PreviewRegistry, ProjectVocab } from "./projects";

export const PROJECT_EXPORT_VERSION = "0.1";

export interface ProjectExport {
  composerProjectExport: string;
  exportedAt: string;
  name: string;
  description: string;
  previewRegistry: PreviewRegistry;
  contract: Record<string, unknown>;
  profile: Record<string, unknown>;
  /** The project's flows (P4) — ADDITIVE on version 0.1 (F6): current builds
   *  pass-but-drop unknown top-level fields, so a flows-bearing file still
   *  imports cleanly (minus flows) into stale builds. Absent when empty. */
  flows?: Flow[];
}

export function buildProjectExport(input: {
  name: string;
  description: string;
  vocab: ProjectVocab;
  exportedAt: string;
  flows?: Flow[];
}): ProjectExport {
  return {
    composerProjectExport: PROJECT_EXPORT_VERSION,
    exportedAt: input.exportedAt,
    name: input.name,
    description: input.description,
    previewRegistry: input.vocab.previewRegistry,
    contract: input.vocab.contract,
    profile: input.vocab.profile,
    ...(input.flows && input.flows.length > 0 ? { flows: input.flows } : {}),
  };
}

export function exportFilename(name: string): string {
  const slug = (name || "project").replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${slug || "project"}.composerproject.json`;
}

/** Browser download of an export bundle. Pure client I/O — no server. */
export function downloadProjectExport(exp: ProjectExport): void {
  const blob = new Blob([JSON.stringify(exp, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFilename(exp.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type ImportResult =
  | { ok: true; name: string; description: string; vocab: ProjectVocab; flows: Flow[] }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function normalizeRegistry(v: unknown): PreviewRegistry {
  return v === "shadcn" || v === "astryx" ? v : "wireframe";
}

/**
 * Parse and VALIDATE an exported project file. Fail-closed: an import may
 * never seed a project whose vocabulary is malformed, so the mapping profile
 * is run through the emitter's own loader here (the same gate the agent and
 * hosted paths use), and the contract must at least carry components. A
 * refusal states plainly what's wrong.
 */
export function parseProjectImport(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn’t valid JSON." };
  }
  if (!isPlainObject(raw)) return { ok: false, error: "That file isn’t a Composer project export." };
  if (raw.composerProjectExport !== PROJECT_EXPORT_VERSION) {
    const found = typeof raw.composerProjectExport === "string" ? ` (found “${raw.composerProjectExport}”)` : "";
    return { ok: false, error: `Unrecognized project format${found}. This build reads composerProjectExport ${PROJECT_EXPORT_VERSION}.` };
  }
  const { contract, profile } = raw;
  if (!isPlainObject(contract)) return { ok: false, error: "The file has no project contract." };
  if (!isPlainObject(profile)) return { ok: false, error: "The file has no mapping profile." };
  if (!isPlainObject(contract.components)) {
    return { ok: false, error: "The project’s contract declares no components — nothing to build from." };
  }
  try {
    loadProfile(profile as never);
  } catch (e) {
    return { ok: false, error: `The mapping profile is invalid: ${e instanceof Error ? e.message : String(e)}` };
  }
  // Flows (P4): absent means none; PRESENT but malformed refuses the import —
  // fail-closed like the profile gate, never a silent drop of authored work.
  const flows: Flow[] = [];
  if (raw.flows !== undefined) {
    if (!Array.isArray(raw.flows)) {
      return { ok: false, error: "The file's flows field is malformed (not a list) — re-export the project and try again." };
    }
    for (const entry of raw.flows) {
      const flow = parseFlow(entry);
      if (!flow) {
        return {
          ok: false,
          error: "The file's flows are malformed (a flow needs an id, a name, and steps with id/title/surfaceId) — re-export the project and try again.",
        };
      }
      flows.push(flow);
    }
  }
  return {
    ok: true,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Imported project",
    description: typeof raw.description === "string" ? raw.description : "",
    vocab: {
      contract: contract as Record<string, unknown>,
      profile: profile as Record<string, unknown>,
      previewRegistry: normalizeRegistry(raw.previewRegistry),
    },
    flows,
  };
}
