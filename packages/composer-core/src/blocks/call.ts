/**
 * Interface blocks (experimental): the call contract.
 *
 * The NAMED canonical call is the contract (ADR-B2):
 *   { "block": "auth-form", "version": 1, "mode": "sign-in", "fields": [...] }
 * Internal APIs, audit traces, provenance and docs use it. The COMPACT
 * positional call is a decodable projection for the wire:
 *   { "b": "auth-form", "v": 1, "p": ["sign-in", "Welcome back", [...]] }
 * Object values become arrays in declared field order; optional values may be
 * omitted from the end, and a skipped middle optional is written null.
 * Positional order is recorded (the prop's index) but is not yet a
 * compatibility commitment: 1B benchmarks named vs positional first.
 *
 * validateCall is B1 (shape and bounds). checkConstraints is the cross-field
 * half of B2; the action-allowlist half needs an expansion (Phase 1A).
 */
import { RESERVED_PROP_NAMES, rootScope, specAtPath, type BlockConstraint, type BlockDefinition, type PropSpec, type ValueSpec } from "./schema";

export type CallEncoding = "named" | "positional";

export interface CallIssue {
  path: string;
  message: string;
}

export type DecodeResult = { ok: true; call: Record<string, unknown> } | { ok: false; issues: CallIssue[] };

type Json = Record<string, unknown>;

/** Own-property read: a prop name never resolves through the prototype chain. */
function own(value: Json, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

/** The prop's position in the compact wire array. */
export function wireIndex(block: Pick<BlockDefinition, "props">, propName: string): number {
  return block.props.findIndex((p) => p.name === propName);
}

// ---------------------------------------------------------------------------
// JSON Schema for the model (selected block only, never the full registry).

function valueSchema(spec: ValueSpec, encoding: CallEncoding): Json {
  const described = (schema: Json): Json => (spec.description ? { ...schema, description: spec.description } : schema);
  switch (spec.type) {
    case "string":
      return described({ type: "string", ...(spec.minLength !== undefined ? { minLength: spec.minLength } : {}), maxLength: spec.maxLength });
    case "enum":
      return described({ enum: [...(spec.values ?? [])] });
    case "boolean":
      return described({ type: "boolean" });
    case "integer":
      return described({ type: "integer", minimum: spec.minimum, maximum: spec.maximum });
    case "array":
      return described({
        type: "array",
        items: valueSchema(spec.items as ValueSpec, encoding),
        ...(spec.minItems !== undefined ? { minItems: spec.minItems } : {}),
        maxItems: spec.maxItems,
        ...(spec.uniqueItems ? { uniqueItems: true } : {}),
      });
    case "object":
      return described(encoding === "named" ? namedObjectSchema(spec.props ?? [], encoding) : positionalArraySchema(spec.props ?? []));
  }
}

function namedObjectSchema(props: PropSpec[], encoding: CallEncoding): Json {
  return {
    type: "object",
    additionalProperties: false,
    required: props.filter((p) => p.required).map((p) => p.name),
    properties: Object.fromEntries(props.map((p) => [p.name, valueSchema(p, encoding)])),
  };
}

function positionalArraySchema(props: PropSpec[]): Json {
  return {
    type: "array",
    prefixItems: props.map((p) => (p.required ? valueSchema(p, "positional") : { anyOf: [valueSchema(p, "positional"), { type: "null" }] })),
    items: false,
    minItems: props.filter((p) => p.required).length,
    maxItems: props.length,
  };
}

/** The JSON Schema a model answers with for ONE block, in either encoding. */
export function callJsonSchema(block: BlockDefinition, encoding: CallEncoding): Json {
  if (encoding === "named") {
    const inner = namedObjectSchema(block.props, encoding);
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["block", "version", ...(inner.required as string[])],
      properties: { block: { const: block.id }, version: { const: block.version }, ...(inner.properties as Json) },
    };
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["b", "v", "p"],
    properties: { b: { const: block.id }, v: { const: block.version }, p: positionalArraySchema(block.props) },
  };
}

// ---------------------------------------------------------------------------
// Projection: named <-> positional. Pure, total on valid input, fail-closed.

function encodeValue(spec: ValueSpec, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (spec.type === "array" && Array.isArray(value)) return value.map((v) => encodeValue(spec.items as ValueSpec, v));
  if (spec.type === "object" && value && typeof value === "object" && !Array.isArray(value)) return encodeFields(spec.props ?? [], value as Json);
  return value;
}

