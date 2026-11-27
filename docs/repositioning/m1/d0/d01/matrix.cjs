/**
 * D0.1 layout and typography matrix for the Library: every viewport, version and panel configuration.
 * Reference point: the top of the white canvas frame (the composition's frame), the same for before and after.
 * Usage: node matrix.cjs <url> <out.json> [screenshot-dir]
 */
const { chromium } = require("playwright");
const [url, out, shots] = process.argv.slice(2);
const fs = require("fs");
const DISMISSED = JSON.stringify({ schema: "composer.experimental.workspace/onboarding", version: 1, data: { dismissed: true } });
const VIEWPORTS = [[1440, 900, ["none", "library", "inspector", "both"]], [1280, 800, ["none", "library", "inspector"]], [1024, 768, ["none", "library", "inspector"]], [390, 844, ["none"]]];

async function setPanels(p, want) {
  for (const panel of ["library", "inspector"]) {
    const t = p.getByTestId(`toggle-${panel}`);
    const isOpen = (await t.getAttribute("aria-expanded")) === "true";
    const should = want === "both" || want === panel;
    if (isOpen !== should) { await t.click(); await p.waitForTimeout(150); }
  }
  // Opening one below 1440 closes the other: re-check the wanted one.
  if (want !== "none" && want !== "both") {
    const t = p.getByTestId(`toggle-${want}`);
    if ((await t.getAttribute("aria-expanded")) !== "true") { await t.click(); await p.waitForTimeout(150); }
  }
}

const measure = () => {
  const frame = document.querySelector('[data-project-canvas="composer"]:not(.cl-frame--kept)');
  const surface = frame?.querySelector("[data-a2ui-surface]");
  const canvas = document.querySelector(".cl-canvas");
  const chips = document.querySelector('[data-testid="scenario-chips"]');
  const cr = chips.getBoundingClientRect();
  const fit = document.querySelector('[data-testid="fit-width"]');
  const fr = fit && fit.getClientRects().length ? fit.getBoundingClientRect() : null;
  let hidden = 0, clipped = 0;
  for (const c of chips.querySelectorAll("button")) {
    const r = c.getBoundingClientRect();
    let h = Math.max(0, r.right - cr.right) + Math.max(0, cr.left - r.left);
    if (fr && r.right > fr.left && r.left < fr.right && r.bottom > fr.top && r.top < fr.bottom) h = Math.max(h, Math.min(r.right, fr.right) - Math.max(r.left, fr.left));
    if (h > 1) { clipped++; hidden += h; }
  }
  const title = document.querySelector("#cl-canvas-title").getBoundingClientRect();
  const toggles = [...document.querySelectorAll('[data-testid^="toggle-"]')].map((t) => t.getBoundingClientRect());
  const mid = (r) => r.top + r.height / 2;
  const togglesWrap = toggles.some((t) => Math.abs(mid(t) - mid(title)) > 12);
  // Type: the smallest visible text in the workspace (outside the canvas frame and visually hidden text).
  let minFont = 99, minFontText = "";
  const walker = document.createTreeWalker(document.querySelector(".cl"), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || el.closest('[data-project-canvas], .cl-sr, style, [hidden], .cl-tool__text')) continue;
    const st = getComputedStyle(el);
    if (st.position === "absolute" && st.clip !== "auto") continue;
    if (!el.getClientRects().length) continue;
    const f = parseFloat(st.fontSize);
    if (f < minFont) { minFont = f; minFontText = n.textContent.trim().slice(0, 30); }
  }
  const head = document.querySelector(".cl-head");
  if (head) for (const el of head.querySelectorAll("*")) { if (el.getClientRects().length && el.childNodes.length && [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) { const f = parseFloat(getComputedStyle(el).fontSize); if (f < minFont) { minFont = f; minFontText = el.textContent.trim().slice(0, 30); } } }
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--green").trim();
  const toRgb = (hex) => { const m = hex.replace("#", ""); return `rgb(${parseInt(m.slice(0, 2), 16)}, ${parseInt(m.slice(2, 4), 16)}, ${parseInt(m.slice(4, 6), 16)})`; };
  const solidAccent = [...document.querySelectorAll(".cl button, .cl label")].filter((b) => !b.closest("[data-project-canvas]") && b.getClientRects().length && getComputedStyle(b).backgroundColor === toRgb(accent)).map((b) => b.textContent.trim().slice(0, 20));
  return {
    frameTop: frame ? Math.round(frame.getBoundingClientRect().top) : null,
    surfaceTop: surface ? Math.round(surface.getBoundingClientRect().top) : null,
    canvasShare: +(canvas.getBoundingClientRect().width / innerWidth).toFixed(3),
    chipsClipped: clipped, chipsHiddenPx: Math.round(hidden), togglesWrap,
    toolbarHeight: Math.round(document.querySelector(".cl-toolbar").getBoundingClientRect().height),
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    minFont, minFontText, solidAccent,
  };
};

(async () => {
  const b = await chromium.launch();
  const res = {};
  for (const [w, h, panelSets] of VIEWPORTS) {
    for (const version of [1, 2]) {
      for (const panels of panelSets) {
        for (const first of w === 1280 || w === 390 ? (version === 1 && panels === (w === 390 ? "none" : "library") ? [false, true] : [false]) : [false]) {
          const ctx = await b.newContext({ viewport: { width: w, height: h } });
          const p = await ctx.newPage();
          await p.route("**/api/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }));
          if (!first) await p.addInitScript((v) => { try { localStorage.setItem("composer.experimental.workspace.onboarding", v); } catch {} }, DISMISSED);
          await p.goto(url);
          await p.getByTestId("nav-library").click();
          await p.waitForSelector('[data-testid="check-pill"]:not([data-state="loading"]), [data-testid="instance-status"]');
          await p.getByRole("radio", { name: new RegExp(`v${version} `, "i") }).check();
          await p.waitForTimeout(250);
          if (w !== 390) await setPanels(p, panels);
          await p.waitForTimeout(300);
          const key = `${w}x${h} v${version} ${panels}${first ? " first-run" : ""}`;
          res[key] = await p.evaluate(measure);
          if (w === 390) {
            res[key].targets = await p.evaluate(() => Object.fromEntries([["toggles", '[data-testid^="toggle-"]'], ["versions", ".cl-seg__opt"], ["chips", ".cl-chip"], ["guideLink", '[data-testid="first-run-strip"] button']].map(([k, sel]) => [k, Math.min(...[...document.querySelectorAll(sel)].map((e) => Math.round(e.getBoundingClientRect().height)).concat(999))])));
          }
          if (shots) await p.screenshot({ path: `${shots}/${key.replace(/ /g, "_")}.png` });
          await ctx.close();
        }
      }
    }
  }
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  for (const [k, v] of Object.entries(res)) console.log(k.padEnd(34), "frame", v.frameTop, "surf", v.surfaceTop, "share", v.canvasShare, "clipped", v.chipsClipped, v.chipsHiddenPx + "px", "wrap", v.togglesWrap, "font", v.minFont, JSON.stringify(v.minFontText), v.solidAccent.length ? "ACCENT:" + v.solidAccent.join("|") : "", v.targets ? JSON.stringify(v.targets) : "");
  await b.close();
})();
