/**
 * The second visual boundary (FM-10): catalog names -> shadcn/ui visuals,
 * each wrapped with the same data-a2ui-id provenance tagging as the Astryx
 * registry, so X-ray works identically under either design system.
 *
 * Coverage is deliberately 8 of the catalog's 9 names: `Dialog` has no
 * visual here and renders the a2ui-ingest `unimplemented` placeholder —
 * the incremental-adoption mechanism docs/renderer-abstraction.md names as
 * the intended migration path, exercised in production rather than claimed.
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

const renders = {
  Text: TextRender,
  Button: ButtonRender,
  Card: CardRender,
  TextField: TextFieldRender,
  Badge: BadgeRender,
  Table: TableRender,
  AlertDialog: AlertDialogRender,
  Column: ColumnRender,
  // Dialog: deliberately absent — renders the visible unimplemented
  // placeholder (legal vocabulary, missing pixels; the run is unaffected).
};

export const shadcnRegistry: Registry = {
  reuseBasic: new Set(),
  custom: Object.fromEntries(
    Object.entries(renders).map(([name, render]) => [name, withProvenance(name, render)]),
  ),
};
