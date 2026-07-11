/**
 * FM-3 deterministic continuation: fork fixture-006 right after generation,
 * rebuild the agent's scenario state from the prefix (POST /fork — reset +
 * grounding restore + accepted-action replay), then take a DIFFERENT action
 * than the parent did. The branches genuinely diverge: the parent applied
 * "vegetarian"; the fork applies "vegan". No model calls — the deterministic
 * responders are the continuation engine.
 */
import { expect, test, type Page } from "@playwright/test";

const openShelf = async (page: Page) => {
  await page.goto("/");
  await page.getByTestId("scenario-recipe-creator").click();
  await page.getByTestId("fixture-generated-cooked").click();
};

test("a fork continues with a different constraint; the parent keeps its own", async ({ page }) => {
  await openShelf(page);

  // Fork at the end of generation, before the parent's first action.
  await page.getByRole("button", { name: "jump to event 12: RUN_FINISHED" }).click();
  await page.getByTestId("fork").click();
  await expect(page.getByTestId("fork-12")).toBeVisible();
  await expect(page.getByTestId("fixture-meta")).toContainText("13 events");

  // Rebuild the agent's session from the prefix and continue.
  await page.getByTestId("fork-continue").click();
  await expect(page.getByTestId("fork-continuing")).toBeVisible();

  // Diverge: vegan, not the parent's vegetarian.
  await page.locator("[data-canvas] input").first().fill("vegan");
  await page.locator("[data-canvas] button", { hasText: /apply/i }).first().click();
  await expect(page.locator("[data-canvas]")).toContainText(/Applied vegan/, { timeout: 10_000 });
  await expect(page.locator("[data-canvas] table td", { hasText: "Nutritional yeast" }).first()).toBeVisible();

  // The branch grew: the continuation round-trip is ON the fork's timeline.
  await expect(page.getByRole("button", { name: /jump to event 1[4-9]: studio.action.accepted/ })).toBeVisible();

  // The parent is untouched: its own branch still ends vegetarian-regenerated.
  await page.getByTestId("fixture-generated-cooked").click();
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
  await expect(page.locator("[data-canvas] table td", { hasText: "Vegetable stock" }).first()).toBeVisible();
  await expect(page.locator("[data-canvas]")).not.toContainText("Nutritional yeast");
  await expect(page.getByTestId("fixture-meta")).toContainText("27 events");
});

test("a fork after the parent's accepted action replays it, then diverges further", async ({ page }) => {
  await openShelf(page);

  // Fork after the parent's vegetarian application was accepted.
  await page.getByRole("button", { name: "jump to event 19: studio.action.accepted" }).click();
  await page.getByTestId("fork").click();
  await page.getByTestId("fork-continue").click();
  await expect(page.getByTestId("fork-continuing")).toBeVisible();

  // The replayed state carries vegetarian; regenerating from here keeps it.
  await page.locator("[data-canvas] button", { hasText: /regenerate/i }).first().click();
  await expect(page.locator("[data-canvas]")).toContainText(/Regenerated:/, { timeout: 10_000 });
  await expect(page.locator("[data-canvas] table td", { hasText: "Vegetable stock" }).first()).toBeVisible();
});

test("a continued fork exports with its branch events and provenance", async ({ page }) => {
  await openShelf(page);
  await page.getByRole("button", { name: "jump to event 12: RUN_FINISHED" }).click();
  await page.getByTestId("fork").click();
  await page.getByTestId("fork-continue").click();
  await expect(page.getByTestId("fork-continuing")).toBeVisible();
  await page.locator("[data-canvas] input").first().fill("gluten-free");
  await page.locator("[data-canvas] button", { hasText: /apply/i }).first().click();
  await expect(page.locator("[data-canvas]")).toContainText(/Applied gluten-free/, { timeout: 10_000 });

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("fork-download").click();
  const download = await downloadPromise;
  const fs = await import("node:fs");
  const doc = JSON.parse(fs.readFileSync((await download.path())!, "utf8"));
  expect(doc.fork.forkIndex).toBe(12);
  expect(doc.events.length).toBeGreaterThan(13); // prefix + the new branch
  const names = doc.events.map((e: any) => e.event.name ?? e.event.type);
  expect(names).toContain("studio.action.accepted");
  expect(names.slice(0, 13)).not.toContain("studio.action.accepted"); // prefix untouched
});
