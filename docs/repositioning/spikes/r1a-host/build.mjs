/**
 * Builds the R1a standalone pages into dist/:
 *   demo.html          the interactive demonstration, live, on upstream 0.16.1
 *   fidelity-016.html  level 2 harness on upstream 0.16.1
 *   fidelity-010.html  the same harness on Composer's own canvas, for comparison
 * Every page is one self-contained HTML file (script and CSS inlined).
 */
import { build } from "esbuild";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
mkdirSync(`${here}/dist`, { recursive: true });

// The exported instances, one bundle for the fidelity pages.
const ev = `${repo}/docs/repositioning/spikes/r1a/evidence`;
const cases = readdirSync(ev).filter((f) => /^(search|results)-.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(`${ev}/${f}`, "utf8"))).filter((r) => r.outcome === "instance");
writeFileSync(`${here}/dist/evidence-bundle.json`, JSON.stringify({ catalog: JSON.parse(readFileSync(`${ev}/catalog-0.9.1.json`, "utf8")), cases }));


// One React, one Astryx per page: the renderer files live in the workspace, so their bare imports of these
// packages are re-resolved from the page's own install (a resolve plugin keeps each package's export map).
const PINNED = /^(react|react-dom|@astryxdesign\/core|@stylexjs\/stylex)(\/.*)?$/;
const pin = (fromDir) => ({
  name: "pin",
  setup(b) {
    b.onResolve({ filter: PINNED }, async (args) => {
      if (args.pluginData === "pinned") return undefined;
      const r = await b.resolve(args.path, { resolveDir: fromDir, kind: args.kind, pluginData: "pinned" });
      return r.errors.length ? { errors: r.errors } : { path: r.path };
    });
  },
});
const upstream = { plugin: pin(here), alias: { "@dspack-studio/a2ui-ingest": `${here}/src/ingest-shim.tsx` } };
const composer = {
  plugin: pin(`${repo}/apps/composer`),
  alias: { "@dspack-studio/a2ui-ingest": `${repo}/packages/a2ui-ingest/src/index.ts`, "@dspack-studio/astryx-renderers": `${repo}/packages/astryx-renderers/src/index.ts` },
};
const css = readFileSync(`${realpathSync(`${here}/node_modules/@astryxdesign/core`)}/dist/astryx.css`, "utf8");

async function page(entry, out, stack, title, nodePaths = [], extraCss = "") {
  const r = await build({
    entryPoints: [`${here}/src/${entry}`],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    write: false,
    jsx: "automatic",
    alias: stack.alias,
    plugins: [stack.plugin],
    nodePaths,
    loader: { ".json": "json" },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${css}${extraCss}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
  writeFileSync(`${here}/dist/${out}`, html);
  console.log(out, (html.length / 1024).toFixed(0), "KB");
}

await page("fidelity-016.tsx", "fidelity-016.html", upstream, "R1a fidelity 0.16.1");
await page("fidelity-010.tsx", "fidelity-010.html", composer, "R1a fidelity Composer canvas", [`${repo}/packages/a2ui-ingest/node_modules`, `${repo}/packages/astryx-renderers/node_modules`]);
if (process.argv.includes("--demo")) {
  await page("demo.tsx", "demo.html", upstream, "Composition Playground", [`${repo}/packages/composer-core/node_modules`], readFileSync(`${here}/src/demo.css`, "utf8"));
}
