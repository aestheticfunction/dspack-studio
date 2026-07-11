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
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  // prod-smoke asserts the DEPLOYED site's properties (no local agent,
  // injected analytics); it runs via playwright.production.config.ts only.
  testIgnore: ["prod-smoke.spec.ts"],
  use: {
    baseURL: "http://localhost:3311",
    // Deterministic CI: the homepage is alive by default (auto-plays the
    // first recording); under reduced motion it jumps to the finished
    // surface instead, which is also the stable state tests start from.
    contextOptions: { reducedMotion: "reduce" },
  },
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
