/**
 * Catalog `TextField` -> Astryx TextInput. When the surface binds `value` to
 * a data-model path, the A2UI binder resolves the live value and generates a
 * `setValue` setter — typing writes straight into the shared data model
 * (optimistic by design: local immediately, synced to the agent on explicit
 * action, per the A2UI spec). Unbound fields fall back to local state.
 */
import { useState, type FC } from "react";
import { TextInput } from "@astryxdesign/core/TextInput";

export const TextFieldRender: FC<any> = ({ props }) => {
  const bound = typeof props.setValue === "function";
  const [local, setLocal] = useState(String(props.value ?? ""));
  return (
    <TextInput
      label={String(props.label ?? "")}
      value={bound ? String(props.value ?? "") : local}
      onChange={(v: string) => (bound ? props.setValue(v) : setLocal(v))}
      type={props.variant === "obscured" ? "password" : "text"}
      placeholder={props.placeholder}
      description={props.description}
      isLabelHidden={props.isLabelHidden}
      isRequired={props.isRequired}
      size={props.size}
    />
  );
};
