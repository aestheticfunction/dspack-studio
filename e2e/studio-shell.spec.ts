/**
 * Studio shell: the first-visit comprehension layer — governance-first hero,
 * per-view helper text, the pipeline diagram, planned-scenario reveals, and
 * the FM-5 caption. Static-safe (no agent, no model calls); runs in the
 * production smoke suite too.
 */
import { expect, test } from "@playwright/test";

test("hero leads with the governance story, before any protocol name", async ({ page }) => {
  await page.goto("/");
  const main = page.locator("main");
  await expect(main).toContainText("The design system governs what the agent ships.");
  const text = (await main.innerText()) ?? "";
  const governanceIdx = text.indexOf("An agent proposes an interface.");
  const protocolIdx = text.search(/AG-UI|A2UI|Astryx/);
  expect(governanceIdx).toBeGreaterThanOrEqual(0);
  expect(protocolIdx).toBeGreaterThan(governanceIdx);
});

test("view switcher explains each view in one sentence", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-help")).toContainText("Recorded real runs");
  await page.getByTestId("view-canvas").click();
  await expect(page.getByTestId("view-help")).toContainText("restyled by the design system");
  await page.getByTestId("view-break").click();
  await expect(page.getByTestId("view-help")).toContainText("Deliberate failures");
  await page.getByTestId("view-live").click();
  await expect(page.getByTestId("view-help")).toContainText("agent on your machine");
});

test("the pipeline diagram names the honest pipeline in reading order", async ({ page }) => {
  await page.goto("/");
  const figure = page.getByTestId("pipeline-diagram");
  await expect(figure).toBeVisible();
  const text = (await figure.innerText()) ?? "";
  for (const stage of ["Prompt / agent", "dspack contract", "dspack-emit", "AG-UI", "A2UI", "Astryx"]) {
    expect(text).toContain(stage);
  }
  expect(text.indexOf("dspack contract")).toBeLessThan(text.indexOf("Astryx"));
  await expect(figure.locator("figcaption")).toContainText("One pipeline, inspectable at every joint");
});

test("the shelf carries six ready scenarios and no planned placeholders", async ({ page }) => {
  await page.goto("/");
  // The example-expansion milestone completed: every scenario is ready. The
  // planned-entry treatment (dimmed chip revealing its needs) stands by in
  // the shelf code for the next expansion, but nothing renders it today.
  for (const id of [
    "recipe-creator",
    "appointment-booking",
    "project-deletion",
    "support-triage",
    "onboarding",
    "hotel-reservations",
  ]) {
    await expect(page.getByTestId(`scenario-${id}`)).not.toContainText("(planned)");
  }
  await expect(page.getByTestId("planned-needs")).toHaveCount(0);
  // The last-flipped scenario actually selects.
  await page.getByTestId("scenario-hotel-reservations").click();
  await expect(page.getByTestId("fixture-argues-back")).toBeVisible();
});

test("restyle themes the active scenario's own surface", async ({ page }) => {
  await page.goto("/");
  // The default scenario is recipe-creator: restyle shows ITS recorded
  // surface, not another scenario's.
  await page.getByTestId("view-canvas").click();
  await expect(page.locator("[data-canvas]")).toContainText("Dietary constraint");
  // Switching scenarios stays in the restyle operation and swaps the surface.
  await page.getByTestId("scenario-appointment-booking").click();
  await expect(page.locator("[data-canvas]")).toContainText("Confirm booking");
  await page.getByTestId("scenario-project-deletion").click();
  await expect(page.locator("[data-canvas]")).toContainText("Delete");
});

test("restyle view carries the FM-5 caption and theme dial", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-canvas").click();
  await expect(page.getByTestId("fm5-caption")).toContainText("Nothing about this interface changed.");
  await page.getByRole("button", { name: "chocolate" }).click();
  await expect(page.getByTestId("fm5-caption")).toBeVisible();
});

test("mobile 375px: the diagram collapses and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByTestId("pipeline-diagram")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // The bus SVG is hidden at this width; the node cards remain readable.
  await expect(page.locator(".dgm-bus")).toBeHidden();
});

test("x-ray is reachable from the inspector components tab (keyboard path)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
  await page.getByTestId("inspector-open").click();
  await page.getByTestId("inspector-tab-components").click();
  const trace = page.locator('[data-testid^="trace-"]').first();
  await expect(trace).toBeVisible();
  await trace.click();
  await expect(page.getByTestId("xray-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("xray-card")).toContainText("created by");
});
