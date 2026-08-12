/**
 * The structural sketch: one value, drawn as low-fidelity STRUCTURE.
 *
 * This is what makes a wireframe look like a wireframe rather than a debugger.
 * Nothing here knows a component name, a design system, or a catalog author's
 * conventions — every decision comes from the declared shape of the property
 * (classify-props) with the runtime value's own shape as the fallback. A
 * catalog this package has never seen sketches exactly as well as the ones it
 * ships with.
 *
 * The rules, in full:
 *   - genuinely textual values are shown as TEXT (real content stays visible);
 *   - tokens (enums) and flags (booleans) are small state chips;
 *   - a list of scalars is a header band of cells, one cell per real item;
 *   - a list of records is one row band per real record, cells drawn from the
 *     record's own values;
 *   - a nested record is a bordered block;
 *   - anything unrecognisable is a blank line bar — the honest "there is
 *     structure here, and no native visual for it".
 *
 * A value is NEVER serialized. `rows=[{"cells":…}]` is not a wireframe.
 */
import type { CSSProperties, ReactNode } from "react";
import type { WireProp, WireShape } from "./classify-props";

/** Sketch, not spreadsheet: enough bands to read the shape, then say the rest. */
const MAX_ROWS = 4;
const MAX_CELLS = 8;
const MAX_TEXT = 120;
const MAX_DEPTH = 2;

const textStyle: CSSProperties = { color: "var(--fg, inherit)", fontSize: 12, lineHeight: 1.45, margin: "2px 0" };
const lineStyle: CSSProperties = { height: 8, borderRadius: 2, background: "var(--line, #8883)", margin: "4px 0", maxWidth: 180 };
const bandStyle: CSSProperties = { display: "flex", gap: 4, margin: "3px 0" };
const cellStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "2px 5px",
  borderRadius: 2,
  background: "var(--bg-1, #8881)",
  border: "1px solid var(--line, #8883)",
  fontSize: 11,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const headerCellStyle: CSSProperties = { ...cellStyle, fontWeight: 600, background: "var(--line, #8883)" };
const stateStyle: CSSProperties = {
  border: "1px solid var(--line, #8884)",
  borderRadius: 4,
  padding: "0 5px",
  fontSize: 11,
  opacity: 0.85,
  marginRight: 4,
};
const blockStyle: CSSProperties = { border: "1px solid var(--line, #8883)", borderRadius: 4, padding: "4px 6px", margin: "3px 0" };
const moreStyle: CSSProperties = { fontSize: 10, opacity: 0.6, margin: "2px 0 0" };

const isScalar = (v: unknown): v is string | number => typeof v === "string" || typeof v === "number";

/** Trim, collapse runs of whitespace, and clamp — a sketch, never a paragraph. */
function clamp(value: string | number, max = MAX_TEXT): string {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function Band({ kind, cells }: { kind: "header" | "row"; cells: Array<string | number> }): ReactNode {
  const shown = cells.slice(0, MAX_CELLS);
  const style = kind === "header" ? headerCellStyle : cellStyle;
  return (
    <div style={bandStyle} data-wire="band" data-wire-band={kind}>
      {shown.map((cell, i) => (
        <span key={i} style={style} data-wire="cell" title={String(cell)}>
          {clamp(cell, 32)}
        </span>
      ))}
      {cells.length > shown.length && (
        <span style={{ ...style, flex: 0 }} data-wire="cell-overflow">
          +{cells.length - shown.length}
        </span>
      )}
    </div>
  );
}

/** The scalars a record contributes to one row band: its own first list of
 *  scalars when it has one (the common `{cells: [...]}` idiom), else every
 *  scalar it carries. Structure only — no key is ever printed. */
function rowCells(record: Record<string, unknown>): Array<string | number> {
  for (const value of Object.values(record)) {
    if (Array.isArray(value) && value.length > 0 && value.every(isScalar)) return value as Array<string | number>;
  }
  const scalars = Object.values(record).filter(isScalar);
  return scalars.length > 0 ? scalars : ["", "", ""];
}

function List({ items }: { items: unknown[] }): ReactNode {
  if (items.length === 0) return <div style={lineStyle} data-wire="line" />;
  if (items.every(isScalar)) return <Band kind="header" cells={items as Array<string | number>} />;
  const records = items.filter((i): i is Record<string, unknown> => !!i && typeof i === "object" && !Array.isArray(i));
  if (records.length === 0) return <div style={lineStyle} data-wire="line" />;
  const shown = records.slice(0, MAX_ROWS);
  return (
    <>
      {shown.map((record, i) => (
        <Band key={i} kind="row" cells={rowCells(record)} />
      ))}
      {records.length > shown.length && (
        <p style={moreStyle} data-wire="more">
          {records.length - shown.length} more rows
        </p>
      )}
    </>
  );
}

/** One value drawn as structure. `shape` is the catalog's declaration; the
 *  runtime value decides whenever the catalog did not (or disagrees). */
export function SketchValue({ name, shape, value, depth = 0 }: { name: string; shape: WireShape; value: unknown; depth?: number }): ReactNode {
  if (value === undefined || value === null) return null;

  if (shape === "boolean" || typeof value === "boolean") {
    return (
      <span style={stateStyle} data-wire="state">
        {value ? "☑" : "☐"} {name}
      </span>
    );
  }

  if (shape === "enum" && isScalar(value)) {
    return (
      <span style={stateStyle} data-wire="state" title={name}>
        {clamp(value, 24)}
      </span>
    );
  }

  if (Array.isArray(value)) return <List items={value} />;

  if (isScalar(value)) {
    const text = clamp(value);
    if (!text) return <div style={lineStyle} data-wire="line" />;
    return (
      <div style={textStyle} data-wire="text" title={name}>
        {text}
      </div>
    );
  }

  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return <div style={lineStyle} data-wire="line" />;
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length === 0) return <div style={lineStyle} data-wire="line" />;
    return (
      <div style={blockStyle} data-wire="block">
        {entries.map(([key, child]) => (
          <SketchValue key={key} name={key} shape="unknown" value={child} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return <div style={lineStyle} data-wire="line" />;
}

/** The sketch for one component's value props, in declaration order. */
export function Sketch({ props, wireProps }: { props: Record<string, unknown> | undefined; wireProps: WireProp[] }): ReactNode {
  const present = wireProps.filter((p) => props?.[p.name] !== undefined && props[p.name] !== null);
  if (present.length === 0) return <div style={lineStyle} data-wire="line" data-wire-sketch="" />;
  return (
    <div data-wire-sketch="">
      {present.map((p) => (
        <SketchValue key={p.name} name={p.name} shape={p.shape} value={props![p.name]} />
      ))}
    </div>
  );
}

/** The inert action affordance: the emitted event name when the value carries
 *  one (real, checkable content), else the property's own name. */
export function actionLabel(name: string, value: unknown): string {
  const event = (value as { event?: { name?: unknown } } | undefined)?.event;
  return typeof event?.name === "string" && event.name ? clamp(event.name, 32) : name;
}
