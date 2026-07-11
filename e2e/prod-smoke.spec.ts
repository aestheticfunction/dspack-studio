/**
 * Production-only smoke: clean console and network on load, the offline
 * live-mode explanation (the static preview ships no agent), mobile
 * viewport, and the client bundle's hygiene (no private hosts, local
 * paths, or credential-shaped strings in anything the page fetches).
 */
import { expect, test } from "@playwright/test";

test("loads with no console errors and no failed requests", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failed: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    consoleErrors.push(`${m.location().url ?? ""} ${m.text()}`);
  });
  page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.url()} ${r.status()}`));

  await page.goto("/");
  await expect(page.locator("[data-canvas] [data-a2ui-id]").first()).toBeVisible();
  // Expected non-defects: the live-mode health probe of the (absent) local
  // agent, and the zone-injected Cloudflare Web Analytics beacon (blocked
  // in sandboxed/ad-blocked environments; async and harmless either way).
  const expected = (e: string) => e.includes("localhost:8787") || e.includes("cloudflareinsights.com");
  const realConsole = consoleErrors.filter((e) => !expected(e));
  const realFailed = failed.filter((f) => !expected(f));
  expect(realConsole, realConsole.join("\n")).toEqual([]);
  expect(realFailed, realFailed.join("\n")).toEqual([]);
});

test("live mode states plainly that it needs a local agent", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-live").click();
  await expect(page.locator("main")).toContainText(/agent (is )?offline|start it: pnpm --filter agent dev|local agent/i, { timeout: 15_000 });
});

test("client traffic carries no private hosts, local paths, or key material", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (r) => {
    const t = r.headers()["content-type"] ?? "";
    if (/(javascript|json|html)/.test(t) && r.status() === 200) {
      try {
        bodies.push(await r.text());
      } catch {
        /* streamed/opaque */
      }
    }
  });
  await page.goto("/");
  await expect(page.locator("[data-canvas] [data-a2ui-id]").first()).toBeVisible();
  const all = bodies.join("\n");
  expect(all).not.toMatch(/100\.\d+\.\d+\.\d+/); // private tailnet hosts
  expect(all).not.toContain("/Users/");
  expect(all).not.toMatch(/sk-ant|ANTHROPIC_API_KEY=|npm_[A-Za-z0-9]{20,}/);
  expect(all).not.toMatch(/reconcil(iation|e) engine internals/i);
});

test("mobile 375px: no horizontal scroll, controls reachable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("xray-toggle")).toBeVisible();
  await expect(page.getByTestId("fork")).toBeVisible();
});
