/**
 * Interface blocks (experimental): host actions, H1 (docs/blocks/HOST-ACTIONS.md;
 * docs/blocks/PHASE-2-RELEASE-PLAN.md, §7).
 *
 * Composer never executes an action; a host binds and authorizes each one.
 * What a block's surface can dispatch is settled when its sidecar loads. The
 * emitter (dspack-emit 0.7.0) gives a node an action only where the profile
 * says so, a v1 `surfacePlan.actionProp` or a v2 route from
 * `synthesized.action`, and names it with a slug of the node's id. Without an
 * id it would name it from the node's text or component instead, and text can
 * be model-written. So H1 holds every such node to an id built only from
 * literals and enum props: the model fills content, never an action name.
 * The names a template can produce must equal its declared `actions`,
 * exactly. Either failure is a B0 failure, which disables the block at load
 * (load.ts); B2 still holds every expansion's emitted names to the same list.
 */
import { shadcnProfile, slug, type Profile } from "@aestheticfunction/dspack-emit";
import { alwaysPresent, rootScope, specAtPath, type BlockDefinition, type Scope, type TemplateChild } from "./schema";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

/** The most names one action id may stand for: past it, a declaration could not be read or reviewed. */
export const MAX_ACTION_NAMES = 256;

/**
 * The components whose emitted instances dispatch an action under a profile,
 * read the way emitSurface reads it, with its default profile when none is
 * given.
 */
export function actionComponents(profile?: Profile): Set<string> {
  const plans = ((profile ?? shadcnProfile) as unknown as { components?: unknown[] }).components ?? [];
  const out = new Set<string>();
  for (const plan of plans) {
    if (!isObject(plan) || typeof plan.dspackId !== "string") continue;
    const v1 = isObject(plan.surfacePlan) && !!plan.surfacePlan.actionProp;
    const routes = isObject(plan.surface) && Array.isArray(plan.surface.routes) ? plan.surface.routes : [];
    const v2 = routes.some((route) => isObject(route) && Array.isArray(route.from) && route.from.includes("synthesized.action"));
    if (v1 || v2) out.add(plan.dspackId);
  }
  return out;
}

type IdValues = { values: string[] } | { issue: string };

const kind = (value: unknown): string => (value === null ? "null" : Array.isArray(value) ? "an array" : `a ${typeof value}`);

/**
 * Every string an action id can evaluate to, read the way the expander
 * evaluates it (expand.ts), or why that set is not bounded. Inside a $concat
 * a number is text; on its own, an id must be a string.
 */
function idValues(value: unknown, scope: Scope, at: string, part: boolean): IdValues {
  const text = (v: unknown) => typeof v === "string" || (part && typeof v === "number");
  if (text(value)) return { values: [String(value)] };
  if (!isObject(value)) return { issue: `${at}: ${kind(value)} is not a string` };
  if ("$prop" in value) {
    const path = String(value.$prop);
    const spec = specAtPath(scope, path);
    if (!spec) return { issue: `${at}: '${path}' does not resolve` };
    if (spec.type !== "enum") return { issue: `${at}: '${path}' is a ${spec.type} the model fills, so the model would name the action` };
    const values = [...(spec.values ?? [])];
    if (!alwaysPresent(scope, path)) {
      if (value.default === undefined) return { issue: `${at}: '${path}' may be absent, and an action id cannot be; make it required or give it a default` };
      if (!text(value.default)) return { issue: `${at}: the default of '${path}' is ${kind(value.default)}, not a string` };
      values.push(String(value.default));
    }
    return { values };
  }
  if ("$case" in value) {
    const path = String(value.$case);
    const spec = specAtPath(scope, path);
    if (!spec || (spec.type !== "enum" && spec.type !== "boolean")) return { issue: `${at}: '${path}' is not an enum or a boolean` };
    const map = isObject(value.map) ? value.map : {};
    const keys = spec.type === "enum" ? (spec.values ?? []) : ["true", "false"];
    const results: unknown[] = keys.map((key) => (Object.hasOwn(map, key) ? map[key] : value.default));
    if (!alwaysPresent(scope, path)) results.push(value.default);
    const values: string[] = [];
    for (const result of results) {
      if (!text(result)) return { issue: `${at}: a $case result is ${result === undefined ? "missing" : `${kind(result)}, not a string`}` };
      values.push(String(result));
    }
    return { values };
  }
  if ("$concat" in value) {
    if (!Array.isArray(value.$concat) || value.$concat.length === 0) return { issue: `${at}: $concat takes a non-empty array` };
    let combined = [""];
    for (const [i, part] of value.$concat.entries()) {
      const found = idValues(part, scope, `${at}.$concat.${i}`, true);
      if ("issue" in found) return found;
      const distinct = [...new Set(found.values)];
      if (combined.length * distinct.length > MAX_ACTION_NAMES) return { issue: `${at}: more than ${MAX_ACTION_NAMES} possible names` };
      combined = combined.flatMap((prefix) => distinct.map((v) => prefix + v));
    }
    return { values: combined };
  }
  if ("$index" in value) return { issue: `${at}: $index is a position, not a literal or an enum` };
  if ("$map" in value) return { issue: `${at}: $map makes a list, not a name` };
  return { issue: `${at}: an object is not a string` };
}

