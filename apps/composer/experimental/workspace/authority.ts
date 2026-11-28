/**
 * The authorization authority on this device (safeguards R1 and R2).
 *
 * Withdrawals used to live in a localStorage record that each tab rewrote from its own in-memory copy. One tab
 * could erase another tab's withdrawal, which then came back as an approval after a reload (reproduced in
 * composer-authority.spec.ts). localStorage has no atomic read-modify-write across tabs. IndexedDB does: one
 * readwrite transaction on one object store is serialized by the browser against every other transaction on it,
 * in any tab. So every change here is a single transaction:
 *   read the current record → apply exactly one change → write it.
 * Nothing is ever written from a copy held in memory.
 *
 * The record (version 2):
 * - `generation`: a persistent counter, raised by every change. Ordering uses it, never the wall clock.
 * - `withdrawn`: current withdrawals, each bound to the exact definition (sha256) and the generation that made it.
 * - `history`: every restored withdrawal, kept. An approval a tab obtained before a withdrawal can never become
 *   valid again just because the version was later restored: the tab compares its approval's generation with
 *   the latest withdrawal of that definition, current or restored.
 *
 * After each change, the other tabs are told on a BroadcastChannel. They never trust the message: they re-read
 * the record. Authorization-sensitive steps also re-read it themselves, so a lost message cannot leave a tab
 * authorizing what was withdrawn.
 *
 * Fail closed: where IndexedDB is unavailable, the authority says so. Nothing can then be restored or used by
 * agents. A withdrawal still takes effect in the tab that made it, labelled as not kept.
 *
 * Migration: a version-1 localStorage record is moved in once, in the first transaction that finds no
 * version-2 record. Every entry is kept as withdrawn, with an ordering generation. The old key is then removed
 * so it cannot be migrated again.
 */
import { KEYS, readRecord, type KeyValueStore } from "./storage";

export interface WithdrawalEntry {
  composition: string;
  version: number;
  compositionSha256: string;
  origin: "packaged" | "device";
  /** The generation of the change that withdrew it. */
  generation: number;
  /** When, for people; never used for ordering. */
  withdrawnAt: string;
}

export interface RestoredEntry {
  composition: string;
  version: number;
  compositionSha256: string;
  withdrawnGeneration: number;
  restoredGeneration: number;
}

export interface AuthorityRecord {
  version: 2;
  generation: number;
  withdrawn: WithdrawalEntry[];
  history: RestoredEntry[];
}

export const EMPTY_AUTHORITY: AuthorityRecord = { version: 2, generation: 0, withdrawn: [], history: [] };

/** One change: return the next record, or null to change nothing. It sees the record as committed, never a copy. */
export type AuthorityChange = (current: AuthorityRecord) => AuthorityRecord | null;

export type AuthorityUpdate = { ok: true; record: AuthorityRecord; changed: boolean } | { ok: false; reason: string };

export interface Authority {
  /** Whether changes can be kept safely here. False: fail closed. */
  readonly available: boolean;
  /** Why not, when unavailable. */
  readonly reason?: string;
  read(): Promise<AuthorityRecord>;
  update(change: AuthorityChange): Promise<AuthorityUpdate>;
  /** Be told that another tab changed the record (re-read it; the message itself carries nothing trusted). */
  subscribe(listener: () => void): () => void;
}

// ---- Validation ---------------------------------------------------------------------------------------------

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SHA = /^[0-9a-f]{64}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nat = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;

/** A stored record, or null if it is not exactly the version-2 shape (then the authority fails closed). */
export function validAuthority(raw: unknown): AuthorityRecord | null {
  if (!isObject(raw) || raw.version !== 2 || !nat(raw.generation) || !Array.isArray(raw.withdrawn) || !Array.isArray(raw.history)) return null;
  for (const w of raw.withdrawn) {
    if (!isObject(w) || typeof w.composition !== "string" || !ID.test(w.composition) || !Number.isInteger(w.version) || (w.version as number) < 1) return null;
    if (typeof w.compositionSha256 !== "string" || !SHA.test(w.compositionSha256) || (w.origin !== "packaged" && w.origin !== "device")) return null;
    if (!nat(w.generation) || (w.generation as number) > (raw.generation as number) || typeof w.withdrawnAt !== "string") return null;
  }
  for (const h of raw.history) {
    if (!isObject(h) || typeof h.composition !== "string" || !Number.isInteger(h.version) || typeof h.compositionSha256 !== "string" || !SHA.test(h.compositionSha256)) return null;
    if (!nat(h.withdrawnGeneration) || !nat(h.restoredGeneration) || (h.restoredGeneration as number) <= (h.withdrawnGeneration as number) || (h.restoredGeneration as number) > (raw.generation as number)) return null;
  }
  const keys = raw.withdrawn.map((w) => `${(w as WithdrawalEntry).composition}@${(w as WithdrawalEntry).version}`);
  if (new Set(keys).size !== keys.length) return null;
  return structuredClone(raw) as unknown as AuthorityRecord;
}

