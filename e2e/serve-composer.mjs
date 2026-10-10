/**
 * Zero-dependency static server for the exported composer (apps/composer/out).
 * The agent-mode Playwright project runs this so the DOM tests exercise the
 * REAL deploy artifact — the same bytes that ship — against the REAL local
 * agent and real project files on disk.
 *
 * Mirrors serve-static.mjs (apps/web/out); kept separate so the two suites
 * can run side by side on different ports.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// COMPOSER_OUT_DIR picks the sibling EXPERIMENTAL artifact (out-experimental,
// built by `pnpm --filter composer build:experimental`) for the blocks suite.
// A plain directory name only, and it must exist: a missing artifact exits
// with the command that builds it, never serves an empty directory.
import { existsSync } from "node:fs";
const outDir = process.env.COMPOSER_OUT_DIR ?? "out";
if (!/^[a-z0-9-]+$/.test(outDir)) {
  console.error(`serve-composer: COMPOSER_OUT_DIR must be a plain directory name, not "${outDir}"`);
  process.exit(1);
}
const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "apps", "composer", outDir);
if (!existsSync(join(root, "index.html"))) {
  console.error(`serve-composer: ${root}/index.html is missing; run pnpm --filter composer ${outDir === "out-experimental" ? "build:experimental" : "build"} first`);
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3312);

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  try {
    let path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^([/\\])+/, "");
    if (path === "" || path.endsWith("/")) path += "index.html";
    let file;
    try {
      file = await readFile(join(root, path));
    } catch {
      file = await readFile(join(root, `${path}.html`)).catch(() => readFile(join(root, "index.html")));
    }
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`composer export on http://localhost:${port}`));
