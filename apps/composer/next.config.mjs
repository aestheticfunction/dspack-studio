import { fileURLToPath } from "node:url";

/**
 * The Composer runs the governed pipeline in the browser. It imports runPipeline
 * + ScriptedAdapter from dspack-gen's SUPPORTED browser boundary
 * (`@aestheticfunction/dspack-gen/browser`, >= 0.3.2) — a clean subgraph whose
 * only Node dependency is node:crypto, the audit report's provenance hash.
 * Cloudflare Workers ban runtime `new Function` (AJV), so the deterministic
 * pipeline can't run in a Worker — but the browser can, and this shim closes the
 * one gap: node:crypto -> a synchronous, verified SHA-256 (lib/crypto-shim.mjs)
 * whose digest equals node:crypto's exactly, so provenance stays honest.
 */
const cryptoShim = fileURLToPath(new URL("./lib/crypto-shim.mjs", import.meta.url));

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
    // Bare "crypto" resolves via alias; the "node:crypto" URI scheme is
    // intercepted before alias resolution, so rewrite it with a
    // module-replacement plugin (webpack throws UnhandledSchemeError otherwise).
    config.resolve.alias = { ...(config.resolve.alias ?? {}), crypto: cryptoShim };
    config.plugins = config.plugins ?? [];
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:crypto$/, cryptoShim));
    return config;
  },
};

export default nextConfig;
