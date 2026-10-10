/**
 * The generation view a block template is judged against (B0's oracle).
 *
 * A port of dspack-gen's run-layer views, which its package keeps unexported
 * (src/run/casualty-view.ts casualtyFreeView, src/run/join-id-view.ts
 * joinIdComponents): the contract minus the emit profile's declared
 * casualties, plus the components whose join participation keys on `self.id`.
 * A template may only emit what generation itself could emit under the same
 * profile; anything else would be refused downstream. Parity with the real
 * generation schema is asserted by packages/block-bench, so this port cannot
 * drift silently.
 */
import type { Profile } from "@aestheticfunction/dspack-emit";

type Json = Record<string, unknown>;

export interface GenerationView {
  /** The contract with casualty components (and examples using them) removed. */
  contract: Json;
  /** Every component and sub-component id generation may emit under the profile. */
  components: Set<string>;
  /** Components whose id is required because a profile join keys on self.id. */
  joinIdComponents: Set<string>;
}

function usesCasualty(value: unknown, casualties: Set<string>): boolean {
  if (Array.isArray(value)) return value.some((entry) => usesCasualty(entry, casualties));
  if (value !== null && typeof value === "object") {
    const record = value as Json;
    if (typeof record.component === "string" && casualties.has(record.component)) return true;
    return Object.values(record).some((entry) => usesCasualty(entry, casualties));
  }
  return false;
}

/** dspack-gen joinIdComponents, verbatim in behavior. */
export function joinIdComponents(profile?: Profile): Set<string> {
  const out = new Set<string>();
  const components = ((profile as unknown as { components?: Json[] } | undefined)?.components ?? []) as Json[];
  for (const plan of components) {
    const collects = (((plan.surface ?? {}) as Json).collects ?? []) as Json[];
    for (const collect of collects) {
      const join = collect.join as Json | undefined;
      if (!join) continue;
      const on = (join.on ?? {}) as { left?: string; right?: string };
      const item = (collect.item ?? {}) as Record<string, string>;
      if (on.left === "self.id" || Object.values(item).includes("self.id")) for (const name of (collect.of ?? []) as string[]) out.add(name);
      if (on.right === "self.id") for (const name of (join.with ?? []) as string[]) out.add(name);
    }
  }
  return out;
}

export function generationView(contract: Json, profile?: Profile): GenerationView {
  const casualties = new Set((profile?.casualtyComponents ?? []).map((c) => c.dspackId));
  const components = (contract.components ?? {}) as Record<string, Json>;
  const kept = Object.fromEntries(Object.entries(components).filter(([id]) => !casualties.has(id)));
  const view: Json = casualties.size === 0 ? contract : { ...contract, components: kept };
  if (casualties.size > 0 && Array.isArray(contract.examples)) {
    view.examples = (contract.examples as Json[]).filter((example) => !usesCasualty(example.surface, casualties));
  }
  const ids = new Set<string>();
  for (const [id, component] of Object.entries(kept)) {
    ids.add(id);
    const subs = (((component.composition ?? {}) as Json).subComponents ?? []) as Array<{ id: string }>;
    for (const sub of subs) ids.add(sub.id);
  }
  return { contract: view, components: ids, joinIdComponents: joinIdComponents(profile) };
}
