/**
 * Catalog `List` -> Astryx List. The contract's List takes arbitrary
 * children (for a comparison, SelectableCards); density and dividers carry
 * verbatim.
 *
 * List semantics. Astryx's List renders a `<ul role="list">` and expects its
 * own ListItem children. The contract's List holds arbitrary components
 * instead, which left the list with no list items (axe
 * aria-required-children; docs/blocks/ACCESSIBILITY.md, "Outside the
 * blocks"). Each child gets a list item of its own here, with no marker,
 * margin or padding, so the layout Astryx gives the list (a flex column with
 * its density gap) applies to the items exactly as it did to the children.
 * Astryx itself is unchanged.
 */
import type { CSSProperties, FC } from "react";
import { List } from "@astryxdesign/core/List";
import { childIds } from "@dspack-studio/a2ui-ingest";

const ITEM: CSSProperties = { listStyle: "none", margin: 0, padding: 0, minWidth: 0 };

export const ListRender: FC<any> = ({ props, buildChild }) => (
  <List density={props.density} hasDividers={Boolean(props.hasDividers)}>
    {childIds(props.children).map((id) => (
      <li key={id} style={ITEM}>
        {buildChild(id)}
      </li>
    ))}
  </List>
);
