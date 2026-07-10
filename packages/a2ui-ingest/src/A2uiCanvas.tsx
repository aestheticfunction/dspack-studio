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
    // Debug telemetry for the remount benchmark: every processor rebuild
    // (canvas remount / message-prefix change) increments a window counter.
    if (typeof window !== "undefined") {
      (window as any).__a2uiCanvasMounts = ((window as any).__a2uiCanvasMounts ?? 0) + 1;
    }
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    const processor = new MessageProcessor<ReactComponentImplementation>(
      [ingested.catalog],
      async (action: A2uiClientAction) => onAction?.(action),
    );
    processor.processMessages(structuredClone(messages) as any);
    const model = Array.from(processor.model.surfacesMap.values())[0];
    if (model) setSurface(processor.model.getSurface(model.id));
    if (typeof window !== "undefined" && typeof performance !== "undefined") {
      const w = window as any;
      w.__a2uiProcessMs = (w.__a2uiProcessMs ?? 0) + (performance.now() - t0);
    }
    return () => processor.model.dispose();
    // onAction is intentionally not a dependency (stable for the surface's
    // lifetime). messages is keyed by LENGTH: a2uiMessagesAt is a prefix
    // accumulator, so equal length implies identical content for one source —
    // this skips rebuilds on playhead-only re-renders (measured 32 -> 8
    // rebuilds per 8 deliveries). Source switches remount via the key prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingested, messages.length]);

  if (!surface) return null;
  return <A2uiSurface surface={surface} />;
};
