/**
 * Flows — multi-step experiences as PROJECT data, never contract data (P4).
 *
 * A flow is an ordered, declarative list of steps, each step a REFERENCE to an
 * existing worked-example surface. Flows live beside the authored-examples
 * delta (same per-project store idiom), travel in the project export, and are
 * rendered by Preview as step navigation over the exact existing
 * single-surface pipeline — so contracts, dspack-gen, dspack-emit, A2UI, and
 * every gate stay byte-identical, and removing a flow leaves every surface
 * exactly as it was.
 *
 * v1 is LINEAR (F4): steps advance in array order, optionally on an emitted
 * action name (`advanceOn`, pure Preview view-state). The per-step
 * `on: [{event, to}]` branching annotation is RESERVED — validated by
 * flow-lint when present, never executed.
 */
import { finding, type ComposerFinding, type Flow, type FlowStep } from "@dspack-studio/composer-core";

/**
 * The Flow/FlowStep TYPES live in composer-core (Phase B lift) so the strict
 * repository manifest and the agent's save-flow route gate the same shape;
 * composer-core's `flowSchema` is the zod twin of parseFlow below — the two
 * must stay rule-identical (both suites pin them against shared fixtures).
 */
export type { Flow, FlowStep } from "@dspack-studio/composer-core";

/* --------------------------------- store ---------------------------------
 * `composer.project.flows.<projectId>` — the examples-delta idiom verbatim
 * (projects.ts): quota-honest boolean save, EMPTY ARRAY REMOVES THE KEY,
 * loads filter malformed entries, and the project lifecycle owns cleanup
 * (duplicateProject copies, removeProject removes). */

/** localStorage is absent during SSR/static prerender and in locked-down
 *  contexts; every access degrades to an empty, in-memory-free store rather
 *  than throwing (same rule as the project index). */
function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

const flowsKey = (id: string): string => `composer.project.flows.${id}`;

/** Persist a project's flows. Quota-honest: false = not saved. */
export function saveFlows(id: string, flows: Flow[]): boolean {
  const s = storage();
  if (!s) return false;
  try {
    if (flows.length === 0) s.removeItem(flowsKey(id));
    else s.setItem(flowsKey(id), JSON.stringify(flows));
    return true;
  } catch {
    return false;
  }
}

export function loadFlows(id: string): Flow[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(flowsKey(id));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseFlow).filter((f): f is Flow => f !== null);
  } catch {
    return [];
  }
}

/** Lifecycle-only cleanup: called by projects.ts removeProject (the flows
 *  twin of its module-private removeExamplesDelta) — never by views. */
export function removeFlows(id: string): void {
  try {
    storage()?.removeItem(flowsKey(id));
  } catch {
    /* best-effort cleanup */
  }
}

/* --------------------------------- shape ---------------------------------
 * ONE strict shape authority serving both consumers: the store's load filter
 * (drop a malformed entry, keep the rest) and the project-import gate
 * (reject the whole file — fail-closed, the profile-gate precedent). The
 * result is hand-rebuilt field by field, so unknown keys never travel. */

const isString = (v: unknown): v is string => typeof v === "string";

function parseStep(value: unknown): FlowStep | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (!isString(r.id) || !isString(r.title) || !isString(r.surfaceId)) return null;
  const step: FlowStep = { id: r.id, title: r.title, surfaceId: r.surfaceId };
  if (r.advanceOn !== undefined) {
    if (!Array.isArray(r.advanceOn) || !r.advanceOn.every(isString)) return null;
    step.advanceOn = r.advanceOn;
  }
  if (r.on !== undefined) {
    if (!Array.isArray(r.on)) return null;
    const on: Array<{ event: string; to: string }> = [];
    for (const entry of r.on) {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;
      if (!isString(e.event) || !isString(e.to)) return null;
      on.push({ event: e.event, to: e.to });
    }
    step.on = on;
  }
  if (r.terminal !== undefined) {
    if (typeof r.terminal !== "boolean") return null;
    step.terminal = r.terminal;
  }
  return step;
}

/** Strictly parse ONE flow; null = malformed (the caller decides filter vs
 *  refuse). Hand-rolled and rule-identical to composer-core's flowSchema —
 *  keep the two in sync. */
export function parseFlow(value: unknown): Flow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (!isString(r.id) || !isString(r.name) || !Array.isArray(r.steps)) return null;
  const steps: FlowStep[] = [];
  for (const raw of r.steps) {
    const step = parseStep(raw);
    if (!step) return null;
    steps.push(step);
  }
  const flow: Flow = { id: r.id, name: r.name, steps };
  if (r.description !== undefined) {
    if (!isString(r.description)) return null;
    flow.description = r.description;
  }
  return flow;
}

/* -------------------------------- id minting ------------------------------ */

/** Lowercase kebab, the `^[a-z0-9][a-z0-9-]*$` id idiom's slug half. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The next free `flow.flow-N` over existing flow ids — the same monotonic,
 *  gap-tolerant rule as nextChatExampleId (projects.ts; keep in sync). */
export function nextFlowId(existing: string[]): string {
  let n = 0;
  for (const id of existing) {
    const match = /^flow\.flow-(\d+)$/.exec(id);
    if (match) n = Math.max(n, Number(match[1]));
  }
  return `flow.flow-${n + 1}`;
}

/** step.<slug-of-title>, suffixed -2, -3… on collision; step-N when the title
 *  yields no slug. Minted at save time; existing steps keep their ids. */
