import { defineConfig } from "@playwright/test";

/**
 * The EXPERIMENTAL composer artifact (interface blocks, docs/BLOCKS.md):
 * apps/composer/out-experimental, built with NEXT_PUBLIC_COMPOSER_EXPERIMENTAL=1
 * by `pnpm --filter composer build:experimental`. It is a sibling of the deploy
 * artifact and never replaces it; the default suites (smoke, agent, production)
 * keep running against apps/composer/out, unchanged.
 *
 *   pnpm --filter composer build:experimental && \
 *   pnpm exec playwright test --config playwright.composer-experimental.config.ts
 *
 * Agent-free: every spec stubs /api/models and /api/propose, so no model is
 * called and the block-mode request shapes are asserted from the stubs.
 */
const PORT = 3315;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  workers: 2,
  use: {
    baseURL: `http://localhost:${PORT}`,
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [{ name: "composer-experimental", testMatch: ["composer-blocks.spec.ts", "composer-blocks-provenance.spec.ts", "composer-blocks-receipts.spec.ts", "composer-beta.spec.ts"] }],
  webServer: [
    {
      command: "node e2e/serve-composer.mjs",
      port: PORT,
      reuseExistingServer: !process.env.CI,
      env: { PORT: String(PORT), COMPOSER_OUT_DIR: "out-experimental" },
    },
  ],
});
