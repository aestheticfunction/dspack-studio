import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { astryxRegistry } from "@dspack-studio/astryx-renderers";

/**
 * The Astryx preview renderers' semantics on the beta path (Phase 2 step 6,
 * docs/blocks/ACCESSIBILITY.md): a heading variant is a heading, a table's
 * scroll region is named by its columns, header text wraps instead of being
 * cut off, and a long word or label wraps instead of overflowing. These
 * renderers are shared with the default build. Server-rendered, so no browser
 * is needed; e2e/composer-blocks-a11y.spec.ts checks the rendered blocks.
 */
const custom = astryxRegistry.custom as Record<string, FC<any>>;
const render = (name: string, props: Record<string, unknown>, children: Record<string, ReactNode> = {}) =>
  renderToStaticMarkup(createElement(custom[name]!, { props, buildChild: (id: string) => children[id] ?? null }));

/** The opening tag of the first element whose class list carries `cls`. */
const tagWith = (html: string, cls: string) => html.match(new RegExp(`<[a-z0-9]+[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`))?.[0] ?? "";

describe("Text", () => {
  it("renders the heading variants as h1, h2 and h3, keeping Astryx's display type", () => {
    expect(render("Text", { variant: "h1", text: "Title" })).toMatch(/<h1 class="astryx-text display-2[^"]*"[^>]*>Title<\/h1>/);
    expect(render("Text", { variant: "h2", text: "Section" })).toMatch(/<h2 class="astryx-text display-3[^"]*"[^>]*>Section<\/h2>/);
    expect(render("Text", { variant: "h3", text: "Group" })).toMatch(/<h3 class="astryx-text large[^"]*"[^>]*>Group<\/h3>/);
  });

  it("keeps body text a paragraph and a caption inline text", () => {
    expect(render("Text", { variant: "body", text: "Body" })).toMatch(/<p class="astryx-text body[^"]*"[^>]*>Body<\/p>/);
    expect(render("Text", { variant: "caption", text: "Note" })).toMatch(/<span class="astryx-text supporting[^"]*"[^>]*>Note<\/span>/);
    expect(render("Text", { text: "No variant" })).toMatch(/<p class="astryx-text body[^"]*"[^>]*>No variant<\/p>/);
  });

  it("keeps a container heading's own text a heading, and never puts its block children inside a heading or a paragraph", () => {
    const html = render("Text", { variant: "h2", text: "Account", children: ["c1"] }, { c1: createElement("p", null, "Child") });
    expect(html).toMatch(/<div class="astryx-text display-3[^"]*"[^>]*><span role="heading" aria-level="2">Account<\/span><span style="display:contents"><p>Child<\/p><\/span><\/div>/);
    expect(html).not.toMatch(/<h[1-6]|<p class/);
    // A container without its own text gets no empty heading.
    expect(render("Text", { variant: "h2", children: ["c1"] }, { c1: "Child" })).not.toContain('role="heading"');
    // A body container is unchanged: no heading role.
    expect(render("Text", { variant: "body", text: "Intro", children: ["c1"] }, { c1: "Child" })).not.toContain('role="heading"');
  });

  it("breaks a long unbroken word instead of overflowing, for every variant", () => {
    for (const variant of ["h1", "h2", "h3", "body", "caption"]) {
      expect(tagWith(render("Text", { variant, text: "x".repeat(200) }), "astryx-text")).toContain("overflow-wrap:anywhere");
    }
  });
});

describe("Table", () => {
  const data = { columns: ["Ticket", "Subject"], data: [{ cells: ["#1", "Export fails"] }] };

  it("names a data table's scroll region by its columns, not only 'Table'", () => {
    expect(tagWith(render("Table", data), "astryx-table-scroll-wrapper")).toContain('aria-label="Table: Ticket, Subject"');
  });

  it("wraps header text instead of cutting it off with an ellipsis", () => {
    const html = render("Table", data);
    const headers = html.match(/<th [^>]*>/g) ?? [];
    expect(headers).toHaveLength(2);
    for (const th of headers) {
      expect(th).toContain("white-space:normal");
      expect(th).toContain("overflow:visible");
      expect(th).toContain("text-overflow:clip");
      expect(th).toContain("overflow-wrap:anywhere");
    }
  });

  it("gives every data column a minimum width, so a narrow table scrolls in its region instead of crushing its words", () => {
    const columns = Array.from({ length: 8 }, (_, i) => `Column ${i + 1}`);
    const html = render("Table", { columns, data: [{ cells: columns.map((c) => `${c} value`) }] });
    const headers = html.match(/<th [^>]*>/g) ?? [];
    expect(headers).toHaveLength(8);
    for (const th of headers) expect(th).toContain("min-width:96px");
    expect(html.match(/<table [^>]*>/)?.[0]).toContain("min-width:768px");
  });

  it("names and wraps a children-mode table the same way", () => {
    const html = render("Table", { columns: ["Step", "Instruction"], children: ["a", "b"] }, { a: "1", b: "Boil water" });
    expect(tagWith(html, "astryx-table-scroll-wrapper")).toContain('aria-label="Table: Step, Instruction"');
    const headers = html.match(/<th [^>]*>/g) ?? [];
    expect(headers).toHaveLength(2);
    for (const th of headers) expect(th).toContain("white-space:normal");
  });

  it("keeps Astryx's name for a table without columns", () => {
    expect(tagWith(render("Table", { children: ["a"] }, { a: "1" }), "astryx-table-scroll-wrapper")).toContain('aria-label="Table"');
  });

  it("wraps a long status label inside its badge", () => {
    const html = render("Table", { columns: ["Name"], data: [{ cells: ["A"], status: { label: "y".repeat(120), variant: "warning" } }] });
    const badge = tagWith(html, "astryx-badge");
    expect(badge).toContain("white-space:normal");
    expect(badge).toContain("overflow-wrap:anywhere");
  });
});

describe("Badge", () => {
  it("wraps a long label inside the badge instead of overflowing its container", () => {
    const badge = tagWith(render("Badge", { label: "Serves: four people with leftovers for lunch the next day", variant: "neutral" }), "astryx-badge");
    expect(badge).toContain("white-space:normal");
    expect(badge).toContain("height:auto");
    expect(badge).toContain("max-width:100%");
    expect(badge).toContain("overflow-wrap:anywhere");
  });
});
