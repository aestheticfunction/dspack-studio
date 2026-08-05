/**
 * The EMITTED corpus: every A2UI component instance dspack-emit has actually
 * produced in this repo, plus the catalog shapes those instances are validated
 * against. Test-only (never exported from the package index) — it exists so the
 * parity suite can compare what the emitter EMITS against what a renderer
 * CONSUMES, rather than against a hand-written list that can drift with it.
 *
 * Two sources, both real emitter output:
 *   - packages/contracts/out/*.surface.json — surfaces emitted by the contracts
 *     build (`emitSurface`) from the authored .dsurface.json / worked example.
 *   - packages/replay/fixtures/*.json — recorded runs; their A2UI operations
 *     ride inside AG-UI TOOL_CALL_RESULT payloads.
 *
 * Instances are folded LAST-WRITE-WINS per (file, surfaceId, component id), so
 * the corpus is the state a renderer is finally asked to draw, not an
 * intermediate delivery.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const CONTRACTS_OUT = fileURLToPath(new URL("../../contracts/out/", import.meta.url));
export const FIXTURES_DIR = fileURLToPath(new URL("../../replay/fixtures/", import.meta.url));

export const catalog: Record<string, any> = JSON.parse(
  readFileSync(join(CONTRACTS_OUT, "catalog.v0_9_1.json"), "utf8"),
);

export interface EmittedInstance {
  /** Source file the instance was emitted into. */
  source: string;
  surfaceId: string;
  /** The raw emitted component object, including `id` and `component`. */
  component: Record<string, any>;
}

/** Pull every A2UI operation out of a file, whichever envelope carries it. */
function a2uiOperations(doc: unknown): any[] {
  const ops: any[] = [];
  const walk = (node: any) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    // Recorded runs: operations ride inside AG-UI tool-call results.
    if (node.type === "TOOL_CALL_RESULT" && typeof node.content === "string") {
      try {
        const parsed = JSON.parse(node.content);
        if (Array.isArray(parsed?.a2ui_operations)) ops.push(...parsed.a2ui_operations);
      } catch {
        /* non-JSON tool results are not A2UI payloads */
      }
    }
    // Contracts build output: { messages: [...] }.
    if (Array.isArray(node.messages)) ops.push(...node.messages);
    Object.values(node).forEach(walk);
  };
  walk(doc);
  return ops;
}

let cached: EmittedInstance[] | undefined;

/** Every distinct emitted instance, in discovery order. */
export function emittedInstances(): EmittedInstance[] {
  if (cached) return cached;
  const files: Array<[string, string]> = [];
  for (const f of readdirSync(CONTRACTS_OUT)) {
    if (f.endsWith(".surface.json")) files.push([CONTRACTS_OUT, f]);
  }
  for (const f of readdirSync(FIXTURES_DIR)) {
    if (f.endsWith(".json")) files.push([FIXTURES_DIR, f]);
  }
  const final = new Map<string, EmittedInstance>();
  for (const [dir, file] of files) {
    const doc = JSON.parse(readFileSync(join(dir, file), "utf8"));
    for (const op of a2uiOperations(doc)) {
      const update = op?.updateComponents;
      if (!update || !Array.isArray(update.components)) continue;
      for (const component of update.components) {
        if (!component?.id || !component?.component) continue;
        final.set(`${file}|${update.surfaceId}|${component.id}`, {
          source: file,
          surfaceId: String(update.surfaceId),
          component,
        });
      }
    }
  }
  cached = [...final.values()];
  return cached;
}

/** Props the emitter actually put on an instance (envelope keys removed). */
export function emittedProps(component: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(component)) {
    if (k === "id" || k === "component") continue;
    out[k] = v;
  }
  return out;
}

/** Flattened catalog property schemas for one component (allOf/$ref resolved). */
export function catalogProps(componentName: string): Record<string, any> {
  const node = catalog.components?.[componentName];
  if (!node) throw new Error(`Component '${componentName}' is not in the emitted catalog.`);
  const acc: Record<string, any> = {};
  const flatten = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (typeof n.$ref === "string" && n.$ref.startsWith("#/")) {
      let target: any = catalog;
      for (const seg of n.$ref.replace(/^#\//, "").split("/")) target = target?.[seg];
      flatten(target);
    }
    if (Array.isArray(n.allOf)) n.allOf.forEach(flatten);
    if (n.properties) Object.assign(acc, n.properties);
  };
  flatten(node);
  delete acc.component;
  delete acc.id;
  return acc;
}

/**
 * Every (component, enum prop) pair the emitter actually emits, with the
 * catalog's full legal value set and declared default. This is the contract
 * vocabulary a renderer has to keep distinguishable.
 */
export function emittedEnumProps(): Array<{
  componentName: string;
  prop: string;
  values: string[];
  default?: string;
  emittedValues: string[];
}> {
  const seen = new Map<string, Set<string>>();
  for (const { component } of emittedInstances()) {
    for (const [prop, value] of Object.entries(emittedProps(component))) {
      const key = `${component.component}.${prop}`;
      if (!seen.has(key)) seen.set(key, new Set());
      if (typeof value === "string") seen.get(key)!.add(value);
    }
  }
  const out: ReturnType<typeof emittedEnumProps> = [];
  for (const key of seen.keys()) {
    const [componentName, prop] = key.split(".");
    const schema = catalogProps(componentName)[prop];
    if (!Array.isArray(schema?.enum)) continue;
    out.push({
      componentName,
      prop,
      values: schema.enum,
      default: schema.default,
      emittedValues: [...seen.get(key)!],
    });
  }
  return out;
}
