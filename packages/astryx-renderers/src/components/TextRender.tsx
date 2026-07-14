/**
 * Catalog `Text` -> Astryx Text. The catalog's variant (h1/h2/h3/body/caption,
 * projected from the contract's semantic `type` prop) maps back onto Astryx's
 * `type` system; the table below is the inverse of the profile's valueMap, so
 * a surface's declared type round-trips to the same Astryx rendering.
 *
 * Text may also carry nested children (the contract's "arbitrary children"
 * composition, which generating models use routinely); they render after the
 * node's own text, inside the same Astryx Text element — matching how Astryx
 * Text nests natively.
 */
import type { FC } from "react";
import { Text } from "@astryxdesign/core/Text";
import { childIds } from "@dspack-studio/a2ui-ingest";

const VARIANT_TO_TYPE: Record<string, { type: any; as: any; weight?: any }> = {
  h1: { type: "display-2", as: "p", weight: "bold" },
  h2: { type: "display-3", as: "p", weight: "semibold" },
  h3: { type: "large", as: "p", weight: "semibold" },
  body: { type: "body", as: "p" },
  caption: { type: "supporting", as: "span" },
};

export const TextRender: FC<any> = ({ props, buildChild }) => {
  const m = VARIANT_TO_TYPE[props.variant as string] ?? VARIANT_TO_TYPE.body;
  const nested = childIds(props.children);
  // A container Text (nested children) must not render <p>: nested Text
  // children render their own <p>/<span>, and <p> cannot contain <p>.
  const as = nested.length > 0 ? "div" : m.as;
  return (
    <Text type={m.type} as={as} weight={m.weight} display="block">
      {props.text}
      {nested.map((id) => (
        <span key={id} style={{ display: "contents" }}>
          {buildChild(id)}
        </span>
      ))}
    </Text>
  );
};
