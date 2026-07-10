/**
 * Catalog `Button` -> Astryx Button. `action` arrives pre-bound as a dispatch
 * function from the A2UI binder; clicking sends the declarative action back
 * through the protocol (in the studio: an AG-UI event to the agent).
 * `isIconOnly` is accepted by the catalog but ignored here until the catalog
 * carries an icon vocabulary (Astryx requires an icon for icon-only buttons).
 */
import type { FC } from "react";
import { Button } from "@astryxdesign/core/Button";

export const ButtonRender: FC<any> = ({ props }) => (
  <Button
    label={String(props.label ?? "")}
    variant={props.variant}
    size={props.size}
    isDisabled={props.isDisabled}
    tooltip={props.tooltip}
    onClick={() => props.action?.()}
  />
);
