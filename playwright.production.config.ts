import { defineConfig } from "@playwright/test";

/**
 * Production smoke configuration: the deterministic, agent-free specs run
 * against the DEPLOYED static site (no local servers, no model calls).
 * Excluded by design: live/generated/break/fork-continue (they exercise
 * the local agent, which the static preview deliberately does not ship).
 *
 *   npx playwright test --config playwright.production.config.ts
 */
const PROD = process.env.PROD_URL ?? "https://studio.aesthetic-function.com";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: PROD,
    contextOptions: { reducedMotion: "reduce" },
  },
  // Mirrors playwright.config.ts: "first-run" asserts the deployed
  // first-visit tour auto-start with clean storage; "studio" runs everything
  // else as a returning visitor (seeded tour-done) so no spec meets the tour.
  projects: [
    {
      name: "first-run",
      testMatch: "tour-first-run.spec.ts",
    },
    {
      name: "studio",
      testMatch: [
        "replay.spec.ts",
        "support-triage.spec.ts",
        "onboarding.spec.ts",
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
        // Replay + restyle only; agent-free by construction.
        "design-swap.spec.ts",
        // The deployed site has no agent, which is exactly the state this suite
        // reproduces locally by blocking the port — it runs as-is in production.
        "break-offline.spec.ts",
        // Agent-free by construction (blocks the agent port itself); the
        // validator, config, and downloads are static-site capabilities.
        "take-home.spec.ts",
        "prod-smoke.spec.ts",
      ],
      use: {
        storageState: {
          cookies: [],
          origins: [
            {
              origin: new URL(PROD).origin,
              localStorage: [{ name: "dspack-studio-tour-done", value: "1" }],
            },
          ],
        },
      },
    },
  ],
});
