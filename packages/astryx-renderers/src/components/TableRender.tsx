/**
 * Catalog `Table` -> Astryx Table (data-driven mode). The catalog carries
 * `columns` (header labels) and `data` (rows of { cells, status? }); rows with
 * a status get a trailing status column rendered as an Astryx Badge.
 */
import type { FC } from "react";
import { Table } from "@astryxdesign/core/Table";
import { Badge } from "@astryxdesign/core/Badge";

interface Row {
  cells?: unknown[];
  status?: { label?: string; variant?: string };
}

export const TableRender: FC<any> = ({ props }) => {
  const headers: string[] = Array.isArray(props.columns) ? props.columns.map(String) : [];
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
