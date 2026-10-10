/**
 * Interface blocks (experimental): the sidecar document format.
 *
 * A block is governed DATA, never code: a named, ordered props signature the
 * model fills, plus a closed declarative template that deterministic machinery
 * expands into an ordinary dspack surface BEFORE the S1/S2/S3 gates. The model
 * supplies content only; composition is owner-authored here (docs/BLOCKS.md
 * ADR-B1). Sidecars live beside a packaged reference, never inside a
 * synchronized contract file (check-sync, reference-sync, report digests).
 *
 * This module only PARSES and STRUCTURALLY CHECKS a sidecar. It does not
 * expand templates or judge calls (see call.ts for the call projection and
 * the B1 shape check). Nothing here is wired into the app: it is inert until
 * the flagged Phase 1A path loads it.
 *
 * Every check fails closed with a pathed reason; an unknown directive, prop
 * type, or constraint kind is an error, never ignored.
 */
import { z } from "zod";

export const BLOCKS_SIDECAR_VERSION = "0.1";

/** Prop names the call envelope reserves (named: block/version; compact: b/v/p). */
export const RESERVED_PROP_NAMES = new Set(["block", "version", "b", "v", "p"]);

const PROP_NAME = /^[a-z][a-zA-Z0-9]*$/;
const BLOCK_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ACTION_NAME = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export type ValueType = "string" | "enum" | "boolean" | "integer" | "array" | "object";

/** The closed value-type language a block signature is written in. */
export interface ValueSpec {
  type: ValueType;
  /** Model-visible, short, discriminative. */
  description?: string;
  /** string */
  minLength?: number;
  maxLength?: number;
  /** enum */
  values?: string[];
  /** integer */
  minimum?: number;
  maximum?: number;
  /** array */
  items?: ValueSpec;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  /** object: ordered fields. Order is the compact wire order (ADR-B2). */
  props?: PropSpec[];
}

export interface PropSpec extends ValueSpec {
  name: string;
  required?: boolean;
}

/** Cross-field checks a call must satisfy (B2 completeness). Closed set. */
export type BlockConstraint =
  | { kind: "equal-length"; paths: [string, string] }
  | { kind: "includes-when"; when: { prop: string; equals: string }; path: string; values: string[] }
  | { kind: "excludes-when"; when: { prop: string; equals: string }; path: string; values: string[] };

/** A template value: literal JSON, or one directive object (keys starting "$"). */
export type TemplateValue = unknown;

export interface TemplateNode {
  component: string;
  id?: TemplateValue;
  props?: Record<string, TemplateValue>;
  text?: TemplateValue;
  children?: TemplateChild[];
}

export type TemplateChild =
  | TemplateNode
  | { $each: string; as: string; children: TemplateChild[] }
  | { $if: string | { $eq: [TemplateValue, TemplateValue] }; children: TemplateChild[]; else?: TemplateChild[] };

export interface BlockExample {
  id: string;
  intent: string;
  prompt: string;
  /** A named canonical call (ADR-B2). */
  call: Record<string, unknown>;
}

export interface BlockDefinition {
  id: string;
  version: number;
  status: "draft" | "approved";
  name: string;
  /** Model-visible summary used for selection. */
  summary: string;
  /** The contract `patterns` entry this block refines, when one exists. */
  relatedPattern?: string;
  intents: string[];
  keywords: string[];
  props: PropSpec[];
  constraints?: BlockConstraint[];
  /** Emitted A2UI action names (dspack-emit slugs) the template may dispatch. */
  actions: string[];
  streaming: "static-safe" | "disable-actions-until-complete";
  /** Fidelity notes: what this design system cannot express for the block. */
  notes?: string[];
  template: TemplateNode;
  examples: BlockExample[];
}

export interface BlocksSidecar {
  blocksSidecar: typeof BLOCKS_SIDECAR_VERSION;
  status: "draft" | "approved";
  reference: { name: string; dspack: string; version: string };
  /** sha256(JSON.stringify(parsed base contract)); see contractDigest. */
  baseSha256: string;
  blocks: BlockDefinition[];
}

export interface BlocksIssue {
  path: string;
  message: string;
}

