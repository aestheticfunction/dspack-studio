/**
 * The canvas: ingests a generated A2UI catalog + visual registry, processes a
 * message stream, and renders the resulting surface. This component exists so
 * that apps never import @a2ui/* directly — the studio's import-isolation rule
 * keeps every A2UI coupling inside this package (and the renderer registry).
 */
import { useEffect, useMemo, useState, type FC } from "react";
import { MessageProcessor, type A2uiClientAction } from "@a2ui/web_core/v0_9";
import { A2uiSurface, type ReactComponentImplementation } from "@a2ui/react/v0_9";
import { buildCatalog, type Registry } from "./buildCatalog";

export type { A2uiClientAction };

export interface A2uiCanvasProps {
  /** The generated A2UI catalog JSON (from @dspack-studio/contracts). */
  catalog: Record<string, any>;
  /** The visual registry (from @dspack-studio/astryx-renderers). */
  registry: Registry;
  /** The A2UI message stream to process (createSurface/updateComponents/...). */
  messages: unknown[];
  /** Called for every action the surface dispatches back to the host. */
  onAction?: (action: A2uiClientAction) => void;
}

export const A2uiCanvas: FC<A2uiCanvasProps> = ({ catalog, registry, messages, onAction }) => {
  const ingested = useMemo(() => buildCatalog(catalog, registry), [catalog, registry]);
  const [surface, setSurface] = useState<any>(null);

  useEffect(() => {
    const processor = new MessageProcessor<ReactComponentImplementation>(
      [ingested.catalog],
      async (action: A2uiClientAction) => onAction?.(action),
    );
    processor.processMessages(structuredClone(messages) as any);
    const model = Array.from(processor.model.surfacesMap.values())[0];
    if (model) setSurface(processor.model.getSurface(model.id));
    return () => processor.model.dispose();
    // onAction is intentionally not a dependency: the processor holds a stable
    // reference for the surface's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingested, messages]);

  if (!surface) return null;
  return <A2uiSurface surface={surface} />;
};
