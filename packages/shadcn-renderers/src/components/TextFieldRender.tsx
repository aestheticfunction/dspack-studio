/**
 * Catalog `TextField` -> shadcn/ui Input + Label. Bound values write through
 * the binder-generated setter (optimistic-local, synced on action), exactly
 * as in the Astryx renderer — the data-model behavior belongs to the
 * protocol layer, not the design system.
 *
 * `size` is carried verbatim by the contract and projected onto shadcn's
 * input height/type-scale steps; dropping it would render a compact field at
 * the same height as a large one.
 */
import { useId, useState, type FC } from "react";
import { cn } from "../cn";

/** Field size -> shadcn's input scale. Catalog default: md. */
const SIZE: Record<string, { input: string; label: string }> = {
  sm: { input: "h-8 px-2 py-1 text-xs", label: "text-xs" },
  md: { input: "h-9 px-3 py-1 text-sm", label: "text-sm" },
  lg: { input: "h-10 px-4 py-2 text-base", label: "text-base" },
};

export const TextFieldRender: FC<any> = ({ props }) => {
  const id = useId();
  const bound = typeof props.setValue === "function";
  const [local, setLocal] = useState(String(props.value ?? ""));
  const size = SIZE[props.size as string] ?? SIZE.md;
  return (
    <div className="grid w-full gap-1.5">
      {!props.isLabelHidden && (
        <label htmlFor={id} className={cn("font-medium leading-none", size.label)}>
          {String(props.label ?? "")}
        </label>
      )}
      <input
        id={id}
        aria-label={props.isLabelHidden ? String(props.label ?? "") : undefined}
        type={props.variant === "obscured" ? "password" : "text"}
        className={cn(
          "flex w-full rounded-md border border-input bg-transparent shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          size.input,
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
