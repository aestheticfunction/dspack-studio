/**
 * Catalog `SelectableCard` -> shadcn/ui-style selectable card: a bordered
 * card whose selected state renders as the primary accent ring (shadcn has
 * no SelectableCard primitive; this is the idiomatic ring treatment).
 * Presentational in replay — selection state is delivered, not clicked.
 *
 * `variant` carries the same surface vocabulary as Card and is projected
 * through the shared table, so an emitted `blue` option reads as blue here
 * exactly as it does under Astryx.
 */
import type { FC } from "react";
import { childIds } from "@dspack-studio/a2ui-ingest";
import { cn } from "../cn";
import { surfaceVariant } from "../surface-variants";

export const SelectableCardRender: FC<any> = ({ props, buildChild }) => {
  const selected = Boolean(props.isSelected);
  const ids = childIds(props.children);
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-disabled={Boolean(props.isDisabled) || undefined}
      className={cn(
        "rounded-xl border border-border text-card-foreground p-4 shadow-sm",
        // The variant's tint (including its border color) lands before the
        // selection ring, so selection always wins the border.
        surfaceVariant(props.variant),
        selected && "border-primary ring-2 ring-primary",
        props.isDisabled && "opacity-50",
      )}
    >
      <div className="font-semibold mb-2 flex items-center justify-between">
        {String(props.label ?? "")}
        {selected && <span className="text-primary text-xs font-medium">selected</span>}
      </div>
      <div className="flex flex-col gap-2">{ids.map((id) => buildChild(id))}</div>
    </div>
  );
};
