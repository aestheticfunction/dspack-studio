"use client";

/**
 * The canvas's selection layer (M1 advanced authoring): outlines for the selected element, and, in Select
 * mode, a transparent layer over the canvas that turns a click into a selection.
 *
 * It is drawn BESIDE the canvas frame, never inside it, and reads the rendered components' positions only:
 * nothing in the canvas is restyled (the isolation the appearance tests hold), and the design system's
 * components are untouched. Each rendered component carries its A2UI id on a `display: contents` wrapper
 * (a2ui-ingest provenance), so a component's box is the box of its contents.
 */
import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

interface Box {
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

function boxOf(el: Element, origin: DOMRect): Omit<Box, "id"> | null {
  const range = document.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top - origin.top, left: r.left - origin.left, width: r.width, height: r.height };
}

/** The rendered component under a point: the smallest box that contains it. */
export function componentAt(frame: HTMLElement, x: number, y: number): string | null {
  let best: { id: string; area: number } | null = null;
  for (const el of Array.from(frame.querySelectorAll<HTMLElement>("[data-a2ui-id]"))) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const area = r.width * r.height;
    if (!best || area <= best.area) best = { id: el.dataset.a2uiId!, area };
  }
  return best?.id ?? null;
}

export function SelectionLayer({
  stage,
  frame,
  selected,
  primary,
  selectMode,
  onPick,
  label,
}: {
  stage: RefObject<HTMLElement | null>;
  frame: RefObject<HTMLElement | null>;
  /** The rendered components of the selected element. */
  selected: string[];
  /** The one the designer picked, when they picked one item of a repeat. */
  primary: string | null;
  selectMode: boolean;
  onPick: (componentId: string) => void;
  label: string;
}) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [hover, setHover] = useState<Box | null>(null);
  const [cover, setCover] = useState<Omit<Box, "id"> | null>(null);

  const measure = useCallback(() => {
    const s = stage.current;
    const f = frame.current;
    if (!s || !f) return;
    const origin = s.getBoundingClientRect();
    const out: Box[] = [];
    for (const id of selected) {
      const el = f.querySelector(`[data-a2ui-id="${CSS.escape(id)}"]`);
      const b = el && boxOf(el, origin);
      if (b) out.push({ id, ...b });
    }
    setBoxes(out);
    const fr = f.getBoundingClientRect();
    setCover({ top: fr.top - origin.top, left: fr.left - origin.left, width: fr.width, height: fr.height });
  }, [stage, frame, selected]);

  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    const f = frame.current;
    if (!f || typeof ResizeObserver === "undefined") return;
    const o = new ResizeObserver(() => measure());
    o.observe(f);
    window.addEventListener("resize", measure);
    return () => {
      o.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [frame, measure]);
  useEffect(() => {
    if (!selectMode) setHover(null);
  }, [selectMode]);

  const at = (x: number, y: number) => {
    const f = frame.current;
    const s = stage.current;
    if (!f || !s) return null;
    const id = componentAt(f, x, y);
    if (!id) return null;
    const el = f.querySelector(`[data-a2ui-id="${CSS.escape(id)}"]`);
    const b = el && boxOf(el, s.getBoundingClientRect());
    return b ? { id, ...b } : null;
  };

  return (
    <>
      {boxes.map((b) => (
        <div
          key={b.id}
          aria-hidden="true"
          className={`cl-sel${primary === null || primary === b.id ? " cl-sel--on" : " cl-sel--also"}`}
          style={{ top: b.top - 3, left: b.left - 3, width: b.width + 6, height: b.height + 6 }}
          data-testid="selection-outline"
          data-component={b.id}
        />
      ))}
      {hover && !boxes.some((b) => b.id === hover.id) && <div aria-hidden="true" className="cl-sel cl-sel--hover" style={{ top: hover.top - 2, left: hover.left - 2, width: hover.width + 4, height: hover.height + 4 }} />}
      {selectMode && cover && (
        <div
          className="cl-pick"
          style={{ top: cover.top, left: cover.left, width: cover.width, height: cover.height }}
          aria-hidden="true"
          title={label}
          data-testid="select-layer"
          onPointerMove={(e) => setHover(at(e.clientX, e.clientY))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const hit = at(e.clientX, e.clientY);
            if (hit) onPick(hit.id);
          }}
        />
      )}
    </>
  );
}
