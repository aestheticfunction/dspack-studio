/**
 * Catalog `Table` -> Astryx Table. Two modes, mirroring Astryx's own API:
 *   - data-driven: `columns` (header labels) + `data` (rows of { cells,
 *     status? }); rows with a status get a trailing status column rendered as
 *     an Astryx Badge.
 *   - children: nested child component IDs (how generating models routinely
 *     express cells), arranged left-to-right, top-to-bottom into rows of one
 *     cell per column via Astryx's native TableRow/TableCell composition.
 *
 * Accessibility (WCAG 2.2 AA): Astryx names every table's keyboard-scrollable
 * region "Table"; here the region is named by its columns, so two tables on
 * one surface are told apart (2.4.6, 4.1.2). Astryx header cells always
 * truncate with an ellipsis; here header text wraps, so no heading is cut
 * off at 200% zoom or 320 px (1.4.4, 1.4.10). Body cells already wrap. A
 * data column gets a minimum width, as Astryx advises (proportional widths
 * with a floor), so a table narrower than its columns scrolls inside its
 * focusable region, the reflow exception for two-dimensional content,
 * instead of crushing each column below a letter's width at 320 px.
 */
import { useMemo, type CSSProperties, type FC } from "react";
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, proportional } from "@astryxdesign/core/Table";
import { Badge } from "@astryxdesign/core/Badge";
import { childIds } from "@dspack-studio/a2ui-ingest";
import { BADGE_WRAP } from "./BadgeRender";

interface Row {
  cells?: unknown[];
  status?: { label?: string; variant?: string };
}

const HEADER_WRAP: CSSProperties = { whiteSpace: "normal", overflow: "visible", textOverflow: "clip", overflowWrap: "anywhere" };
/** Eight columns of this still fit the composer's canvas at 1280 px. */
const COLUMN_FLOOR = 96;

/** Names the scroll region by the table's columns, and wraps header text. */
function accessibleTable(headers: string[]) {
  return {
    transformScrollWrapper: (p: any) => (headers.length > 0 ? { ...p, htmlProps: { ...p.htmlProps, "aria-label": `Table: ${headers.join(", ")}` } } : p),
    transformHeaderCell: (p: any) => ({ ...p, htmlProps: { ...p.htmlProps, style: { ...p.htmlProps?.style, ...HEADER_WRAP } } }),
  };
}

export const TableRender: FC<any> = ({ props, buildChild }) => {
  const headers: string[] = Array.isArray(props.columns) ? props.columns.map(String) : [];
  const nested = childIds(props.children);
  const rows: Row[] = Array.isArray(props.data) ? props.data : [];
  const hasStatus = nested.length === 0 && rows.some((r) => r?.status);
  // Astryx caches table plugins by reference: one per set of column names.
  const names = hasStatus ? [...headers, "Status"] : headers;
  const key = names.join("\u0000");
  const plugins = useMemo(() => ({ accessible: accessibleTable(names) }), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (nested.length > 0) {
    const width = Math.max(headers.length, 1);
    const bodyRows: string[][] = [];
    for (let i = 0; i < nested.length; i += width) bodyRows.push(nested.slice(i, i + width));
    return (
      <Table density={props.density} dividers={props.dividers} isStriped={props.isStriped} plugins={plugins}>
        {headers.length > 0 && (
          <TableHeader>
            <TableRow isHeaderRow>
              {headers.map((header, i) => (
                <TableHeaderCell key={i} style={HEADER_WRAP}>
                  {header}
                </TableHeaderCell>
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

  const columnWidth = proportional(1, { minWidth: COLUMN_FLOOR });
  const columns = headers.map((header, i) => ({ key: `c${i}`, header, width: columnWidth }));
  if (hasStatus) {
    columns.push({
      key: "status",
      header: "Status",
      width: columnWidth,
      renderCell: (item: Record<string, unknown>) => {
        const s = item.status as Row["status"];
        return s ? <Badge label={String(s.label ?? "")} variant={s.variant as any} style={BADGE_WRAP} /> : null;
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
      plugins={plugins}
    />
  );
};
