/** Catalog `Column` -> flex column with shadcn's spacing idiom. */
import type { FC } from "react";
import { childIds } from "@dspack-studio/a2ui-ingest";
import { cn } from "../cn";

const JUSTIFY: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  spaceBetween: "justify-between",
  spaceAround: "justify-around",
  spaceEvenly: "justify-evenly",
  stretch: "justify-start",
};
const ALIGN: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

export const ColumnRender: FC<any> = ({ props, buildChild }) => (
  <div className={cn("flex flex-col gap-3", JUSTIFY[props.justify as string], ALIGN[props.align as string] ?? "items-stretch")}>
    {childIds(props.children).map((id) => (
      <span key={id} style={{ display: "contents" }}>
        {buildChild(id)}
      </span>
    ))}
  </div>
);
