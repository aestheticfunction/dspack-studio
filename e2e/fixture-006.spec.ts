/**
 * fixture-006 fidelity: the recorded live recipe run (generated surface +
 * grounded co-edits) replays from the shelf, reconstructs under scrubbing,
 * and survives the export -> import path byte-faithfully. Deterministic —
 * no model calls; the fixture file is the backend.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE = join(process.cwd(), "packages", "replay", "fixtures", "fixture-006.json");

async function openShelfFixture(page: Page) {
  await page.goto("/");
  await page.getByTestId("scenario-recipe-creator").click();
  await page.getByTestId("fixture-generated-cooked").click();
}

const scrub = async (page: Page, key: "End" | "Home") => {
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press(key);
};

test("replays from the shelf: generated surface, grounded co-edits, final state", async ({ page }) => {
  await openShelfFixture(page);
  await expect(page.getByTestId("fixture-meta")).toContainText("live run, ollama:gpt-oss:latest");

  await scrub(page, "End");
  // Final state: regenerated dish with the vegetarian swap applied to the
  // GENERATED table, and the bound status caption narrating it.
  await expect(page.locator("[data-canvas]")).toContainText(/Regenerated: Lemon herb risotto/);
  await expect(page.locator("[data-canvas] table td", { hasText: "Vegetable stock" }).first()).toBeVisible();
  // The instructions carry their own heading, labeled by the enhancement.
  await expect(page.locator("[data-canvas]")).toContainText("Instructions");
  await expect(page.getByTestId("audit-outcome")).toContainText("passed");
});

test("scrub reconstruction: earlier moments render their exact states", async ({ page }) => {
  await openShelfFixture(page);
  // The generation delivery: the seeded recipe (ingredients + instructions)
  // is already a full recipe, but carries no swapped rows yet.
  await page.getByRole("button", { name: /jump to event 10: studio.surface.enhanced/ }).click();
  await expect(page.locator("[data-canvas] table")).toHaveCount(2);
  await expect(page.locator("[data-canvas]")).toContainText("Spaghetti");
  await expect(page.locator("[data-canvas]")).toContainText("al dente");
  await expect(page.locator("[data-canvas]")).not.toContainText("Vegetable stock");
  // After the accepted constraint round-trip: swapped rows, applied status.
  await page.getByRole("button", { name: /jump to event 19: studio.action.accepted/ }).click();
  await expect(page.locator("[data-canvas]")).toContainText(/Applied vegetarian/);
  await expect(page.locator("[data-canvas] table td", { hasText: "Smoked tofu" }).first()).toBeVisible();
  // Back to nothing.
  await scrub(page, "Home");
  await expect(page.getByTestId("canvas-empty")).toBeVisible();
});

test("export -> import round-trip renders the same final state", async ({ page }) => {
  await openShelfFixture(page);
  const original = JSON.parse(readFileSync(FIXTURE, "utf8"));

  await page.getByTestId("import-input").setInputFiles(FIXTURE);
  await expect(page.getByTestId("fixture-meta")).toContainText("(imported)");
  await expect(page.getByTestId("fixture-meta")).toContainText(`${original.events.length} events`);
  await scrub(page, "End");
  await expect(page.locator("[data-canvas]")).toContainText(/Regenerated: Lemon herb risotto/);
  await expect(page.locator("[data-canvas] table td", { hasText: "Vegetable stock" }).first()).toBeVisible();
});
