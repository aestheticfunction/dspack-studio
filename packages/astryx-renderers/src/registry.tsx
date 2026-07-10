/**
 * The visual boundary: the one file that names catalog components, because it
 * supplies their Astryx visuals. Every component in the emitted Astryx A2UI
 * catalog maps to a real @astryxdesign/core component — nothing delegates to
 * the A2UI Basic Catalog visuals and nothing is unimplemented. Each renderer
 * is wrapped with provenance tagging (data-a2ui-id) for X-ray.
 */
import type { Registry } from "@dspack-studio/a2ui-ingest";
import { withProvenance } from "./provenance";
import { TextRender } from "./components/TextRender";
import { ButtonRender } from "./components/ButtonRender";
import { CardRender } from "./components/CardRender";
import { TextFieldRender } from "./components/TextFieldRender";
import { BadgeRender } from "./components/BadgeRender";
import { TableRender } from "./components/TableRender";
import { AlertDialogRender } from "./components/AlertDialogRender";
import { DialogRender } from "./components/DialogRender";
import { ColumnRender } from "./components/ColumnRender";

const renders = {
  Text: TextRender,
  Button: ButtonRender,
  Card: CardRender,
  TextField: TextFieldRender,
  Badge: BadgeRender,
  Table: TableRender,
  AlertDialog: AlertDialogRender,
  Dialog: DialogRender,
  Column: ColumnRender,
};

export const astryxRegistry: Registry = {
  reuseBasic: new Set(),
  custom: Object.fromEntries(
    Object.entries(renders).map(([name, render]) => [name, withProvenance(name, render)]),
  ),
};