export type ParseSidecarResult = { ok: true; sidecar: BlocksSidecar } | { ok: false; issues: BlocksIssue[] };

// ---------------------------------------------------------------------------
// zod: the envelope. Recursive value specs and templates are checked by hand
// below, because their rules are positional and cross-field.

const valueSpecSchema: z.ZodType<ValueSpec> = z.lazy(() =>
  z
    .object({
      type: z.enum(["string", "enum", "boolean", "integer", "array", "object"]),
      description: z.string().min(1).max(240).optional(),
      minLength: z.number().int().min(0).optional(),
      maxLength: z.number().int().min(1).optional(),
      values: z.array(z.string().min(1)).min(1).optional(),
      minimum: z.number().int().optional(),
      maximum: z.number().int().optional(),
      items: valueSpecSchema.optional(),
      minItems: z.number().int().min(0).optional(),
      maxItems: z.number().int().min(1).optional(),
      uniqueItems: z.boolean().optional(),
      props: z.array(propSpecSchema).min(1).optional(),
    })
    .strict(),
);

const propSpecSchema: z.ZodType<PropSpec> = z.lazy(() =>
  z
    .object({
      name: z.string().regex(PROP_NAME, "prop names are camelCase identifiers"),
      required: z.boolean().optional(),
      type: z.enum(["string", "enum", "boolean", "integer", "array", "object"]),
      description: z.string().min(1).max(240).optional(),
      minLength: z.number().int().min(0).optional(),
      maxLength: z.number().int().min(1).optional(),
      values: z.array(z.string().min(1)).min(1).optional(),
      minimum: z.number().int().optional(),
      maximum: z.number().int().optional(),
      items: valueSpecSchema.optional(),
      minItems: z.number().int().min(0).optional(),
      maxItems: z.number().int().min(1).optional(),
      uniqueItems: z.boolean().optional(),
      props: z.array(propSpecSchema).min(1).optional(),
    })
    .strict(),
);

const whenSchema = z.object({ prop: z.string().min(1), equals: z.string().min(1) }).strict();
const constraintSchema: z.ZodType<BlockConstraint> = z.union([
  z.object({ kind: z.literal("equal-length"), paths: z.tuple([z.string().min(1), z.string().min(1)]) }).strict(),
  z
    .object({ kind: z.literal("includes-when"), when: whenSchema, path: z.string().min(1), values: z.array(z.string().min(1)).min(1) })
    .strict(),
  z
    .object({ kind: z.literal("excludes-when"), when: whenSchema, path: z.string().min(1), values: z.array(z.string().min(1)).min(1) })
    .strict(),
]);

