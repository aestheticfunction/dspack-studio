/**
 * Workspace appearance (experimental, T4): the governed themes, Neutral dark, Neutral light and Custom, compiled by
 * the shared theme compiler, and the workspace choices. What an appearance may change is Composer's chrome; what it
 * must never change is asserted here: the canvas's computed styles, the colour scheme the design system inherits,
 * and every governance record (drafts, versions, approvals, checks). Agent-free: nothing here calls a model.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const NS = "composer.experimental.workspace.";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const DISMISSED = JSON.stringify({ schema: "composer.experimental.workspace/onboarding", version: 1, data: { dismissed: true } });
const APPEARANCE_KEYS = [`${NS}appearance`, "composer.appearance.v1"];

async function open(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));
  await page.addInitScript((v) => {
    if (!sessionStorage.getItem("onboarding-seeded")) {
      localStorage.setItem("composer.experimental.workspace.onboarding", v);
      sessionStorage.setItem("onboarding-seeded", "1");
    }
  }, DISMISSED);
  await page.goto("/");
}
const ready = (page: Page) => expect(page.getByTestId("check-pill")).not.toHaveAttribute("data-state", "loading", { timeout: 30_000 });
async function library(page: Page) {
  await page.getByTestId("nav-library").click();
  await ready(page);
}
async function settings(page: Page) {
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("workspace-appearance")).toBeVisible();
}
async function pick(page: Page, base: string) {
  await page.getByTestId(`theme-${base}`).click();
  await expect(page.getByTestId(`theme-${base}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("appearance-status")).toHaveAttribute("data-ok", "true");
}
const storage = (page: Page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
const without = (s: Record<string, string | null>, keys: string[]) => Object.fromEntries(Object.entries(s).filter(([k]) => !keys.includes(k)));
const chrome = (page: Page) => page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return { bg: cs.getPropertyValue("--bg").trim(), fg: cs.getPropertyValue("--fg").trim(), theme: document.documentElement.getAttribute("data-theme") };
});

/** Every computed property an appearance could plausibly reach, for the canvas and everything drawn in it. */
const canvasStyles = (page: Page) =>
  page.locator('[data-project-canvas="composer"]:not(.cl-frame--kept)').evaluate((frame) => {
    const props = ["color", "background-color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-transform", "border-top-color", "border-top-width", "border-radius", "box-shadow", "color-scheme", "padding-top", "padding-left", "margin-top", "gap", "outline-color"];
    const read = (el: Element) => {
      const cs = getComputedStyle(el);
      return props.map((p) => `${p}=${cs.getPropertyValue(p)}`).join(";");
    };
    const frameOwn = getComputedStyle(frame);
    return {
      frame: ["background-color", "color", "color-scheme", "font-family", "font-size"].map((p) => `${p}=${frameOwn.getPropertyValue(p)}`).join(";"),
      inside: [...frame.querySelectorAll("*")].map((el) => `${el.tagName.toLowerCase()}.${el.className && typeof el.className === "string" ? el.className.split(" ")[0] : ""} ${read(el)}`),
    };
  });

