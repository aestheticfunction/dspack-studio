/**
 * Catalog `Table` -> shadcn/ui Table markup. Both modes of the catalog shape
 * (data-driven columns/data and nested children) render, mirroring the
 * Astryx renderer's chunking of flat children into rows of one cell per
 * column; rows with a status get a trailing Badge cell.
 *
 * The presentation props the contract carries — `density`, `dividers`,
 * `isStriped` — are projected onto shadcn's table utilities rather than
 * dropped: a table emitted as compact-and-striped must read as compact and
 * striped here, or the emitted surface is being misrepresented.
 */
import type { FC, ReactNode } from "react";
import { childIds } from "@dspack-studio/a2ui-ingest";
import { BadgeRender } from "./BadgeRender";
import { cn } from "../cn";

interface Row {
  cells?: unknown[];
  status?: { label?: string; variant?: string };
}

/** Row density -> shadcn's header/cell spacing steps. Catalog default: balanced. */
const DENSITY: Record<string, { head: string; cell: string }> = {
  compact: { head: "h-8 px-2 py-0.5", cell: "px-2 py-0.5" },
  balanced: { head: "h-10 px-2 py-2", cell: "px-2 py-2" },
  spacious: { head: "h-12 px-4 py-4", cell: "px-4 py-4" },
};

/**
 * Divider style -> the borders shadcn's table draws. Catalog default: rows.
 * `rows` divides horizontally, `columns` vertically, `grid` both, `none`
 * neither — four values, four distinct treatments.
 */
const ROW_DIVIDER: Record<string, string> = {
  rows: "border-b",
  columns: "",
  grid: "border-b",
  none: "",
};
const CELL_DIVIDER: Record<string, string> = {
  rows: "",
  columns: "border-r last:border-r-0",
  grid: "border-r last:border-r-0",
  none: "",
};

const HEAD = "text-left align-middle text-sm font-medium text-muted-foreground";
const CELL = "align-middle text-sm";

export const TableRender: FC<any> = ({ props, buildChild }) => {
  const headers: string[] = Array.isArray(props.columns) ? props.columns.map(String) : [];
  const nested = childIds(props.children);

  const density = DENSITY[props.density as string] ?? DENSITY.balanced;
  const dividers = (props.dividers as string) in ROW_DIVIDER ? (props.dividers as string) : "rows";
  const rowDivider = ROW_DIVIDER[dividers];
  const cellDivider = CELL_DIVIDER[dividers];
  const striped = Boolean(props.isStriped);

  let bodyRows: Array<Array<ReactNode>>;
  let anyStatus = false;
  if (nested.length > 0) {
    const width = Math.max(headers.length, 1);
    bodyRows = [];
    for (let i = 0; i < nested.length; i += width) {
      bodyRows.push(nested.slice(i, i + width).map((id) => buildChild(id)));
    }
  } else {
    const rows: Row[] = Array.isArray(props.data) ? props.data : [];
    anyStatus = rows.some((r) => r.status);
    bodyRows = rows.map((r) => {
      const cells: ReactNode[] = (r.cells ?? []).map((c) => String(c));
      if (anyStatus) {
        cells.push(r.status ? <BadgeRender props={{ label: r.status.label, variant: r.status.variant }} /> : null);
      }
      return cells;
    });
  }

  return (
    <div className="w-full overflow-auto rounded-md border">
      <table className="w-full caption-bottom text-sm">
        {headers.length > 0 && (
          <thead className="border-b">
            <tr className="transition-colors">
              {headers.map((h, i) => (
                <th key={i} scope="col" className={cn(HEAD, density.head, cellDivider)}>{h}</th>
              ))}
              {anyStatus && <th scope="col" className={cn(HEAD, density.head, cellDivider)}>Status</th>}
            </tr>
          </thead>
        )}
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr
              key={ri}
              className={cn(
                "transition-colors hover:bg-muted/50",
                rowDivider,
                "last:border-b-0",
                striped && "odd:bg-muted/40",
              )}
            >
              {row.map((cell, ci) => (
                <td key={ci} className={cn(CELL, density.cell, cellDivider)}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
