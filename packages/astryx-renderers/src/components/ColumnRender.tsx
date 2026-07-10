/**
 * Catalog `Column` (synthesized layout primitive) -> Astryx VStack.
 * A2UI's justify/align vocabulary projects onto VStack's alignment aliases.
 */
import type { FC } from "react";
import { VStack } from "@astryxdesign/core/Stack";
import { childIds } from "../provenance";

const JUSTIFY: Record<string, "start" | "center" | "end" | "between" | "around" | "evenly"> = {
  start: "start",
  center: "center",
  end: "end",
  spaceBetween: "between",
  spaceAround: "around",
  spaceEvenly: "evenly",
  stretch: "start",
};
const ALIGN: Record<string, "start" | "center" | "end" | "stretch"> = {
  start: "start",
  center: "center",
  end: "end",
  stretch: "stretch",
};

export const ColumnRender: FC<any> = ({ props, buildChild }) => (
  <VStack gap={3} justify={JUSTIFY[props.justify as string]} align={ALIGN[props.align as string] ?? "stretch"}>
    {childIds(props.children).map((id) => (
      <span key={id} style={{ display: "contents" }}>
        {buildChild(id)}
      </span>
    ))}
  </VStack>
);
