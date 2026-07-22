/**
 * Catalog `List` -> Astryx List. The contract's List takes arbitrary
 * children (for a comparison, SelectableCards); density and dividers carry
 * verbatim.
 */
import type { FC } from "react";
import { List } from "@astryxdesign/core/List";
import { childIds } from "@dspack-studio/a2ui-ingest";

export const ListRender: FC<any> = ({ props, buildChild }) => (
  <List density={props.density} hasDividers={Boolean(props.hasDividers)}>
    {childIds(props.children).map(buildChild)}
  </List>
);
