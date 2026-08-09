"use client";

/**
 * Small Aesthetic Function UI helpers shared across the product views.
 *
 * The identity marks are the square, circle and triangle from af-site's motion
 * language (MOTION.md): design, code and docs, drawn in the same 1.4px outlined
 * language, at rest in ink. `true` resolves a mark's stroke to green — the
 * moment of correction, used only where something has actually aligned (a
 * passing build, a ready project). They are decorative and aria-hidden.
 */
import type { ReactNode } from "react";

/**
 * The canonical Aesthetic Function brand mark — the exact asset from
 * af-site/assets/af-mark.svg, verbatim (not redrawn). `fill="currentColor"`
 * binds it to the element's color, so it recolors under every governed
 * appearance theme exactly as it does on aesthetic-function.com; the composer
 * paints it in the accent (var(--green)). Labeled "Aesthetic Function" for
 * screen readers — quiet ecosystem identity beside the Composer app name.
 */
export function AfMark({ className = "af-brand__mark", decorative = false }: { className?: string; decorative?: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 243.11 200.33"
      fill="currentColor"
      focusable="false"
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "Aesthetic Function" })}
    >
      <path d="M142.91,102.32v-53.81l-30.32,53.81h30.32Z" />
      <path d="M118.22,0c-4.21,0-8.11,2.2-10.28,5.81L1.74,182.14c-4.82,8,.94,18.19,10.28,18.19h231.09V0h-124.89ZM223.34,49.15h-47.11v53.17h46.98v31.36h-46.98v47.81h-21.32c-6.63,0-12-5.37-12-12v-35.85l-39.83-.5c-4.31-.05-8.31,2.2-10.5,5.92l-21.46,36.52c-2.16,3.67-6.09,5.92-10.35,5.92h-8.37c-9.25,0-15.02-10.03-10.38-18.03L122,25.81c2.15-3.7,6.1-5.97,10.38-5.97h90.96v29.32h0Z" />
    </svg>
  );
}

export function Marks({ trueCount = 0, className = "" }: { trueCount?: number; className?: string }) {
  const marks = [
    <svg key="sq" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="1.5" y="1.5" width="9" height="9" />
    </svg>,
    <svg key="ci" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" />
    </svg>,
    <svg key="tr" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.5 L10.5 10.5 L1.5 10.5 Z" />
    </svg>,
  ];
  return (
    <span className={`af-marks ${className}`.trim()} aria-hidden="true">
      {marks.map((m, i) => (
        <span key={i} className={`af-mark${i < trueCount ? " af-mark--true" : ""}`}>
          {m}
        </span>
      ))}
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="af-eyebrow">{children}</p>;
}

/** The shared editorial header for a working view: an eyebrow naming the view,
 *  and one plain line saying what it is. Keeps the inner views in the same
 *  Aesthetic Function voice and rhythm as the hub, Build, and Settings. */
export function ViewHeader({ eyebrow, lead }: { eyebrow: string; lead?: string }) {
  return (
    <header style={{ marginBottom: 18 }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      {lead && (
        <p className="af-lead" style={{ marginTop: 0, fontSize: 14 }}>
          {lead}
        </p>
      )}
    </header>
  );
}

/** Human "3 days ago" style stamp; absolute date is the title for precision. */
export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 45) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 22) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w} week${w === 1 ? "" : "s"} ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  return `${Math.round(d / 365)} yr ago`;
}
