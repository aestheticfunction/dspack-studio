/**
 * Catalog `AlertDialog` -> Astryx AlertDialog. The Astryx contract's
 * props-based idiom has no trigger sub-component; on the studio canvas the
 * confirmation renders inline (Astryx's `isInline`) so the governed content —
 * title, consequence description, specific action label — is visible evidence
 * rather than hidden behind a modal. Confirming dispatches the declarative
 * action back through the protocol. Modal behavior driven by the shared data
 * model arrives with the agent loop (Phase 2).
 */
import type { FC } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";

export const AlertDialogRender: FC<any> = ({ props }) => (
  <AlertDialog
    isInline
    isOpen
    onOpenChange={() => {}}
    title={String(props.title ?? "")}
    description={String(props.description ?? "")}
    actionLabel={String(props.actionLabel ?? "")}
    cancelLabel={props.cancelLabel}
    actionVariant={props.actionVariant}
    onAction={() => props.action?.()}
  />
);
