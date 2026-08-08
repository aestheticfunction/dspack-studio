import { defineConfig } from "@playwright/test";

/**
 * Production smoke for the deployed COMPOSER Worker
 * (composer.aesthetic-function.com). Agent-free by construction: the hosted
 * composer ships the pre-emitted demo project and no agent, which is exactly
 * what composer-prod-smoke.spec.ts asserts. Separate from
 * playwright.production.config.ts (the exhibit) so the two Workers keep
 * independent deploy + smoke cadences (docs/deployment.md).
 */
const COMPOSER_PROD = process.env.COMPOSER_PROD_URL ?? "https://composer.aesthetic-function.com";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: COMPOSER_PROD,
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [{ name: "composer", testMatch: "composer-prod-smoke.spec.ts" }],
});
