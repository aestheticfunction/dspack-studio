/**
 * Approval withdrawal on this device (decision 34), as an authorization-lifecycle decision.
 *
 * The approved definition is never changed or deleted, and its recorded check evidence is never rewritten. What
 * changes is whether this device authorizes it. A withdrawal is recorded in the authority (authority.ts), then
 * the host withdraws the approval, so nothing new is shown from the version and nothing on a surface already
 * shown runs. Restoring takes a person's explicit decision and a check run now. The host accepts only a check
 * issued after the withdrawal (host.ts restore).
 *
 * Every record change is one transaction on the authority (safeguards R1). It applies exactly one change to
 * the record as committed, never a copy this tab holds:
 *   withdraw: add exactly this withdrawal. If it cannot be recorded, nothing is withdrawn. If the host then
 *             refuses, exactly that withdrawal is undone, and only if it is still the one this tab made.
 *   restore:  check first, then remove exactly the withdrawal that was seen (compare and set: a newer
 *             withdrawal is never removed). Then restore the host. If the host refuses, the withdrawal is put
 *             back as a new one.
 *
 * Withdrawal is not supersession: approving a newer version supersedes nothing, and withdrawing one authorizes
 * no other.
 */
import { compositionPins, recheck, type CompositionDefinition, type Governor, type Host, type ScenarioResult } from "@dspack-studio/composer-core/compositions";
import { approvalStanding, EMPTY_AUTHORITY, reinstateChange, restoreChange, undoWithdrawChange, withdrawalFor, withdrawChange, type Authority, type AuthorityRecord } from "./authority";

export const shaOf = async (c: CompositionDefinition): Promise<string> => (await compositionPins(c)).compositionSha256;

export type LifecycleResult =
  | { ok: true; record: AuthorityRecord; scenarios?: ScenarioResult[]; approvalGeneration?: number; warning?: string }
  | { ok: false; reason: string; scenarios?: ScenarioResult[] };

/** Withdraw an approved version's approval on this device. */
export async function withdrawApproval(options: { definition: CompositionDefinition; host: Host; authority: Authority; origin: "packaged" | "device" }): Promise<LifecycleResult> {
  const { definition: c, host, authority, origin } = options;
  if (c.status !== "approved") return { ok: false, reason: "only an approved version has an approval to withdraw" };
  const sha = await shaOf(c);
  if (!authority.available) {
    // Fail closed: withdrawing is the safe direction, so this tab withdraws it, and says it is not kept.
    if (host.isWithdrawn(c.id)) return { ok: false, reason: `the approval of v${c.version} is already withdrawn` };
    host.withdraw(c.id);
    return { ok: true, record: structuredClone(EMPTY_AUTHORITY), warning: `Withdrawn in this tab only: ${authority.reason}. Other tabs and a reload do not see it.` };
  }
  const r = await authority.update(withdrawChange(c, sha, origin));
  if (!r.ok) return { ok: false, reason: `the withdrawal could not be recorded on this device, so nothing was withdrawn: ${r.reason}` };
  if (!r.changed && host.isWithdrawn(c.id)) return { ok: false, reason: `the approval of v${c.version} is already withdrawn` };
  const made = withdrawalFor(r.record, c, sha)!;
  if (!host.isWithdrawn(c.id)) {
    const h = host.withdraw(c.id);
    if (!h.withdrawn) {
      if (r.changed) await authority.update(undoWithdrawChange(made));
      return { ok: false, reason: h.reason };
    }
  }
  return { ok: true, record: r.record };
}

/**
 * Restore a withdrawn approval: a person's decision, and a check that passes now. Also used when another tab
 * restored it: this tab is authorized again only by its own check, run here.
 */
export async function restoreApproval(options: { governor: Governor; definition: CompositionDefinition; host: Host; authority: Authority }): Promise<LifecycleResult> {
  const { governor, definition: c, host, authority } = options;
  if (!authority.available) return { ok: false, reason: `nothing can be restored here: ${authority.reason}` };
  const sha = await shaOf(c);
  const before = await authority.read();
  const seen = withdrawalFor(before, c, sha);
  if (!seen && !host.isWithdrawn(c.id)) return { ok: false, reason: `the approval of v${c.version} is not withdrawn` };
  // The approval this check yields is bound to the generation read before it ran.
  const fresh = await recheck(governor, c);
  if (!fresh.approval) {
    const failing = fresh.scenarios.filter((s) => !s.matches).length;
    return { ok: false, reason: `its checks do not pass now (${failing} of ${fresh.scenarios.length} examples), so it stays withdrawn`, scenarios: fresh.scenarios };
  }
  let record = before;
  if (seen) {
    const u = await authority.update(restoreChange(seen));
    if (!u.ok) return { ok: false, reason: `the restoration could not be recorded on this device, so it stays withdrawn: ${u.reason}` };
    if (!u.changed) return { ok: false, reason: "it changed in another tab while the checks ran (withdrawn again, or already restored); nothing was restored here. Look again" };
    record = u.record;
  } else {
    // Restored in another tab: the record already allows it. Make sure nothing withdrew it again meanwhile.
    record = await authority.read();
    if (withdrawalFor(record, c, sha)) return { ok: false, reason: "it was withdrawn again in another tab while the checks ran; nothing was restored here" };
  }
  const r = host.restore(c.id, fresh.approval);
  if (!r.approved) {
    if (seen) await authority.update(reinstateChange(seen));
    return { ok: false, reason: r.reason };
  }
  return { ok: true, record, scenarios: fresh.scenarios, approvalGeneration: record.generation };
}

export interface Standing {
  /** Versions withdrawn in this tab by this call. */
  withdrawn: string[];
  /** Versions this tab may not use although the record allows them: restored elsewhere, so a check is needed here. */
  restoredElsewhere: string[];
}

/**
 * Apply the authority's record to this tab's hosts: at load, when another tab says the record changed, and before
 * anything authorization-sensitive. A version is used here only if it is not withdrawn and this tab's approval is
 * at least as recent as its latest withdrawal (R2). Otherwise its host is withdrawn here.
 */
export async function applyAuthority(record: AuthorityRecord, versions: Array<{ definition: CompositionDefinition; host: Host | undefined; approvalGeneration: number }>): Promise<Standing> {
  const out: Standing = { withdrawn: [], restoredElsewhere: [] };
  for (const { definition: c, host, approvalGeneration } of versions) {
    if (!host || c.status !== "approved") continue;
    const key = `${c.id}@${c.version}`;
    const standing = approvalStanding(record, c, await shaOf(c), approvalGeneration);
    if (standing === "current") {
      if (host.isWithdrawn(c.id)) out.restoredElsewhere.push(key);
      continue;
    }
    if (!host.isWithdrawn(c.id) && host.withdraw(c.id).withdrawn) out.withdrawn.push(key);
    if (standing === "stale") out.restoredElsewhere.push(key);
  }
  return out;
}
