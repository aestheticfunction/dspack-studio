/**
 * Stands in for the two helpers Composer's Astryx renderers import from
 * @dspack-studio/a2ui-ingest (childIds, withProvenance), so the renderer files
 * are used unchanged without pulling in a2ui-ingest, which is built on the
 * pinned @a2ui 0.10 stack. Same behaviour, copied, part of the spike's bridge.
 */
import type { FC } from "react";

export function childIds(children: unknown): string[] {
  if (Array.isArray(children)) return children.filter((c): c is string => typeof c === "string");
  return [];
}

export function withProvenance(name: string, Render: FC<any>): FC<any> {
  const Tagged: FC<any> = (p) => (
    <span style={{ display: "contents" }} data-a2ui-id={p?.context?.componentModel?.id} data-a2ui-component={name}>
      <Render {...p} />
    </span>
  );
  Tagged.displayName = `A2ui(${name})`;
  return Tagged;
}
