/**
 * The installed versions of the lint (dspack-gen, as this app resolves it) and the emitter (dspack-emit,
 * as composer-core resolves it). A composition governor pins both (R1A-REVIEW L2), so the experimental
 * build is given them at build time (next.config.mjs) and the tests read them the same way.
 */
import { readFileSync } from "node:fs";

const version = (url) => JSON.parse(readFileSync(url, "utf8")).version;

export function installedToolchain() {
  return {
    lint: version(new URL("../node_modules/@aestheticfunction/dspack-gen/package.json", import.meta.url)),
    emit: version(new URL("../../../packages/composer-core/node_modules/@aestheticfunction/dspack-emit/package.json", import.meta.url)),
  };
}
