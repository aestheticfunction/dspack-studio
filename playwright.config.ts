import { defineConfig } from "@playwright/test";

/**
 * The e2e suite runs against the STATIC EXPORT (apps/web/out) served by a
 * zero-dependency file server — the same artifact that deploys — plus the
 * local agent for live-mode tests (scripted adapter: deterministic, zero
 * model calls, zero network beyond localhost).
 *
 * Run `pnpm --filter web build` first (CI does; the webServer commands below
 * do not rebuild to keep local iteration fast).
 */
const BASE_URL = "http://localhost:3311";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  // The local agent is deliberately single-session (one visitor, one
  // machine): interactive specs mutate its scenario state and grounding,
  // so parallel workers can race each other through it. One worker keeps
  // every run deterministic; the static production suite stays parallel.
  workers: 1,
  use: {
    baseURL: BASE_URL,
    // Deterministic CI: the homepage is alive by default (auto-plays the
    // first recording); under reduced motion it jumps to the finished
    // surface instead, which is also the stable state tests start from.
    contextOptions: { reducedMotion: "reduce" },
  },
  // The tour auto-starts for first-time visitors, so visitor history is part
  // of every test's premise. Two projects make it explicit: "first-run"
  // starts with clean storage (the auto-start spec), "studio" is seeded as a
  // returning visitor so every other spec keeps asserting the plain studio.
  projects: [
    {
      name: "first-run",
      testMatch: "tour-first-run.spec.ts",
    },
    {
      name: "studio",
      // prod-smoke asserts the DEPLOYED site's properties (no local agent,
      // injected analytics); it runs via playwright.production.config.ts only.
      // composer-prod-smoke targets the DEPLOYED composer app; it runs via
      // playwright.composer-production.config.ts only.
      testIgnore: ["prod-smoke.spec.ts", "composer-prod-smoke.spec.ts", "tour-first-run.spec.ts"],
      use: {
        storageState: {
          cookies: [],
          origins: [
            {
              origin: BASE_URL,
              localStorage: [{ name: "dspack-studio-tour-done", value: "1" }],
            },
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: "node e2e/serve-static.mjs",
      port: 3311,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm --filter agent dev",
      port: 8787,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
