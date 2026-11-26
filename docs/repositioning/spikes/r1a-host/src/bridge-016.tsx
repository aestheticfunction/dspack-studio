/**
 * R1a level 2: the bridge from an emitted A2UI catalog to upstream
 * @a2ui/react 0.16.1, written for the spike (R0-REVIEW A15).
 *
 * What it does, and all it does:
 *   - loads the catalog document with upstream's own Catalog.fromJson
 *     (0.16.1 derives each component's schema from its JSON definition, so
 *     a2ui-ingest's hand-written schema bridge is not needed);
 *   - attaches Composer's Astryx renderer for each component name with
 *     createComponentImplementation, the files used unchanged;
 *   - keeps a setter only where the property is a data binding (the same
 *     rule a2ui-ingest applies, R0 decision 16), so an unbound field keeps
 *     what is typed and a bound one writes to the data model.
 */
import { createElement, useEffect, useState, type FC } from "react";
import { Catalog, MessageProcessor } from "@a2ui/web_core/v0_9";
import { A2uiSurface, createComponentImplementation } from "@a2ui/react/v0_9";
import { TextRender } from "../../../../../packages/astryx-renderers/src/components/TextRender";
import { ButtonRender } from "../../../../../packages/astryx-renderers/src/components/ButtonRender";
import { CardRender } from "../../../../../packages/astryx-renderers/src/components/CardRender";
import { TextFieldRender } from "../../../../../packages/astryx-renderers/src/components/TextFieldRender";
import { BadgeRender } from "../../../../../packages/astryx-renderers/src/components/BadgeRender";
import { TableRender } from "../../../../../packages/astryx-renderers/src/components/TableRender";
import { AlertDialogRender } from "../../../../../packages/astryx-renderers/src/components/AlertDialogRender";
import { DialogRender } from "../../../../../packages/astryx-renderers/src/components/DialogRender";
import { ColumnRender } from "../../../../../packages/astryx-renderers/src/components/ColumnRender";
import { ListRender } from "../../../../../packages/astryx-renderers/src/components/ListRender";
import { SelectableCardRender } from "../../../../../packages/astryx-renderers/src/components/SelectableCardRender";
import { MetadataListRender } from "../../../../../packages/astryx-renderers/src/components/MetadataListRender";
import { withProvenance } from "./ingest-shim";

const RENDERS: Record<string, FC<any>> = {
  Text: TextRender, Button: ButtonRender, Card: CardRender, TextField: TextFieldRender, Badge: BadgeRender, Table: TableRender,
  AlertDialog: AlertDialogRender, Dialog: DialogRender, Column: ColumnRender, List: ListRender, SelectableCard: SelectableCardRender, MetadataList: MetadataListRender,
};

function onlyBoundSetters(props: Record<string, unknown>, raw: Record<string, unknown> | undefined) {
  let out = props;
  for (const key of Object.keys(props)) {
    const m = /^set([A-Z].*)$/.exec(key);
    if (!m || typeof props[key] !== "function") continue;
    const name = m[1]!.charAt(0).toLowerCase() + m[1]!.slice(1);
    const value = raw?.[name] as Record<string, unknown> | undefined;
    if (value && typeof value === "object" && ("path" in value || "@path" in value)) continue;
    if (out === props) out = { ...props };
    delete out[key];
  }
  return out;
}

export interface BuiltCatalog016 {
  catalog: any;
  rendered: string[];
  unrendered: string[];
}

export function buildCatalog016(doc: Record<string, any>): BuiltCatalog016 {
  const loaded: any = Catalog.fromJson(doc, "0.9");
  const impls: any[] = [];
  const rendered: string[] = [];
  const unrendered: string[] = [];
  for (const [name, api] of loaded.components as Map<string, any>) {
    const Render = RENDERS[name];
    if (!Render) {
      unrendered.push(name);
      impls.push(createComponentImplementation(api, () => createElement("span", { "data-unrendered": name }, `[no renderer: ${name}]`)));
      continue;
    }
    const Tagged = withProvenance(name, Render);
    const Wrapped: FC<any> = (args) => createElement(Tagged, { ...args, props: onlyBoundSetters(args.props ?? {}, args.context?.componentModel?.properties) });
    impls.push(createComponentImplementation(api, Wrapped as any));
    rendered.push(name);
  }
  return { catalog: new Catalog(loaded.id, "0.9", impls), rendered, unrendered };
}

/** Renders one message batch. Remounts on a new batch: an instance is replaced, never patched. */
export const Surface016: FC<{ built: BuiltCatalog016; messages: unknown[]; onAction: (a: any) => void; onReady?: (processor: any) => void }> = ({ built, messages, onAction, onReady }) => {
  const [surfaces, setSurfaces] = useState<any[]>([]);
  useEffect(() => {
    const processor = new MessageProcessor<any>([built.catalog], async (a: any) => onAction(a));
    processor.processMessages(structuredClone(messages) as any);
    setSurfaces(Array.from(processor.model.surfacesMap.values()));
    onReady?.(processor);
    return () => processor.model.dispose();
  }, [built, messages]);
  return createElement(
    "div",
    null,
    surfaces.map((s: any) => createElement("div", { key: s.id, "data-a2ui-surface": s.id }, createElement(A2uiSurface as any, { surface: s }))),
  );
};
