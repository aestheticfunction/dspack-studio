/**
 * One digest function for block bindings, shared by the runtime loader, the
 * contract-time ratchet and the bench, so they can never disagree about what
 * "the same base contract" means. It hashes the PARSED document
 * (sha256 of JSON.stringify), the canonicalization dspack-gen's report digest
 * uses (src/audit/report.ts contractDigest), not file bytes: the browser only
 * ever holds the parsed JSON. WebCrypto, so it runs in browsers and Node 20+.
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The base-contract binding digest a sidecar declares as `baseSha256`. */
export function contractDigest(contract: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(contract));
}
