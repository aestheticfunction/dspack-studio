/**
 * Catalog `Table` -> Astryx Table. Two modes, mirroring Astryx's own API:
 *   - data-driven: `columns` (header labels) + `data` (rows of { cells,
 *     status? }); rows with a status get a trailing status column rendered as
 *     an Astryx Badge.
 *   - children: nested child component IDs (how generating models routinely
 *     express cells), arranged left-to-right, top-to-bottom into rows of one
 *     cell per column via Astryx's native TableRow/TableCell composition.
 */
import type { FC } from "react";
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table";
import { Badge } from "@astryxdesign/core/Badge";
import { childIds } from "../provenance";

interface Row {
  cells?: unknown[];
  status?: { label?: string; variant?: string };
}

export const TableRender: FC<any> = ({ props, buildChild }) => {
  const headers: string[] = Array.isArray(props.columns) ? props.columns.map(String) : [];
  const nested = childIds(props.children);

  if (nested.length > 0) {
    const width = Math.max(headers.length, 1);
    const bodyRows: string[][] = [];
    for (let i = 0; i < nested.length; i += width) bodyRows.push(nested.slice(i, i + width));
    return (
      <Table density={props.density} dividers={props.dividers} isStriped={props.isStriped}>
        {headers.length > 0 && (
          <TableHeader>
            <TableRow isHeaderRow>
              {headers.map((header, i) => (
                <TableHeaderCell key={i}>{header}</TableHeaderCell>
              ))}
            </TableRow>
          </TableHeader>
        )}
        <TableBody>
          {bodyRows.map((row, ri) => (
            <TableRow key={ri}>
              {row.map((id) => (
                <TableCell key={id}>{buildChild(id)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  const rows: Row[] = Array.isArray(props.data) ? props.data : [];
  const hasStatus = rows.some((r) => r?.status);

  const columns = headers.map((header, i) => ({ key: `c${i}`, header }));
  if (hasStatus) {
    columns.push({
      key: "status",
      header: "Status",
      renderCell: (item: Record<string, unknown>) => {
        const s = item.status as Row["status"];
        return s ? <Badge label={String(s.label ?? "")} variant={s.variant as any} /> : null;
      },
    } as any);
  }

  const data = rows.map((r, ri) => {
    const rec: Record<string, unknown> = { __id: ri, status: r?.status };
    (r?.cells ?? []).forEach((cell, i) => (rec[`c${i}`] = String(cell)));
    return rec;
  });

  return (
    <Table
      data={data}
      columns={columns as any}
      idKey="__id"
      density={props.density}
      dividers={props.dividers}
      isStriped={props.isStriped}
    />
  );
};