test.describe("appearances", () => {
  test("Settings offers the three governed themes, Neutral dark, Neutral light and Custom; a neutral or custom one is compiled and applied to the chrome", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    await settings(page);
    const group = page.getByTestId("appearance");
    for (const name of ["Aesthetic Function", "Ember", "Slate", "Neutral dark", "Neutral light", "Custom"]) await expect(group.getByRole("button", { name: new RegExp(name) })).toBeVisible();
    await expect(page.getByTestId("theme-default")).toHaveAttribute("aria-pressed", "true");
    const before = await chrome(page);

    await pick(page, "neutral-light");
    await expect(page.getByTestId("appearance-status")).toContainText(/Applied\. \d+ contrast checks pass/);
    const light = await chrome(page);
    expect(light.theme).toBe("workspace");
    expect(light.bg).not.toBe(before.bg);

    await pick(page, "neutral-dark");
    const dark = await chrome(page);
    expect(dark.bg).not.toBe(light.bg);

    await pick(page, "custom");
    await expect(page.getByTestId("custom-direction")).toBeVisible();
    await page.getByTestId("custom-scheme").selectOption("light");
    await expect(page.getByTestId("appearance-status")).toHaveAttribute("data-ok", "true");
    const custom1 = await chrome(page);
    await page.getByTestId("custom-surfaceHue").selectOption("amber");
    await expect(page.getByTestId("appearance-status")).toHaveAttribute("data-ok", "true");
    expect((await chrome(page)).bg).not.toBe(custom1.bg);

    // What is kept is the choice, a closed-enum proposal: never a colour.
    const stored = JSON.parse((await storage(page))[`${NS}appearance`]!);
    expect(stored).toMatchObject({ schema: "composer.experimental.workspace/appearance", version: 1, data: { base: "custom", custom: { scheme: "light", surfaceHue: "amber" } } });
    expect(JSON.stringify(stored)).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|--/i);
  });

  test("a governed theme goes through the existing preference, which the default build reads", async ({ page }) => {
    await open(page);
    await settings(page);
    await pick(page, "ember");
    expect((await storage(page))["composer.appearance.v1"]).toBe("ember");
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("ember");
    await pick(page, "neutral-dark");
    await pick(page, "default");
    expect((await storage(page))["composer.appearance.v1"]).toBe("default");
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBeNull();
  });

  test("the choice survives a reload; a malformed or tampered record is not applied and the default appearance stays", async ({ page }) => {
    await open(page);
    await settings(page);
    const initial = await chrome(page);
    await pick(page, "neutral-light");
    const light = await chrome(page);
    await page.reload();
    await expect.poll(() => chrome(page)).toEqual(light);
    await settings(page);
    await expect(page.getByTestId("theme-neutral-light")).toHaveAttribute("aria-pressed", "true");

    for (const tampered of [
      "{not json",
      JSON.stringify({ schema: "composer.experimental.workspace/appearance", version: 1, data: { base: "neutral-light", custom: {}, workspace: {}, vars: { "--bg": "#ff0000" } } }),
      JSON.stringify({ schema: "composer.experimental.workspace/appearance", version: 9, data: {} }),
    ]) {
      await page.evaluate(([k, v]) => {
        localStorage.setItem(k!, v!);
        localStorage.removeItem("composer.appearance.v1");
      }, [`${NS}appearance`, tampered]);
      await page.reload();
      await expect(page.getByTestId("nav-settings")).toBeVisible();
      expect(await chrome(page)).toEqual(initial);
    }
  });
});

test.describe("isolation", () => {
  test("the canvas's computed styles and the colour scheme it inherits are identical under every appearance and workspace choice", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    await library(page);
    const reference = await canvasStyles(page);
    expect(reference.inside.length).toBeGreaterThan(40);
    expect(reference.frame).toContain("color-scheme=light");
    const scheme = () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
    const rootScheme = await scheme();

    const variants: Array<[string, Record<string, string>]> = [
      ["ember", {}],
      ["neutral-light", {}],
      ["neutral-dark", {}],
      ["custom", {}],
      ["neutral-light", { "ws-density": "compact", "ws-textScale": "large", "ws-labelCase": "capitals", "ws-display": "brand", "ws-surround": "dark" }],
      ["neutral-dark", { "ws-surround": "light" }],
    ];
    for (const [base, choices] of variants) {
      await settings(page);
      await pick(page, base);
      for (const [id, value] of Object.entries(choices)) {
        await page.getByTestId(id).selectOption(value);
        await expect(page.getByTestId("appearance-status")).toHaveAttribute("data-ok", "true");
      }
      await library(page);
      const now = await canvasStyles(page);
      expect(now.frame, `${base} ${JSON.stringify(choices)}`).toBe(reference.frame);
      expect(now.inside, `${base} ${JSON.stringify(choices)}`).toEqual(reference.inside);
      expect(await scheme(), base).toBe(rootScheme);
    }
  });

  test("changing the appearance changes no draft, version, approval or check: only the appearance records move", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    await library(page);
    // A draft on this device, so there is a governance record to protect.
    if ((await page.getByTestId("composition-library").getAttribute("data-library")) !== "open") await page.getByTestId("toggle-library").click();
    await page.getByTestId("library-item-hotel-search").click();
    await page.getByTestId("create-draft").click();
    await expect(page.getByRole("radio", { name: /v2 Draft/i })).toBeChecked();
    await page.getByRole("radio", { name: /v1 Approved/i }).check();
    // Settle: the Library records each version's runtime check when it loads, so the baseline is taken after a load.
    await page.reload();
    await library(page);
    const pill = await page.getByTestId("check-pill").getAttribute("data-state");
    const before = without(await storage(page), APPEARANCE_KEYS);
    expect(Object.keys(before)).toContain(`${NS}drafts`);

    for (const base of ["neutral-light", "custom", "slate", "neutral-dark"]) {
      await settings(page);
      await pick(page, base);
      await page.getByTestId("ws-density").selectOption(base === "custom" ? "compact" : "comfortable");
    }
    await library(page);
    expect(without(await storage(page), APPEARANCE_KEYS)).toEqual(before);
    await expect(page.getByTestId("check-pill")).toHaveAttribute("data-state", pill!);
  });
});

