"use client";

/**
 * The canvas is client-only: the A2UI surface model and Astryx runtime themes
 * are browser constructs, and Node's stub localStorage global (present but
 * non-functional without --localstorage-file) defeats typeof guards in the
 * dependency chain during SSR.
 */
import dynamic from "next/dynamic";

const Studio = dynamic(() => import("./studio").then((m) => m.Studio), { ssr: false });

export default function Page() {
  return <Studio />;
}
