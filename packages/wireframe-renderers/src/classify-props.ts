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

export interface WireProp {
  name: string;
  kind: WirePropKind;
}

const SKIP = new Set(["component", "id", "accessibility", "weight"]);

function refTail(schema: unknown): string | undefined {
  const ref = (schema as { $ref?: unknown })?.$ref;
  if (typeof ref !== "string") return undefined;
  const tail = ref.split("/").at(-1);
  return tail;
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
      out.push({ name: propName, kind });
    }
  }
  return out;
}
