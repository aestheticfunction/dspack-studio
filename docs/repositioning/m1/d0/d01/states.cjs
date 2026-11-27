/** D0.1 key states: the one-hotel refusal, the draft's changes, and "Not now" after Reserve. Usage: node states.cjs <url> <dir> <dpr> */
const { chromium } = require("playwright");
const [url, out, dpr = "1"] = process.argv.slice(2);
const DISMISSED = JSON.stringify({ schema: "composer.experimental.workspace/onboarding", version: 1, data: { dismissed: true } });
(async () => {
  const b = await chromium.launch();
  const open = async (w, h) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: Number(dpr) });
    const p = await ctx.newPage();
    await p.addInitScript((v) => { try { localStorage.setItem("composer.experimental.workspace.onboarding", v); } catch {} }, DISMISSED);
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: '{"error":"unavailable"}' }));
    await p.goto(url); await p.getByTestId("nav-library").click();
    await p.waitForSelector('[data-testid="check-pill"]:not([data-state="loading"])'); await p.waitForTimeout(300);
    return p;
  };
  let p = await open(1280, 800);
  await p.getByTestId("scenario-one").click(); await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/state-refusal-1280.png` });
  await p.getByTestId("scenario-confirm").click(); await p.waitForTimeout(300);
  await p.locator('[data-project-canvas="composer"] button', { hasText: /^Reserve / }).click(); await p.waitForTimeout(200);
  await p.locator('[data-project-canvas="composer"] button', { hasText: "Not now" }).click(); await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/state-not-now-1280.png` });
  await p.getByRole("radio", { name: /v2 Draft/i }).check(); await p.getByTestId("scenario-three").click(); await p.waitForTimeout(300);
  const summary = p.locator('[data-testid="draft-note"] summary');
  if (await summary.count()) { await summary.click(); await p.waitForTimeout(200); }
  await p.screenshot({ path: `${out}/state-draft-1280.png` });
  await p.context().close();
  p = await open(390, 844);
  await p.getByTestId("scenario-one").click(); await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/state-refusal-390.png` });
  await b.close();
})();
