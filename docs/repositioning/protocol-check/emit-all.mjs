// Emit every worked example of both packaged Composer references, at both
// A2UI versions, with the exact library Composer uses. Output: one JSON per
// reference with the catalogs and per-surface messages.
import { readFileSync, writeFileSync } from "node:fs";
const [repo, out] = process.argv.slice(2);
import { pathToFileURL } from "node:url";
// The exact dspack-emit build composer-core depends on (pnpm links it here).
const emit = await import(pathToFileURL(`${repo}/packages/composer-core/node_modules/@aestheticfunction/dspack-emit/dist/index.js`).href);
const refs = {
  astryx: ["apps/composer/astryx-project/astryx.dspack.json", "apps/composer/astryx-project/astryx.profile.json"],
  "shadcn-v3": ["apps/composer/shadcn-v3-project/shadcn-ui.dspack.json", "apps/composer/shadcn-v3-project/shadcn-v3.profile.json"],
};
for (const [name, [c, p]] of Object.entries(refs)) {
  const doc = JSON.parse(readFileSync(`${repo}/${c}`, "utf8"));
  const profileJson = JSON.parse(readFileSync(`${repo}/${p}`, "utf8"));
  const profile = emit.loadProfile(profileJson);
  const result = { name, catalogs: {}, surfaces: [] };
  for (const v of ["0.9.1", "1.0"]) {
    const t = emit.transformFromJson(doc, { a2uiVersion: v, profile });
    result.catalogs[v] = t.catalog;
    result["gates_" + v] = t.validation ? Object.fromEntries(Object.entries(t.validation).map(([k, g]) => [k, g?.pass ?? g?.ok ?? g])) : null;
  }
  for (const ex of doc.examples ?? []) {
    try {
      const r = emit.emitSurface(ex.surface, doc, { profile, surfaceId: ex.id.replace(/[^a-z0-9]+/g, "_") });
      result.surfaces.push({ id: ex.id, messages: r.messages, warnings: r.warnings.length });
    } catch (e) {
      result.surfaces.push({ id: ex.id, refused: String(e.message ?? e).slice(0, 200) });
    }
  }
  writeFileSync(`${out}/emitted-${name}.json`, JSON.stringify(result, null, 1));
  console.log(name, "surfaces", result.surfaces.length, "refused", result.surfaces.filter((s) => s.refused).length);
}