const blockSchema = z
  .object({
    id: z.string().regex(BLOCK_ID, "block ids are kebab-case"),
    version: z.number().int().min(1),
    status: z.enum(["draft", "approved"]),
    name: z.string().min(1).max(80),
    summary: z.string().min(1).max(240),
    relatedPattern: z.string().min(1).optional(),
    intents: z.array(z.string().min(1)).min(1),
    keywords: z.array(z.string().min(1)).default([]),
    props: z.array(propSpecSchema).min(1),
    constraints: z.array(constraintSchema).optional(),
    actions: z.array(z.string().regex(ACTION_NAME, "action names are dspack-emit slugs")),
    streaming: z.enum(["static-safe", "disable-actions-until-complete"]),
    notes: z.array(z.string().min(1)).optional(),
    template: z.record(z.unknown()),
    examples: z
      .array(
        z
          .object({
            id: z.string().min(1),
            intent: z.string().min(1),
            prompt: z.string().min(1),
            call: z.record(z.unknown()),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const sidecarSchema = z
  .object({
    blocksSidecar: z.literal(BLOCKS_SIDECAR_VERSION),
    status: z.enum(["draft", "approved"]),
    reference: z.object({ name: z.string().min(1), dspack: z.string().min(1), version: z.string().min(1) }).strict(),
    baseSha256: z.string().regex(/^[0-9a-f]{64}$/, "a lowercase hex sha256"),
    blocks: z.array(blockSchema).min(1),
  })
  .strict();

// ---------------------------------------------------------------------------

/** Parse and structurally check a sidecar document. Fails closed. */
export function parseBlocksSidecar(json: unknown): ParseSidecarResult {
  const parsed = sidecarSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  const sidecar = parsed.data as unknown as BlocksSidecar;
  const issues: BlocksIssue[] = [];
  const seen = new Set<string>();
  sidecar.blocks.forEach((block, b) => {
    const at = `blocks.${b}`;
    if (seen.has(block.id)) issues.push({ path: `${at}.id`, message: `duplicate block id '${block.id}'` });
    seen.add(block.id);
    checkProps(block.props, `${at}.props`, issues, true);
    for (const [i, c] of (block.constraints ?? []).entries()) checkConstraint(block, c, `${at}.constraints.${i}`, issues);
    checkTemplateNode(block.template, `${at}.template`, rootScope(block), issues);
    const exampleIds = new Set<string>();
    block.examples.forEach((example, e) => {
      if (exampleIds.has(example.id)) issues.push({ path: `${at}.examples.${e}.id`, message: `duplicate example id '${example.id}'` });
      exampleIds.add(example.id);
      if (!block.intents.includes(example.intent)) {
        issues.push({ path: `${at}.examples.${e}.intent`, message: `'${example.intent}' is not one of the block's intents` });
      }
    });
  });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, sidecar };
}

/** Signature rules: unique names, nothing reserved, required before optional
 *  (positional wire order, ADR-B2), every string and array bounded. */
function checkProps(props: PropSpec[], at: string, issues: BlocksIssue[], topLevel: boolean): void {
  const names = new Set<string>();
  let sawOptional = false;
  props.forEach((prop, i) => {
    const path = `${at}.${i}`;
    if (names.has(prop.name)) issues.push({ path: `${path}.name`, message: `duplicate prop '${prop.name}'` });
    names.add(prop.name);
    if (prop.name in Object.prototype) issues.push({ path: `${path}.name`, message: `'${prop.name}' shadows an Object.prototype member` });
    if (topLevel && RESERVED_PROP_NAMES.has(prop.name)) {
      issues.push({ path: `${path}.name`, message: `'${prop.name}' is reserved by the call envelope` });
    }
    if (prop.required) {
      if (sawOptional) issues.push({ path, message: `required prop '${prop.name}' follows an optional one; required props come first` });
    } else {
      sawOptional = true;
    }
    checkValueSpec(prop, path, issues);
  });
}

function checkValueSpec(spec: ValueSpec, at: string, issues: BlocksIssue[]): void {
  const misplaced = (keys: Array<keyof ValueSpec>) => {
    for (const key of keys) {
      if (spec[key] !== undefined) issues.push({ path: `${at}.${String(key)}`, message: `'${String(key)}' does not apply to type '${spec.type}'` });
    }
  };
  switch (spec.type) {
    case "string":
      if (spec.maxLength === undefined) issues.push({ path: at, message: "string values must declare maxLength" });
      if (spec.minLength !== undefined && spec.maxLength !== undefined && spec.minLength > spec.maxLength) {
        issues.push({ path: at, message: "minLength exceeds maxLength" });
      }
      misplaced(["values", "minimum", "maximum", "items", "minItems", "maxItems", "uniqueItems", "props"]);
      break;
    case "enum":
      if (!spec.values || spec.values.length === 0) issues.push({ path: at, message: "enum values must declare values" });
      else if (new Set(spec.values).size !== spec.values.length) issues.push({ path: `${at}.values`, message: "enum values repeat" });
      misplaced(["minLength", "maxLength", "minimum", "maximum", "items", "minItems", "maxItems", "uniqueItems", "props"]);
      break;
    case "boolean":
      misplaced(["minLength", "maxLength", "values", "minimum", "maximum", "items", "minItems", "maxItems", "uniqueItems", "props"]);
      break;
    case "integer":
      if (spec.minimum === undefined || spec.maximum === undefined) issues.push({ path: at, message: "integer values must declare minimum and maximum" });
      else if (spec.minimum > spec.maximum) issues.push({ path: at, message: "minimum exceeds maximum" });
      misplaced(["minLength", "maxLength", "values", "items", "minItems", "maxItems", "uniqueItems", "props"]);
      break;
    case "array":
      if (!spec.items) issues.push({ path: at, message: "array values must declare items" });
      else checkValueSpec(spec.items, `${at}.items`, issues);
      if (spec.maxItems === undefined) issues.push({ path: at, message: "array values must declare maxItems" });
      if (spec.minItems !== undefined && spec.maxItems !== undefined && spec.minItems > spec.maxItems) {
        issues.push({ path: at, message: "minItems exceeds maxItems" });
      }
      misplaced(["minLength", "maxLength", "values", "minimum", "maximum", "props"]);
      break;
    case "object":
      if (!spec.props || spec.props.length === 0) issues.push({ path: at, message: "object values must declare props" });
      else checkProps(spec.props, `${at}.props`, issues, false);
      misplaced(["minLength", "maxLength", "values", "minimum", "maximum", "items", "minItems", "maxItems", "uniqueItems"]);
      break;
  }
}

// ---------------------------------------------------------------------------
// Paths: "name" | "name.field" | "name.*.field" (wildcard only in constraints).

/** Names visible to a template position: top-level props, plus the variables
 *  bound by enclosing $each / $map (loop = true, so $index can tell them apart). */
export type Scope = Map<string, { spec: ValueSpec; loop: boolean }>;

/** Resolve the ValueSpec a dotted path names against a scope of variables. */
export function specAtPath(scope: Scope, path: string, allowWildcard = false): ValueSpec | null {
  const [head, ...rest] = path.split(".");
  let spec = scope.get(head ?? "")?.spec ?? null;
  for (const segment of rest) {
    if (!spec) return null;
    if (segment === "*") {
      if (!allowWildcard || spec.type !== "array" || !spec.items) return null;
      spec = spec.items;
      continue;
    }
    if (spec.type !== "object" || !spec.props) return null;
    spec = spec.props.find((p) => p.name === segment) ?? null;
  }
  return spec;
}

/** True when every segment of a path is guaranteed present for a B1-valid call:
 *  the head is a loop variable or a required prop, and each field is required. */
export function alwaysPresent(scope: Scope, path: string): boolean {
  const [head, ...rest] = path.split(".");
  const entry = scope.get(head ?? "");
  if (!entry) return false;
  if (!entry.loop && !(entry.spec as PropSpec).required) return false;
  let spec: ValueSpec | undefined = entry.spec;
  for (const segment of rest) {
    const field: PropSpec | undefined = spec?.type === "object" ? spec.props?.find((p) => p.name === segment) : undefined;
    if (!field?.required) return false;
    spec = field;
  }
  return true;
}

export function rootScope(block: Pick<BlockDefinition, "props">): Scope {
  return new Map(block.props.map((p) => [p.name, { spec: p, loop: false }]));
}

function checkConstraint(block: BlockDefinition, c: BlockConstraint, at: string, issues: BlocksIssue[]): void {
  const scope = rootScope(block);
  if (c.kind === "equal-length") {
    for (const [i, p] of c.paths.entries()) {
      const spec = specAtPath(scope, p, true);
      if (!spec || spec.type !== "array") issues.push({ path: `${at}.paths.${i}`, message: `'${p}' does not name an array` });
    }
    return;
  }
  const when = scope.get(c.when.prop)?.spec;
  if (!when || when.type !== "enum" || !when.values?.includes(c.when.equals)) {
    issues.push({ path: `${at}.when`, message: `'${c.when.prop}' = '${c.when.equals}' is not a declared enum value` });
  }
  const target = specAtPath(scope, c.path);
  const itemValues = target?.type === "array" && target.items?.type === "enum" ? target.items.values : undefined;
  if (!itemValues) issues.push({ path: `${at}.path`, message: `'${c.path}' does not name an array of enum values` });
  else for (const v of c.values) if (!itemValues.includes(v)) issues.push({ path: `${at}.values`, message: `'${v}' is not a value of '${c.path}'` });
}

// ---------------------------------------------------------------------------
// Template structure (expansion semantics are Phase 1A; the SHAPE is fixed here).

const VALUE_DIRECTIVES = new Set(["$prop", "$concat", "$case", "$index", "$map"]);

function isDirective(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).some((k) => k.startsWith("$"));
}

function checkTemplateNode(node: unknown, at: string, scope: Scope, issues: BlocksIssue[]): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    issues.push({ path: at, message: "a template node is an object" });
    return;
  }
  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!["component", "id", "props", "text", "children"].includes(key)) issues.push({ path: `${at}.${key}`, message: `unknown template node key '${key}'` });
  }
  if (typeof record.component !== "string" || record.component.length === 0) {
    issues.push({ path: `${at}.component`, message: "a template node names its component literally" });
  }
  if (record.id !== undefined) checkTemplateValue(record.id, `${at}.id`, scope, issues);
  if (record.text !== undefined) checkTemplateValue(record.text, `${at}.text`, scope, issues);
  if (record.props !== undefined) {
    if (!record.props || typeof record.props !== "object" || Array.isArray(record.props) || isDirective(record.props)) {
      issues.push({ path: `${at}.props`, message: "props is a literal object of template values" });
    } else {
      for (const [k, v] of Object.entries(record.props)) checkTemplateValue(v, `${at}.props.${k}`, scope, issues);
    }
  }
  if (record.children !== undefined) checkTemplateChildren(record.children, `${at}.children`, scope, issues);
}

