/**
 * DialogRender — the visual that closed the last shadcn registry placeholder.
 *
 * Fail-first: before DialogRender existed, `shadcnRegistry.custom.Dialog` was
 * undefined and a Dialog instance drew the a2ui-ingest `unimplemented`
 * placeholder. `Dialog` is declared catalog vocabulary no worked example
 * emits (measured 2026-08-08), so it has no corpus parity coverage — this
 * focused test is its verification: given the catalog's Dialog props, the
 * renderer draws the governed content (title + child) inline, no portal.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { shadcnRegistry } from "./registry";

const buildChild = (id: string) => createElement("div", { "data-child": id }, `body:${id}`);

const render = (props: Record<string, unknown>): string => {
  const Visual = (shadcnRegistry.custom as Record<string, any>).Dialog;
  return renderToStaticMarkup(createElement(Visual, { props, buildChild }));
};

describe("DialogRender", () => {
  it("is registered — the last placeholder is now a real visual", () => {
    expect((shadcnRegistry.custom as Record<string, unknown>).Dialog).toBeDefined();
  });

  it("draws the governed title and child inline (role=dialog, not modal)", () => {
    const html = render({ title: "Invite people", child: "body_1", variant: "standard", purpose: "form" });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="false"');
    expect(html).toContain("Invite people");
    expect(html).toContain("body:body_1");
    expect(html).toContain('data-purpose="form"');
  });

  it("fullscreen widens the surface; standard is constrained", () => {
    expect(render({ title: "T", child: "c", variant: "fullscreen" })).toContain("w-full");
    expect(render({ title: "T", child: "c", variant: "standard" })).toContain("max-w-lg");
  });

  it("a titleless dialog omits the heading rather than drawing an empty one", () => {
    const html = render({ child: "c" });
    expect(html).not.toContain("<h2");
    expect(html).toContain("body:c");
  });
});
