/**
 * Interface blocks (experimental): the expander (RFC section 5).
 *
 * A pure function of (block, named call, reference, intent): the same inputs
 * give byte-identical JSON. The template language is closed: no expressions,
 * no string templating beyond $concat, no conditionals inside values, no
 * recursion, and no access to anything but the call. Every failure is a
 * pathed reason the caller reports as an invariant failure; an expansion is
 * never repaired by a model.
 */
import { sha256Hex } from "./digest";
import type { BlockDefinition, TemplateChild } from "./schema";

/** The surface an expansion produces (dspack surface wrapper). */
export interface ExpandedSurface {
  dspackSurface: "0.1";
  system: string;
  intent: string;
  root: Record<string, unknown>;
}

export type ExpandResult = { ok: true; surface: ExpandedSurface } | { ok: false; path: string; message: string };

type Json = Record<string, unknown>;

/** A value that evaluated to nothing. Distinct from null, which is a value. */
const ABSENT: unique symbol = Symbol("absent");
type Evaluated = unknown;

/** Variables in scope: top-level props, and each enclosing $each/$map binding. */
type Env = Map<string, { value: unknown; index?: number }>;

class Failure extends Error {
  constructor(
    readonly at: string,
    message: string,
  ) {
    super(message);
  }
}

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const isDirective = (value: unknown): value is Json => isObject(value) && Object.keys(value).some((k) => k.startsWith("$"));

/** Own properties only: a name never resolves through a prototype chain. */
function resolve(env: Env, path: string): Evaluated {
  const [head, ...rest] = path.split(".");
  const entry = env.get(head ?? "");
  if (!entry) return ABSENT;
  let current: unknown = entry.value;
  for (const segment of rest) {
    if (!isObject(current) || !Object.hasOwn(current, segment)) return ABSENT;
    current = current[segment];
  }
  return current === undefined ? ABSENT : current;
}

