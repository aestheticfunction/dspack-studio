/**
 * Construct a renderable `Catalog<ReactComponentImplementation>` from a generated A2UI
 * catalog JSON plus a name to React-visual registry.
 *
 * The component VOCABULARY and the per-component ACCEPTED SCHEMA come entirely from the
 * catalog JSON (via `buildComponentApi`): this function iterates `catalog.components` and
 * has no hardcoded component-name list. The registry supplies only the hand-authored
 * visual layer:
 *   - `reuseBasic`: delegate the visual to the published Basic Catalog implementation.
 *   - `custom`: a hand-authored React render function.
 * A catalog component with neither still enters the Catalog (so it is part of the accepted
 * vocabulary) but renders a visible "unimplemented" placeholder, which is distinct from the
 * renderer's "Unknown component" state (a name absent from the Catalog entirely).
 */
import type { FC } from "react";
import { Catalog } from "@a2ui/web_core/v0_9";
import {
  basicCatalog,
  createComponentImplementation,
  type ReactComponentImplementation,
} from "@a2ui/react/v0_9";
import { buildComponentApi } from "./buildComponentApi";

export interface Registry {
  /** Component names whose visual is delegated to the Basic Catalog implementation. */
  reuseBasic: Set<string>;
  /** Component name to hand-authored React render function. */
  custom: Record<string, FC<any>>;
}

export interface BuiltCatalog {
  catalog: Catalog<ReactComponentImplementation>;
  /** Catalog names with no visual (rendered as the placeholder). */
  unimplemented: string[];
  /** Every component name the Catalog accepts, in catalog order. */
  names: string[];
}

function makeUnimplemented(name: string): FC<any> {
  const Placeholder: FC<any> = () => (
    <span style={{ color: "#b91c1c", fontFamily: "monospace", fontSize: 12 }}>
      [unimplemented: {name}]
    </span>
  );
  return Placeholder;
}

export function buildCatalog(catalog: Record<string, any>, registry: Registry): BuiltCatalog {
  const names = Object.keys(catalog.components ?? {});
  const impls: ReactComponentImplementation[] = [];
  const unimplemented: string[] = [];

  for (const name of names) {
    // Accepted schema is derived from the catalog, regardless of how it is rendered.
    const api = buildComponentApi(catalog, name);

    if (registry.reuseBasic.has(name)) {
      const basic = basicCatalog.components.get(name);
      if (basic) {
        // Advertise the catalog-derived schema; reuse the published visual + binder.
        impls.push({ name, schema: api.schema, render: basic.render });
        continue;
      }
    }

    const customRender = registry.custom[name];
    if (customRender) {
      impls.push(createComponentImplementation(api, customRender as any));
      continue;
    }

    unimplemented.push(name);
    impls.push(createComponentImplementation(api, makeUnimplemented(name) as any));
  }

  return { catalog: new Catalog(catalog.catalogId, impls), unimplemented, names };
}
