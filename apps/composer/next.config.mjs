import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * The Composer runs the governed pipeline in the browser. Cloudflare Workers
 * ban runtime `new Function` (AJV), so the deterministic pipeline can't run in
 * a Worker — but the browser can, and dspack-emit + dspack-gen/core (emit +
 * S1/S2/S3) are already browser-safe (validation.ts runs them today).
 *
 * Two build-time seams make runPipeline bundle for the browser:
 *
 * 1. node:crypto — audit/report.js hashes the contract for provenance; that is
 *    the ONLY Node dependency in the orchestrator's subgraph. Rewrite it to a
 *    synchronous, verified SHA-256 (lib/crypto-shim.mjs) whose digest equals
 *    node:crypto's exactly, so provenance stays byte-for-byte honest.
 *
 * 2. Deep import — dspack-gen's package index re-exports the WHOLE surface
 *    (`export * from ./adapters` → ollama→undici→node:diagnostics_channel and
 *    anthropic→@anthropic-ai/sdk; plus eval/runner→node:fs/node:path). None of
 *    that is used in the browser. run/orchestrator.js + adapters/fake.js pull a
 *    minimal, clean subgraph, so we alias custom specifiers straight to those
 *    dist files (an absolute-path alias bypasses the package `exports` map).
 *    app/gen-deep.d.ts re-exports the real types so TypeScript stays honest.
 */
const cryptoShim = fileURLToPath(new URL("./lib/crypto-shim.mjs", import.meta.url));
const genDist = path.dirname(fileURLToPath(import.meta.resolve("@aestheticfunction/dspack-gen")));
const genRun = path.join(genDist, "run", "orchestrator.js");
const genScripted = path.join(genDist, "adapters", "fake.js");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  transpilePackages: [
    "@dspack-studio/a2ui-ingest",
    "@dspack-studio/composer-core",
    "@dspack-studio/shadcn-renderers",
    "@dspack-studio/wireframe-renderers",
  ],
  webpack: (config, { webpack }) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@composer/gen-run": genRun,
      "@composer/gen-scripted": genScripted,
      crypto: cryptoShim,
    };
    // The "node:crypto" URI scheme is intercepted before alias resolution, so
    // rewrite it with a module-replacement plugin (webpack throws
    // UnhandledSchemeError otherwise).
    config.plugins = config.plugins ?? [];
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:crypto$/, cryptoShim));
    return config;
  },
};

export default nextConfig;
