/** Layout measurements and screenshots of the Library, for D0 before/after. */
const { chromium } = require("playwright");
const [url, out, dpr = "1"] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const res = {};
  for (const [w, h, first] of [[1280, 800, false], [1280, 800, true], [1440, 900, false], [1024, 768, false], [390, 844, false], [390, 844, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: Number(dpr) });
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }));
    if (!first) await p.addInitScript(() => { try { localStorage.setItem("composer.experimental.workspace.onboarding", JSON.stringify({ schema: "composer.experimental.workspace/onboarding", version: 1, data: { dismissed: true } })); } catch {} });
    await p.goto(url); await p.getByTestId("nav-library").click();
    await p.waitForSelector("[data-testid=instance-status], [data-testid=check-pill]"); await p.waitForTimeout(500);
    const m = await p.evaluate(() => {
      const frame = document.querySelector('[data-project-canvas="composer"]:not(.cl-frame--kept)');
      const rendered = frame?.querySelector("[data-a2ui-surface]") ?? frame;
      const canvas = document.querySelector(".cl-canvas");
      const r = rendered.getBoundingClientRect();
      return {
        compositionTop: Math.round(r.top),
        compositionWidth: Math.round(r.width),
        canvasShare: +(canvas.getBoundingClientRect().width / innerWidth).toFixed(3),
        pageScrollH: document.documentElement.scrollHeight,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        firstRun: !!document.querySelector("[data-testid=first-run]"),
      };
    });
    const key = `${w}x${h}${first ? "-first-run" : ""}`;
    res[key] = m;
    await p.screenshot({ path: `${out}/library-${key}.png` });
    if (w >= 1280 && !first) {
      await p.getByTestId("toggle-inspector").click(); await p.waitForTimeout(300);
      res[key].canvasShareInspector = await p.evaluate(() => +(document.querySelector(".cl-canvas").getBoundingClientRect().width / innerWidth).toFixed(3));
      await p.screenshot({ path: `${out}/library-${key}-inspector.png` });
    }
    await ctx.close();
  }
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})();
