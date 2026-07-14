/**
 * Catalog `TextField` -> shadcn/ui Input + Label. Bound values write through
 * the binder-generated setter (optimistic-local, synced on action), exactly
 * as in the Astryx renderer — the data-model behavior belongs to the
 * protocol layer, not the design system.
 */
import { useId, useState, type FC } from "react";
import { cn } from "../cn";

export const TextFieldRender: FC<any> = ({ props }) => {
  const id = useId();
  const bound = typeof props.setValue === "function";
  const [local, setLocal] = useState(String(props.value ?? ""));
  return (
    <div className="grid w-full gap-1.5">
      {!props.isLabelHidden && (
        <label htmlFor={id} className="text-sm font-medium leading-none">
          {String(props.label ?? "")}
        </label>
      )}
      <input
        id={id}
        aria-label={props.isLabelHidden ? String(props.label ?? "") : undefined}
        type={props.variant === "obscured" ? "password" : "text"}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        )}
        value={bound ? String(props.value ?? "") : local}
        onChange={(e) => (bound ? props.setValue(e.target.value) : setLocal(e.target.value))}
        placeholder={props.placeholder}
        required={Boolean(props.isRequired)}
      />
      {props.description && <p className="text-sm text-muted-foreground">{String(props.description)}</p>}
    </div>
  );
};
