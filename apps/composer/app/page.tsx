"use client";

import dynamic from "next/dynamic";

// The composer is a browser construct end to end (WebCrypto ledger hashing,
// A2UI surface model, canvas registries) — client-only, like the studio.
const Composer = dynamic(() => import("./composer").then((m) => m.Composer), { ssr: false });

export default function Page() {
  return <Composer />;
}
