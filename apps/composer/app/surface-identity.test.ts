import { describe, expect, it } from "vitest";
import { finding } from "@dspack-studio/composer-core";
import { blockingFindings, partitionSurfaces, surfaceEntriesById, surfaceIdentity, surfaceTitle } from "./surface-identity";

/**
 * Surface identity is a PRODUCT rule, not a rename: `ex.chat-1` stays the
 * canonical id everywhere (audit, export, flow bindings), and the thing a
 * person reads is the title that produced it. These pin the resolution order,
 * the empty-safety, and the ownership partition every picker orders by.
 */
describe("surfaceTitle — the human label, id preserved as metadata", () => {
  it("prefers an authored name over the prompt and the description", () => {
    expect(
      surfaceTitle({ id: "ex.a", name: "Delete account confirmation", prompt: "a screen to delete my account", description: "Card with…" }, "ex.a"),
    ).toBe("Delete account confirmation");
  });

  it("falls back to the goal that produced it, then to the description", () => {
    expect(surfaceTitle({ id: "ex.chat-1", prompt: "let people permanently delete their account" }, "ex.chat-1")).toBe(
      "let people permanently delete their account",
    );
    expect(surfaceTitle({ id: "ex.b", description: "A semantic data table" }, "ex.b")).toBe("A semantic data table");
  });

  it("is empty-safe: blank, whitespace-only, and missing entries fall back to the id", () => {
    expect(surfaceTitle({ id: "ex.c", name: "   ", prompt: "" }, "ex.c")).toBe("ex.c");
    expect(surfaceTitle(undefined, "ex.d")).toBe("ex.d");
    expect(surfaceTitle(null, "ex.e")).toBe("ex.e");
    expect(surfaceTitle({ id: "ex.f" }, "ex.f")).toBe("ex.f");
  });

  it("truncates sensibly and collapses whitespace, never mid-ellipsis noise", () => {
    const long = "a settings panel for notification preferences with digest frequency and channel toggles";
    const title = surfaceTitle({ id: "ex.g", prompt: long }, "ex.g");
    expect(title.length).toBeLessThanOrEqual(48);
    expect(title.endsWith("…")).toBe(true);
    expect(long.startsWith(title.slice(0, -1).trim())).toBe(true);
    expect(surfaceTitle({ id: "ex.h", name: "  two   spaces  " }, "ex.h")).toBe("two spaces");
  });

  it("surfaceIdentity keeps the canonical id beside the title (audit stays visible)", () => {
    expect(surfaceIdentity({ id: "ex.chat-1", prompt: "a table of orders" }, "ex.chat-1")).toEqual({
      title: "a table of orders",
      id: "ex.chat-1",
    });
    // A title-less surface must not render the id twice.
    expect(surfaceIdentity(undefined, "ex.chat-2")).toEqual({ title: "ex.chat-2", id: "ex.chat-2" });
  });

  it("indexes contract.examples by id, tolerating junk entries", () => {
    const byId = surfaceEntriesById([{ id: "ex.a", name: "A" }, null, { name: "no id" }, { id: "ex.b", prompt: "B" }]);
    expect(byId.get("ex.a")?.name).toBe("A");
    expect(byId.get("ex.b")?.prompt).toBe("B");
    expect(byId.size).toBe(2);
    expect(surfaceEntriesById(undefined).size).toBe(0);
  });
});

/**
 * "gates not green — 1 error finding" is true and useless: it names a count,
 * not a thing to fix. blockingFindings turns the findings that actually block
 * a build into rows a person can act on — the surface's own title, its
 * canonical id, and the gate's verbatim reason.
 */
