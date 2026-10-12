/**
 * The add and remove check (live/operation.ts): an add must lengthen a list in the surface and shorten none, a remove
 * the reverse, judged from the prior and the refined surface alone, so every arm is scored the same way.
 */
import { describe, expect, it } from "vitest";
import { checkOperation, listLengths, missed, performed } from "./operation";

type Json = Record<string, any>;

/** A shadcn table: rows are table-row children of the table body, each with its cells. */
const shadcn = (rows: string[][], footer: string[] = ["New record", "Export"]): Json => ({
  dspackSurface: "0.1",
  root: {
    component: "card",
    id: "c",
    children: [
      { component: "card-header", id: "h", children: [{ component: "card-title", id: "t", text: "Support queue" }] },
      {
        component: "card-content",
        id: "b",
        children: [
          {
            component: "table",
            id: "tbl",
            children: [
              { component: "table-body", id: "tb", children: rows.map((cells, i) => ({ component: "table-row", id: `r${i}`, children: cells.map((text, j) => ({ component: "table-cell", id: `r${i}c${j}`, text })) })) },
            ],
          },
        ],
      },
      { component: "card-footer", id: "f", children: footer.map((text, i) => ({ component: "button", id: `b${i}`, text })) },
    ],
  },
});

/** An Astryx table: rows are entries of the table's data prop. */
const astryx = (rows: string[][], buttons = 1): Json => ({
  dspackSurface: "0.1",
  root: {
    component: "card",
    id: "c",
    children: [
      { component: "text", id: "t", text: "Open support tickets" },
      { component: "table", id: "tbl", props: { columns: ["Ticket", "Subject"], data: rows.map((cells) => ({ cells })) } },
      ...Array.from({ length: buttons }, (_, i) => ({ component: "button", id: `b${i}`, props: { label: `Action ${i}` } })),
    ],
  },
});

const rows = [
  ["#1", "One"],
  ["#2", "Two"],
  ["#3", "Three"],
];

describe("the lists of a surface", () => {
  it("are keyed by the owning component and the path to the list, summed over nodes, for children and for arrays in props", () => {
    expect(Object.fromEntries(listLengths(shadcn(rows)))).toMatchObject({ "card.children": 3, "table-body.children": 3, "table-row.children": 6, "card-footer.children": 2 });
    expect(Object.fromEntries(listLengths(astryx(rows)))).toMatchObject({ "card.children": 3, "table.props.columns": 2, "table.props.data": 3, "table.props.data.cells": 6 });
  });
});

describe("an add or a remove, judged by the direction of the change", () => {
  it("an added row is an add on either design system, and a removed row a remove", () => {
    const four = [...rows, ["#9001", "Password reset loop"]];
    expect(checkOperation("add", shadcn(rows), shadcn(four))).toEqual({ requested: "add", observed: "add", deltas: { "table-body.children": 1, "table-row.children": 2 } });
    expect(checkOperation("add", astryx(rows), astryx(four))).toEqual({ requested: "add", observed: "add", deltas: { "table.props.data": 1, "table.props.data.cells": 2 } });
    expect(checkOperation("remove", astryx(rows), astryx(rows.slice(0, 2)))).toMatchObject({ observed: "remove", deltas: { "table.props.data": -1, "table.props.data.cells": -2 } });
    expect(performed(checkOperation("remove", shadcn(rows), shadcn(rows.slice(0, 2))))).toBe(true);
  });

  it("a surface that only rewrote text, or did not change at all, changed no list: the operation was missed although the gates may pass", () => {
    const renamed = shadcn(rows);
    renamed.root.children[0].children[0].text = "Support queue (refined)";
    for (const after of [renamed, shadcn(rows)]) {
      const check = checkOperation("add", shadcn(rows), after);
      expect(check).toEqual({ requested: "add", observed: "none", deltas: {} });
      expect(performed(check)).toBe(false);
      expect(missed(check)).toBe(true);
    }
  });

  it("the opposite operation is a miss, and lists changed both ways are mixed: neither performed nor clearly missed", () => {
    const opposite = checkOperation("add", astryx(rows), astryx(rows.slice(0, 2)));
    expect(opposite.observed).toBe("remove");
    expect([performed(opposite), missed(opposite)]).toEqual([false, true]);
    // The row was added, but a footer button went with it.
    const mixed = checkOperation("add", shadcn(rows), shadcn([...rows, ["#4", "Four"]], ["New record"]));
    expect(mixed).toMatchObject({ observed: "mixed", deltas: { "card-footer.children": -1, "table-body.children": 1 } });
    expect([performed(mixed), missed(mixed)]).toEqual([false, false]);
  });

  it("reads only the surface's root, so metadata beside it never counts", () => {
    const before = { ...astryx(rows), notes: ["a"] };
    const after = { ...astryx(rows), notes: ["a", "b"] };
    expect(checkOperation("add", before, after).observed).toBe("none");
  });
});
