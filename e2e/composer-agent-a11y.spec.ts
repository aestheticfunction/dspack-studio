/**
 * Accessibility of the ledger-v2 decision surface (dspack-studio#32).
 *
 * These controls carry irreversible-feeling authorship decisions, so their
 * names must say WHICH component they act on, their outcomes must be
 * announced rather than merely painted, and the whole surface must survive
 * an axe pass. Automation is the floor; the manual screen-reader pass stays
 * in the release checklist.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { CONFLICT, PENDING, connect, demoProject, rediscover } from "./support/agent-project";

const scan = (page: Page) =>
  new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .disableRules(["region"]) // single-app shell; landmarks reviewed manually
    .analyze();

async function decisionSurface(page: Page) {
  const project = demoProject({ newComponentInSource: true, sourceEvolved: true });
  await connect(page, project.root);
  await rediscover(page);
  return project;
}

test("every decision control names the component it acts on", async ({ page }) => {
  await decisionSurface(page);

  // Ambiguous repeated names ("Restore", "Restore") are the failure mode:
  // several rows offer the same verb, so the accessible name must carry the id.
  const report = page.getByTestId("rediscovery-report");
  await expect(report.getByRole("button", { name: `Restore ${PENDING}` })).toBeVisible();
  await expect(report.getByRole("button", { name: `Never rediscover ${PENDING}` })).toBeVisible();
  await expect(report.getByRole("button", { name: `Keep ${CONFLICT} nested` })).toBeVisible();
  await expect(report.getByRole("button", { name: `Restore ${CONFLICT} as a top-level component` })).toBeVisible();
  // The ownership panel's twin controls name their surface, so a screen
  // reader never hears two identical "Restore" buttons.
  await expect(page.getByRole("button", { name: `Restore ${PENDING} from the ownership panel` })).toBeVisible();

  // Every Accept must say WHAT it accepts and for WHICH entry: several
  // rows render the same visible word.
  const accepts = page.getByTestId("fresh-facts").getByRole("button");
  const count = await accepts.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    expect(await accepts.nth(i).getAttribute("aria-label")).toMatch(/^Accept \/.+ for .+$/);
  }
});

test("decision outcomes are announced, not just painted", async ({ page }) => {
  await decisionSurface(page);
  const notice = page.getByTestId("notice");
  // A live region so a screen-reader user learns the decision landed.
  await expect(notice).toHaveAttribute("role", /status|alert/);
  await expect(notice).toHaveAttribute("aria-live", /polite|assertive/);

  await page.getByTestId("rediscovery-report").getByRole("button", { name: `Never rediscover ${PENDING}` }).click();
  await expect(notice).toContainText(PENDING);
});

test("the decision groups are labelled regions a keyboard user can navigate", async ({ page }) => {
  await decisionSurface(page);
  // Each group's heading must be associated with its container, so the
  // buttons inside are not orphan verbs in the accessibility tree.
  await expect(page.getByRole("group", { name: /deletions awaiting your decision/i })).toBeVisible();
  await expect(page.getByRole("group", { name: /restructured, not re-added/i })).toBeVisible();
  await expect(page.getByRole("group", { name: /fresh facts on entries you own/i })).toBeVisible();
});

test("the pending-decision surface has no axe violations", async ({ page }) => {
  await decisionSurface(page);
  await expect(page.getByTestId("rediscovery-report")).toBeVisible();
  const results = await scan(page);
  expect(results.violations, JSON.stringify(results.violations, null, 1)).toEqual([]);
});

test("the entry-level ownership panel has no axe violations after a decision", async ({ page }) => {
  await decisionSurface(page);
  await page.getByTestId(`tombstone-${PENDING}`).click();
  await expect(page.getByTestId(`entry-${PENDING}`)).toContainText("tombstoned");
  const results = await scan(page);
  expect(results.violations, JSON.stringify(results.violations, null, 1)).toEqual([]);
});

test("the inventory view with per-entry ownership chips has no axe violations", async ({ page }) => {
  await decisionSurface(page);
  await page.getByTestId("nav-inventory").click();
  await expect(page.getByTestId("inventory-info-card")).toBeVisible();
  const results = await scan(page);
  expect(results.violations, JSON.stringify(results.violations, null, 1)).toEqual([]);
});

test("a busy decision is announced and its controls are disabled while it runs", async ({ page }) => {
  await decisionSurface(page);
  // Add latency to the REAL save round-trip (the request still reaches the
  // agent) so the transient busy state is observable rather than raced.
  await page.route("**/project/save", async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    await route.continue();
  });
  const button = page.getByTestId(`tombstone-${PENDING}`);
  await button.dispatchEvent("click");
  // The whole decision surface locks, not just the pressed control: a second
  // decision computed from the same pre-save state would drop the first.
  await expect(button).toBeDisabled();
  await expect(page.getByTestId(`restore-${PENDING}`)).toBeDisabled();
  await expect(page.getByTestId("rediscover")).toBeDisabled();
  await expect(page.getByTestId(`entry-${PENDING}`)).toContainText("tombstoned");
  await expect(page.getByTestId("rediscover")).toBeEnabled();
});
