/**
 * Compositions (R1a spike): the sidecar dispatcher and the load-time checks.
 *
 * A 0.1 blocks sidecar is upcast in memory: every block becomes a composition
 * whose parameters are the block's props, with no data, no inputs and no
 * payloads, and one state per intent the block declares. Expanding an upcast
 * composition under a state equals expandBlock under that intent, byte for
 * byte (compositions.test.ts proves it on every packaged example), and the
 * 0.1 file is never rewritten.
 *
 * A 0.2 sidecar is parsed (schema.ts) and checked here against its own
 * templates: every input and action names a node that exists, carries a
 * literal id and sits where the attachment can find it after emission.
 * Every check fails closed with a pathed reason.
 */
import { contractDigest } from "../blocks/digest";
import type { BlockDefinition, BlocksSidecar, TemplateChild } from "../blocks/schema";
import { parseBlocksSidecar } from "../blocks/schema";
import { COMPOSITIONS_SIDECAR_VERSION, parseCompositionsSidecar, type CompositionDefinition, type CompositionIssue, type CompositionsSidecar } from "./schema";

type Json = Record<string, unknown>;

export interface LoadedCompositions {
  /** The version the file declared. */
  from: "0.1" | "0.2";
  binding: "ok" | "mismatch" | "invalid";
  sidecar?: CompositionsSidecar;
  usable: CompositionDefinition[];
  disabled: Array<{ composition: string; issues: string[] }>;
  issues: string[];
}

/** One composition per block: parameters = props, one always-state per intent. */
export function upcastBlock(block: BlockDefinition): CompositionDefinition {
  return {
    id: block.id,
    version: block.version,
    status: block.status,
    name: block.name,
    summary: block.summary,
    parameters: block.props,
    data: [],
    inputs: [],
    actions: [],
    states: block.intents.map((intent) => ({ id: stateIdFor(intent), purpose: intent, guard: { always: true } as const, template: block.template })),
    scenarios: [],
    upcastFrom: { block: block.id, version: block.version },
  };
}

/** A state id for an intent id (already kebab-case in every packaged contract). */
export function stateIdFor(intent: string): string {
  return intent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "default";
}

/** Upcast a parsed 0.1 sidecar. The 0.1 object is not modified. */
export function upcastSidecar(sidecar: BlocksSidecar): CompositionsSidecar {
  return {
    compositionsSidecar: COMPOSITIONS_SIDECAR_VERSION,
    status: sidecar.status,
    reference: sidecar.reference,
    baseSha256: sidecar.baseSha256,
    blocks: sidecar.blocks,
    compositions: sidecar.blocks.map(upcastBlock),
  };
}

const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

interface NodeSite {
  component: string;
  /** Inside some $each. */
  repeated: boolean;
  /** The ids of enclosing nodes, nearest last. */
  ancestors: string[];
  /** The $each sources enclosing it, nearest last, with the node that owns each. */
  loops: Array<{ each: string; as: string; owner: string | null }>;
}

/** Every literal node id in a template, with where it sits. Duplicate ids are reported. */
export function templateSites(template: Json): { sites: Map<string, NodeSite>; duplicates: string[] } {
  const sites = new Map<string, NodeSite>();
  const duplicates: string[] = [];
  const visitNode = (node: Json, ancestors: string[], loops: NodeSite["loops"]) => {
    const id = typeof node.id === "string" ? node.id : null;
    if (id) {
      if (sites.has(id)) duplicates.push(id);
      else sites.set(id, { component: String(node.component), repeated: loops.length > 0, ancestors, loops });
    }
    const next = id ? [...ancestors, id] : ancestors;
    visitChildren((node.children ?? []) as TemplateChild[], next, loops, id);
  };
  const visitChildren = (children: TemplateChild[], ancestors: string[], loops: NodeSite["loops"], owner: string | null) => {
    for (const child of children) {
      const entry = child as Json;
      if ("$each" in entry) visitChildren((entry.children ?? []) as TemplateChild[], ancestors, [...loops, { each: String(entry.$each), as: String(entry.as), owner }], owner);
      else if ("$if" in entry) {
        visitChildren((entry.children ?? []) as TemplateChild[], ancestors, loops, owner);
        visitChildren((entry.else ?? []) as TemplateChild[], ancestors, loops, owner);
      } else visitNode(entry, ancestors, loops);
    }
  };
  visitNode(template, [], []);
  return { sites, duplicates };
}