function checkTemplateChildren(children: unknown, at: string, scope: Scope, issues: BlocksIssue[]): void {
  if (!Array.isArray(children)) {
    issues.push({ path: at, message: "children is an array" });
    return;
  }
  children.forEach((child, i) => {
    const path = `${at}.${i}`;
    if (child && typeof child === "object" && "$each" in child) {
      const each = child as Record<string, unknown>;
      for (const key of Object.keys(each)) if (!["$each", "as", "children"].includes(key)) issues.push({ path: `${path}.${key}`, message: `unknown $each key '${key}'` });
      const source = typeof each.$each === "string" ? specAtPath(scope, each.$each) : null;
      if (!source || source.type !== "array" || !source.items) issues.push({ path: `${path}.$each`, message: `'${String(each.$each)}' does not name an array` });
      if (typeof each.as !== "string" || !PROP_NAME.test(each.as) || scope.has(each.as)) {
        issues.push({ path: `${path}.as`, message: "$each binds a fresh camelCase name" });
      }
      const inner = new Map(scope);
      if (source?.items && typeof each.as === "string") inner.set(each.as, { spec: source.items, loop: true });
      checkTemplateChildren(each.children, `${path}.children`, inner, issues);
    } else if (child && typeof child === "object" && "$if" in child) {
      const cond = child as Record<string, unknown>;
      for (const key of Object.keys(cond)) if (!["$if", "children", "else"].includes(key)) issues.push({ path: `${path}.${key}`, message: `unknown $if key '${key}'` });
      const test = cond.$if;
      if (typeof test === "string") {
        if (!specAtPath(scope, test)) issues.push({ path: `${path}.$if`, message: `'${test}' does not resolve` });
      } else if (test && typeof test === "object" && Array.isArray((test as { $eq?: unknown }).$eq) && (test as { $eq: unknown[] }).$eq.length === 2 && Object.keys(test).length === 1) {
        (test as { $eq: unknown[] }).$eq.forEach((v, k) => checkTemplateValue(v, `${path}.$if.$eq.${k}`, scope, issues));
      } else {
        issues.push({ path: `${path}.$if`, message: "$if takes a path or { $eq: [a, b] }" });
      }
      checkTemplateChildren(cond.children, `${path}.children`, scope, issues);
      if (cond.else !== undefined) checkTemplateChildren(cond.else, `${path}.else`, scope, issues);
    } else {
      checkTemplateNode(child, path, scope, issues);
    }
  });
}