export function mintStepId(title: string, taken: Set<string>): string {
  const slug = slugify(title);
  if (!slug) {
    let n = 1;
    while (taken.has(`step.step-${n}`)) n++;
    return `step.step-${n}`;
  }
  if (!taken.has(`step.${slug}`)) return `step.${slug}`;
  let n = 2;
  while (taken.has(`step.${slug}-${n}`)) n++;
  return `step.${slug}-${n}`;
}

/* ----------------------------- emitted actions ----------------------------
 * The names `advanceOn` may reference are the action events the referenced
 * surface's EMITTED messages carry (`{event: {name}}` — the same objects the
 * Preview action log receives). Walked structurally, never parsed from
 * prose; a surface that emitted nothing (refusal) contributes an empty set. */

function collectActionNames(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectActionNames(item, into);
    return;
  }
  if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    const event = node.event;
    if (event && typeof event === "object" && !Array.isArray(event)) {
      const name = (event as Record<string, unknown>).name;
      if (typeof name === "string") into.add(name);
    }
    for (const child of Object.values(node)) collectActionNames(child, into);
  }
}

/** Every emitted action name in one surface's message stream. */
export function emittedActionNames(messages: unknown[]): Set<string> {
  const names = new Set<string>();
  collectActionNames(messages, names);
  return names;
}

/** Per-surface action names over the emit corpus (missing messages → empty set). */
export function emittedActionsBySurface(surfaces: Array<{ name: string; messages?: unknown[] }>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const s of surfaces) map.set(s.name, s.messages ? emittedActionNames(s.messages) : new Set());
  return map;
}

/* ---------------------------- accept-into-step ----------------------------
 * Phase B: Build's Accept can TARGET a flow step — the minted example id
 * becomes the step's surfaceId, through the ordinary saveFlows funnel. Pure
 * data transition; the accept itself never depends on it. */

export interface StepBinding {
  flowId: string;
  stepId: string;
}

/**
 * Re-bind ONE step's surface to a freshly accepted example id. Returns the
 * next flows array and the bound step, or `step: null` when the binding is
 * STALE (flow or step gone since the build started) — in which case the
 * flows ride through untouched and the CALLER notices; an accept never
 * fails for a stale binding.
 */
export function bindStepSurface(flows: Flow[], binding: StepBinding, surfaceId: string): { flows: Flow[]; step: FlowStep | null } {
  const flow = flows.find((f) => f.id === binding.flowId);
  const step = flow?.steps.find((s) => s.id === binding.stepId);
  if (!flow || !step) return { flows, step: null };
  const bound: FlowStep = { ...step, surfaceId };
  return {
    flows: flows.map((f) => (f.id === flow.id ? { ...f, steps: f.steps.map((s) => (s.id === step.id ? bound : s)) } : f)),
    step: bound,
  };
}

/* -------------------------------- flow-lint -------------------------------
 * Validates REFERENCES, never surfaces: per-surface gates (S1–S3/A1–A3) run
 * exactly as today, and a flow over an emit-refused surface reports the
 * surface's own finding elsewhere. Targets are `<flowId>` or
 * `<flowId>/<stepId>` so Checks can point at the fix location. */

export interface FlowLintContext {
  /** Example ids of the project's merged surface corpus. */
  exampleIds: Set<string>;
  /** Emitted action names per surface (emittedActionsBySurface). */
  actionsBySurface: Map<string, Set<string>>;
}

/** The dangling-surface wording, shared with Preview's honest step fallback. */
export function missingSurfaceMessage(step: FlowStep): string {
  return `step '${step.id}' references surface '${step.surfaceId}', which is not in this project's surfaces`;
}

export function flowLint(flows: Flow[], ctx: FlowLintContext): ComposerFinding[] {
  const findings: ComposerFinding[] = [];
  const flowIdsSeen = new Set<string>();
  for (const flow of flows) {
    if (flowIdsSeen.has(flow.id)) {
      findings.push(finding("flow", "duplicate-flow-id", "error", flow.id, `flow id '${flow.id}' is used by more than one flow`));
    }
    flowIdsSeen.add(flow.id);

    if (flow.steps.length === 0) {
      findings.push(finding("flow", "empty-flow", "warn", flow.id, `flow '${flow.name}' has no steps — add steps in Preview`));
      continue;
    }

    const stepIds = new Set(flow.steps.map((s) => s.id));
    const stepIdsSeen = new Set<string>();
    for (const step of flow.steps) {
      const target = `${flow.id}/${step.id}`;
      if (stepIdsSeen.has(step.id)) {
        findings.push(finding("flow", "duplicate-step-id", "error", target, `step id '${step.id}' is used more than once in flow '${flow.id}'`));
      }
      stepIdsSeen.add(step.id);

      if (!ctx.exampleIds.has(step.surfaceId)) {
        // One cause, one finding: with no surface there is nothing to check
        // advanceOn against, so the reference error stands alone.
        findings.push(finding("flow", "dangling-surface", "error", target, missingSurfaceMessage(step)));
      } else {
        const actions = ctx.actionsBySurface.get(step.surfaceId) ?? new Set<string>();
        for (const name of step.advanceOn ?? []) {
          if (!actions.has(name)) {
            findings.push(
              finding(
                "flow",
                "unknown-action",
                "warn",
                target,
                `'${name}' is not an action '${step.surfaceId}' emits — the step will not auto-advance on it`,
              ),
            );
          }
        }
      }

      for (const branch of step.on ?? []) {
        if (!stepIds.has(branch.to)) {
          findings.push(
            finding("flow", "dangling-step-target", "error", target, `on['${branch.event}'] targets '${branch.to}', which is not a step in flow '${flow.id}'`),
          );
        }
      }
    }
  }
  return findings;
}
