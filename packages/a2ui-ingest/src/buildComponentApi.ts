/**
 * Schema bridge: turn one A2UI catalog component (JSON Schema, draft 2020-12) into a
 * renderer `ComponentApi` (`{ name, schema: ZodObject }`).
 *
 * This module is GENERIC A2UI ingestion. It reads only the catalog JSON and the standard
 * A2UI common-type vocabulary; it has no dspack knowledge and no hardcoded component-name
 * list. Property-level classification keys on the `$ref` NAME (the last path segment), so a
 * prop like `DynamicString` classifies identically whether the ref is inlined
 * (`#/$defs/DynamicString`) or external (`.../common_types.json#/$defs/DynamicString`).
 *
 * The allOf/`$ref` FLATTENING (used to merge ComponentCommon / Checkable property sets)
 * resolves internal `#/...` refs only; an external `$ref` is rejected with a clear error
 * rather than silently dropping properties. This project emits fully inlined commons, so
 * internal resolution is sufficient here; supporting external-commons catalogs would mean
 * fetching/resolving those documents in `resolveRef`.
 *
 * Tier 1 (primary, required): classify each property from the catalog itself, mapping the
 * common-type `$ref` names to the canonical Zod unions exported by @a2ui/web_core so that
 * the renderer's `scrapeSchemaBehavior` recognizes their binding behavior.
 * Tier 2 (optional, additive): if a property carries an `x-a2ui` hint and Tier 1 cannot
 * classify it from the ref name, use the hint. The adapter works correctly with `x-a2ui`
 * entirely absent.
 */
import { z } from "zod";
import {
  DynamicStringSchema,
  DynamicNumberSchema,
  DynamicBooleanSchema,
  ComponentIdSchema,
  ChildListSchema,
  ActionSchema,
  AccessibilityAttributesSchema,
  CheckableSchema,
  type ComponentApi,
} from "@a2ui/web_core/v0_9";

type Json = Record<string, any>;

/** Maps an A2UI common-type `$defs` name to its canonical Zod schema. */
const REF_TO_ZOD: Record<string, z.ZodTypeAny> = {
  DynamicString: DynamicStringSchema,
  DynamicNumber: DynamicNumberSchema,
  DynamicBoolean: DynamicBooleanSchema,
  ComponentId: ComponentIdSchema,
  ChildList: ChildListSchema,
  Action: ActionSchema,
  AccessibilityAttributes: AccessibilityAttributesSchema,
};

/** Tier 2: x-a2ui kind to Zod, used only when Tier 1 cannot classify from the schema. */
const KIND_TO_ZOD: Record<string, () => z.ZodTypeAny> = {
  "dynamic-string": () => DynamicStringSchema,
  "dynamic-number": () => DynamicNumberSchema,
  "dynamic-boolean": () => DynamicBooleanSchema,
  "component-id": () => ComponentIdSchema,
  "child-list": () => ChildListSchema,
  action: () => ActionSchema,
  "static-string": () => z.string(),
  boolean: () => z.boolean(),
  number: () => z.number(),
};

// Catalog-envelope keys handled by the framework, not part of the component props schema.
const ENVELOPE_KEYS = new Set(["component", "id"]);

function refName(schema: Json | undefined): string | undefined {
  const ref = schema?.$ref;
  return typeof ref === "string" ? ref.split("/").pop() : undefined;
}

function resolveRef(catalog: Json, ref: string): Json {
  // Fail fast rather than silently dropping properties/required constraints.
  if (!ref.startsWith("#/")) {
    throw new Error(
      `Unsupported external $ref '${ref}'. The ingestion adapter resolves internal refs only.`,
    );
  }
  const path = ref.replace(/^#\//, "").split("/");
  let node: any = catalog;
  for (const seg of path) node = node?.[seg];
  if (node === undefined) throw new Error(`Unresolvable internal $ref '${ref}'.`);
  return node;
}

/** Flatten a component's allOf/$ref chain into a merged property map + required set. */
function flatten(catalog: Json, node: Json, acc: { props: Json; required: Set<string> }) {
  if (!node || typeof node !== "object") return acc;
  if (typeof node.$ref === "string") flatten(catalog, resolveRef(catalog, node.$ref), acc);
  if (Array.isArray(node.allOf)) for (const sub of node.allOf) flatten(catalog, sub, acc);
  if (node.properties) for (const [k, v] of Object.entries(node.properties)) acc.props[k] = v;
  if (Array.isArray(node.required)) for (const r of node.required) acc.required.add(r);
  return acc;
}

/** Classify a single property schema into a Zod schema. Returns whether default was applied. */
function zodForProp(prop: Json): { schema: z.ZodTypeAny; defaultApplied: boolean } {
  // Tier 1: common-type ref.
  const rn = refName(prop);
  if (rn && REF_TO_ZOD[rn]) return { schema: REF_TO_ZOD[rn], defaultApplied: false };

  // Tier 1: enum.
  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    let s: z.ZodTypeAny = z.enum(prop.enum as [string, ...string[]]);
    if (prop.default !== undefined) s = (s as z.ZodEnum<any>).default(prop.default);
    return { schema: s, defaultApplied: true };
  }

  // Tier 1: array of CheckRule (the Checkable `checks` property).
  if (prop.type === "array" && refName(prop.items) === "CheckRule") {
    return { schema: CheckableSchema.shape.checks, defaultApplied: false };
  }

  // Tier 1: scalars.
  switch (prop.type) {
    case "string":
      return { schema: z.string(), defaultApplied: false };
    case "number":
      return { schema: z.number(), defaultApplied: false };
    case "boolean":
      return { schema: z.boolean(), defaultApplied: false };
    case "array":
      return { schema: z.array(z.any()), defaultApplied: false };
    case "object":
      return { schema: z.record(z.any()), defaultApplied: false };
  }

  // Tier 2: x-a2ui hint (only reached when Tier 1 could not classify).
  const kind = prop["x-a2ui"]?.kind as string | undefined;
  if (kind && KIND_TO_ZOD[kind]) return { schema: KIND_TO_ZOD[kind](), defaultApplied: false };

  return { schema: z.any(), defaultApplied: false };
}

/**
 * Build a renderer ComponentApi from the catalog component named `name`.
 * `catalog` is the full parsed catalog JSON (needed to resolve internal `$ref`s).
 *
 * The schema is derived ENTIRELY from the catalog (props + common props like
 * `accessibility` flow through the same classifier). We do not inject any property the
 * catalog does not define, so the renderer accepts exactly what the generated contract
 * validates (e.g. `weight` is accepted only if the catalog's common type defines it).
 */
export function buildComponentApi(catalog: Json, name: string): ComponentApi {
  const component = catalog.components?.[name];
  if (!component) throw new Error(`Component '${name}' not found in catalog.`);

  const { props, required } = flatten(catalog, component, { props: {}, required: new Set() });

  const built: Record<string, z.ZodTypeAny> = {};
  for (const [propName, propSchema] of Object.entries(props)) {
    if (ENVELOPE_KEYS.has(propName)) continue; // component/id handled by the envelope
    let { schema, defaultApplied } = zodForProp(propSchema as Json);
    if (!defaultApplied && (propSchema as Json).default !== undefined) {
      schema = (schema as any).default((propSchema as Json).default);
    }
    if (!required.has(propName)) schema = schema.optional();
    built[propName] = schema;
  }

  const schema = z.object(built).strict();
  return { name, schema };
}
