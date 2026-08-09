/**
 * Synchronous SHA-256 (FIPS 180-4) exposing the tiny slice of node:crypto the
 * governed pipeline uses in the browser.
 *
 * Why this exists: dspack-gen's audit/report.js hashes the contract for
 * provenance with `createHash("sha256").update(str).digest("hex")`. That is
 * the ONLY node:crypto use anywhere in the runPipeline chain — every other
 * dependency (emit, S1/S2/S3 lint, the adapters, repair) is already
 * browser-safe, which is why the Composer runs emit + lint client-side today.
 * Cloudflare Workers ban runtime `new Function` (AJV), so the deterministic
 * pipeline cannot run in a Worker; the browser CAN run it — the one gap is
 * node:crypto, and WebCrypto's digest is async while report.js is synchronous.
 *
 * So we provide a real, synchronous SHA-256 (not a stub): provenance receipts
 * stay byte-for-byte honest — the hash the browser computes equals the hash
 * the CLI and agent compute with node:crypto. next.config.mjs aliases
 * `node:crypto` and `crypto` to this module for the client bundle.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

function sha256Bytes(bytes) {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const len = bytes.length;
  const bitLen = len * 8;
  const withOne = len + 1;
  const pad = (56 - (withOne % 64) + 64) % 64;
  const total = withOne + pad + 8;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  // 64-bit big-endian bit length (our inputs are well under 2^53 bits).
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  m[total - 8] = (hi >>> 24) & 0xff;
  m[total - 7] = (hi >>> 16) & 0xff;
  m[total - 6] = (hi >>> 8) & 0xff;
  m[total - 5] = hi & 0xff;
  m[total - 4] = (lo >>> 24) & 0xff;
  m[total - 3] = (lo >>> 16) & 0xff;
  m[total - 2] = (lo >>> 8) & 0xff;
  m[total - 1] = lo & 0xff;

  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) | (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  let hex = "";
  for (let i = 0; i < 8; i++) hex += (H[i] >>> 0).toString(16).padStart(8, "0");
  return hex;
}

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
function toBytes(chunk) {
  if (chunk instanceof Uint8Array) return chunk;
  const str = typeof chunk === "string" ? chunk : String(chunk);
  if (encoder) return encoder.encode(str);
  // Fallback (no TextEncoder): UTF-8 encode by hand.
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = str.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

export function createHash(algorithm) {
  if (algorithm !== "sha256") {
    throw new Error(`crypto-shim: only "sha256" is implemented for the browser bundle (got ${algorithm})`);
  }
  const chunks = [];
  return {
    update(chunk) {
      chunks.push(toBytes(chunk));
      return this;
    },
    digest(encoding) {
      if (encoding && encoding !== "hex") {
        throw new Error(`crypto-shim: only "hex" digest is implemented (got ${encoding})`);
      }
      const size = chunks.reduce((n, c) => n + c.length, 0);
      const all = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        all.set(c, at);
        at += c.length;
      }
      return sha256Bytes(all);
    },
  };
}

export default { createHash };
