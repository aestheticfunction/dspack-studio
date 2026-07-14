/**
 * Provenance tagging for X-ray: every rendered catalog component is wrapped in
 * a `display: contents` element carrying `data-a2ui-id` (the A2UI node id) and
 * `data-a2ui-component` (the catalog component name). The wrapper contributes
 * no layout of its own; it exists so the X-ray overlay can map pixels back to
 * the event, rule, and catalog entry that produced them.
 */
import type { FC } from "react";

export function withProvenance(name: string, Render: FC<any>): FC<any> {
  const Tagged: FC<any> = (p) => {
    const id: string | undefined = p?.context?.componentModel?.id;
    return (
      <span style={{ display: "contents" }} data-a2ui-id={id} data-a2ui-component={name}>
        <Render {...p} />
      </span>
    );
  };
  Tagged.displayName = `A2ui(${name})`;
  return Tagged;
}

/** Resolve a ChildList value (string[] | template object) to explicit ids. */
export function childIds(children: unknown): string[] {
  if (Array.isArray(children)) return children.filter((c): c is string => typeof c === "string");
  return []; // template form lands with the data-model work in Phase 2
}
