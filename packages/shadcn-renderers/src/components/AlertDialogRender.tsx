/**
 * Catalog `AlertDialog` -> shadcn/ui AlertDialog content, rendered INLINE
 * for the same reason the Astryx renderer does: on the studio canvas the
 * governed content — title, consequence description, specific action label —
 * is visible evidence, not hidden behind a modal. The markup and classes are
 * shadcn's alert-dialog content; the portal/overlay behavior is deliberately
 * not used, so no Radix dependency enters the bundle.
 *
 * TWO CATALOGS, TWO NAMES FOR THE CONFIRM — and one extra part. The
 * Astryx/neutral catalog names the confirm action `actionLabel` (required)
 * and stops at the panel. shadcn/ui v3 names it `confirmLabel` and also
 * declares `triggerLabel` (REQUIRED) — shadcn's AlertDialog is Trigger +
 * Content, and the trigger is what tells a reader what the dialog is FOR.
 * Reading only `actionLabel` left every shadcn/ui v3 confirmation with a blank
 * confirm button and no opener at all: "Delete project and all data" and
 * "Delete project" both vanished from the flagship destructive surface. The
 * trigger renders only when the catalog declares one, so the neutral catalog's
 * panel-only rendering is unchanged.
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
    // The catalog's declared default for `actionVariant` is `primary`, and
    // A2UI's binder never applies the schema default — an omitted variant
    // arrives as undefined. Defaulting to `destructive` here dressed every
    // ungoverned confirmation as dangerous, which is the opposite failure to
    // a destructive action that renders as an ordinary button.
    defaultVariants: { variant: "primary" },
  },
);

export const AlertDialogRender: FC<any> = ({ props }) => {
  const titleId = useId();
  const descriptionId = useId();
  const panelId = useId();
  // shadcn/ui v3 names the confirm action `confirmLabel`; the neutral catalog
  // names it `actionLabel`. An instance carries exactly one.
  const confirmLabel = props.confirmLabel ?? props.actionLabel;
  const hasTrigger = props.triggerLabel != null;
  // A Fragment, not a wrapper: a catalog without `triggerLabel` (the neutral
  // one) must render the panel exactly as it did before this renderer learned
  // about triggers — same element, same attributes, no new box.
  return (
  <>
  {hasTrigger && (
    <button
      type="button"
      className="mb-3 inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-haspopup="dialog"
      aria-controls={panelId}
    >
      {String(props.triggerLabel)}
    </button>
  )}
  <div
    id={hasTrigger ? panelId : undefined}
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
        className={cn(actionVariants({ variant: (props.actionVariant as any) ?? "primary" }))}
        onClick={() => props.action?.()}
      >
        {String(confirmLabel ?? "")}
      </button>
    </div>
  </div>
  </>
  );
};
