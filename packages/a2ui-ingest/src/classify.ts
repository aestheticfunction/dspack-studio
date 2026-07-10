/**
 * Pure (React-free) registry classification, split out so the acceptance gates can run in
 * the root test suite without pulling in JSX. Given the catalog's component names and a
 * registry, decide how each name is rendered. The catalog is the source of the names; the
 * registry only assigns visuals.
 */
export interface RegistryShape {
  reuseBasic: Set<string>;
  custom: Record<string, unknown>;
}

export interface RegistryPlan {
  /** Names whose visual is delegated to the Basic Catalog. */
  reuseBasic: string[];
  /** Names with a hand-authored React visual. */
  custom: string[];
  /** Names in the catalog with no visual (render the placeholder). */
  unimplemented: string[];
}

export function planRegistry(catalogNames: string[], registry: RegistryShape): RegistryPlan {
  const plan: RegistryPlan = { reuseBasic: [], custom: [], unimplemented: [] };
  for (const name of catalogNames) {
    if (registry.reuseBasic.has(name)) plan.reuseBasic.push(name);
    else if (registry.custom[name]) plan.custom.push(name);
    else plan.unimplemented.push(name);
  }
  return plan;
}
