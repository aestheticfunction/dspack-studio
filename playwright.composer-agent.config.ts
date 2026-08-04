import { defineConfig } from "@playwright/test";

/**
 * Agent-mode composer suite: the layer above the composer-core and agent
 * unit tests. Those pin every ledger transition and refusal in code; this
 * pins that a PERSON can reach them — real exported UI, real local agent
 * routes, real project files on disk.
 *
 *   pnpm --filter composer build && npx playwright test --config playwright.composer-agent.config.ts
 *
 * Why a third config: the deployed composer (composer-production) is
 * agent-free by construction and ships a ledger-v1 demo, so the v2 decision
 * controls never render there; the exhibit suite (playwright.config.ts)
 * serves apps/web. Neither can reach this surface.
 *
 * One worker, no retries: every spec mutates real files through a
 * single-session agent, and a retry would replay a decision against
 * already-decided state — exactly the flakiness these tests exist to catch.
 */
const BASE_URL = process.env.COMPOSER_AGENT_URL ?? "http://localhost:3312";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: BASE_URL,
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    {
      name: "composer-agent",
      testMatch: ["composer-agent.spec.ts", "composer-agent-a11y.spec.ts", "composer-build.spec.ts", "composer-build-a11y.spec.ts"],
    },
  ],
  webServer: [
    {
      command: "node e2e/serve-composer.mjs",
      port: 3312,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm --filter agent dev",
      port: 8787,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