/** A version-1 record (localStorage) moved into version 2: every entry stays withdrawn, in order. */
export function migrateV1(store: KeyValueStore | null): AuthorityRecord {
  const v1 = readRecord("authorization", store);
  const entries = v1.status === "ok" ? v1.value.withdrawn : [];
  const at = new Date().toISOString();
  return { version: 2, generation: entries.length, withdrawn: entries.map((w, i) => ({ ...w, generation: i + 1, withdrawnAt: at })), history: [] };
}

// ---- Questions every caller asks ----------------------------------------------------------------------------

/** The current withdrawal of exactly this definition, if any. */
export function withdrawalFor(record: AuthorityRecord, c: { id: string; version: number }, sha: string): WithdrawalEntry | undefined {
  return record.withdrawn.find((w) => w.composition === c.id && w.version === c.version && w.compositionSha256 === sha);
}

/** The generation of the latest withdrawal of this definition, current or restored; 0 if never withdrawn. */
export function lastWithdrawalGeneration(record: AuthorityRecord, c: { id: string; version: number }, sha: string): number {
  const same = (x: { composition: string; version: number; compositionSha256: string }) => x.composition === c.id && x.version === c.version && x.compositionSha256 === sha;
  return Math.max(0, ...record.withdrawn.filter(same).map((w) => w.generation), ...record.history.filter(same).map((h) => h.withdrawnGeneration));
}

/**
 * Whether an approval this tab holds is still good: the definition is not withdrawn now, and the approval was
 * obtained at or after the latest withdrawal of it (by the generation read before its check ran).
 */
export function approvalStanding(record: AuthorityRecord, c: { id: string; version: number }, sha: string, approvalGeneration: number): "current" | "withdrawn" | "stale" {
  if (withdrawalFor(record, c, sha)) return "withdrawn";
  return approvalGeneration >= lastWithdrawalGeneration(record, c, sha) ? "current" : "stale";
}

// ---- Changes ------------------------------------------------------------------------------------------------

/** Withdraw exactly this definition. No change if it is already withdrawn. */
export const withdrawChange =
  (c: { id: string; version: number }, sha: string, origin: "packaged" | "device", at = new Date().toISOString()): AuthorityChange =>
  (r) => {
    if (withdrawalFor(r, c, sha)) return null;
    const generation = r.generation + 1;
    return { ...r, generation, withdrawn: [...r.withdrawn.filter((w) => !(w.composition === c.id && w.version === c.version)), { composition: c.id, version: c.version, compositionSha256: sha, origin, generation, withdrawnAt: at }] };
  };

/**
 * Restore exactly the withdrawal that was checked (compare and set): if it is no longer there, or a newer
 * withdrawal replaced it, nothing changes. A restoration never removes a withdrawal it did not see.
 */
export const restoreChange =
  (seen: WithdrawalEntry): AuthorityChange =>
  (r) => {
    const current = r.withdrawn.find((w) => w.composition === seen.composition && w.version === seen.version);
    if (!current || current.generation !== seen.generation || current.compositionSha256 !== seen.compositionSha256) return null;
    const generation = r.generation + 1;
    return {
      ...r,
      generation,
      withdrawn: r.withdrawn.filter((w) => w !== current),
      history: [...r.history, { composition: current.composition, version: current.version, compositionSha256: current.compositionSha256, withdrawnGeneration: current.generation, restoredGeneration: generation }],
    };
  };

/** Undo exactly one withdrawal this tab just made (its host refused): only if it is still the one it made. */
export const undoWithdrawChange =
  (made: WithdrawalEntry): AuthorityChange =>
  (r) => {
    const current = r.withdrawn.find((w) => w.composition === made.composition && w.version === made.version);
    if (!current || current.generation !== made.generation) return null;
    // Kept in history, so an approval from before it stays stale.
    const generation = r.generation + 1;
    return { ...r, generation, withdrawn: r.withdrawn.filter((w) => w !== current), history: [...r.history, { composition: current.composition, version: current.version, compositionSha256: current.compositionSha256, withdrawnGeneration: current.generation, restoredGeneration: generation }] };
  };

