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
