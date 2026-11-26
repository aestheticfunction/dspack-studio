/**
 * The Astryx list-semantics correction, in a real browser: what axe reports, what the list contains, where
 * every option card sits, and a screenshot, for
 *   - the plan comparison in Composer's Preview (default build), and
 *   - hotel results on Composer's own canvas (the R1a fidelity page on the 0.10 stack).
 * Run once before and once after the adapter change; the two reports are compared by compare.
 *
 *   node verify_list.cjs <composer-url> <fidelity-010.html> <out-dir> <label> > list-<label>.json
 */
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");
const { join } = require("node:path");

const [base, fidelity, out, label] = process.argv.slice(2);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function inspect(page, scope, shot) {
  const axe = await new AxeBuilder({ page }).include(scope).withTags(TAGS).analyze();
  const structure = await page.evaluate((sel) =>
    [...document.querySelectorAll(`${sel} .astryx-list`)].map((ul) => ({
      tag: ul.tagName,
      role: ul.getAttribute("role"),
      children: [...ul.children].map((c) => c.tagName + (c.getAttribute("role") ? `[${c.getAttribute("role")}]` : "")),
      nestedListItems: ul.querySelectorAll("li li").length,
    })), scope);
  const boxes = await page.evaluate((sel) =>
    [...document.querySelectorAll(`${sel} [data-a2ui-component=SelectableCard]`)].map((el) => {
      // The provenance wrapper is display: contents; the card is its first element.
      const r = (el.firstElementChild ?? el).getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    }), scope);
  const tree = await page.locator(`${scope} .astryx-list`).first().ariaSnapshot();
  await page.locator(scope).first().screenshot({ path: join(out, shot) });
  return { violations: axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) })), structure, cardBoxes: boxes, ariaSnapshot: tree };
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route("**/api/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }));
  await page.goto(base);
  await page.getByTestId("new-project-name").fill(`list ${label}`);
  await page.getByTestId("new-source-astryx").click();
  await page.getByTestId("new-project-create").click();
  await page.getByTestId("nav-preview").click();
  await page.getByTestId("surface-ex.plan-comparison").click();
  await page.locator("[data-project-canvas] [data-a2ui-component=SelectableCard]").first().waitFor();
  await page.waitForTimeout(400);
  const plan = await inspect(page, "[data-project-canvas]", `plan-comparison-${label}.png`);
  // Keyboard: Tab reaches each option card's checkbox in order.
  await page.locator("[data-project-canvas]").first().click({ position: { x: 2, y: 2 } });
  const tabbed = [];
  for (let i = 0; i < 20 && tabbed.length < 2; i++) {
    await page.keyboard.press("Tab");
    const n = await page.evaluate(() => (document.activeElement?.closest("[data-a2ui-component=SelectableCard]") && document.activeElement.tagName === "INPUT" ? document.activeElement.getAttribute("aria-label") : null));
    if (n && !tabbed.includes(n)) tabbed.push(n);
  }
  plan.keyboard = tabbed;
  await page.goto(`file://${fidelity}?case=results-three`);
  await page.locator("[data-a2ui-component=SelectableCard]").first().waitFor();
  await page.waitForTimeout(300);
  const hotel = await inspect(page, "[data-canvas]", `hotel-results-${label}.png`);
  await browser.close();
  console.log(JSON.stringify({ label, planComparison: plan, hotelResults: hotel }, null, 2));
})();
