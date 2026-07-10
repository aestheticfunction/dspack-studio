/**
 * Catalog `Text` -> Astryx Text. The catalog's variant (h1/h2/h3/body/caption,
 * projected from the contract's `as` prop) maps onto Astryx's semantic `type`
 * system: Astryx renders headings via `type`, not via the `as` element
 * (a v0.1.2 -> v0.1.4 drift the drift check reports upstream).
 */
import type { FC } from "react";
import { Text } from "@astryxdesign/core/Text";

const VARIANT_TO_TYPE: Record<string, { type: any; as: any; weight?: any }> = {
  h1: { type: "display-2", as: "p", weight: "bold" },
  h2: { type: "display-3", as: "p", weight: "semibold" },
  h3: { type: "large", as: "p", weight: "semibold" },
  body: { type: "body", as: "p" },
  caption: { type: "supporting", as: "span" },
};

export const TextRender: FC<any> = ({ props }) => {
  const m = VARIANT_TO_TYPE[props.variant as string] ?? VARIANT_TO_TYPE.body;
  return (
    <Text type={m.type} as={m.as} weight={m.weight} display="block">
      {props.text}
    </Text>
  );
};
