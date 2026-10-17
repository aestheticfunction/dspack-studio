/**
 * Catalog `Text` -> Astryx Text. The catalog's variant (h1/h2/h3/body/caption,
 * projected from the contract's semantic `type` prop) maps back onto Astryx's
 * `type` system; the table below is the inverse of the profile's valueMap, so
 * a surface's declared type round-trips to the same Astryx rendering.
 *
 * A heading variant renders as a heading element (Astryx Text renders h1-h3
 * for display types that need heading semantics), so a surface's headings
 * reach assistive technology (WCAG 1.3.1, 2.4.6), and every variant breaks a
 * long unbroken word instead of overflowing at 320 px (1.4.10).
 *
 * Text may also carry nested children (the contract's "arbitrary children"
 * composition, which generating models use routinely); they render after the
 * node's own text, inside the same Astryx Text element — matching how Astryx
 * Text nests natively.
 */
import type { CSSProperties, FC } from "react";
import { Text } from "@astryxdesign/core/Text";
import { childIds } from "@dspack-studio/a2ui-ingest";

const VARIANT_TO_TYPE: Record<string, { type: any; as: "h1" | "h2" | "h3" | "p" | "span"; level?: number; weight?: any }> = {
  h1: { type: "display-2", as: "h1", level: 1, weight: "bold" },
  h2: { type: "display-3", as: "h2", level: 2, weight: "semibold" },
  h3: { type: "large", as: "h3", level: 3, weight: "semibold" },
  body: { type: "body", as: "p" },
  caption: { type: "supporting", as: "span" },
};

const WRAP: CSSProperties = { overflowWrap: "anywhere" };

export const TextRender: FC<any> = ({ props, buildChild }) => {
  const m = VARIANT_TO_TYPE[props.variant as string] ?? VARIANT_TO_TYPE.body;
  const nested = childIds(props.children);
  if (nested.length === 0) {
    return (
      <Text type={m.type} as={m.as} weight={m.weight} display="block" style={WRAP}>
        {props.text}
      </Text>
    );
  }
  // A container Text (nested children) renders a div: nested Text children
  // render their own <p>/<span>/heading, and neither a <p> nor a heading may
  // contain them. A heading's own text keeps its heading role.
  return (
    <Text type={m.type} as="div" weight={m.weight} display="block" style={WRAP}>
      {m.level && props.text ? (
        <span role="heading" aria-level={m.level}>
          {props.text}
        </span>
      ) : (
        props.text
      )}
      {nested.map((id) => (
        <span key={id} style={{ display: "contents" }}>
          {buildChild(id)}
        </span>
      ))}
    </Text>
  );
};