/**
 * Every action name a block's template can make its surface dispatch, under
 * a profile's action components, and every node whose name cannot be bounded.
 * Both branches of every $if and the body of every $each count: the names are
 * those of some call, so the set is the union over all of them.
 */
export function templateActionNames(block: Pick<BlockDefinition, "props" | "template">, components: ReadonlySet<string>): { names: string[]; issues: string[] } {
  const names = new Set<string>();
  const issues: string[] = [];

  const walkNode = (node: Json, at: string, scope: Scope) => {
    const component = String(node.component);
    if (components.has(component)) {
      if (node.id === undefined) {
        issues.push(`${at}: '${component}' dispatches an action, so it needs an id built from literals and enum props; without one, the emitter names the action from the node's text or component`);
      } else {
        const found = idValues(node.id, scope, `${at}.id`, false);
        if ("issue" in found) issues.push(found.issue);
        else for (const value of found.values) names.add(slug(value));
      }
    }
    if (Array.isArray(node.children)) walkChildren(node.children as TemplateChild[], `${at}.children`, scope);
  };

  const walkChildren = (children: TemplateChild[], at: string, scope: Scope) => {
    children.forEach((child, i) => {
      const entry = child as Json;
      const path = `${at}.${i}`;
      if ("$each" in entry) {
        const items = specAtPath(scope, String(entry.$each))?.items;
        const inner: Scope = new Map(scope);
        if (items) inner.set(String(entry.as), { spec: items, loop: true });
        walkChildren((entry.children ?? []) as TemplateChild[], `${path}.children`, inner);
      } else if ("$if" in entry) {
        walkChildren((entry.children ?? []) as TemplateChild[], `${path}.children`, scope);
        walkChildren((entry.else ?? []) as TemplateChild[], `${path}.else`, scope);
      } else {
        walkNode(entry, path, scope);
      }
    });
  };

  walkNode(block.template as unknown as Json, "template", rootScope(block));
  return { names: [...names].sort(), issues };
}

/** H1 for one block: unbounded action ids, then every difference between the names it can emit and the ones it declares. */
export function actionIssues(block: Pick<BlockDefinition, "props" | "template" | "actions">, components: ReadonlySet<string>): string[] {
  const { names, issues } = templateActionNames(block, components);
  // An unbounded id leaves the set of names unknown, so there is nothing to compare.
  if (issues.length > 0) return issues;
  const out: string[] = [];
  const declared = new Set<string>();
  for (const name of block.actions) {
    if (declared.has(name)) out.push(`actions: '${name}' is declared more than once`);
    declared.add(name);
  }
  for (const name of names) if (!declared.has(name)) out.push(`actions: the template can emit '${name}', which is not declared`);
  for (const name of declared) if (!names.includes(name)) out.push(`actions: '${name}' is declared, but no node of the template can emit it`);
  return out;
}

/** Every action event a message stream carries, in document order, with its name and context as written. */
export function actionEvents(messages: unknown): Array<{ name: unknown; context: unknown }> {
  const out: Array<{ name: unknown; context: unknown }> = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!isObject(value)) return;
    if (isObject(value.event)) out.push({ name: value.event.name, context: value.event.context });
    Object.values(value).forEach(walk);
  };
  walk(messages);
  return out;
}
