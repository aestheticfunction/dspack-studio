/**
 * D1 in a real browser: the Astryx sample's plan comparison in Composer's Preview, drawn by the default
 * build, before (the deployed production site, which is main) and after (a local default build of this
 * branch). For every option card it records what is drawn, what the accessibility tree says, and keyboard
 * focus; and it saves a screenshot of the comparison on both.
 *
 *   node verify_d1.cjs <before-url> <after-url> <screenshot-dir> > d1-browser.json
 *
 * The local default build is served with:
 *   pnpm --filter composer build && node e2e/serve-composer.mjs   (PORT, default 3312)
 */
const { chromium } = require("playwright");
const { join } = require("node:path");

const [before, after, shots] = process.argv.slice(2);

async function inspect(browser, base, label) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  await page.route("**/api/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }));
  await page.goto(base);
  await page.getByTestId("new-project-name").fill(`d1 ${label}`);
  await page.getByTestId("new-source-astryx").click();
  await page.getByTestId("new-project-create").click();
  await page.getByTestId("nav-preview").click();
  await page.getByTestId("surface-ex.plan-comparison").click();
  const cards = page.locator("[data-project-canvas] [data-a2ui-component=SelectableCard]");
  await cards.first().waitFor();
  await page.waitForTimeout(400);
  const result = [];
  for (let i = 0; i < (await cards.count()); i++) {
    const card = cards.nth(i);
    const info = await card.evaluate((el) => {
      const input = el.querySelector("input[type=checkbox]");
      const name = el.querySelector("[data-selectable-card-name]");
      const visibleText = [...el.querySelectorAll("*")].filter((n) => n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && n.checkVisibility()).map((n) => [...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent.trim()).join(" ")).filter(Boolean);
      return { accessibleName: input?.getAttribute("aria-label") ?? null, drawnName: name?.textContent ?? null, drawnNameHidden: name?.getAttribute("aria-hidden") ?? null, firstVisibleText: visibleText[0] ?? null, headings: el.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]").length };
    });
    // What a screen reader is given for the card: the accessibility tree.
    const aria = await card.ariaSnapshot();
    const label = info.accessibleName ?? "";
    const occurrences = label ? aria.split(label).length - 1 : 0;
    result.push({ ...info, visibleNameIsTheLabel: !!label && info.firstVisibleText === label, ariaSnapshot: aria, labelInAccessibilityTree: occurrences });
  }
  // Keyboard: Tab reaches each card's checkbox, and the card shows a focus ring.
  await page.locator("[data-project-canvas]").first().click({ position: { x: 2, y: 2 } });
  const focus = [];
  for (let i = 0; i < 25 && focus.length < result.length; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => {
      const a = document.activeElement;
      const card = a?.closest("[data-a2ui-component=SelectableCard]");
      if (!card || a.tagName !== "INPUT") return null;
      const box = card.firstElementChild ?? card;
      const s = getComputedStyle(box);
      return { name: a.getAttribute("aria-label"), ring: s.outlineStyle !== "none" && s.outlineWidth !== "0px" ? `${s.outlineStyle} ${s.outlineWidth}` : "none" };
    });
    if (f && !focus.some((x) => x.name === f.name)) focus.push(f);
  }
  await page.locator("[data-project-canvas]").first().screenshot({ path: join(shots, `plan-comparison-${label}.png`) });
  await page.close();
  return { url: base, cards: result, keyboard: focus, pageErrors: errors };
}

(async () => {
  const browser = await chromium.launch();
  const b = await inspect(browser, before, "before");
  const a = await inspect(browser, after, "after");
  await browser.close();
  const pass =
    a.cards.length > 0 &&
    a.cards.every((c) => c.visibleNameIsTheLabel && c.drawnNameHidden === "true" && c.headings === 0 && c.labelInAccessibilityTree === 1) &&
    a.keyboard.length === a.cards.length &&
    a.pageErrors.length === 0;
  console.log(JSON.stringify({ before: b, after: a, pass }, null, 2));
  process.exit(pass ? 0 : 1);
})();
