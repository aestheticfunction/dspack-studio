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
 * The names a template can produce, at most 256 per id, must equal its
 * declared `actions`, exactly (templateActionNames says how they are
 * counted). Either failure is a B0 failure, which disables the block at load
 * (load.ts); B2 still holds every expansion's emitted names to the same list.
 */
import { shadcnProfile, slug, type Profile } from "@aestheticfunction/dspack-emit";
import { alwaysPresent, rootScope, specAtPath, type BlockDefinition, type Scope, type TemplateChild } from "./schema";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

/** The most names one action id may stand for: past it, a declaration could not be read or reviewed. */
export const MAX_ACTION_NAMES = 256;
/** The most combinations of the names one action id reads that H1 evaluates. */
export const MAX_ACTION_COMBINATIONS = 4096;

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

/** A value an enum or boolean name can take on a path, or its absence. */
const ABSENT: unique symbol = Symbol("absent");
type Value = string | boolean | typeof ABSENT;
/** The values each enum or boolean name can still take where an enclosing $if narrowed it. */
type Narrowed = ReadonlyMap<string, readonly Value[]>;

const kind = (value: unknown): string => (value === null ? "null" : Array.isArray(value) ? "an array" : `${/^[aeiou]/.test(typeof value) ? "an" : "a"} ${typeof value}`);
const isLiteral = (value: unknown) => value === null || ["string", "number", "boolean"].includes(typeof value);

/** The values a name in scope can take: an enum's or a boolean's, with absence when a call may omit it, as narrowed on this path. Null for any other type. */
function domain(scope: Scope, path: string, narrowed: Narrowed): readonly Value[] | null {
  const known = narrowed.get(path);
  if (known) return known;
  const spec = specAtPath(scope, path);
  const present: Value[] | null = spec?.type === "enum" ? [...(spec.values ?? [])] : spec?.type === "boolean" ? [true, false] : null;
  if (!present) return null;
  return alwaysPresent(scope, path) ? present : [...present, ABSENT];
}

/**
 * The names an action id reads, or why it is not built from literals and enum
 * props alone. Inside a $concat a number is text; on its own, an id must be a
 * string.
 */
function idForm(value: unknown, scope: Scope, at: string): { reads: string[] } | { issue: string } {
  const reads = new Set<string>();
  const check = (v: unknown, where: string, part: boolean): string | null => {
    const text = (x: unknown) => typeof x === "string" || (part && typeof x === "number");
    if (text(v)) return null;
    if (!isObject(v)) return `${where}: ${kind(v)} is not a string`;
    if ("$prop" in v) {
      const path = String(v.$prop);
      const spec = specAtPath(scope, path);
      if (!spec) return `${where}: '${path}' does not resolve`;
      if (spec.type === "string") return `${where}: '${path}' is a string the model fills, so the model would name the action`;
      if (spec.type !== "enum") return `${where}: '${path}' is ${/^[aeiou]/.test(spec.type) ? "an" : "a"} ${spec.type} prop, not an enum`;
      if (v.default !== undefined && !text(v.default)) return `${where}: the default of '${path}' is ${kind(v.default)}, not a string`;
      reads.add(path);
      return null;
    }
    if ("$case" in v) {
      const path = String(v.$case);
      const spec = specAtPath(scope, path);
      if (!spec || (spec.type !== "enum" && spec.type !== "boolean")) return `${where}: '${path}' is not an enum or a boolean`;
      const results = [...Object.values(isObject(v.map) ? v.map : {}), ...(v.default !== undefined ? [v.default] : [])];
      const bad = results.filter((r) => !text(r));
      if (bad.length > 0) return `${where}: a $case result is ${kind(bad[0])}, not a string`;
      reads.add(path);
      return null;
    }
    if ("$concat" in v) {
      if (!Array.isArray(v.$concat) || v.$concat.length === 0) return `${where}: $concat takes a non-empty array`;
      for (const [i, p] of v.$concat.entries()) {
        const issue = check(p, `${where}.$concat.${i}`, true);
        if (issue) return issue;
      }
      return null;
    }
    if ("$index" in v) return `${where}: $index is a position, not a literal or an enum`;
    if ("$map" in v) return `${where}: $map makes a list, not a name`;
    return `${where}: an object is not a string`;
  };
  const issue = check(value, at, false);
  return issue ? { issue } : { reads: [...reads] };
}