test.describe("workspace choices", () => {
  test("density, text size, label case, header and canvas surround take effect on the workspace", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    await library(page);
    const measure = () =>
      page.evaluate(() => {
        const title = document.querySelector(".cl-title, .cl-head h2, .cl-head h1") as HTMLElement | null;
        const stage = document.querySelector(".cl-stage") as HTMLElement;
        const nav = document.querySelector(".af-nav__link") as HTMLElement;
        return {
          title: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
          stagePad: getComputedStyle(stage).paddingTop,
          stageBg: getComputedStyle(stage).backgroundColor,
          navFont: getComputedStyle(nav).fontFamily,
          header: document.documentElement.getAttribute("data-ws-header"),
        };
      });
    const base = await measure();
    expect(base.title).toBeGreaterThan(0);
    await settings(page);
    await pick(page, "neutral-light");
    for (const [id, v] of [["ws-textScale", "large"], ["ws-surround", "dark"], ["ws-display", "plain"], ["ws-labelCase", "capitals"]] as const) {
      await page.getByTestId(id).selectOption(v);
      await expect(page.getByTestId("appearance-status")).toHaveAttribute("data-ok", "true");
    }
    await library(page);
    const after = await measure();
    expect(after.title).toBeCloseTo(base.title * 1.125, 0);
    expect(after.stagePad).toBe("16px");
    expect(after.stageBg).not.toBe(base.stageBg);
    expect(after.header).toBe("plain");
    expect(after.navFont).not.toBe(base.navFont);
    await expect(page.locator(".cl-label").first()).toHaveCSS("text-transform", "uppercase");
  });

  test("compact density tightens the workspace without breaking the D0.1 type floor or 24 px targets", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    await settings(page);
    await pick(page, "neutral-light");
    await page.getByTestId("ws-density").selectOption("compact");
    await library(page);
    const faults = await page.evaluate(() => {
      const out: string[] = [];
      const root = document.querySelector('[data-testid="composition-library"]')!;
      for (const el of root.querySelectorAll("*")) {
        if (el.closest("[data-project-canvas]") || !el.getClientRects().length) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
        if (own && parseFloat(getComputedStyle(el).fontSize) < 12) out.push(`text ${el.textContent!.trim().slice(0, 30)}`);
        if (el.matches("button, select, input:not([type=radio]):not([type=checkbox]), [role=radio]")) {
          const r = el.getBoundingClientRect();
          if (r.height < 24 && r.width > 0) out.push(`target ${el.textContent!.trim().slice(0, 30) || el.getAttribute("aria-label")} ${r.height}`);
        }
      }
      return out;
    });
    expect(faults).toEqual([]);
  });
});

test.describe("accessibility", () => {
  for (const base of ["neutral-light", "neutral-dark"])
    for (const [w, h] of [
      [1280, 800],
      [390, 844],
    ] as const)
      test(`axe: Settings and the Library under ${base} at ${w} px, with no exceptions`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await open(page);
        await settings(page);
        await pick(page, base);
        const s = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(s.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
        await library(page);
        const l = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(l.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      });
});
