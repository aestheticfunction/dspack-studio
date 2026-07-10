/**
 * Zero-dependency static server for the exported site (apps/web/out).
 * Playwright's webServer runs this; the e2e suite exercises the REAL static
 * export — the same artifact that deploys — with zero model calls (replay
 * fixtures are the backend).
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "apps", "web", "out");
const port = Number(process.env.PORT ?? 3311);

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
}).listen(port, () => console.log(`static export on http://localhost:${port}`));
