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
  | { kind: "agent"; path: string };

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
    (["reference", "agent"] as const).includes((r.source as { kind?: string }).kind as never)
  );
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
  return createProject({
    name: `${original.name} copy`,
    description: original.description,
    source: original.source,
  });
}

export function removeProject(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id));
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
