/**
 * Catalog `MetadataList` -> Astryx MetadataList. The catalog carries items
 * as data-props (the Table idiom — sub-components carry no props under
 * grammar-constrained generation); this renderer synthesizes the upstream
 * MetadataListItem children from the array.
 */
import type { FC } from "react";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";

interface Item {
  label?: unknown;
  value?: unknown;
}

export const MetadataListRender: FC<any> = ({ props }) => {
  const items: Item[] = Array.isArray(props.items) ? props.items : [];
  return (
    <MetadataList columns={props.columns} orientation={props.orientation}>
      {items.map((item, i) => (
        <MetadataListItem key={i} label={String(item.label ?? "")}>
          {String(item.value ?? "")}
        </MetadataListItem>
      ))}
    </MetadataList>
  );
};
