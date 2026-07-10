import { defineConfig } from "@playwright/test";

/**
 * The e2e suite runs against the STATIC EXPORT (apps/web/out) served by a
 * zero-dependency file server — the same artifact that deploys. Replay
 * fixtures are the backend, so the suite is fully deterministic: zero model
 * calls, zero network beyond localhost.
 *
 * Run `pnpm --filter web build` first (CI does; the webServer command below
 * does not rebuild to keep local iteration fast).
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3311",
  },
  webServer: {
    command: "node e2e/serve-static.mjs",
    port: 3311,
    reuseExistingServer: !process.env.CI,
  },
});
