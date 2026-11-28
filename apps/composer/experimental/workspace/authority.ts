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
 * version-2 record. Every entry is kept as withdrawn, with an ordering generation, and marked `legacy`. A legacy
 * entry applies to its composition and version whatever the definition's hash: its hash was taken before
 * definitions were normalized (decision 81), so the same definition can hash differently now, and matching by
 * hash alone could let it through. The version-1 record is never cleared or rewritten: it stays as evidence, and
 * the version-2 record existing is what prevents a second migration.
 *
 * Only a genuinely absent version-1 record means "no withdrawals". A record that is malformed, of another
 * version, or cannot be read is evidence that withdrawals may exist. Then nothing is written, the old record is
 * left as it is, and the authority blocks every approval on this device (`blockAll`) until it can be read.
 *
 * Identity: an entry names one exact definition (composition, version and hash). Two definitions under the same
 * composition and version are distinct, and withdrawing one never erases the other's withdrawal.
 */
import { readRecord, type KeyValueStore } from "./storage";

export interface WithdrawalEntry {
  composition: string;
  version: number;
  compositionSha256: string;
  origin: "packaged" | "device";
  /** The generation of the change that withdrew it. */
  generation: number;
  /** When, for people; never used for ordering. */
  withdrawnAt: string;
  /** Migrated from a version-1 record: applies to its composition and version whatever the hash (fail closed). */
  legacy?: true;
}

export interface RestoredEntry {
  composition: string;
  version: number;
  compositionSha256: string;
  withdrawnGeneration: number;
  restoredGeneration: number;
  legacy?: true;
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
  /**
   * The record exists but cannot be established (unreadable evidence): no approval on this device may be used
   * until it can, and nothing is written meanwhile.
   */
  readonly blockAll?: boolean;
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
    if (w.legacy !== undefined && w.legacy !== true) return null;
  }
  for (const h of raw.history) {
    if (!isObject(h) || typeof h.composition !== "string" || !Number.isInteger(h.version) || typeof h.compositionSha256 !== "string" || !SHA.test(h.compositionSha256)) return null;
    if (!nat(h.withdrawnGeneration) || !nat(h.restoredGeneration) || (h.restoredGeneration as number) <= (h.withdrawnGeneration as number) || (h.restoredGeneration as number) > (raw.generation as number)) return null;
    if (h.legacy !== undefined && h.legacy !== true) return null;
  }
  // One entry per exact definition: composition, version and hash.
  const keys = raw.withdrawn.map((w) => `${(w as WithdrawalEntry).composition}@${(w as WithdrawalEntry).version}#${(w as WithdrawalEntry).compositionSha256}`);
  if (new Set(keys).size !== keys.length) return null;
  return structuredClone(raw) as unknown as AuthorityRecord;
}

/**
 * A version-1 record (localStorage) moved into version 2: every entry stays withdrawn, in order, marked legacy.
 * Only a genuinely absent record migrates as "nothing withdrawn". Anything unreadable refuses, with the reason;
 * the caller then writes nothing and fails closed.
 */
export function migrateV1(store: KeyValueStore | null): { ok: true; record: AuthorityRecord } | { ok: false; reason: string } {
  if (!store) return { ok: false, reason: "the earlier authorization record cannot be read in this browser, so whether anything was withdrawn is unknown" };
  const v1 = readRecord("authorization", store);
  if (v1.status === "missing") return { ok: true, record: structuredClone(EMPTY_AUTHORITY) };
  if (v1.status !== "ok") return { ok: false, reason: `the earlier authorization record is ${v1.status === "malformed" ? "not in the expected form" : v1.status === "incompatible" ? "of another version" : "unreadable"}, so whether anything was withdrawn is unknown; it is kept as it is` };
  const at = new Date().toISOString();
  const entries = v1.value.withdrawn;
  return { ok: true, record: { version: 2, generation: entries.length, withdrawn: entries.map((w, i) => ({ ...w, generation: i + 1, withdrawnAt: at, legacy: true as const })), history: [] } };
}

// ---- Questions every caller asks ----------------------------------------------------------------------------

/** Whether an entry applies to this definition: its exact hash, or a legacy entry for its composition and version. */
const applies = (x: { composition: string; version: number; compositionSha256: string; legacy?: true }, c: { id: string; version: number }, sha: string) =>
  x.composition === c.id && x.version === c.version && (x.compositionSha256 === sha || x.legacy === true);

/** Every current withdrawal that applies to this definition. */
export function withdrawalsFor(record: AuthorityRecord, c: { id: string; version: number }, sha: string): WithdrawalEntry[] {
  return record.withdrawn.filter((w) => applies(w, c, sha));
}