function encodeFields(props: PropSpec[], value: Json): unknown[] {
  const out = props.map((p) => (own(value, p.name) === undefined ? null : encodeValue(p, own(value, p.name))));
  // Trailing optionals are omitted; a skipped middle optional stays null.
  while (out.length > 0 && out[out.length - 1] === null && !props[out.length - 1]?.required) out.pop();
  return out;
}

/** Named canonical call -> compact positional call. */
export function encodeCall(block: BlockDefinition, named: Json): Json {
  return { b: block.id, v: block.version, p: encodeFields(block.props, named) };
}

function decodeValue(spec: ValueSpec, value: unknown, at: string, issues: CallIssue[]): unknown {
  if (value === null || value === undefined) return undefined;
  if (spec.type === "array") {
    if (!Array.isArray(value)) {
      issues.push({ path: at, message: "expected an array" });
      return undefined;
    }
    return value.map((v, i) => decodeValue(spec.items as ValueSpec, v, `${at}.${i}`, issues));
  }
  if (spec.type === "object") {
    if (!Array.isArray(value)) {
      issues.push({ path: at, message: "expected a positional array" });
      return undefined;
    }
    return decodeFields(spec.props ?? [], value, at, issues);
  }
  return value;
}

function decodeFields(props: PropSpec[], values: unknown[], at: string, issues: CallIssue[]): Json {
  if (values.length > props.length) issues.push({ path: at, message: `${values.length} positional values for ${props.length} declared fields` });
  const out: Json = {};
  props.forEach((p, i) => {
    const decoded = decodeValue(p, values[i], `${at}.${i}`, issues);
    if (decoded !== undefined) out[p.name] = decoded;
  });
  return out;
}

/** Compact positional call -> named canonical call. Does not judge bounds (B1 does). */
export function decodeCall(block: BlockDefinition, compact: unknown): DecodeResult {
  const issues: CallIssue[] = [];
  if (!compact || typeof compact !== "object" || Array.isArray(compact)) return { ok: false, issues: [{ path: "$", message: "a compact call is an object" }] };
  const record = compact as Json;
  for (const key of Object.keys(record)) if (!["b", "v", "p"].includes(key)) issues.push({ path: `$.${key}`, message: `unknown key '${key}'` });
  if (record.b !== block.id) issues.push({ path: "$.b", message: `expected block '${block.id}'` });
  if (record.v !== block.version) issues.push({ path: "$.v", message: `expected version ${block.version}` });
  if (!Array.isArray(record.p)) issues.push({ path: "$.p", message: "expected the positional argument array" });
  if (issues.length > 0) return { ok: false, issues };
  const props = decodeFields(block.props, record.p as unknown[], "$.p", issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, call: { block: block.id, version: block.version, ...props } };
}

// ---------------------------------------------------------------------------
// B1: shape and bounds of a NAMED call. Every issue is pathed; nothing coerces.

function checkValue(spec: ValueSpec, value: unknown, at: string, issues: CallIssue[]): void {
  switch (spec.type) {
    case "string":
      if (typeof value !== "string") return void issues.push({ path: at, message: "expected a string" });
      {
        // Code points, as JSON Schema counts string length, not UTF-16 units.
        const length = [...value].length;
        if (spec.minLength !== undefined && length < spec.minLength) issues.push({ path: at, message: `shorter than ${spec.minLength}` });
        if (spec.maxLength !== undefined && length > spec.maxLength) issues.push({ path: at, message: `longer than ${spec.maxLength}` });
      }
      return;
    case "enum":
      if (typeof value !== "string" || !(spec.values ?? []).includes(value)) issues.push({ path: at, message: `expected one of ${(spec.values ?? []).join(", ")}` });
      return;
    case "boolean":
      if (typeof value !== "boolean") issues.push({ path: at, message: "expected a boolean" });
      return;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) return void issues.push({ path: at, message: "expected an integer" });
      if (spec.minimum !== undefined && value < spec.minimum) issues.push({ path: at, message: `below ${spec.minimum}` });
      if (spec.maximum !== undefined && value > spec.maximum) issues.push({ path: at, message: `above ${spec.maximum}` });
      return;
    case "array": {
      if (!Array.isArray(value)) return void issues.push({ path: at, message: "expected an array" });
      if (spec.minItems !== undefined && value.length < spec.minItems) issues.push({ path: at, message: `fewer than ${spec.minItems} items` });
      if (spec.maxItems !== undefined && value.length > spec.maxItems) issues.push({ path: at, message: `more than ${spec.maxItems} items` });
      if (spec.uniqueItems) {
        // Canonical form (positional projection) so key order cannot hide a duplicate.
        const keys = value.map((v) => JSON.stringify(encodeValue(spec.items as ValueSpec, v)));
        if (new Set(keys).size !== keys.length) issues.push({ path: at, message: "items repeat" });
      }
      value.forEach((v, i) => checkValue(spec.items as ValueSpec, v, `${at}.${i}`, issues));
      return;
    }
    case "object":
      if (!value || typeof value !== "object" || Array.isArray(value)) return void issues.push({ path: at, message: "expected an object" });
      checkFields(spec.props ?? [], value as Json, at, issues);
      return;
  }
}