type IdValue = { text: string } | { absent: string } | { fails: string };

/** An action id under one assignment of the names it reads, evaluated as the expander evaluates it (expand.ts). */
function evaluateId(value: unknown, assignment: ReadonlyMap<string, Value>, at: string): IdValue {
  if (typeof value === "string" || typeof value === "number") return { text: String(value) };
  const v = value as Json;
  if ("$prop" in v) {
    const got = assignment.get(String(v.$prop));
    if (got === ABSENT || got === undefined) return v.default !== undefined ? { text: String(v.default) } : { absent: String(v.$prop) };
    return { text: String(got) };
  }
  if ("$case" in v) {
    const got = assignment.get(String(v.$case));
    const key = typeof got === "string" ? got : typeof got === "boolean" ? String(got) : undefined;
    const map = isObject(v.map) ? v.map : {};
    if (key !== undefined && Object.hasOwn(map, key)) return { text: String(map[key]) };
    if (v.default !== undefined) return { text: String(v.default) };
    return { fails: `${at}: the $case on '${String(v.$case)}' has no value for ${key === undefined ? "its absence" : `'${key}'`}` };
  }
  let out = "";
  for (const [i, part] of (v.$concat as unknown[]).entries()) {
    const found = evaluateId(part, assignment, `${at}.$concat.${i}`);
    if ("fails" in found) return found;
    if ("absent" in found) return { fails: `${at}.$concat.${i}: '${found.absent}' may be absent, and an action id cannot be; make it required or give it a default` };
    out += found.text;
  }
  return { text: out };
}

/**
 * How an $if splits the values of the names it tests: truthiness of a name,
 * or a name's equality with a literal (with the default it reads when absent),
 * narrows that name in each branch; a comparison of two literals picks one
 * branch. Null marks a branch no call can take. Any other test narrows
 * nothing, and both branches count.
 */
function branches(test: unknown, scope: Scope, narrowed: Narrowed): { then: Narrowed | null; otherwise: Narrowed | null } {
  const split = (path: string, holds: (v: Value) => boolean) => {
    const values = domain(scope, path, narrowed);
    if (!values) return { then: narrowed, otherwise: narrowed };
    const yes = values.filter(holds);
    const no = values.filter((v) => !holds(v));
    return { then: yes.length > 0 ? new Map(narrowed).set(path, yes) : null, otherwise: no.length > 0 ? new Map(narrowed).set(path, no) : null };
  };
  if (typeof test === "string") return split(test, (v) => v !== ABSENT && v !== false && v !== "");
  if (isObject(test) && Array.isArray(test.$eq) && test.$eq.length === 2) {
    const [a, b] = test.$eq as [unknown, unknown];
    if (isLiteral(a) && isLiteral(b)) {
      const same = JSON.stringify(a) === JSON.stringify(b);
      return { then: same ? narrowed : null, otherwise: same ? null : narrowed };
    }
    const bare = (x: unknown): x is Json => isObject(x) && "$prop" in x && Object.keys(x).every((k) => k === "$prop" || k === "default");
    const pair = bare(a) && isLiteral(b) ? ([a, b] as const) : bare(b) && isLiteral(a) ? ([b, a] as const) : null;
    if (pair) {
      const [prop, literal] = pair;
      return split(String(prop.$prop), (v) => {
        const read = v === ABSENT ? (prop.default !== undefined ? prop.default : ABSENT) : v;
        return read !== ABSENT && JSON.stringify(read) === JSON.stringify(literal);
      });
    }
  }
  return { then: narrowed, otherwise: narrowed };
}

