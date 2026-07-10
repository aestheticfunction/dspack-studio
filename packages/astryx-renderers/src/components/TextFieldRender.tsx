/**
 * Catalog `TextField` -> Astryx TextInput. Astryx requires a controlled value;
 * until the shared-data-model work lands (Phase 2), the value is local state
 * seeded from the surface's bound `value`.
 */
import { useState, type FC } from "react";
import { TextInput } from "@astryxdesign/core/TextInput";

export const TextFieldRender: FC<any> = ({ props }) => {
  const [value, setValue] = useState(String(props.value ?? ""));
  return (
    <TextInput
      label={String(props.label ?? "")}
      value={value}
      onChange={(v: string) => setValue(v)}
      type={props.variant === "obscured" ? "password" : "text"}
      placeholder={props.placeholder}
      description={props.description}
      isLabelHidden={props.isLabelHidden}
      isRequired={props.isRequired}
      size={props.size}
    />
  );
};
