/**
 * Catalog `MetadataList` -> shadcn/ui-style definition list. The catalog
 * carries items as data-props ({ label, value } records); this renders them
 * as a token-colored dl grid — muted labels, plain values.
 */
import type { FC } from "react";
import { cn } from "../cn";

interface Item {
  label?: unknown;
  value?: unknown;
}

export const MetadataListRender: FC<any> = ({ props }) => {
  const items: Item[] = Array.isArray(props.items) ? props.items : [];
  const horizontal = props.orientation === "horizontal";
  return (
    <dl className={cn("text-sm", props.columns === "multi" ? "grid grid-cols-2 gap-x-6 gap-y-1" : "flex flex-col gap-1")}>
      {items.map((item, i) => (
        <div key={i} className={cn(horizontal ? "flex items-baseline gap-2" : "flex flex-col")}>
          <dt className="text-muted-foreground">{String(item.label ?? "")}</dt>
          <dd className="m-0 font-medium">{String(item.value ?? "")}</dd>
        </div>
      ))}
    </dl>
  );
};
