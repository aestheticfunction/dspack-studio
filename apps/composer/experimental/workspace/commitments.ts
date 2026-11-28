/**
 * Pending commitments on this device (safeguards R3).
 *
 * The Library itself never dispatches anything: actions are previewed only. This journal is what a host uses
 * once consequential actions run on this device. With it, a commitment survives a reload:
 * - it is kept before it is accepted (a commitment that cannot be kept is not accepted);
 * - it is re-attached to the next host settle-only, so it can be queried and settled by its key but never
 *   dispatched again;
 * - a second commitment of the same action is refused while it is pending or unknown;
 * - it names the exact version, definition and authorization generation it was accepted under, so one
 *   accepted before a withdrawal is said to be.
 *
 * Only metadata is kept. Never a payload, a typed value (private or not), or anything a tool returned.
 *
 * Each commitment has its own key (`…commitment.<idempotency key>`). Keys are unique per surface and action,
 * so two tabs never rewrite each other's entries. An entry changes only by its own settlement.
 */
import type { Commitment, CommitmentJournal, Outcome, PersistedCommitment } from "@dspack-studio/composer-core/compositions";
import { lastWithdrawalGeneration, type AuthorityRecord } from "./authority";
import { NAMESPACE, type KeyValueStore } from "./storage";

const PREFIX = `${NAMESPACE}commitment.`;
const OUTCOMES: Outcome[] = ["pending", "succeeded", "failed", "unknown"];

export interface KeptCommitment extends PersistedCommitment {
  /** The authorization generation this tab's approval came from when it was accepted. */
  approvalGeneration: number;
  acceptedAt: string;
  history: Array<{ status: Outcome; at: string }>;
}

/** A listable store: localStorage, or a test store with the same two members. */
export type ListableStore = KeyValueStore & { readonly length: number; key(index: number): string | null };

const SHA = /^[0-9a-f]{64}$/;
function valid(raw: unknown): KeptCommitment | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const keys = Object.keys(c).sort().join(",");
  if (keys !== "acceptedAt,action,approvalGeneration,componentId,composition,compositionSha256,history,key,status,version") return null;
  if (typeof c.key !== "string" || typeof c.composition !== "string" || !Number.isInteger(c.version) || typeof c.compositionSha256 !== "string" || !SHA.test(c.compositionSha256)) return null;
  if (typeof c.action !== "string" || typeof c.componentId !== "string" || !OUTCOMES.includes(c.status as Outcome) || !Number.isInteger(c.approvalGeneration) || typeof c.acceptedAt !== "string") return null;
  if (!Array.isArray(c.history) || !c.history.every((h) => h && typeof h === "object" && OUTCOMES.includes((h as { status: Outcome }).status) && typeof (h as { at: string }).at === "string")) return null;
  return structuredClone(c) as unknown as KeptCommitment;
}

/** Every commitment kept on this device; entries that do not validate are left where they are and not used. */
export function keptCommitments(store: ListableStore | null): KeptCommitment[] {
  if (!store) return [];
  const out: KeptCommitment[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!k?.startsWith(PREFIX)) continue;
    try {
      const c = valid(JSON.parse(store.getItem(k) ?? ""));
      if (c && `${PREFIX}${c.key}` === k) out.push(c);
    } catch {
      /* not a commitment entry */
    }
  }
  return out.sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt));
}

const NEXT: Record<Outcome, Outcome[]> = { pending: ["succeeded", "failed", "unknown"], unknown: ["succeeded", "failed", "unknown"], succeeded: ["succeeded"], failed: ["failed"] };

/**
 * The journal a host writes through. `approvalGeneration` is read when each commitment is accepted.
 *
 * Across hosts (tabs) it re-reads what is stored at each step: a key already kept is never accepted again; an
 * open commitment of the same action for the same definition, kept by another host, refuses a second one; and a
 * kept outcome is moved only along the lifecycle, so a terminal outcome is never overwritten. localStorage has
 * no cross-tab transaction, so two tabs pressing at the same instant can still both pass the check. That
 * residual window is why this journal is for local synthetic use only (see the safeguards record).
 */
export function commitmentJournal(store: (KeyValueStore & Partial<Pick<ListableStore, "length" | "key">>) | null, approvalGeneration: () => number): CommitmentJournal {
  return {
    accept(c: Commitment) {
      if (!store) return false;
      if (store.getItem(`${PREFIX}${c.key}`) !== null) return { duplicate: c.key };
      if (typeof store.length === "number" && store.key) {
        const open = keptCommitments(store as ListableStore).find((k) => k.composition === c.composition && k.version === c.version && k.compositionSha256 === c.compositionSha256 && k.action === c.action && (k.status === "pending" || k.status === "unknown"));
        if (open) return { duplicate: open.key };
      }
      const kept: KeptCommitment = {
        key: c.key,
        composition: c.composition,
        version: c.version,
        compositionSha256: c.compositionSha256,
        action: c.action,
        componentId: c.componentId,
        status: c.status,
        approvalGeneration: approvalGeneration(),
        acceptedAt: new Date().toISOString(),
        history: [{ status: c.status, at: new Date().toISOString() }],
      };
      try {
        store.setItem(`${PREFIX}${c.key}`, JSON.stringify(kept));
        return store.getItem(`${PREFIX}${c.key}`) === JSON.stringify(kept);
      } catch {
        return false;
      }
    },
    settle(key: string, status: Outcome) {
      if (!store) return false;
      try {
        const was = valid(JSON.parse(store.getItem(`${PREFIX}${key}`) ?? ""));
        if (!was) return false;
        if (!NEXT[was.status].includes(status)) return "conflict";
        if (was.status === status) return true;
        const next: KeptCommitment = { ...was, status, history: [...was.history, { status, at: new Date().toISOString() }] };
        store.setItem(`${PREFIX}${key}`, JSON.stringify(next));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Commitments to re-attach to a host, for exactly the definitions it governs (the host matches them itself). */
export const pendingFor = (kept: KeptCommitment[], composition: string, version: number): PersistedCommitment[] =>
  kept.filter((c) => c.composition === composition && c.version === version).map(({ key, composition: id, version: v, compositionSha256, action, componentId, status }) => ({ key, composition: id, version: v, compositionSha256, action, componentId, status }));

/** Whether a commitment was accepted before the latest withdrawal of its definition (said, never hidden). */
export function acceptedBeforeWithdrawal(c: KeptCommitment, record: AuthorityRecord): boolean {
  const w = lastWithdrawalGeneration(record, { id: c.composition, version: c.version }, c.compositionSha256);
  return w > 0 && c.approvalGeneration < w;
}
