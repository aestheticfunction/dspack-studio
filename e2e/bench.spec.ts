/**
 * P4 canvas-remount benchmark (gated: BENCH=1). Measures the per-delivery
 * remount workaround under rapid interactive state patches: remount count,
 * processing time, click->paint latency, and focus/draft-input loss.
 */
import { expect, test } from "@playwright/test";

test("remount benchmark: rapid servings co-editing", async ({ page }) => {
  test.skip(!process.env.BENCH, "benchmark is manual (BENCH=1)");
  await page.goto("/");
  await page.getByTestId("scenario-recipe-creator").click();
  await page.getByTestId("view-live").click();
  await page.getByTestId("live-run").click();
  await expect(page.locator("[data-canvas]")).toContainText("Spaghetti", { timeout: 15_000 });

  const before = await page.evaluate(() => ({
    mounts: (window as any).__a2uiCanvasMounts ?? 0,
    processMs: (window as any).__a2uiProcessMs ?? 0,
  }));

  // Focus/draft-loss probe: type a draft into the constraint input first.
  const input = page.locator("[data-canvas] input").first();
  await input.fill("vegeta");
  await input.focus();

  const latencies: number[] = [];
  for (let i = 3; i <= 10; i++) {
    const t0 = Date.now();
    await page.locator("[data-canvas] button", { hasText: "More servings" }).first().click();
    await expect(page.locator("[data-canvas]")).toContainText(`Servings: ${i}`, { timeout: 5000 });
    latencies.push(Date.now() - t0);
  }

  const after = await page.evaluate(() => ({
    mounts: (window as any).__a2uiCanvasMounts ?? 0,
    processMs: (window as any).__a2uiProcessMs ?? 0,
    focusedTag: document.activeElement?.tagName,
    draft: (document.querySelector("[data-canvas] input") as HTMLInputElement | null)?.value,
    events: document.querySelector('[data-testid="fixture-meta"]')?.textContent,
  }));

  console.log(JSON.stringify({
    deliveries: 8,
    remounts: after.mounts - before.mounts,
    totalProcessMs: Math.round((after.processMs - before.processMs) * 10) / 10,
    clickToPaintMs: latencies,
    meanLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    focusRetained: after.focusedTag === "INPUT",
    draftRetained: after.draft === "vegeta",
    meta: after.events,
  }, null, 2));
});
