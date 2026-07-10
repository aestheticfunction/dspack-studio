/**
 * Catalog `Dialog` -> Astryx Dialog, rendered inline on the canvas (same
 * rationale as AlertDialog). `variant` and `purpose` carry verbatim.
 */
import type { FC } from "react";
import { Dialog } from "@astryxdesign/core/Dialog";
import { Text } from "@astryxdesign/core/Text";

export const DialogRender: FC<any> = ({ props, buildChild }) => (
  <Dialog
    isInline
    isOpen
    onOpenChange={() => {}}
    variant={props.variant}
    purpose={props.purpose}
  >
    {props.title ? (
      <Text type="large" weight="semibold" as="p" display="block">
        {String(props.title)}
      </Text>
    ) : null}
    {props.child ? buildChild(props.child) : null}
  </Dialog>
);
