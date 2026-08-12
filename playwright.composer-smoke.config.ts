import { defineConfig } from "@playwright/test";

/**
 * PRE-MERGE hosted/demo smoke: the composer static export served locally with
 * NO agent — the exact agent-free experience a visitor gets at
 * composer.aesthetic-function.com. Runs composer-prod-smoke.spec.ts (whole
 * in-browser Build loop: propose → S1/S2/S3 → repair → emit → render → refine,
 * plus validation, preview, export, and bundle hygiene) against the real deploy
 * artifact, in CI, BEFORE deploy.
 *
 * The public-URL post-deploy smoke stays in playwright.composer-production.config.ts
 * (docs/deployment.md): same spec, different target — local artifact here, the
 * live Worker there.
 *
 * A SECOND project — "composer-product" — runs the agent-free product suites
 * (surface authoring, flows, governance) on the same artifact and the same
 * server. They are not smoke: they are the first-adoption surfaces a new team
 * touches, driven end to end with the scripted provider (no model call, ever).
 * They stay out of the deployed-URL config on purpose — they author and delete
 * project data, which the post-deploy smoke must not do to a live site.
 */
const PORT = Number(process.env.COMPOSER_SMOKE_PORT ?? 3313);

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    { name: "composer-smoke", testMatch: "composer-prod-smoke.spec.ts" },
    {
      name: "composer-product",
      testMatch: ["composer-surfaces.spec.ts", "composer-flows.spec.ts", "composer-governance.spec.ts"],
    },
  ],
  webServer: [
    {
      command: `PORT=${PORT} node e2e/serve-composer.mjs`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