function truthy(value: Evaluated): boolean {
  if (value === ABSENT || value === null || value === false || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function evaluate(value: unknown, env: Env, at: string): Evaluated {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((entry, i) => {
      const out = evaluate(entry, env, `${at}.${i}`);
      if (out === ABSENT) throw new Failure(`${at}.${i}`, "an array element evaluated to nothing");
      return out;
    });
  }
  if (!isObject(value)) throw new Failure(at, "not a JSON value");
  if (!isDirective(value)) {
    const out: Json = {};
    for (const [key, entry] of Object.entries(value)) {
      const evaluated = evaluate(entry, env, `${at}.${key}`);
      if (evaluated !== ABSENT) out[key] = evaluated;
    }
    return out;
  }
  if ("$prop" in value) {
    const found = resolve(env, String(value.$prop));
    if (found !== ABSENT) return found;
    return value.default !== undefined ? value.default : ABSENT;
  }
  if ("$concat" in value) {
    const parts = value.$concat;
    if (!Array.isArray(parts)) throw new Failure(`${at}.$concat`, "$concat takes an array");
    return parts
      .map((part, i) => {
        const out = evaluate(part, env, `${at}.$concat.${i}`);
        if (out === ABSENT) throw new Failure(`${at}.$concat.${i}`, "a $concat part evaluated to nothing");
        if (typeof out === "string") return out;
        if (typeof out === "number") return String(out);
        throw new Failure(`${at}.$concat.${i}`, `a $concat part is a ${out === null ? "null" : typeof out}, not a string or number`);
      })
      .join("");
  }
  if ("$case" in value) {
    const source = resolve(env, String(value.$case));
    const map = isObject(value.map) ? value.map : {};
    const key = typeof source === "string" ? source : typeof source === "boolean" ? String(source) : undefined;
    if (key !== undefined && Object.hasOwn(map, key)) return map[key];
    if (value.default !== undefined) return value.default;
    throw new Failure(at, source === ABSENT ? `'${String(value.$case)}' is absent and $case has no default` : `no mapping for '${String(key ?? source)}' and no default`);
  }
  if ("$index" in value) {
    const entry = env.get(String(value.$index));
    if (entry?.index === undefined) throw new Failure(at, `'${String(value.$index)}' is not an enclosing $each or $map variable`);
    return entry.index;
  }
  if ("$map" in value) {
    const source = resolve(env, String(value.$map));
    if (source === ABSENT) return ABSENT;
    if (!Array.isArray(source)) throw new Failure(at, `'${String(value.$map)}' is not an array`);
    return source.map((item, i) => {
      const inner: Env = new Map(env).set(String(value.as), { value: item, index: i + 1 });
      const out = evaluate(value.value, inner, `${at}.value`);
      if (out === ABSENT) throw new Failure(`${at}.value`, "a $map value evaluated to nothing");
      return out;
    });
  }
  throw new Failure(at, `unknown directive in {${Object.keys(value).join(", ")}}`);
}

function test(condition: unknown, env: Env, at: string): boolean {
  if (typeof condition === "string") return truthy(resolve(env, condition));
  if (isObject(condition) && Array.isArray(condition.$eq) && condition.$eq.length === 2) {
    const a = evaluate(condition.$eq[0], env, `${at}.$eq.0`);
    const b = evaluate(condition.$eq[1], env, `${at}.$eq.1`);
    if (a === ABSENT || b === ABSENT) return a === b;
    return JSON.stringify(a) === JSON.stringify(b);
  }
  throw new Failure(at, "$if takes a path or { $eq: [a, b] }");
}

function expandChildren(children: TemplateChild[], env: Env, at: string): Json[] {
  const out: Json[] = [];
  children.forEach((child, i) => {
    const path = `${at}.${i}`;
    const entry = child as Json;
    if ("$each" in entry) {
      const source = resolve(env, String(entry.$each));
      if (source === ABSENT) return;
      if (!Array.isArray(source)) throw new Failure(path, `'${String(entry.$each)}' is not an array`);
      source.forEach((item, n) => {
        const inner: Env = new Map(env).set(String(entry.as), { value: item, index: n + 1 });
        out.push(...expandChildren((entry.children ?? []) as TemplateChild[], inner, `${path}.children`));
      });
    } else if ("$if" in entry) {
      const branch = test(entry.$if, env, `${path}.$if`) ? "children" : "else";
      out.push(...expandChildren((entry[branch] ?? []) as TemplateChild[], env, `${path}.${branch}`));
    } else {
      out.push(expandNode(entry, env, path));
    }
  });
  return out;
}

/** Output keys in the fixed order component, id, props, text, children. */
function expandNode(node: Json, env: Env, at: string): Json {
  if (typeof node.component !== "string") throw new Failure(`${at}.component`, "a template node names its component literally");
  const out: Json = { component: node.component };
  if (node.id !== undefined) {
    const id = evaluate(node.id, env, `${at}.id`);
    if (id !== ABSENT) out.id = id;
  }
  if (node.props !== undefined) {
    if (!isObject(node.props) || isDirective(node.props)) throw new Failure(`${at}.props`, "props is a literal object of template values");
    const props: Json = {};
    for (const [key, value] of Object.entries(node.props)) {
      const evaluated = evaluate(value, env, `${at}.props.${key}`);
      if (evaluated !== ABSENT) props[key] = evaluated;
    }
    if (Object.keys(props).length > 0) out.props = props;
  }
  if (node.text !== undefined) {
    const text = evaluate(node.text, env, `${at}.text`);
    if (text !== ABSENT) out.text = text;
  }
  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) throw new Failure(`${at}.children`, "children is an array");
    const children = expandChildren(node.children as TemplateChild[], env, `${at}.children`);
    if (children.length > 0) out.children = children;
  }
  return out;
}

/**
 * Expand a named call into a dspack surface. The call is read through the
 * block's declared props only (own properties); the envelope keys and
 * anything undeclared are invisible to the template.
 */
export function expandBlock(
  block: BlockDefinition,
  call: Json,
  options: { reference: { name: string }; intent: string },
): ExpandResult {
  if (!block.intents.includes(options.intent)) {
    return { ok: false, path: "intent", message: `'${options.intent}' is not one of ${block.id}'s intents` };
  }
  const env: Env = new Map();
  for (const prop of block.props) {
    if (Object.hasOwn(call, prop.name) && call[prop.name] !== undefined) env.set(prop.name, { value: call[prop.name] });
  }
  try {
    const root = expandNode(block.template as unknown as Json, env, "template");
    return { ok: true, surface: { dspackSurface: "0.1", system: options.reference.name, intent: options.intent, root } };
  } catch (error) {
    if (error instanceof Failure) return { ok: false, path: error.at, message: error.message };
    throw error;
  }
}

/** sha256 of the compact JSON: what provenance and refinement compare. */
export function expansionDigest(surface: ExpandedSurface | Json): Promise<string> {
  return sha256Hex(JSON.stringify(surface));
}
