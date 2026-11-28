/**
 * Approval withdrawal on this device (decision 34), as an authorization-lifecycle decision.
 *
 * The approved definition is never changed or deleted, and its recorded check evidence is never rewritten. What
 * changes is whether this device's host authorizes it: a withdrawal is recorded (storage.ts `authorization`),
 * then the host withdraws the approval, so nothing new is shown from the version and nothing on a surface already
 * shown runs. Restoring takes a person's explicit decision and a check run now: only a check issued after the
 * withdrawal is accepted by the host (host.ts restore).
 *
 * Order of operations keeps the record and the host in step:
 *   withdraw: write the record first; if it cannot be written, nothing is withdrawn and the reason is given.
 *   restore:  check first; then remove the record; then restore the host. If the host refuses, the record is
 *             written back, so a reload never authorizes what this session refused.
 *
 * A packaged approval is withdrawn by this local record alone (origin "packaged"); a version approved on this
 * device is withdrawn the same way (origin "device"). Neither definition changes. Withdrawal is not
 * supersession: approving a newer version supersedes nothing here, and withdrawing one authorizes no other.
 */
import { compositionPins, recheck, type CompositionDefinition, type Governor, type Host, type ScenarioResult } from "@dspack-studio/composer-core/compositions";
import { writeRecord, type KeyValueStore, type StoredAuthorization, type Withdrawal } from "./storage";

export const shaOf = async (c: CompositionDefinition): Promise<string> => (await compositionPins(c)).compositionSha256;

/** The record's withdrawal of exactly this definition, if any. */
export function withdrawalOf(record: StoredAuthorization, c: CompositionDefinition, sha: string): Withdrawal | undefined {
  return record.withdrawn.find((w) => w.composition === c.id && w.version === c.version && w.compositionSha256 === sha);
}

export type LifecycleResult = { ok: true; record: StoredAuthorization; scenarios?: ScenarioResult[] } | { ok: false; reason: string; scenarios?: ScenarioResult[] };

/** Withdraw an approved version's approval on this device. */
export async function withdrawApproval(options: { definition: CompositionDefinition; host: Host; record: StoredAuthorization; origin: "packaged" | "device"; store: KeyValueStore | null }): Promise<LifecycleResult> {
  const { definition: c, host, record, origin, store } = options;
  if (c.status !== "approved") return { ok: false, reason: "only an approved version has an approval to withdraw" };
  const sha = await shaOf(c);
  if (withdrawalOf(record, c, sha) || host.isWithdrawn(c.id)) return { ok: false, reason: `the approval of v${c.version} is already withdrawn` };
  const next: StoredAuthorization = { withdrawn: [...record.withdrawn.filter((w) => !(w.composition === c.id && w.version === c.version)), { composition: c.id, version: c.version, compositionSha256: sha, origin }] };
  const written = writeRecord("authorization", next, store);
  if (!written.ok) return { ok: false, reason: `the withdrawal could not be recorded on this device, so nothing was withdrawn: ${written.reason}` };
  const r = host.withdraw(c.id);
  if (!r.withdrawn) {
    writeRecord("authorization", record, store);
    return { ok: false, reason: r.reason };
  }
  return { ok: true, record: next };
}

/** Restore a withdrawn approval: a person's decision, and a check that passes now. */
export async function restoreApproval(options: { governor: Governor; definition: CompositionDefinition; host: Host; record: StoredAuthorization; store: KeyValueStore | null }): Promise<LifecycleResult> {
  const { governor, definition: c, host, record, store } = options;
  if (!host.isWithdrawn(c.id)) return { ok: false, reason: `the approval of v${c.version} is not withdrawn` };
  const fresh = await recheck(governor, c);
  if (!fresh.approval) {
    const failing = fresh.scenarios.filter((s) => !s.matches).length;
    return { ok: false, reason: `its checks do not pass now (${failing} of ${fresh.scenarios.length} examples), so it stays withdrawn`, scenarios: fresh.scenarios };
  }
  const next: StoredAuthorization = { withdrawn: record.withdrawn.filter((w) => !(w.composition === c.id && w.version === c.version)) };
  const written = writeRecord("authorization", next, store);
  if (!written.ok) return { ok: false, reason: `the restoration could not be recorded on this device, so it stays withdrawn: ${written.reason}` };
  const r = host.restore(c.id, fresh.approval);
  if (!r.approved) {
    writeRecord("authorization", record, store);
    return { ok: false, reason: r.reason };
  }
  return { ok: true, record: next, scenarios: fresh.scenarios };
}

/** Apply a stored record to the hosts of the versions it names (at load, or when another tab changed it). */
export async function applyWithdrawals(record: StoredAuthorization, versions: Array<{ definition: CompositionDefinition; host: Host | undefined }>): Promise<string[]> {
  const applied: string[] = [];
  for (const { definition: c, host } of versions) {
    if (!host || c.status !== "approved" || host.isWithdrawn(c.id)) continue;
    if (withdrawalOf(record, c, await shaOf(c)) && host.withdraw(c.id).withdrawn) applied.push(`${c.id}@${c.version}`);
  }
  return applied;
}
