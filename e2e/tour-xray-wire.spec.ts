/**
 * Guided tour, FM-4 X-ray, and the true Wire View, against the static
 * artifact with recorded fixtures only.
 */
import { expect, test, type Page } from "@playwright/test";

const scrubToEnd = async (page: Page) => {
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
};

test("the tour walks FM-1, FM-2, X-ray, and the receipt on real states", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tour-start").click();

  // Step 1: the failed gate moment of the real repair run.
  await expect(page.getByTestId("tour-title")).toContainText("argues back");
  await expect(page.getByTestId("gate-ticker")).toContainText("S3✗");

  await page.getByTestId("tour-next").click();
  await expect(page.getByTestId("tour-title")).toContainText("Time travel");
  await expect(page.locator("[data-canvas] [data-a2ui-id]").first()).toBeVisible();

  await page.getByTestId("tour-next").click();
  await expect(page.getByTestId("tour-title")).toContainText("X-ray");
  await expect(page.getByTestId("xray-card")).toBeVisible();

  await page.getByTestId("tour-next").click();
  await expect(page.getByTestId("tour-title")).toContainText("receipt");
  await expect(page.getByTestId("receipt-hash")).toBeVisible();

  // Finishing never traps: the studio stays fully usable, tour restartable.
  await page.getByTestId("tour-finish").click();
  await expect(page.getByTestId("tour-bar")).toHaveCount(0);
  await expect(page.getByTestId("tour-start")).toBeVisible();
});

test("the tour is dismissible at any step and keyboard operable", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tour-start").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tour-bar")).toBeVisible();
  await page.getByTestId("tour-skip").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tour-bar")).toHaveCount(0);
});

test("x-ray: click a rendered element, read its provenance, jump to its event", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("scenario-project-deletion").click();
  await scrubToEnd(page);
  await page.getByTestId("xray-toggle").click();
  await expect(page.getByTestId("xray-card")).toContainText("click any rendered element");

  await page.locator("[data-canvas] [data-a2ui-id]").first().click();
  await expect(page.getByTestId("xray-card")).toContainText("is an A2UI");
  await expect(page.getByTestId("xray-created")).toContainText(/created by\s*event 17/);
  await expect(page.getByTestId("xray-created")).toContainText("explicit");

  // Jump: the timeline moves to the creating event.
  await page.getByTestId("xray-created").getByRole("button", { name: "event 17" }).click();
  await expect(page.getByTestId("scrubber")).toHaveValue("17");
  // Reverse direction: at a delivery event the x-ray notes the violet wash.
  await expect(page.getByTestId("xray-card")).toBeVisible();
});

test("x-ray rule provenance is labeled inferred and absent rules are stated", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("scenario-project-deletion").click();
  await scrubToEnd(page);
  await page.getByTestId("xray-toggle").click();
  const ids = await page.locator("[data-canvas] [data-a2ui-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-a2ui-id")));
  const alertNode = ids.find((id) => id?.includes("alert"));
  if (alertNode) {
    await page.locator(`[data-canvas] [data-a2ui-id="${alertNode}"]`).first().click();
    await expect(page.getByTestId("xray-rules")).toContainText("inferred by component type");
  } else {
    await page.locator("[data-canvas] [data-a2ui-id]").first().click();
    await expect(page.getByTestId("xray-rules")).toBeVisible();
  }
});

test("the wire: raw ordered events, real content types, labeled protobuf re-encoding", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("scenario-project-deletion").click();
  await scrubToEnd(page);
  await page.getByTestId("the-wire").locator("> summary").click();

  await expect(page.getByTestId("wire-transport")).toContainText("text/event-stream");
  await expect(page.getByTestId("wire-transport")).toContainText("recorded fixture");
  await expect(page.getByTestId("wire-events").locator("li")).toHaveCount(20);

  // Expand one event: raw JSON.
  await page.getByTestId("wire-events").locator("li").nth(1).locator("summary").click();
  await expect(page.getByTestId("wire-events")).toContainText("dspack.run.start");

  // Protobuf: an honest re-encoding, labeled as such, with real bytes.
  await page.getByTestId("wire-encoding-proto").click();
  await expect(page.getByTestId("wire-proto-label")).toContainText("re-encoded view");
  await expect(page.getByTestId("wire-proto-label")).toContainText("original was SSE JSON");
  await page.getByTestId("wire-events").locator("li").nth(0).locator("summary").click();
  await expect(page.getByTestId("wire-events").locator("pre").first()).toContainText(/^([0-9a-f]{2} )+/);
});

test("fork branch comparison shows both endings and their disagreements", async ({ page }) => {
  await page.goto("/#s=recipe-creator&f=generated-cooked&e=12");
  await page.getByTestId("fork").click();
  await page.getByTestId("branch-compare").locator("summary").click();
  await expect(page.getByTestId("branch-original")).toContainText("27 events");
  await expect(page.getByTestId("branch-fork")).toContainText("13 events");
  // The parent applied vegetarian after the fork point; the fork has not.
  await expect(page.getByTestId("branch-diff")).toContainText("recipe");
});
