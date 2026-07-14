/**
 * Catalog `Table` -> shadcn/ui Table markup. Both modes of the catalog shape
 * (data-driven columns/data and nested children) render, mirroring the
 * Astryx renderer's chunking of flat children into rows of one cell per
 * column; rows with a status get a trailing Badge cell.
 */
import type { FC } from "react";
import { childIds } from "@dspack-studio/a2ui-ingest";
import { BadgeRender } from "./BadgeRender";
import { cn } from "../cn";

interface Row {
  cells?: unknown[];
  status?: { label?: string; variant?: string };
}

const TH = "h-10 px-2 text-left align-middle text-sm font-medium text-muted-foreground";
const TD = "p-2 align-middle text-sm";
const TR = "border-b transition-colors hover:bg-muted/50";

export const TableRender: FC<any> = ({ props, buildChild }) => {
  const headers: string[] = Array.isArray(props.columns) ? props.columns.map(String) : [];
  const nested = childIds(props.children);

  let bodyRows: Array<Array<React.ReactNode>>;
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
      const cells: React.ReactNode[] = (r.cells ?? []).map((c) => String(c));
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
            <tr className={TR}>
              {headers.map((h, i) => (
                <th key={i} scope="col" className={TH}>{h}</th>
              ))}
              {anyStatus && <th scope="col" className={TH}>Status</th>}
            </tr>
          </thead>
        )}
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={ri} className={cn(TR, "last:border-0")}>
              {row.map((cell, ci) => (
                <td key={ci} className={TD}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
