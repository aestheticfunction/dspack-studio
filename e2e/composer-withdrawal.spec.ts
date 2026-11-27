/**
 * Approval withdrawal on this device (decision 34), in the experimental Library: withdraw an approval without
 * changing its definition, see that nothing uses it and nothing stands in for it, survive a reload, follow
 * another tab, and restore it only by an explicit decision with checks that pass now. Agent-free.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const NS = "composer.experimental.workspace.";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
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
const storage = (page: Page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
async function inspector(page: Page) {
  if ((await page.getByTestId("composition-library").getAttribute("data-inspector")) !== "open") await page.getByTestId("toggle-inspector").click();
  await page.getByTestId("tab-design").click();
}
async function withdraw(page: Page) {
  await inspector(page);
  await page.getByTestId("withdraw").click();
  await page.getByTestId("withdraw-confirm-button").click();
  await expect(page.getByTestId("approval-withdrawn")).toBeVisible();
}

test.describe("approval withdrawal", () => {
  test("withdrawing a packaged approval changes no definition: nothing is shown from it, no other version stands in, and a reload keeps it withdrawn", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await page.getByRole("radio", { name: /v1 Approved/i }).check();
    await ready(page);
    await inspector(page);
    await page.getByTestId("withdraw").click();
    const confirm = page.getByTestId("withdraw-confirm");
    await expect(confirm).toContainText("v1 stays exactly as it is: its definition and its recorded checks do not change.");
    await expect(confirm).toContainText("No other version is used in its place.");
    await expect(confirm).toContainText("It is a packaged approval: it is withdrawn on this device only, by a local record.");
    await expect(page.getByRole("button", { name: "Keep it approved" })).toBeFocused();
    const evidence = (await storage(page))[`${NS}approvals`];
    await page.getByTestId("withdraw-confirm-button").click();
    await expect(page.getByTestId("authoring-notice")).toContainText("The approval of v1 is withdrawn on this device. v1 itself is unchanged");
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "withdrawn");
    await expect(page.getByTestId("refusal")).toContainText("Approval withdrawn on this device");
    await expect(page.getByTestId("check-pill")).toHaveAttribute("data-state", "withdrawn");
    // The previous screen is kept for comparison only, not interactive.
    await expect(page.getByTestId("kept-instance").locator("summary")).toContainText("not interactive");
    await expect(page.getByRole("radio", { name: /v1 Approved · withdrawn/i })).toBeChecked();
    // Another example: still nothing shown from v1, and the draft is not used in its place.
    await page.getByTestId("scenario-two").click();
    await ready(page);
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "withdrawn");
    const stored = await storage(page);
    const record = JSON.parse(stored[`${NS}authorization`]!).data.withdrawn;
    expect(record).toEqual([{ composition: "hotel-results", version: 1, compositionSha256: expect.stringMatching(/^[0-9a-f]{64}$/), origin: "packaged" }]);
    expect(stored[`${NS}approvals`]).toBe(evidence);
    expect(stored[`${NS}versions`]).toBeUndefined();
    await page.reload();
    await ready(page);
    await page.getByRole("radio", { name: /v1 Approved · withdrawn/i }).check();
    await ready(page);
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "withdrawn");
  });

  test("restoring is an explicit decision that runs the checks now; a reload keeps it restored", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await page.getByRole("radio", { name: /v1 Approved/i }).check();
    await withdraw(page);
    await page.getByTestId("refusal-restore").click();
    const confirm = page.getByTestId("restore-confirm");
    await expect(confirm).toContainText("Its checks run again now; it is restored only if every example behaves as expected.");
    await page.getByTestId("restore-confirm-button").click();
    await expect(page.getByTestId("authoring-notice")).toContainText("Approval of v1 restored on this device: its checks pass now.");
    await expect(page.getByTestId("check-pill")).toHaveAttribute("data-state", "pass");
    await expect(page.getByRole("radio", { name: /^v1 Approved$/i })).toBeChecked();
    expect(JSON.parse((await storage(page))[`${NS}authorization`]!).data.withdrawn).toEqual([]);
    await page.reload();
    await ready(page);
    await page.getByRole("radio", { name: /v1 Approved/i }).check();
    await expect(page.getByTestId("check-pill")).toHaveAttribute("data-state", "pass");
  });

  test("a version approved on this device can be withdrawn; the earlier approved version is not selected in its place", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await page.getByRole("radio", { name: /v2 Draft/i }).check();
    await inspector(page);
    // The packaged draft's checks ran when the Library loaded: it can be approved.
    await expect(page.getByTestId("authoring-bar")).toHaveAttribute("data-state", "pass");
    await page.getByTestId("approve").click();
    await page.getByTestId("approve-confirm-button").click();
    await expect(page.getByRole("radio", { name: /v2 Approved/i })).toBeChecked();
    await withdraw(page);
    await expect(page.getByTestId("withdraw-confirm")).toHaveCount(0);
    const record = JSON.parse((await storage(page))[`${NS}authorization`]!).data.withdrawn;
    expect(record).toEqual([expect.objectContaining({ composition: "hotel-results", version: 2, origin: "device" })]);
    // The device's approved definition is still recorded, unchanged.
    expect(JSON.parse((await storage(page))[`${NS}versions`]!).data.approved.map((c: { version: number; status: string }) => `${c.version}:${c.status}`)).toEqual(["2:approved"]);
    await page.reload();
    await ready(page);
    // Opening the composition selects v2, withdrawn, as it is: v1 is not silently used instead.
    await expect(page.getByRole("radio", { name: /v2 Approved · withdrawn/i })).toBeChecked();
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "withdrawn");
    // v1 keeps its own approval.
    await page.getByRole("radio", { name: /v1 Approved/i }).check();
    await expect(page.getByTestId("check-pill")).toHaveAttribute("data-state", "pass");
  });

  test("another tab on this device follows a withdrawal at once", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const a = await context.newPage();
    const b = await context.newPage();
    await openLibrary(a);
    await openLibrary(b);
    await a.getByRole("radio", { name: /v1 Approved/i }).check();
    await b.getByRole("radio", { name: /v1 Approved/i }).check();
    await ready(b);
    await expect(b.getByTestId("check-pill")).toHaveAttribute("data-state", "pass");
    await withdraw(a);
    await expect(b.getByTestId("refusal")).toHaveAttribute("data-stage", "withdrawn");
    await expect(b.getByRole("radio", { name: /v1 Approved · withdrawn/i })).toBeChecked();
    await context.close();
  });

  for (const [w, h] of [
    [1280, 800],
    [390, 844],
  ] as const)
    test(`axe at ${w} px: the withdrawal confirmation and a withdrawn version, with no exceptions`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openLibrary(page);
      await page.getByRole("radio", { name: /v1 Approved/i }).check();
      await inspector(page);
      await page.getByTestId("withdraw").click();
      const c = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(c.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      await page.getByTestId("withdraw-confirm-button").click();
      await expect(page.getByTestId("approval-withdrawn")).toBeVisible();
      const d = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(d.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
});
