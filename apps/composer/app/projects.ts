/**
 * Projects as first-class objects.
 *
 * A project is the thing a person creates, names, and returns to — not the demo.
 * It records only its IDENTITY and its SOURCE (the governed vocabulary it builds
 * from); the working contract/profile are derived from that source when the
 * project opens (a packaged reference is cloned fresh; an agent project is
 * reconnected on the user's machine). Identity persists in localStorage so the
 * hub, recents, rename, duplicate, and remove survive a reload; a hosted demo's
 * in-session edits stay in memory, as they always have and as the UI says.
 *
 * Deliberately storage-light: the base vocabulary is the reference (bundled) or
 * the user's own repository (on disk), so a project index never holds a 400KB
 * contract per row. Reference-backed projects may persist a small authored
 * delta (accepted example ids) so a project remembers its own work.
 */

/** Where a project's governed vocabulary comes from. */
export type ProjectSource =
  | { kind: "reference"; referenceId: string }
  | { kind: "agent"; path: string }
  /** An imported project: its governed vocabulary (contract + profile +
   *  previewRegistry) travelled in a file and is stored inline, keyed by id.
   *  This is what makes a project portable off one machine and back — the
   *  reference need not be bundled and no on-disk path is assumed. */
  | { kind: "imported" };

export interface StoredProject {
  id: string;
  name: string;
  description: string;
  source: ProjectSource;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

const KEY = "composer.projects.v1";

/** localStorage is absent during SSR/static prerender and in locked-down
 *  contexts; every access degrades to an empty, in-memory-free store rather
 *  than throwing (the hub simply shows no saved projects). */
function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function readAll(): StoredProject[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidProject);
  } catch {
    return [];
  }
}

function writeAll(projects: StoredProject[]): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(projects));
  } catch {
    /* quota or serialization failure: the session keeps working in memory;
       persistence is a convenience, never a correctness dependency. */
  }
}

function isValidProject(p: unknown): p is StoredProject {
  if (!p || typeof p !== "object") return false;
  const r = p as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    !!r.source &&
    typeof r.source === "object" &&
    (["reference", "agent", "imported"] as const).includes((r.source as { kind?: string }).kind as never)
  );
}

/* ----------------------- Imported-project vocabulary -----------------------
 * An imported project carries its governed vocabulary with it. We keep that
 * (potentially ~100KB) payload OUT of the project index — one key per project,
 * loaded only when the project opens — so listing the hub stays cheap and a
 * single oversized import can never corrupt the whole index. */

export type PreviewRegistry = "wireframe" | "shadcn" | "astryx";

export interface ProjectVocab {
  contract: Record<string, unknown>;
  profile: Record<string, unknown>;
  previewRegistry: PreviewRegistry;
}

const vocabKey = (id: string): string => `composer.project.vocab.${id}`;

export function saveVocab(id: string, vocab: ProjectVocab): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(vocabKey(id), JSON.stringify(vocab));
    return true;
  } catch {
    // Quota exceeded (a large contract on a near-full store): report honestly
    // so the caller can refuse the import rather than create a project whose
    // vocabulary silently failed to persist.
    return false;
  }
}

export function loadVocab(id: string): ProjectVocab | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(vocabKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProjectVocab;
    if (!parsed || typeof parsed !== "object" || !parsed.contract || !parsed.profile) return null;
    return parsed;
  } catch {
    return null;
  }
}

function removeVocab(id: string): void {
  try {
    storage()?.removeItem(vocabKey(id));
  } catch {
    /* best-effort cleanup */
  }
}

/** A stable-ish id without pulling a dep; crypto.randomUUID where available. */
function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `p_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** All projects, most-recently-opened first. */
export function listProjects(): StoredProject[] {
  return readAll().sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

/** The N most recently opened projects. */
export function recentProjects(n = 5): StoredProject[] {
  return listProjects().slice(0, n);
}

export function getProject(id: string): StoredProject | null {
  return readAll().find((p) => p.id === id) ?? null;
}

export function createProject(input: { name: string; description?: string; source: ProjectSource }): StoredProject {
  const now = Date.now();
  const project: StoredProject = {
    id: newId(),
    name: input.name.trim() || "Untitled project",
    description: (input.description ?? "").trim(),
    source: input.source,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
  writeAll([project, ...readAll()]);
  return project;
}

export function updateProject(id: string, patch: Partial<Pick<StoredProject, "name" | "description" | "source">>): StoredProject | null {
  const all = readAll();
  const at = all.findIndex((p) => p.id === id);
  if (at < 0) return null;
  const next: StoredProject = {
    ...all[at],
    ...(patch.name !== undefined ? { name: patch.name.trim() || all[at].name } : {}),
    ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
    ...(patch.source !== undefined ? { source: patch.source } : {}),
    updatedAt: Date.now(),
  };
  all[at] = next;
  writeAll(all);
  return next;
}

export function renameProject(id: string, name: string): StoredProject | null {
  return updateProject(id, { name });
}

/** Mark a project opened (moves it to the top of recents). */
export function touchProject(id: string): void {
  const all = readAll();
  const at = all.findIndex((p) => p.id === id);
  if (at < 0) return;
  all[at] = { ...all[at], lastOpenedAt: Date.now() };
  writeAll(all);
}

export function duplicateProject(id: string): StoredProject | null {
  const original = getProject(id);
  if (!original) return null;
  const copy = createProject({
    name: `${original.name} copy`,
    description: original.description,
    source: original.source,
  });
  // An imported project's vocabulary lives under its own id — carry it to the
  // copy so the duplicate is a real, openable project, not a dangling source.
  if (original.source.kind === "imported") {
    const vocab = loadVocab(original.id);
    if (vocab) saveVocab(copy.id, vocab);
  }
  return copy;
}

export function removeProject(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id));
  removeVocab(id);
  if (getLastOpened() === id) setLastOpened(null);
}

const LAST_KEY = "composer.lastProject.v1";

/** The project to reopen on return, so a reload lands back where you were. */
export function getLastOpened(): string | null {
  const s = storage();
  try {
    return s?.getItem(LAST_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setLastOpened(id: string | null): void {
  const s = storage();
  try {
    if (id === null) s?.removeItem(LAST_KEY);
    else s?.setItem(LAST_KEY, id);
  } catch {
    /* persistence is a convenience, never a correctness dependency */
  }
}
