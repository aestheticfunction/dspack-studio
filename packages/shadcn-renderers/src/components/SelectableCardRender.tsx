/**
 * Catalog `SelectableCard` -> shadcn/ui-style selectable card: a bordered
 * card whose selected state renders as the primary accent ring (shadcn has
 * no SelectableCard primitive; this is the idiomatic ring treatment).
 * Presentational in replay — selection state is delivered, not clicked.
 */
import type { FC } from "react";
import { childIds } from "@dspack-studio/a2ui-ingest";
import { cn } from "../cn";

export const SelectableCardRender: FC<any> = ({ props, buildChild }) => {
  const selected = Boolean(props.isSelected);
  const ids = childIds(props.children);
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-disabled={Boolean(props.isDisabled) || undefined}
      className={cn(
        "rounded-xl border bg-card text-card-foreground p-4 shadow-sm",
        selected ? "border-primary ring-2 ring-primary" : "border-border",
        props.isDisabled && "opacity-50",
      )}
    >
      <div className="font-semibold mb-2 flex items-center justify-between">
        {String(props.label ?? "")}
        {selected && <span className="text-primary text-xs font-medium">selected</span>}
      </div>
      <div className="flex flex-col gap-2">{ids.map(buildChild)}</div>
    </div>
  );
};
