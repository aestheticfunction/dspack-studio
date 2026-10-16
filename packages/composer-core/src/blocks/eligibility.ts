/**
 * Interface blocks (experimental): eligibility.
 *
 * Composer never infers support. A build may be offered blocks only when all
 * of these hold:
 * - the project is a packaged reference project, or an Example session (both
 *   have source kind "reference"); imported and repository projects never are;
 * - the run happens in the browser (hosted or scripted); a local model routes
 *   through the agent, which has no block mode;
 * - the live vocabulary is still exactly the base the sidecar was bound to
 *   (only accepted examples added), and the live profile is unchanged;
 * - the sidecar bound and is approved, and so is the block (a draft is never
 *   offered, whatever its evaluation);
 * - the block was not disabled for this session.
 * An ineligible build carries no block metadata anywhere.
 */
import { contractDigest } from "./digest";
import type { LoadedBlocks } from "./load";
import type { BlockDefinition } from "./schema";

type Json = Record<string, unknown>;

export type IneligibleReason =
  | "no-project"
  | "imported-project"
  | "repository-project"
  | "local-model"
  | "binding-mismatch"
  | "contract-edited"
  | "profile-edited"
  | "sidecar-not-approved"
  | "no-approved-blocks"
  | "all-disabled";

export interface EligibilityInput {
  /** Composer's mode: "demo" for browser projects, "agent" for repositories. */
  mode: string;
  /** The active project's source (an Example session's is a reference source). */
  source: { kind: "reference" | "agent" | "imported" } | null;
  /** True when this build runs in the browser (hosted or scripted). */
  inBrowser: boolean;
  /** liveBaseDigest(live contract, packaged base). */
  liveDigest: string;
  /** The live profile is the packaged base profile, unedited. */
  profileMatchesBase: boolean;
  loaded: LoadedBlocks;
  /** Block ids disabled for this session (an invariant failure disables one). */
  disabled: ReadonlySet<string>;
}

/**
 * The digest of the live contract with its examples put back to the base's:
 * equal to the base digest exactly when only accepted examples changed. The
 * spread keeps key order (an overridden key keeps its position).
 */
export function liveBaseDigest(live: Json, base: Json): Promise<string> {
  return contractDigest({ ...live, examples: base.examples });
}

export function eligibleBlocks(input: EligibilityInput): { blocks: BlockDefinition[]; reason: IneligibleReason | null } {
  const none = (reason: IneligibleReason) => ({ blocks: [], reason });
  if (!input.source) return none("no-project");
  if (input.mode === "agent" || input.source.kind === "agent") return none("repository-project");
  if (input.source.kind === "imported") return none("imported-project");
  if (!input.inBrowser) return none("local-model");
  if (input.loaded.binding !== "ok" || !input.loaded.sidecar) return none("binding-mismatch");
  if (input.liveDigest !== input.loaded.sidecar.baseSha256) return none("contract-edited");
  if (!input.profileMatchesBase) return none("profile-edited");
  if (input.loaded.sidecar.status !== "approved") return none("sidecar-not-approved");
  const approved = input.loaded.usable.filter((b) => b.status === "approved");
  if (approved.length === 0) return none("no-approved-blocks");
  const blocks = approved.filter((b) => !input.disabled.has(b.id));
  return blocks.length > 0 ? { blocks, reason: null } : none("all-disabled");
}
