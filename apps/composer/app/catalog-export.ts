/**
 * The Catalog export (Preview's "export catalog"): the emitted A2UI catalog,
 * the vocabulary an A2UI/AG-UI client consumes, plus every emitted surface's
 * messages (worked AG-UI payloads), as one JSON download. A pure browser
 * download, in demo mode and agent mode alike, with no filesystem round
 * trip, so a hosted user can take the catalog away and use it.
 *
 * The beta's experimental build adds a per-surface action manifest to the
 * bundle (docs/blocks/HOST-ACTIONS.md). Nothing here knows of it, and the
 * default build's export stays byte-identical to the one before it
 * (catalog-export.test.ts).
 */

/** What the export reads from an emit. */
export interface CatalogEmit {
  catalog?: unknown;
  surfaces?: ReadonlyArray<{ name: string; messages?: unknown[] }>;
}

export interface CatalogBundle {
  a2uiCatalog: unknown;
  surfaces: Array<{ name: string; messages: unknown[] }>;
  exportedAt: string;
}

/** The catalog and every surface that emitted; a refused surface has no messages to take away. */
export function catalogBundle(emit: CatalogEmit, exportedAt: string): CatalogBundle {
  return {
    a2uiCatalog: emit.catalog,
    surfaces: (emit.surfaces ?? [])
      .filter((s) => s.messages)
      .map((s) => ({ name: s.name, messages: s.messages as unknown[] })),
    exportedAt,
  };
}

/** The bytes the download holds. */
export function catalogJson(bundle: object): string {
  return JSON.stringify(bundle, null, 2);
}

/** Download a bundle as `<name>-catalog.json`. */
export function downloadCatalog(bundle: object, name: string): void {
  const blob = new Blob([catalogJson(bundle)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "a2ui"}-catalog.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
