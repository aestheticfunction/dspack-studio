/**
 * Cross-tab authorization integrity (safeguards R1, R2), in two real tabs of one browser profile.
 *
 * Failing-first: each test below failed on the record-writing code before R1. That code wrote the
 * authorization record from each tab's in-memory copy, so one tab could erase another tab's withdrawal, which
 * then came back as an approval after a reload.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const DISMISSED = JSON.stringify({ schema: "composer.experimental.workspace/onboarding", version: 1, data: { dismissed: true } });

async function openLibrary(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));
  await page.addInitScript((v) => {
    if (!localStorage.getItem("composer.experimental.workspace.onboarding")) localStorage.setItem("composer.experimental.workspace.onboarding", v);
  }, DISMISSED);
  await page.goto("/");
  await page.getByTestId("nav-library").click();
  await ready(page);
}
const ready = (page: Page) => expect(page.getByTestId("check-pill")).not.toHaveAttribute("data-state", "loading", { timeout: 30_000 });
async function inspector(page: Page) {
  if ((await page.getByTestId("composition-library").getAttribute("data-inspector")) !== "open") await page.getByTestId("toggle-inspector").click();
  await page.getByTestId("tab-design").click();
}
async function choose(page: Page, composition: string) {
  if ((await page.getByTestId("composition-library").getAttribute("data-library")) !== "open") await page.getByTestId("toggle-library").click();
  await page.getByTestId("view-compositions").click();
  await page.getByTestId(`library-item-${composition}`).click();
  await ready(page);
}
async function startWithdraw(page: Page) {
  await inspector(page);
  await page.getByTestId("withdraw").click();
  await expect(page.getByTestId("withdraw-confirm-button")).toBeVisible();
}
async function twoTabs(browser: import("@playwright/test").Browser): Promise<{ context: BrowserContext; a: Page; b: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const a = await context.newPage();
  const b = await context.newPage();
  await openLibrary(a);
  await openLibrary(b);
  return { context, a, b };
}

test.describe("cross-tab authorization integrity", () => {
  test("reproduced: a withdrawal made in another tab is not erased by this tab's next withdrawal, and stays withdrawn after a reload", async ({ browser }) => {
    const { context, a, b } = await twoTabs(browser);
    // Tab A opened before tab B approved anything.
    await choose(a, "hotel-search");
    // Tab B approves the packaged v2 draft of Hotel results on this device, then withdraws that approval.
    await b.getByRole("radio", { name: /v2 Draft/i }).check();
    await inspector(b);
    await expect(b.getByTestId("authoring-bar")).toHaveAttribute("data-state", "pass");
    await b.getByTestId("approve").click();
    await b.getByTestId("approve-confirm-button").click();
    await expect(b.getByRole("radio", { name: /v2 Approved/i })).toBeChecked();
    await startWithdraw(b);
    await b.getByTestId("withdraw-confirm-button").click();
    await expect(b.getByTestId("approval-withdrawn")).toBeVisible();
    // Tab A, which never saw that version approved, withdraws Hotel search v1.
    await startWithdraw(a);
    await a.getByTestId("withdraw-confirm-button").click();
    await expect(a.getByTestId("approval-withdrawn")).toBeVisible();
    // After a reload, both withdrawals hold: Hotel results v2 did not come back as approved.
    await a.reload();
    await ready(a);
    await choose(a, "hotel-results");
    await expect(a.getByRole("radio", { name: /v2 Withdrawn/i })).toBeChecked();
    await expect(a.getByTestId("refusal")).toHaveAttribute("data-stage", "withdrawn");
    await choose(a, "hotel-search");
    await expect(a.getByTestId("refusal")).toHaveAttribute("data-stage", "withdrawn");
    await context.close();
  });

  test("concurrent withdrawals in two tabs are both kept", async ({ browser }) => {
    const { context, a, b } = await twoTabs(browser);
    await choose(a, "hotel-search");
    await b.getByRole("radio", { name: /v1 Approved/i }).check();
    await ready(b);
    await startWithdraw(a);
    await startWithdraw(b);
    // Both confirmations at once.
    await Promise.all([a.getByTestId("withdraw-confirm-button").click(), b.getByTestId("withdraw-confirm-button").click()]);
    await expect(a.getByTestId("approval-withdrawn")).toBeVisible();
    await expect(b.getByTestId("approval-withdrawn")).toBeVisible();
    for (const page of [a, b]) {
      await page.reload();
      await ready(page);
      await choose(page, "hotel-search");
      await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "withdrawn");
      await choose(page, "hotel-results");
      await page.getByRole("radio", { name: /v1 Withdrawn/i }).check();
      await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "withdrawn");
    }
    await context.close();
  });

  test("a restoration in another tab does not authorize this tab until it runs its own checks", async ({ browser }) => {
    const { context, a, b } = await twoTabs(browser);
    for (const page of [a, b]) {
      await page.getByRole("radio", { name: /v1 Approved/i }).check();
      await ready(page);
    }
    await startWithdraw(a);
    await a.getByTestId("withdraw-confirm-button").click();
    await expect(b.getByTestId("refusal")).toHaveAttribute("data-stage", "withdrawn");
    // Tab A restores, with its own passing checks.
    await a.getByTestId("refusal-restore").click();
    await a.getByTestId("restore-confirm-button").click();
    await expect(a.getByTestId("check-pill")).toHaveAttribute("data-state", "pass", { timeout: 20_000 });
    // Tab B is told, and stays refused until it checks here.
    await expect(b.getByTestId("restored-elsewhere")).toBeVisible();
    await expect(b.getByTestId("refusal")).toHaveAttribute("data-stage", "withdrawn");
    await b.getByTestId("restored-elsewhere-check").click();
    await expect(b.getByTestId("check-pill")).toHaveAttribute("data-state", "pass", { timeout: 20_000 });
    await context.close();
  });
});
