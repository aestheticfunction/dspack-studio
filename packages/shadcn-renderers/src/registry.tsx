/**
 * The second visual boundary (FM-10): catalog names -> shadcn/ui visuals,
 * each wrapped with the same data-a2ui-id provenance tagging as the Astryx
 * registry, so X-ray works identically under either design system.
 *
 * Coverage is now 12 of the catalog's 12 names. `Dialog` was the last
 * placeholder — the incremental-adoption mechanism docs/renderer-abstraction.md
 * names — and is now a real shadcn visual (DialogRender), closing the one
 * measured production renderer gap. The placeholder mechanism itself stays
 * exercised by the parity suite, which proves the complement is now empty.
 */
import type { Registry } from "@dspack-studio/a2ui-ingest";
import { withProvenance } from "@dspack-studio/a2ui-ingest";
import { TextRender } from "./components/TextRender";
import { ButtonRender } from "./components/ButtonRender";
import { CardRender } from "./components/CardRender";
import { TextFieldRender } from "./components/TextFieldRender";
import { BadgeRender } from "./components/BadgeRender";
import { TableRender } from "./components/TableRender";
import { AlertDialogRender } from "./components/AlertDialogRender";
import { ColumnRender } from "./components/ColumnRender";
import { ListRender } from "./components/ListRender";
import { SelectableCardRender } from "./components/SelectableCardRender";
import { MetadataListRender } from "./components/MetadataListRender";
import { DialogRender } from "./components/DialogRender";

const renders = {
  Text: TextRender,
  Button: ButtonRender,
  Card: CardRender,
  TextField: TextFieldRender,
  Badge: BadgeRender,
  Table: TableRender,
  AlertDialog: AlertDialogRender,
  Column: ColumnRender,
  List: ListRender,
  SelectableCard: SelectableCardRender,
  MetadataList: MetadataListRender,
  Dialog: DialogRender,
};

export const shadcnRegistry: Registry = {
  reuseBasic: new Set(),
  custom: Object.fromEntries(
    Object.entries(renders).map(([name, render]) => [name, withProvenance(name, render)]),
  ),
};
