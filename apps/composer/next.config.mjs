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
 *
 * Interface blocks (experimental; docs/BLOCKS.md). The DEFAULT build is today's
 * artifact, byte for byte, with no block code in it. An EXPERIMENTAL build
 * (NEXT_PUBLIC_COMPOSER_EXPERIMENTAL=1) is a sibling artifact in
 * out-experimental/ that is never the deploy artifact. Three things enforce
 * that here, and none of them is optional:
 *   - the flag is inlined as "0" or "1": an unset variable would stay a
 *     runtime read, and the literal `=== "1"` checks would not fold away;
 *   - the experimental/ directory (sidecars and the block runtime) is aliased
 *     to nothing unless the flag is on, a backstop under the dead-code folding;
 *   - the flag and the output directory must agree, or the build throws.
 */
const cryptoShim = fileURLToPath(new URL("./lib/crypto-shim.mjs", import.meta.url));
const experimentalDir = fileURLToPath(new URL("./experimental", import.meta.url));

/** @returns {import('next').NextConfig} */
export default function composerConfig(phase) {
  const flag = process.env.NEXT_PUBLIC_COMPOSER_EXPERIMENTAL === "1" ? "1" : "0";
  const outDir = process.env.COMPOSER_OUT_DIR || "out";
  if (phase === "phase-production-build") {
    if (outDir !== "out" && outDir !== "out-experimental") {
      throw new Error(`COMPOSER_OUT_DIR must be "out" or "out-experimental", not "${outDir}"`);
    }
    if (flag === "1" && outDir !== "out-experimental") {
      throw new Error("NEXT_PUBLIC_COMPOSER_EXPERIMENTAL=1 builds only into out-experimental (pnpm --filter composer build:experimental); the deploy artifact never carries block code");
    }
    if (flag !== "1" && outDir === "out-experimental") {
      throw new Error("out-experimental is the experimental artifact; set NEXT_PUBLIC_COMPOSER_EXPERIMENTAL=1 to build it");
    }
  }
  return {
    output: "export",
    ...(phase === "phase-production-build" && outDir === "out-experimental" ? { distDir: "out-experimental" } : {}),
    env: { NEXT_PUBLIC_COMPOSER_EXPERIMENTAL: flag },
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
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        crypto: cryptoShim,
        ...(flag === "1" ? {} : { [experimentalDir]: false }),
      };
      config.plugins = config.plugins ?? [];
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:crypto$/, cryptoShim));
      return config;
    },
  };
}
