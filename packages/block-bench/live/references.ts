/**
 * The packaged references the evaluation runs against, loaded exactly as the
 * experimental runtime loads them: the base contract, the loaded profile, and
 * the sidecar bound to the base digest and B0-checked (loadBlocks). A block
 * that B0 disables is reported and never offered, as in the app.
 */
import { loadProfile, type Profile } from "@aestheticfunction/dspack-emit";
import { lintSurface } from "@aestheticfunction/dspack-gen/core";
import { loadBlocks, type BlockDefinition, type BlocksSidecar, type LintVerdict } from "@dspack-studio/composer-core/blocks";
import { REFERENCES, REPO } from "../src/bench";
import { readFileSync } from "node:fs";
import type { ReferenceShape } from "./corpus";

type Json = Record<string, any>;

export interface LoadedReference {
  id: string;
  name: string;
  contract: Json;
  profile: Profile;
  profileRaw: Json;
  sidecar: BlocksSidecar | undefined;
  /** Blocks that bound and passed B0: what the app would offer. */
  blocks: BlockDefinition[];
  disabled: Array<{ block: string; issues: string[] }>;
  binding: "ok" | "mismatch" | "invalid";
  issues: string[];
  /** S1/S2/S3 bound to this contract, the block phase's `lint` dependency. */
  lint: (surface: unknown) => LintVerdict;
  shape: ReferenceShape;
}

const read = (rel: string): Json => JSON.parse(readFileSync(`${REPO}${rel}`, "utf8"));

export async function loadReference(id: string): Promise<LoadedReference> {
  const ref = REFERENCES.find((r) => r.id === id);
  if (!ref) throw new Error(`unknown reference ${id}; known: ${REFERENCES.map((r) => r.id).join(", ")}`);
  const contract = read(ref.contract);
  const profileRaw = read(ref.profile);
  const profile = loadProfile(profileRaw as never) as Profile;
  const loaded = await loadBlocks(read(ref.sidecar), { baseContract: contract, profile });
  const intents = new Set<string>(((contract.intents as Json[]) ?? []).map((i) => String(i.id)));
  const components = new Set<string>(Array.isArray(contract.components) ? contract.components.map((c: Json) => String(c.name ?? c.id)) : Object.keys(contract.components ?? {}));
  return {
    id,
    name: String(contract.name),
    contract,
    profile,
    profileRaw,
    sidecar: loaded.sidecar,
    blocks: loaded.usable,
    disabled: loaded.disabled,
    binding: loaded.binding,
    issues: loaded.issues,
    lint: (surface) => lintSurface(surface as never, contract as never) as unknown as LintVerdict,
    shape: { id, intents, components, blocks: loaded.usable },
  };
}

export const REFERENCE_IDS: readonly string[] = REFERENCES.map((r) => r.id);
