/**
 * Catalog `Select` -> shadcn/ui Select. Rendered as a styled native <select>
 * (the trigger's border/height/type-scale match shadcn's Select trigger): a
 * faithful, dependency-free rendering that stays fully functional in the
 * preview without pulling Radix. The bound value writes through the
 * binder-generated setter, exactly as TextField does — the data-model behavior
 * belongs to the protocol layer, not the design system.
 */
import { useId, useState, type FC } from "react";
import { cn } from "../cn";

export const SelectRender: FC<any> = ({ props }) => {
  const id = useId();
  const options: Array<{ label?: string }> = Array.isArray(props.options) ? props.options : [];
  const bound = typeof props.setValue === "function";
  const initial = String(props.value ?? props.defaultValue ?? "");
  const [local, setLocal] = useState(initial);
  const value = bound ? String(props.value ?? props.defaultValue ?? "") : local;
  return (
    <div className="grid w-full gap-1.5">
      {props.label != null && !props.isLabelHidden && (
        <label htmlFor={id} className="text-sm font-medium leading-none">
          {String(props.label)}
        </label>
      )}
      <select
        id={id}
        aria-label={props.isLabelHidden ? String(props.label ?? "") : undefined}
        className={cn(
          "flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        )}
        value={value}
        onChange={(e) => (bound ? props.setValue(e.target.value) : setLocal(e.target.value))}
        required={Boolean(props.isRequired)}
      >
        {value === "" && <option value="" disabled hidden>{String(props.placeholder ?? "Select…")}</option>}
        {options.map((o, i) => (
          <option key={i} value={String(o.label ?? "")}>
            {String(o.label ?? "")}
          </option>
        ))}
      </select>
    </div>
  );
};
