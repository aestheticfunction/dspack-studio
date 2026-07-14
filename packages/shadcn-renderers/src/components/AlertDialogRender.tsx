/**
 * Catalog `AlertDialog` -> shadcn/ui AlertDialog content, rendered INLINE
 * for the same reason the Astryx renderer does: on the studio canvas the
 * governed content — title, consequence description, specific action label —
 * is visible evidence, not hidden behind a modal. The markup and classes are
 * shadcn's alert-dialog content; the portal/overlay behavior is deliberately
 * not used, so no Radix dependency enters the bundle.
 */
import { useId, type FC } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../cn";

const actionVariants = cva(
  "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
      },
    },
    defaultVariants: { variant: "destructive" },
  },
);

export const AlertDialogRender: FC<any> = ({ props }) => {
  const titleId = useId();
  const descriptionId = useId();
  return (
  <div
    role="alertdialog"
    aria-modal="false"
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
    className="max-w-lg space-y-2 rounded-lg border bg-background p-6 shadow-lg"
  >
    <h2 id={titleId} className="text-lg font-semibold">{String(props.title ?? "")}</h2>
    <p id={descriptionId} className="text-sm text-muted-foreground">{String(props.description ?? "")}</p>
    <div className="flex justify-end gap-2 pt-2">
      {props.cancelLabel && (
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {String(props.cancelLabel)}
        </button>
      )}
      <button
        type="button"
        className={cn(actionVariants({ variant: (props.actionVariant as any) ?? "destructive" }))}
        onClick={() => props.action?.()}
      >
        {String(props.actionLabel ?? "")}
      </button>
    </div>
  </div>
  );
};
