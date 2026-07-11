/**
 * FM-12 e2e: the receipt panel renders the run's evidence, the download's
 * canonical hash equals an independent recomputation from the fixture file
 * (the byte-match boundary crossing the UI), verification of the matching
 * receipt says so, and a receipt from a DIFFERENT run is a loud mismatch.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { parseFixture } from "../packages/replay/src/fixture";
import { buildReceipt } from "../packages/replay/src/receipt";

const scrubToEnd = async (page: Page) => {
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
};

test("receipt renders evidence and its download matches an independent recomputation", async ({ page }, testInfo) => {
  await page.goto("/");
  await scrubToEnd(page);
  await page.getByTestId("receipt-summary").click();

  await expect(page.getByTestId("receipt-summary")).toContainText("passed");
  await expect(page.getByTestId("receipt-attempts")).toContainText("#0: S1✓ S2✓ S3✗"); // the argue-back
  await expect(page.getByTestId("receipt-gates")).toContainText("0.9.1");
  const shownHash = (await page.getByTestId("receipt-hash").textContent())!.trim();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("receipt-download").click();
  const download = await downloadPromise;
  const doc = JSON.parse(readFileSync((await download.path())!, "utf8"));

  // Independent recomputation from the bundled fixture file itself.
  const fixture = parseFixture(JSON.parse(readFileSync(join(process.cwd(), "packages", "replay", "fixtures", "fixture-001.json"), "utf8")));
  const independent = await buildReceipt(fixture, { intent: fixture.intent, prompt: fixture.prompt });
  expect(doc.canonicalSha256).toBe(independent!.canonicalSha256);
  expect(doc.canonicalSha256).toBe(shownHash);

  // Verifying the matching receipt: match, said plainly.
  await page.getByTestId("receipt-verify-input").setInputFiles((await download.path())!);
  await expect(page.getByTestId("receipt-verdict")).toContainText("verified");

  // A receipt from a DIFFERENT run: loud mismatch, never silent.
  const other = parseFixture(JSON.parse(readFileSync(join(process.cwd(), "packages", "replay", "fixtures", "fixture-006.json"), "utf8")));
  const wrong = await buildReceipt(other, { intent: other.intent, prompt: other.prompt });
  const wrongPath = testInfo.outputPath("wrong-receipt.json");
  writeFileSync(wrongPath, JSON.stringify(wrong));
  await page.getByTestId("receipt-verify-input").setInputFiles(wrongPath);
  await expect(page.getByTestId("receipt-verdict")).toContainText("MISMATCH");
});
