/**
 * Catalog `Dialog` -> shadcn/ui Dialog content, rendered INLINE for the same
 * reason AlertDialogRender is: on the studio canvas the governed content is
 * visible evidence, not hidden behind a portal. The markup and classes are
 * shadcn's dialog-content idiom; the portal/overlay behavior is deliberately
 * not used, so no Radix dependency enters the bundle.
 *
 * This completes the shadcn registry to 12 of 12 catalog names — the
 * incremental-adoption placeholder docs/renderer-abstraction.md named is now
 * exercised as a real visual rather than the unimplemented fallback.
 *
 * `variant` (standard | fullscreen) widens the surface; `purpose`
 * (required | form | info) is carried as a data attribute for styling hooks
 * and assistive context without inventing chrome the catalog does not model.
 */
import { useId, type FC } from "react";
import { cn } from "../cn";

export const DialogRender: FC<any> = ({ props, buildChild }) => {
  const titleId = useId();
  const fullscreen = props.variant === "fullscreen";
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={props.title ? titleId : undefined}
      data-purpose={props.purpose ?? undefined}
      className={cn(
        "flex flex-col gap-4 rounded-lg border bg-background p-6 shadow-lg",
        fullscreen ? "w-full" : "max-w-lg",
      )}
    >
      {props.title && (
        <div className="flex flex-col gap-1.5">
          <h2 id={titleId} className="text-lg font-semibold leading-none tracking-tight">
            {String(props.title)}
          </h2>
        </div>
      )}
      {props.child ? buildChild(props.child) : null}
    </div>
  );
};
