import { defineConfig } from "@playwright/test";

/**
 * Composer production smoke: agent-free specs against the DEPLOYED composer
 * (its hosted posture is the pre-emitted demo project; everything needing
 * files or models states plainly that it wants the local agent).
 *
 *   npx playwright test --config playwright.composer-production.config.ts
 *
 * COMPOSER_PROD_URL overrides the target (used pre-merge against a local
 * static serve of apps/composer/out).
 */
const PROD = process.env.COMPOSER_PROD_URL ?? "https://composer.aesthetic-function.com";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: PROD,
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    {
      name: "composer",
      testMatch: "composer-prod-smoke.spec.ts",
    },
  ],
});
