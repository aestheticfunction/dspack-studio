/**
 * Agent eligibility (safeguards R4): the one gate that says whether an agent may use a version, once agents
 * exist. Discovery, when it is built, reads this and nothing else.
 *
 * Eligibility is not publication. It is evaluated every time it is asked and never stored, so a later
 * withdrawal, rule change or safety rule applies at once. A version is eligible only if all of these hold:
 * - it is an exact approved version (approved versions are immutable);
 * - this device can keep authorization safely (the authority is available);
 * - its approval is not withdrawn, and this tab's approval of it is not older than its latest withdrawal;
 * - its latest check passed for exactly this definition under the current contract, profile and toolchain;
 * - it meets the current sensitive-data rules: every private field is masked, and every field drawn as a
 *   password is private;
 * - nothing is unresolved from a block it was promoted from;
 * - every intended next state is reached by an example.
 *
 * A historical approval never exempts a version. The packaged Hotel search v1 stays byte-identical and usable
 * in the Library's synthetic preview, but it is ineligible while its private field is unmasked (decision 53).
 */
import { pinsFor, samePins, transitionIssues, type CompositionDefinition, type Governor, type Host } from "@dspack-studio/composer-core/compositions";
import { approvalStanding, type Authority, type AuthorityRecord } from "./authority";
import { interactionIssues } from "./interaction";
import type { VersionCheck } from "./runtime";
import { shaOf } from "./withdrawal";

export interface EligibilityReason {
  kind: "status" | "authority" | "withdrawn" | "stale" | "checks" | "safety" | "promotion" | "intent";
  text: string;
}

export interface Eligibility {
  eligible: boolean;
  /** The headline a designer reads. */
  headline: string;
  reasons: EligibilityReason[];
  /** For technical inspection only. */
  technical: { compositionSha256: string; authorityGeneration: number; approvalGeneration: number | null; withdrawalGeneration: number | null };
}

export async function agentEligibility(input: {
  definition: CompositionDefinition;
  host: Host | undefined;
  check: VersionCheck | undefined;
  governor: Governor;
  authority: Authority;
  record: AuthorityRecord;
  approvalGeneration: number | undefined;
  promotionBlockers: string[];
}): Promise<Eligibility> {
  const { definition: c, host, check, governor, authority, record, approvalGeneration } = input;
  const sha = await shaOf(c);
  const reasons: EligibilityReason[] = [];
  if (c.status !== "approved") reasons.push({ kind: "status", text: "Only an approved version can be used by agents; this is a draft." });
  if (!authority.available) reasons.push({ kind: "authority", text: `This browser cannot keep authorization safely (${authority.reason}), so nothing is eligible here.` });
  const standing = approvalStanding(record, c, sha, approvalGeneration ?? -1);
  if (standing === "withdrawn") reasons.push({ kind: "withdrawn", text: "Its approval is withdrawn on this device." });
  // Not withdrawn in the record, but this tab's approval predates a withdrawal (or this tab still refuses it).
  else if (standing === "stale" || host?.isWithdrawn(c.id)) reasons.push({ kind: "stale", text: "It was withdrawn and restored since this tab checked it. Run its checks here." });
  const current = !!check?.approval && check.definition === c && samePins(check.approval.pins, await pinsFor(governor, c));
  if (c.status === "approved" && !current) reasons.push({ kind: "checks", text: "Its checks have not passed under the current rules, profile and toolchain." });
  for (const i of interactionIssues(c)) reasons.push({ kind: "safety", text: i.text.replace(/ (Mask|Make|Declare) [^.]*before this version can be approved\.$/, "") });
  for (const p of input.promotionBlockers) reasons.push({ kind: "promotion", text: p });
  for (const t of transitionIssues(c)) reasons.push({ kind: "intent", text: `${t}.` });
  const safety = reasons.some((r) => r.kind === "safety");
  const headline = reasons.length === 0 ? "Eligible for agents on this device. Not published: no agent can find it yet." : safety ? "Needs a safety update before agents can use it." : c.status !== "approved" ? "Not eligible for agents: it is a draft." : "Not eligible for agents yet.";
  const w = record.withdrawn.find((x) => x.composition === c.id && x.version === c.version && x.compositionSha256 === sha);
  return { eligible: reasons.length === 0, headline, reasons, technical: { compositionSha256: sha, authorityGeneration: record.generation, approvalGeneration: approvalGeneration ?? null, withdrawalGeneration: w?.generation ?? null } };
}
