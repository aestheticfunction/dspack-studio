import { defineConfig } from "@playwright/test";

/**
 * Production smoke configuration: the deterministic, agent-free specs run
 * against the DEPLOYED static site (no local servers, no model calls).
 * Excluded by design: live/generated/break/fork-continue (they exercise
 * the local agent, which the static preview deliberately does not ship).
 *
 *   npx playwright test --config playwright.production.config.ts
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: [
    "replay.spec.ts",
    "alive.spec.ts",
    "permalinks.spec.ts",
    "tour-xray-wire.spec.ts",
    "receipts.spec.ts",
    "fork.spec.ts",
    "fixture-006.spec.ts",
    "inspector.spec.ts",
    "wire.spec.ts",
    "a11y.spec.ts",
    "studio-shell.spec.ts",
    // The deployed site has no agent, which is exactly the state this suite
    // reproduces locally by blocking the port — it runs as-is in production.
    "break-offline.spec.ts",
    "prod-smoke.spec.ts",
  ],
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: process.env.PROD_URL ?? "https://studio.aesthetic-function.com",
    contextOptions: { reducedMotion: "reduce" },
  },
});
