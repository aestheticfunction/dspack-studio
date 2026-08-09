/**
 * Catalog `Alert` -> shadcn/ui Alert. A bordered callout with a title and an
 * optional description; the `destructive` variant carries the destructive
 * foreground/border, exactly as shadcn's Alert does. Static by construction
 * (no actions, no bound value) — it reports a condition the user needs to know.
 */
import { type FC } from "react";
import { cn } from "../cn";

export const AlertRender: FC<any> = ({ props }) => {
  const destructive = props.variant === "destructive";
  return (
    <div
      role="alert"
      className={cn(
        "relative w-full rounded-lg border px-4 py-3 text-sm",
        destructive ? "border-destructive/50 text-destructive" : "border-border text-foreground",
      )}
    >
      {props.title != null && (
        <h5 className="mb-1 font-medium leading-none tracking-tight">{String(props.title)}</h5>
      )}
      {props.description != null && (
        <div className={cn("text-sm leading-relaxed", destructive ? "opacity-90" : "text-muted-foreground")}>
          {String(props.description)}
        </div>
      )}
    </div>
  );
};
