/**
 * Light per-prop classification for wireframe rendering, derived from the
 * catalog JSON alone. This is presentation-only triage (which props are child
 * references, actions, or displayable values) — the ACCEPTED schema still
 * comes from buildComponentApi in a2ui-ingest; nothing here widens or narrows
 * the vocabulary.
 *
 * Emitted catalogs compose each component as
 * allOf: [{$ref ComponentCommon}, {$ref Checkable?}, { properties: {...} }];
 * classification keys on each property's $ref tail (the same Tier-1 signal
 * buildComponentApi uses), so it works on any conformant inlined catalog.
 */

export type WirePropKind = "child" | "children" | "action" | "value";

/**
 * How a value prop should be DRAWN, declared by the catalog rather than
 * guessed per design system: free text is content, an enum is a token, a
 * boolean is a flag, an array/object is structure. "unknown" means the
 * catalog did not say and the runtime value decides (see SketchValue).
 */
export type WireShape = "text" | "enum" | "boolean" | "number" | "list" | "record" | "unknown";

export interface WireProp {
  name: string;
  kind: WirePropKind;
  shape: WireShape;
}

const SKIP = new Set(["component", "id", "accessibility", "weight"]);

function refTail(schema: unknown): string | undefined {
  const ref = (schema as { $ref?: unknown })?.$ref;
  if (typeof ref !== "string") return undefined;
  const tail = ref.split("/").at(-1);
  return tail;
}

/**
 * The drawable shape of one value property, from the same Tier-1 signals:
 * the $ref tail for A2UI's shared string type, then plain JSON Schema
 * `enum`/`type`. Nothing design-system-specific is consulted.
 */
function shapeOf(schema: unknown, tail: string | undefined): WireShape {
  if (tail === "DynamicString") return "text";
  const s = (schema ?? {}) as { enum?: unknown; type?: unknown; oneOf?: unknown };
  if (Array.isArray(s.enum) && s.enum.length > 0) return "enum";
  if (Array.isArray(s.oneOf) && s.oneOf.every((o) => o && typeof o === "object" && "const" in (o as object))) return "enum";
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
  if (type === "boolean") return "boolean";
  if (type === "number" || type === "integer") return "number";
  if (type === "string") return "text";
  if (type === "array") return "list";
  if (type === "object") return "record";
  return "unknown";
}

export function classifyProps(catalog: Record<string, any>, name: string): WireProp[] {
  const component = catalog.components?.[name];
  if (!component) return [];
  const layers: Array<Record<string, unknown>> = [];
  for (const layer of component.allOf ?? [component]) {
    const props = (layer as { properties?: Record<string, unknown> }).properties;
    if (props) layers.push(props);
  }
  const out: WireProp[] = [];
  const seen = new Set<string>();
  for (const props of layers) {
    for (const [propName, schema] of Object.entries(props)) {
      if (SKIP.has(propName) || seen.has(propName)) continue;
      seen.add(propName);
      const tail = refTail(schema);
      const kind: WirePropKind =
        tail === "ComponentId" ? "child" : tail === "ChildList" ? "children" : tail === "Action" ? "action" : "value";
      out.push({ name: propName, kind, shape: kind === "value" ? shapeOf(schema, tail) : "unknown" });
    }
  }
  return out;
}