/** Count the nodes one $each body yields per item, when every branch is a plain node. */
function eachBodyNodes(template: Json, list: string): { each: string; as: string; nodes: number } | null {
  let found: { each: string; as: string; nodes: number } | null = null;
  const visit = (node: Json) => {
    const children = (node.children ?? []) as TemplateChild[];
    if (node.id === list) {
      const loops = children.filter((c) => "$each" in (c as Json)) as Json[];
      if (loops.length === 1 && children.length === 1) {
        const body = (loops[0]!.children ?? []) as Json[];
        const plain = body.every((b) => !("$each" in b) && !("$if" in b));
        found = { each: String(loops[0]!.$each), as: String(loops[0]!.as), nodes: plain ? body.length : -1 };
      }
    }
    for (const c of children) {
      const e = c as Json;
      if ("$each" in e || "$if" in e) {
        for (const b of [...((e.children ?? []) as Json[]), ...((e.else ?? []) as Json[])]) if (!("$each" in b) && !("$if" in b)) visit(b);
      } else visit(e);
    }
  };
  visit(template);
  return found;
}

/** Structural checks a composition must pass before any instance is made. */
export function compositionIssues(c: CompositionDefinition, contract: Json): CompositionIssue[] {
  const issues: CompositionIssue[] = [];
  const intents = new Set(((contract.intents ?? []) as Json[]).map((i) => String(i.id)));
  c.states.forEach((state, n) => {
    if (!intents.has(state.purpose)) issues.push({ path: `states.${n}.purpose`, message: `'${state.purpose}' is not an intent of this contract` });
    const { duplicates } = templateSites(state.template as unknown as Json);
    for (const d of duplicates) issues.push({ path: `states.${n}.template`, message: `node id '${d}' appears twice; inputs and actions need unique literal ids` });
  });
  const statesWith = (node: string) => c.states.filter((s) => templateSites(s.template as unknown as Json).sites.has(node));
  c.inputs.forEach((input, n) => {
    const where = statesWith(input.node);
    if (where.length === 0) issues.push({ path: `inputs.${n}.node`, message: `no state's template has a node with id '${input.node}'` });
    for (const s of where) {
      const site = templateSites(s.template as unknown as Json).sites.get(input.node)!;
      if (site.component !== "text-input") issues.push({ path: `inputs.${n}.node`, message: `'${input.node}' is a ${site.component}, not a text-input` });
      if (site.repeated) issues.push({ path: `inputs.${n}.node`, message: `'${input.node}' is inside $each; an input binds one leaf path, so it sits outside any repeat` });
    }
    if (input.kind === "integer" && (input.minimum === undefined || input.maximum === undefined)) issues.push({ path: `inputs.${n}`, message: "an integer input declares minimum and maximum" });
  });
  c.actions.forEach((action, n) => {
    for (const stateId of action.states) {
      const state = c.states.find((s) => s.id === stateId);
      if (!state) continue;
      const { sites } = templateSites(state.template as unknown as Json);
      const site = sites.get(action.node);
      if (!site) {
        issues.push({ path: `actions.${n}.node`, message: `state '${stateId}' has no node with id '${action.node}'` });
        continue;
      }
      if (action.repeat) {
        const list = sites.get(action.repeat.list);
        if (!list) issues.push({ path: `actions.${n}.repeat.list`, message: `state '${stateId}' has no list node '${action.repeat.list}'` });
        else if (list.repeated) issues.push({ path: `actions.${n}.repeat.list`, message: `the list '${action.repeat.list}' is itself repeated` });
        const body = eachBodyNodes(state.template as unknown as Json, action.repeat.list);
        if (!body) issues.push({ path: `actions.${n}.repeat`, message: `'${action.repeat.list}' must hold exactly one $each and nothing else` });
        else {
          if (body.each !== action.repeat.each || body.as !== action.repeat.as) issues.push({ path: `actions.${n}.repeat`, message: `'${action.repeat.list}' repeats '${body.each}' as '${body.as}', not '${action.repeat.each}' as '${action.repeat.as}'` });
          if (body.nodes !== 1) issues.push({ path: `actions.${n}.repeat`, message: "each item must expand to exactly one node, so item k is the list's k-th child" });
        }
        if (!site.repeated || site.loops.at(-1)?.as !== action.repeat.as) issues.push({ path: `actions.${n}.node`, message: `'${action.node}' is not inside the '${action.repeat.as}' repeat` });
        if (site.loops.length > 1) issues.push({ path: `actions.${n}.node`, message: "nested repeats are not supported in R1a" });
        for (const w of action.repeat.witness) if (!w.startsWith(`${action.repeat.as}.`)) issues.push({ path: `actions.${n}.repeat.witness`, message: `witness '${w}' must read the item '${action.repeat.as}'` });
        for (const [k, v] of Object.entries(action.payload ?? {})) {
          if (isObject(v) && !String(v.$prop).startsWith(`${action.repeat.as}.`)) issues.push({ path: `actions.${n}.payload.${k}`, message: "a per-item payload reads the item only" });
        }
      } else if (site.repeated) {
        issues.push({ path: `actions.${n}`, message: `'${action.node}' is repeated; declare its repeat so each item gets its own payload` });
      }
      if (site.component !== "button" && site.component !== "alert-dialog") issues.push({ path: `actions.${n}.node`, message: `'${action.node}' is a ${site.component}; only buttons and alert dialogs dispatch here` });
    }
    if (action.consequential && action.states.length !== 1) issues.push({ path: `actions.${n}.states`, message: "a consequential action is dispatched from exactly one confirmation state" });
  });
  return issues;
}