/**
 * Every action name a block's template can make its surface dispatch, under
 * a profile's action components, and every node whose name is not bounded.
 * Each action id is evaluated as the expander evaluates it, over every
 * combination of the enum and boolean names it reads, so a name read twice
 * holds one value. An $if that tests a name's truthiness or its equality
 * with a literal narrows that name in each branch, and a branch no call can
 * take counts nothing. Other conditions, and the cross-field constraints a
 * call must meet, are taken as able to hold either way: the set may then
 * include a name no call reaches, never miss one a call can emit.
 */
export function templateActionNames(block: Pick<BlockDefinition, "props" | "template">, components: ReadonlySet<string>): { names: string[]; issues: string[] } {
  const names = new Set<string>();
  const issues: string[] = [];

  const walkNode = (node: Json, at: string, scope: Scope, narrowed: Narrowed) => {
    const component = String(node.component);
    if (components.has(component)) {
      const where = `${at}.id`;
      const form = node.id === undefined ? null : idForm(node.id, scope, where);
      if (form === null) {
        issues.push(`${at}: '${component}' dispatches an action, so it needs an id built from literals and enum props; without one, the emitter names the action from the node's text or component`);
      } else if ("issue" in form) {
        issues.push(form.issue);
      } else {
        const values = form.reads.map((path) => domain(scope, path, narrowed) ?? []);
        const combinations = values.reduce((n, v) => n * v.length, 1);
        if (combinations > MAX_ACTION_COMBINATIONS) {
          issues.push(`${where}: more than ${MAX_ACTION_COMBINATIONS} combinations of the names it reads`);
        } else {
          const own = new Set<string>();
          const found = new Set<string>();
          for (let n = 0; n < combinations; n++) {
            const assignment = new Map<string, Value>();
            let rest = n;
            form.reads.forEach((path, i) => {
              assignment.set(path, values[i]![rest % values[i]!.length]!);
              rest = Math.floor(rest / values[i]!.length);
            });
            const result = evaluateId(node.id, assignment, where);
            if ("fails" in result) found.add(result.fails);
            else if ("absent" in result) found.add(`${where}: '${result.absent}' may be absent, and an action id cannot be; make it required or give it a default`);
            else own.add(slug(result.text));
          }
          if (own.size > MAX_ACTION_NAMES) found.add(`${where}: more than ${MAX_ACTION_NAMES} possible names`);
          issues.push(...found);
          for (const name of own) names.add(name);
        }
      }
    }
    if (Array.isArray(node.children)) walkChildren(node.children as TemplateChild[], `${at}.children`, scope, narrowed);
  };

  const walkChildren = (children: TemplateChild[], at: string, scope: Scope, narrowed: Narrowed) => {
    children.forEach((child, i) => {
      const entry = child as Json;
      const path = `${at}.${i}`;
      if ("$each" in entry) {
        const items = specAtPath(scope, String(entry.$each))?.items;
        const inner: Scope = new Map(scope);
        const innerNarrowed = new Map(narrowed);
        innerNarrowed.delete(String(entry.as));
        if (items) inner.set(String(entry.as), { spec: items, loop: true });
        walkChildren((entry.children ?? []) as TemplateChild[], `${path}.children`, inner, innerNarrowed);
      } else if ("$if" in entry) {
        const split = branches(entry.$if, scope, narrowed);
        if (split.then) walkChildren((entry.children ?? []) as TemplateChild[], `${path}.children`, scope, split.then);
        if (split.otherwise) walkChildren((entry.else ?? []) as TemplateChild[], `${path}.else`, scope, split.otherwise);
      } else {
        walkNode(entry, path, scope, narrowed);
      }
    });
  };

  walkNode(block.template as unknown as Json, "template", rootScope(block), new Map());
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