describe("blockingFindings — what is blocking the build, by name", () => {
  const examples = [
    { id: "ex.empty-card", name: "A card with nothing in it" },
    { id: "ex.orders-loading", prompt: "show that orders are loading" },
  ];

  it("resolves a finding's target to the surface's human title and keeps the id", () => {
    const rows = blockingFindings([finding("A3", "emit-surface", "error", "ex.empty-card", "refusing to emit: …")], examples);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "ex.empty-card",
      title: "A card with nothing in it",
      isSurface: true,
      gate: "A3",
      code: "emit-surface",
      message: "refusing to emit: …",
    });
  });

  it("resolves an S3 target that carries a node path after the surface id", () => {
    const rows = blockingFindings([finding("S3", "rule.button-carries-text", "error", "ex.orders-loading $.root.children[0]", "boom")], examples);
    expect(rows[0].id).toBe("ex.orders-loading");
    expect(rows[0].title).toBe("show that orders are loading");
    expect(rows[0].isSurface).toBe(true);
  });

  it("keeps non-surface blockers — they still block, they just are not surfaces", () => {
    const rows = blockingFindings(
      [
        finding("coverage", "unclassified", "error", "badge", "component is neither mapped, adapted, omitted, nor a declared casualty"),
        finding("document", "harness", "error", "", "contract is not valid against the schema"),
      ],
      examples,
    );
    expect(rows.map((r) => r.isSurface)).toEqual([false, false]);
    expect(rows[0].id).toBe("badge");
    expect(rows[0].title).toBe("badge");
    expect(rows[1].id).toBe("");
    expect(rows[1].title).toBe("");
  });

  it("reports only unresolved errors: warnings, info, and acknowledged casualties are not blockers", () => {
    const acknowledged = {
      ...finding("A3", "emit-surface", "error", "ex.docs-article-trail", "refusing to emit: …"),
      acknowledged: { componentId: "breadcrumb", class: "cannot-represent", reason: "no A2UI equivalent" },
    };
    const rows = blockingFindings(
      [
        finding("S3", "rule.spinner-names-what-is-loading", "warn", "ex.orders-loading", "warned"),
        finding("A3", "wrapped", "info", "ex.empty-card", "noted"),
        acknowledged,
      ],
      examples,
    );
    expect(rows).toEqual([]);
  });

  it("is empty-safe: no findings, and findings against a project with no examples", () => {
    expect(blockingFindings([], examples)).toEqual([]);
    const rows = blockingFindings([finding("A3", "emit-surface", "error", "ex.empty-card", "refusing to emit: …")], undefined);
    expect(rows[0]).toMatchObject({ id: "ex.empty-card", title: "ex.empty-card", isSurface: false });
  });
});

describe("partitionSurfaces — the user's work first, refusals demoted not hidden", () => {
  const surfaces = [
    { name: "ex.delete-account-confirmation" },
    { name: "ex.broken-reference", error: "emit refused: unknown component" },
    { name: "ex.chat-1" },
    { name: "ex.notification-preferences" },
    { name: "ex.chat-2", error: "emit refused: S2" },
  ];
  const referenceIds = new Set(["ex.delete-account-confirmation", "ex.broken-reference", "ex.notification-preferences"]);

  it("puts the project's own surfaces first and the reference corpus second", () => {
    const groups = partitionSurfaces(surfaces, { referenceIds });
    expect(groups.yours.map((s) => s.name)).toEqual(["ex.chat-1"]);
    expect(groups.reference.map((s) => s.name)).toEqual(["ex.delete-account-confirmation", "ex.notification-preferences"]);
    // Ordered: everything the user owns comes before anything that teaches.
    expect(groups.ordered.map((s) => s.name)).toEqual([
      "ex.chat-1",
      "ex.chat-2",
      "ex.delete-account-confirmation",
      "ex.notification-preferences",
      "ex.broken-reference",
    ]);
  });

  it("separates refusals by OWNER: the user's stay visible, the reference's collapse", () => {
    const groups = partitionSurfaces(surfaces, { referenceIds });
    expect(groups.yoursRefused.map((s) => s.name)).toEqual(["ex.chat-2"]);
    expect(groups.referenceRefused.map((s) => s.name)).toEqual(["ex.broken-reference"]);
    // Nothing is dropped — every surface lands in exactly one group.
    const all = [...groups.yours, ...groups.yoursRefused, ...groups.reference, ...groups.referenceRefused];
    expect(all).toHaveLength(surfaces.length);
  });

  it("an EXAMPLE workspace owns everything it shows — the reference corpus IS the content", () => {
    const groups = partitionSurfaces(surfaces, { referenceIds, isExample: true });
    expect(groups.reference).toEqual([]);
    expect(groups.referenceRefused).toEqual([]);
    expect(groups.yours.map((s) => s.name)).toEqual([
      "ex.delete-account-confirmation",
      "ex.chat-1",
      "ex.notification-preferences",
    ]);
  });

  it("a project with no reference corpus (imported, repository) owns every surface", () => {
    const groups = partitionSurfaces(surfaces, { referenceIds: null });
    expect(groups.reference).toEqual([]);
    expect(groups.yours).toHaveLength(3);
    expect(groups.yoursRefused).toHaveLength(2);
  });
});