/** Parse (0.1 or 0.2), bind to the packaged base contract, and check every composition. */
export async function loadCompositions(raw: unknown, options: { baseContract: Json }): Promise<LoadedCompositions> {
  const declared = isObject(raw) ? (raw.compositionsSidecar ?? raw.blocksSidecar) : undefined;
  let from: "0.1" | "0.2";
  let sidecar: CompositionsSidecar;
  if (isObject(raw) && raw.blocksSidecar === "0.1" && raw.compositionsSidecar === undefined) {
    const parsed = parseBlocksSidecar(raw);
    if (!parsed.ok) return { from: "0.1", binding: "invalid", usable: [], disabled: [], issues: parsed.issues.map((i) => `${i.path}: ${i.message}`) };
    from = "0.1";
    sidecar = upcastSidecar(parsed.sidecar);
  } else if (isObject(raw) && raw.compositionsSidecar === COMPOSITIONS_SIDECAR_VERSION) {
    const parsed = parseCompositionsSidecar(raw);
    if (!parsed.ok) return { from: "0.2", binding: "invalid", usable: [], disabled: [], issues: parsed.issues.map((i) => `${i.path}: ${i.message}`) };
    from = "0.2";
    sidecar = { ...parsed.sidecar, compositions: [...parsed.sidecar.blocks.map(upcastBlock), ...parsed.sidecar.compositions] };
  } else {
    return { from: "0.2", binding: "invalid", usable: [], disabled: [], issues: [`unsupported sidecar version '${String(declared)}'; this loader reads 0.1 and 0.2`] };
  }
  const digest = await contractDigest(options.baseContract);
  if (digest !== sidecar.baseSha256) {
    return { from, binding: "mismatch", sidecar, usable: [], disabled: [], issues: [`bound to base ${sidecar.baseSha256.slice(0, 12)}, but the packaged base is ${digest.slice(0, 12)}`] };
  }
  const usable: CompositionDefinition[] = [];
  const disabled: LoadedCompositions["disabled"] = [];
  const ids = new Set<string>();
  for (const c of sidecar.compositions) {
    const issues = compositionIssues(c, options.baseContract).map((i) => `${i.path}: ${i.message}`);
    if (ids.has(c.id)) issues.push(`id '${c.id}' is used twice (version coexistence is deferred, R0-REVIEW A10)`);
    ids.add(c.id);
    if (issues.length > 0) disabled.push({ composition: c.id, issues });
    else usable.push(c);
  }
  return { from, binding: "ok", sidecar, usable, disabled, issues: [] };
}