function checkTemplateValue(value: unknown, at: string, scope: Scope, issues: BlocksIssue[]): void {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkTemplateValue(v, `${at}.${i}`, scope, issues));
    return;
  }
  if (typeof value !== "object") {
    issues.push({ path: at, message: "not a JSON value" });
    return;
  }
  const record = value as Record<string, unknown>;
  if (!isDirective(record)) {
    for (const [k, v] of Object.entries(record)) checkTemplateValue(v, `${at}.${k}`, scope, issues);
    return;
  }
  const directive = Object.keys(record).find((k) => k.startsWith("$")) as string;
  if (!VALUE_DIRECTIVES.has(directive) || Object.keys(record).filter((k) => k.startsWith("$")).length !== 1) {
    issues.push({ path: at, message: `unknown or ambiguous directive in {${Object.keys(record).join(", ")}}` });
    return;
  }
  const allow = (keys: string[]) => {
    for (const k of Object.keys(record)) if (!keys.includes(k)) issues.push({ path: `${at}.${k}`, message: `'${k}' is not valid with ${directive}` });
  };
  switch (directive) {
    case "$prop":
      allow(["$prop", "default"]);
      if (typeof record.$prop !== "string" || !specAtPath(scope, record.$prop)) issues.push({ path: `${at}.$prop`, message: `'${String(record.$prop)}' does not resolve` });
      if (record.default !== undefined && (typeof record.default === "object" && record.default !== null)) issues.push({ path: `${at}.default`, message: "a default is a literal scalar" });
      break;
    case "$concat":
      allow(["$concat"]);
      if (!Array.isArray(record.$concat) || record.$concat.length === 0) issues.push({ path: `${at}.$concat`, message: "$concat takes a non-empty array" });
      else record.$concat.forEach((v, i) => checkTemplateValue(v, `${at}.$concat.${i}`, scope, issues));
      break;
    case "$case": {
      allow(["$case", "map", "default"]);
      const source = typeof record.$case === "string" ? specAtPath(scope, record.$case) : null;
      if (!source || (source.type !== "enum" && source.type !== "boolean")) issues.push({ path: `${at}.$case`, message: `'${String(record.$case)}' does not name an enum or boolean` });
      const map = record.map;
      const isScalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
      if (!map || typeof map !== "object" || Array.isArray(map)) issues.push({ path: `${at}.map`, message: "$case takes a literal map" });
      else {
        const keys = source?.type === "enum" ? source.values ?? [] : ["true", "false"];
        for (const [k, v] of Object.entries(map)) {
          if (!keys.includes(k)) issues.push({ path: `${at}.map.${k}`, message: `'${k}' is not a value of '${String(record.$case)}'` });
          if (!isScalar(v)) issues.push({ path: `${at}.map.${k}`, message: "a $case result is a literal scalar" });
        }
        if (record.default === undefined) {
          for (const k of keys) if (!Object.hasOwn(map, k)) issues.push({ path: `${at}.map`, message: `no mapping for '${k}' and no default` });
          // A source that may be absent would make a B1-valid call fail expansion.
          if (typeof record.$case === "string" && !alwaysPresent(scope, record.$case)) {
            issues.push({ path: `${at}.$case`, message: `'${record.$case}' may be absent; give a default` });
          }
        }
      }
      if (record.default !== undefined && !isScalar(record.default)) issues.push({ path: `${at}.default`, message: "a $case default is a literal scalar" });
      break;
    }
    case "$index":
      allow(["$index"]);
      if (typeof record.$index !== "string" || scope.get(record.$index)?.loop !== true) {
        issues.push({ path: `${at}.$index`, message: `'${String(record.$index)}' is not an enclosing $each or $map variable` });
      }
      break;
    case "$map": {
      allow(["$map", "as", "value"]);
      const source = typeof record.$map === "string" ? specAtPath(scope, record.$map) : null;
      if (!source || source.type !== "array" || !source.items) issues.push({ path: `${at}.$map`, message: `'${String(record.$map)}' does not name an array` });
      if (typeof record.as !== "string" || !PROP_NAME.test(record.as) || scope.has(record.as)) issues.push({ path: `${at}.as`, message: "$map binds a fresh camelCase name" });
      const inner = new Map(scope);
      if (source?.items && typeof record.as === "string") inner.set(record.as, { spec: source.items, loop: true });
      checkTemplateValue(record.value, `${at}.value`, inner, issues);
      break;
    }
  }
}
