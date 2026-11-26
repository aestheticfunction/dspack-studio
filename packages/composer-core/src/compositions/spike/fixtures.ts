/** Shared setup for the R1a tests and evidence: the Astryx reference, the real lint, the compositions and data sets. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lintSurface } from "@aestheticfunction/dspack-gen/core";
import { createGovernor, type LintReport } from "../governance";
import { loadCompositions } from "../load";
import type { CompositionDefinition } from "../schema";

export const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));
export const readJson = (rel: string) => JSON.parse(readFileSync(`${REPO}${rel}`, "utf8"));
export const contract = () => readJson("apps/composer/astryx-project/astryx.dspack.json");
export const profileJson = () => readJson("apps/composer/astryx-project/astryx.profile.json");
export const sidecarJson = () => readJson("packages/composer-core/src/compositions/spike/astryx.compositions.json");
export const datasets = (): Record<string, any> => readJson("packages/composer-core/src/compositions/spike/datasets.json").sets;
export const lint = (surface: unknown, c: Record<string, unknown>) => lintSurface(surface, c as never) as unknown as LintReport;

export async function governorFor(c = contract()) {
  return createGovernor({ contract: c, profileJson: profileJson(), lintSurface: lint });
}

export async function compositions(c = contract()): Promise<Record<string, CompositionDefinition>> {
  const loaded = await loadCompositions(sidecarJson(), { baseContract: c });
  if (loaded.binding !== "ok" || loaded.disabled.length > 0) throw new Error(JSON.stringify({ issues: loaded.issues, disabled: loaded.disabled }));
  return Object.fromEntries(loaded.usable.map((x) => [x.id, x]));
}