/** Put back exactly a withdrawal this tab removed (its host then refused the restoration), as a new withdrawal. */
export const reinstateChange =
  (removed: WithdrawalEntry): AuthorityChange =>
  (r) => {
    if (r.withdrawn.some((w) => w.composition === removed.composition && w.version === removed.version)) return null;
    const generation = r.generation + 1;
    return { ...r, generation, withdrawn: [...r.withdrawn, { ...removed, generation, withdrawnAt: new Date().toISOString() }] };
  };

// ---- Implementations ----------------------------------------------------------------------------------------

const DB = "composer.experimental.workspace";
const STORE = "authority";
const KEY = "authorization";
const CHANNEL = "composer.experimental.workspace.authority";

/** The browser's authority: one IndexedDB transaction per change, and a BroadcastChannel to tell other tabs. */
export async function browserAuthority(store: KeyValueStore | null): Promise<Authority> {
  if (typeof indexedDB === "undefined") return unavailableAuthority("this browser keeps no IndexedDB here, so withdrawals cannot be kept safely across tabs");
  let db: IDBDatabase;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("blocked"));
    });
  } catch (e) {
    return unavailableAuthority(`the authorization store could not be opened (${e instanceof Error ? e.message : "unknown"})`);
  }
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  const listeners = new Set<() => void>();
  if (channel) channel.onmessage = () => listeners.forEach((l) => l());

  /** One readwrite transaction: read, migrate if needed, apply, write. Serialized by the browser across tabs. */
  const transact = (change: AuthorityChange | null): Promise<AuthorityUpdate> =>
    new Promise((resolve) => {
      let result: AuthorityUpdate = { ok: false, reason: "the change did not complete" };
      let migrated = false;
      try {
        const tx = db.transaction(STORE, "readwrite");
        const os = tx.objectStore(STORE);
        const get = os.get(KEY);
        get.onsuccess = () => {
          let current: AuthorityRecord | null;
          if (get.result === undefined) {
            current = migrateV1(store);
            migrated = true;
          } else current = validAuthority(get.result);
          if (!current) {
            result = { ok: false, reason: "the stored authorization record is not in the expected form, so nothing is changed or authorized" };
            tx.abort();
            return;
          }
          const next = change ? change(current) : null;
          if (next || migrated) os.put(next ?? current, KEY);
          result = { ok: true, record: next ?? current, changed: !!next };
        };
        tx.oncomplete = () => {
          if (migrated) {
            try {
              store?.setItem(KEYS.authorization, "");
            } catch {
              /* the migrated copy is authoritative; a leftover old key is ignored once version 2 exists */
            }
          }
          if (result.ok && result.changed) channel?.postMessage({ changed: true });
          resolve(result);
        };
        tx.onabort = tx.onerror = () => resolve(result.ok ? { ok: false, reason: "the change could not be written" } : result);
      } catch (e) {
        resolve({ ok: false, reason: e instanceof Error ? e.message : "the change could not be written" });
      }
    });

  return {
    available: true,
    async read() {
      const r = await transact(null);
      if (!r.ok) throw new Error(r.reason);
      return r.record;
    },
    update: (change) => transact(change),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Fail closed: nothing is kept, nothing can be restored; reads report no withdrawals but `available` is false. */
export function unavailableAuthority(reason: string): Authority {
  return {
    available: false,
    reason,
    read: async () => structuredClone(EMPTY_AUTHORITY),
    update: async () => ({ ok: false, reason }),
    subscribe: () => () => {},
  };
}

/**
 * An authority over a shared in-memory value, for tests: changes are serialized as IndexedDB serializes them,
 * and every tab created from the same `shared` sees the same record. `failNext` makes the next write fail.
 */
export function memoryAuthority(shared: { record: AuthorityRecord; queue: Promise<unknown>; listeners: Set<() => void>; failNext?: boolean }): Authority {
  return {
    available: true,
    read: async () => structuredClone(shared.record),
    update(change) {
      const run = shared.queue.then((): AuthorityUpdate => {
        if (shared.failNext) {
          shared.failNext = false;
          return { ok: false, reason: "the write failed" };
        }
        const next = change(structuredClone(shared.record));
        if (next) {
          shared.record = structuredClone(next);
          shared.listeners.forEach((l) => l());
        }
        return { ok: true, record: structuredClone(shared.record), changed: !!next };
      });
      shared.queue = run.catch(() => undefined);
      return run;
    },
    subscribe(listener) {
      shared.listeners.add(listener);
      return () => shared.listeners.delete(listener);
    },
  };
}

export const sharedMemory = (): { record: AuthorityRecord; queue: Promise<unknown>; listeners: Set<() => void>; failNext?: boolean } => ({ record: structuredClone(EMPTY_AUTHORITY), queue: Promise.resolve(), listeners: new Set<() => void>() });