/** A current withdrawal of this definition, if any. */
export function withdrawalFor(record: AuthorityRecord, c: { id: string; version: number }, sha: string): WithdrawalEntry | undefined {
  return withdrawalsFor(record, c, sha)[0];
}

/** The generation of the latest withdrawal of this definition, current or restored; 0 if never withdrawn. */
export function lastWithdrawalGeneration(record: AuthorityRecord, c: { id: string; version: number }, sha: string): number {
  return Math.max(0, ...record.withdrawn.filter((w) => applies(w, c, sha)).map((w) => w.generation), ...record.history.filter((h) => applies(h, c, sha)).map((h) => h.withdrawnGeneration));
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

/**
 * Withdraw exactly this definition. No change if a withdrawal already applies to it. Withdrawals of other
 * definitions under the same composition and version are kept: one never erases another.
 */
export const withdrawChange =
  (c: { id: string; version: number }, sha: string, origin: "packaged" | "device", at = new Date().toISOString()): AuthorityChange =>
  (r) => {
    if (withdrawalFor(r, c, sha)) return null;
    const generation = r.generation + 1;
    return { ...r, generation, withdrawn: [...r.withdrawn, { composition: c.id, version: c.version, compositionSha256: sha, origin, generation, withdrawnAt: at }] };
  };

const sameEntry = (a: WithdrawalEntry, b: WithdrawalEntry) => a.composition === b.composition && a.version === b.version && a.compositionSha256 === b.compositionSha256 && a.generation === b.generation;
const toHistory = (w: WithdrawalEntry, restoredGeneration: number): RestoredEntry => ({ composition: w.composition, version: w.version, compositionSha256: w.compositionSha256, withdrawnGeneration: w.generation, restoredGeneration, ...(w.legacy ? { legacy: true as const } : {}) });

/**
 * Restore exactly the withdrawals that were seen to apply to this definition (compare and set): if any of them is
 * no longer there, or any other withdrawal now applies to it, nothing changes. A restoration never removes a
 * withdrawal it did not see, and never touches another definition's.
 */
export const restoreChange =
  (c: { id: string; version: number }, sha: string, seen: WithdrawalEntry[]): AuthorityChange =>
  (r) => {
    const now = withdrawalsFor(r, c, sha);
    if (seen.length === 0 || now.length !== seen.length || !seen.every((s) => now.some((n) => sameEntry(n, s)))) return null;
    const generation = r.generation + 1;
    return { ...r, generation, withdrawn: r.withdrawn.filter((w) => !now.includes(w)), history: [...r.history, ...now.map((w) => toHistory(w, generation))] };
  };

/** Undo exactly one withdrawal this tab just made (its host refused): only if it is still the one it made. */
export const undoWithdrawChange =
  (made: WithdrawalEntry): AuthorityChange =>
  (r) => {
    const current = r.withdrawn.find((w) => sameEntry(w, made));
    if (!current) return null;
    // Kept in history, so an approval from before it stays stale.
    const generation = r.generation + 1;
    return { ...r, generation, withdrawn: r.withdrawn.filter((w) => w !== current), history: [...r.history, toHistory(current, generation)] };
  };

/** Put back the withdrawals this tab removed (its host then refused the restoration), as new withdrawals. */
export const reinstateChange =
  (c: { id: string; version: number }, sha: string, removed: WithdrawalEntry[]): AuthorityChange =>
  (r) => {
    if (removed.length === 0 || withdrawalsFor(r, c, sha).length > 0) return null;
    const generation = r.generation + 1;
    return { ...r, generation, withdrawn: [...r.withdrawn, ...removed.map((w) => ({ ...w, generation, withdrawnAt: new Date().toISOString() }))] };
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
            const m = migrateV1(store);
            if (!m.ok) {
              // Unreadable evidence: write nothing, leave the old record as it is, and fail closed.
              result = { ok: false, reason: m.reason };
              tx.abort();
              return;
            }
            current = m.record;
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
          // The version-1 record is left in place as evidence; the version-2 record now existing prevents a
          // second migration.
          void migrated;
          if (result.ok && result.changed) channel?.postMessage({ changed: true });
          resolve(result);
        };
        tx.onabort = tx.onerror = () => resolve(result.ok ? { ok: false, reason: "the change could not be written" } : result);
      } catch (e) {
        resolve({ ok: false, reason: e instanceof Error ? e.message : "the change could not be written" });
      }
    });

  // Establish the record once before anything relies on it: unreadable evidence blocks every approval here.
  const first = await transact(null);
  if (!first.ok) return blockedAuthority(first.reason);
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

/**
 * Fail closed on unreadable evidence: nothing is kept, nothing can be restored, and every approval on this device
 * is treated as withdrawn (`blockAll`) until the record can be read.
 */
export function blockedAuthority(reason: string): Authority {
  return { ...unavailableAuthority(reason), blockAll: true };
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
