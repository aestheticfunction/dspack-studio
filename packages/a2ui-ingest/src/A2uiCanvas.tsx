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
  const [surfaces, setSurfaces] = useState<Array<{ id: string; surface: any }>>([]);

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
    // Every live surface renders in creation order: an agent may put a
    // second surface beside the first (FM-7: the HITL question) and remove
    // it later (deleteSurface) — the stream, not this canvas, decides.
    setSurfaces(
      Array.from(processor.model.surfacesMap.values())
        .map((model: any) => ({ id: String(model.id), surface: processor.model.getSurface(model.id) }))
        .filter((s) => Boolean(s.surface)),
    );
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

  if (surfaces.length === 0) return null;
  // One shared grid spaces the surfaces; the per-surface wrapper exists only
  // to carry the data-a2ui-surface attribute (a gap on a single-child
  // wrapper would space nothing).
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {surfaces.map(({ id, surface }) => (
        <div key={id} data-a2ui-surface={id}>
          <A2uiSurface surface={surface} />
        </div>
      ))}
    </div>
  );
};
