/**
 * Catalog `SelectableCard` -> Astryx SelectableCard. Presentational in
 * replay: `isSelected` is delivered state (selection lives in the shared
 * data model), so onChange is a no-op until the interaction overlay grounds
 * a select action.
 */
import type { FC } from "react";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { childIds } from "@dspack-studio/a2ui-ingest";

const VARIANTS = new Set([
  "default", "transparent", "muted",
  "blue", "cyan", "gray", "green", "orange", "pink", "purple", "red", "teal", "yellow",
]);

export const SelectableCardRender: FC<any> = ({ props, buildChild }) => (
  <SelectableCard
    label={String(props.label ?? "")}
    isSelected={Boolean(props.isSelected)}
    isDisabled={Boolean(props.isDisabled)}
    variant={VARIANTS.has(props.variant as string) ? (props.variant as any) : "default"}
    onChange={() => {}}
  >
    {childIds(props.children).map(buildChild)}
  </SelectableCard>
);
