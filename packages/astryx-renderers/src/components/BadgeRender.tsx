/** Catalog `Badge` -> Astryx Badge. All fourteen variants carry verbatim. */
import type { FC } from "react";
import { Badge } from "@astryxdesign/core/Badge";

export const BadgeRender: FC<any> = ({ props }) => (
  <Badge label={String(props.label ?? "")} variant={props.variant} />
);
