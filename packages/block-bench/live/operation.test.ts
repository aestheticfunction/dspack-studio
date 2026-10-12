/**
 * The add and remove check (live/operation.ts): an add must lengthen a list in the surface and shorten none, a remove
 * the reverse, judged list by list from the prior and the refined surface alone, so every arm is scored the same way.
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

/** Where the shadcn fixture keeps its table rows and its footer buttons. */
const BODY = "card.children>card-content.children>table.children>table-body.children";
const FOOTER = "card.children>card-footer.children";

describe("the lists of a surface", () => {
  it("are each keyed by where they sit: a node by its component and rank among same-component siblings, an array element by its index", () => {
    expect(Object.fromEntries(listLengths(shadcn(rows)))).toMatchObject({ "card.children": 3, [BODY]: 3, [`${BODY}>table-row.children`]: 2, [`${BODY}>table-row#2.children`]: 2, [FOOTER]: 2 });
    expect(Object.fromEntries(listLengths(astryx(rows)))).toMatchObject({ "card.children": 3, "card.children>table.props.columns": 2, "card.children>table.props.data": 3, "card.children>table.props.data[2].cells": 2 });
  });
});

describe("an add or a remove, judged by the direction of the change", () => {
  it("an added row is an add on either design system, and a removed row a remove", () => {
    const four = [...rows, ["#9001", "Password reset loop"]];
    expect(checkOperation("add", shadcn(rows), shadcn(four))).toEqual({ requested: "add", observed: "add", deltas: { [BODY]: 1, [`${BODY}>table-row#3.children`]: 2 } });
    expect(checkOperation("add", astryx(rows), astryx(four))).toEqual({ requested: "add", observed: "add", deltas: { "card.children>table.props.data": 1, "card.children>table.props.data[3].cells": 2 } });
    expect(checkOperation("remove", astryx(rows), astryx(rows.slice(0, 2)))).toEqual({ requested: "remove", observed: "remove", deltas: { "card.children>table.props.data": -1, "card.children>table.props.data[2].cells": -2 } });
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
    expect(mixed).toMatchObject({ observed: "mixed", deltas: { [FOOTER]: -1, [BODY]: 1 } });
    expect([performed(mixed), missed(mixed)]).toEqual([false, false]);
  });

  it("judges each list on its own: a row added to one table never hides a row dropped from another, and a sibling added beside a table leaves its lists alone", () => {
    // A guide's two tables, ingredients then steps: a step added while an ingredient is dropped is mixed, not an add.
    const guide = (ingredients: string[], steps: string[][]): Json => ({
      root: {
        component: "card",
        id: "c",
        children: [
          { component: "table", id: "i", props: { columns: ["Item"], data: ingredients.map((x) => ({ cells: [x] })) } },
          { component: "table", id: "s", props: { columns: ["Step", "Instruction"], data: steps.map((cells) => ({ cells })) } },
        ],
      },
    });
    const before = guide(["pasta", "tomatoes"], [["1", "Boil"], ["2", "Toss"]]);
    const check = checkOperation("add", before, guide(["pasta"], [["1", "Boil"], ["2", "Toss"], ["3", "Serve"]]));
    expect(check.observed).toBe("mixed");
    expect(check.deltas).toMatchObject({ "card.children>table.props.data": -1, "card.children>table#1.props.data": 1 });
    // Equal and opposite changes in two lists are mixed too, never "none".
    expect(checkOperation("remove", before, guide(["pasta", "tomatoes", "basil"], [["1", "Boil"]])).observed).toBe("mixed");
    // A badge added before the table moves no list of the table's: only the card's own children grew.
    expect(checkOperation("add", astryx(rows), { root: { ...astryx(rows).root, children: [{ component: "badge", id: "new", props: { label: "New" } }, ...astryx(rows).root.children] } })).toEqual({ requested: "add", observed: "add", deltas: { "card.children": 1 } });
  });

  it("reads only the surface's root, so metadata beside it never counts", () => {
    const before = { ...astryx(rows), notes: ["a"] };
    const after = { ...astryx(rows), notes: ["a", "b"] };
    expect(checkOperation("add", before, after).observed).toBe("none");
  });
});
