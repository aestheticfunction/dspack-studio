/**
 * Catalog `List` -> shadcn/ui-style list markup: a vertical stack with
 * token-colored dividers. Density projects onto spacing steps; treatment
 * native to this design system.
 */
import type { FC } from "react";
import { childIds } from "@dspack-studio/a2ui-ingest";
import { cn } from "../cn";

const GAP: Record<string, string> = {
  compact: "gap-1",
  balanced: "gap-2",
  spacious: "gap-4",
};

export const ListRender: FC<any> = ({ props, buildChild }) => (
  <div role="list" className={cn("flex flex-col", GAP[props.density as string] ?? "gap-2", props.hasDividers && "divide-y divide-border [&>*]:pt-2 first:[&>*]:pt-0")}>
    {childIds(props.children).map((id: string) => (
      <div role="listitem" key={id}>
        {buildChild(id)}
      </div>
    ))}
  </div>
);