function checkFields(props: PropSpec[], value: Json, at: string, issues: CallIssue[], reserved?: Set<string>): void {
  const declared = new Set(props.map((p) => p.name));
  for (const key of Object.keys(value)) {
    if (reserved?.has(key)) continue;
    if (!declared.has(key)) issues.push({ path: `${at}.${key}`, message: `'${key}' is not declared` });
  }
  for (const p of props) {
    // Only a missing key is absent: an explicit null is a type error, exactly
    // as the named JSON Schema the model answers against treats it.
    const v = own(value, p.name);
    if (v === undefined) {
      if (p.required) issues.push({ path: `${at}.${p.name}`, message: "required" });
      continue;
    }
    checkValue(p, v, `${at}.${p.name}`, issues);
  }
}

/** B1: a named call's envelope, declared props, types and bounds. */
export function validateCall(block: BlockDefinition, call: unknown): CallIssue[] {
  if (!call || typeof call !== "object" || Array.isArray(call)) return [{ path: "$", message: "a call is an object" }];
  const record = call as Json;
  const issues: CallIssue[] = [];
  if (record.block !== block.id) issues.push({ path: "$.block", message: `expected block '${block.id}'` });
  if (record.version !== block.version) issues.push({ path: "$.version", message: `expected version ${block.version}` });
  checkFields(block.props, record, "$", issues, new Set(["block", "version"]));
  for (const key of Object.keys(record)) {
    if (RESERVED_PROP_NAMES.has(key) && key !== "block" && key !== "version") issues.push({ path: `$.${key}`, message: `'${key}' is reserved` });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// B2 (constraints half): closed cross-field checks over a B1-valid call.

function valuesAt(call: Json, path: string): unknown[] {
  let frontier: unknown[] = [call];
  for (const segment of path.split(".")) {
    const next: unknown[] = [];
    for (const v of frontier) {
      if (segment === "*") {
        if (Array.isArray(v)) next.push(...v);
      } else if (v && typeof v === "object" && !Array.isArray(v) && own(v as Json, segment) !== undefined) {
        next.push(own(v as Json, segment));
      }
    }
    frontier = next;
  }
  return frontier;
}

function checkConstraint(call: Json, c: BlockConstraint, at: string): CallIssue[] {
  if (c.kind === "equal-length") {
    const [left, right] = c.paths.map((p) => valuesAt(call, p).filter(Array.isArray).map((a) => (a as unknown[]).length));
    const lengths = new Set([...(left ?? []), ...(right ?? [])]);
    return lengths.size > 1 ? [{ path: at, message: `'${c.paths[0]}' and '${c.paths[1]}' differ in length` }] : [];
  }
  if (call[c.when.prop] !== c.when.equals) return [];
  const present = new Set((valuesAt(call, c.path)[0] as unknown[] | undefined) ?? []);
  const wanted = c.kind === "includes-when" ? c.values.filter((v) => !present.has(v)) : c.values.filter((v) => present.has(v));
  if (wanted.length === 0) return [];
  const verb = c.kind === "includes-when" ? "must include" : "must not include";
  return [{ path: at, message: `when ${c.when.prop} is '${c.when.equals}', '${c.path}' ${verb} ${wanted.join(", ")}` }];
}

/** The constraint half of B2 over a B1-valid named call. */
export function checkConstraints(block: BlockDefinition, call: Json): CallIssue[] {
  return (block.constraints ?? []).flatMap((c, i) => checkConstraint(call, c, `constraints.${i}`));
}

/** Re-export for callers that only need path resolution over a block's props. */
export function propSpecAt(block: Pick<BlockDefinition, "props">, path: string): ValueSpec | null {
  return specAtPath(rootScope(block), path);
}
