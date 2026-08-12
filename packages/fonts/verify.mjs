/**
 * Re-hash every vendored face against catalog.json — offline, no network.
 *
 * This is the teeth on the fix it belongs to: the apps stopped fetching type
 * from fonts.gstatic.com at build time, so the bytes that used to arrive over
 * the wire now live in git. A silent corruption or a well-meaning "re-export"
 * would change what the product renders with nothing to catch it. This does.
 *
 *   node packages/fonts/verify.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(HERE, "catalog.json"), "utf8"));

const failures = [];
let bytes = 0;

for (const face of catalog.faces) {
  const file = path.join(HERE, "files", face.file);
  if (!fs.existsSync(file)) {
    failures.push(`${face.file}: missing`);
    continue;
  }
  const buf = fs.readFileSync(file);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  if (buf.length !== face.bytes) failures.push(`${face.file}: ${buf.length} bytes, catalog says ${face.bytes}`);
  else if (sha256 !== face.sha256) failures.push(`${face.file}: sha256 ${sha256}, catalog says ${face.sha256}`);
  bytes += buf.length;
}

// A face on disk that the catalog does not know about is unpinned, and an
// unpinned face is exactly the thing this record exists to prevent.
const known = new Set(catalog.faces.map((f) => f.file));
for (const file of fs.readdirSync(path.join(HERE, "files"))) {
  if (!known.has(file)) failures.push(`${file}: on disk but not in catalog.json`);
}

if (failures.length > 0) {
  console.error("fonts: catalog verification FAILED");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `fonts: ${catalog.faces.length} faces verified against catalog.json ` +
    `(${(bytes / 1024).toFixed(1)} KB, subset ${catalog.subset}, ${catalog.license.id})`
);
