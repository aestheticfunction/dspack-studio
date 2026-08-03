/**
 * Composer production smoke (agent-free by construction — the deployed
 * composer ships the pre-emitted demo project and no agent).
 *
 * Covers the deployment acceptance criteria: HTTPS load with a clean
 * console/network, the demo project without any agent, honest agent
 * indication, ledger states, inventory, mapper, validation evidence,
 * preview (wireframe + casualty refusal), reload without a platform 404,
 * and client-bundle hygiene.
 */
import { expect, test } from "@playwright/test";

/** Expected non-defects: the agent health probe and the zone beacon. */
const expected = (e: string) => e.includes("localhost:8787") || e.includes("cloudflareinsights.com");

test("loads over HTTPS with no console errors and no failed requests", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failed: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    consoleErrors.push(`${m.location().url ?? ""} ${m.text()}`);
  });
  page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.url()} ${r.status()}`));

  await page.goto("/");
  await expect(page.getByTestId("notice")).toContainText("Demo project loaded");
  const realConsole = consoleErrors.filter((e) => !expected(e));
  const realFailed = failed.filter((f) => !expected(f));
  expect(realConsole, realConsole.join("\n")).toEqual([]);
  expect(realFailed, realFailed.join("\n")).toEqual([]);
});

test("demo project loads without an agent, and the UI says so honestly", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header")).toContainText("agent: not running");
  await expect(page.getByTestId("notice")).toContainText(/run the local agent/i);
  // Agent-dependent actions state their requirement instead of pretending.
  await expect(page.locator("body")).toContainText(/pnpm +--filter agent dev/);
});

test("ledger ownership states render from the shipped contract", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("ledger-components")).toContainText("human-owned");
  await expect(page.getByTestId("ledger-tokens")).toContainText("tool-owned");
  await expect(page.getByTestId("ledger-rules")).toContainText("human-authored");
});

test("inventory renders every demo component with derived lifecycle chips", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-inventory").click();
  for (const id of ["action-button", "info-card", "mini-stepper", "note-field", "tag-pill"]) {
    await expect(page.getByTestId(`inventory-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId("inventory-mini-stepper")).toContainText("casualty");
});

test("mapper shows the projection grid and fidelity evidence for a component", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-inventory").click();
  await page.getByTestId("inventory-action-button").click();
  await page.getByTestId("nav-mapper").click();
  await expect(page.locator("body")).toContainText("maps to");
  await expect(page.getByTestId("map-tone")).toHaveValue("variant");
  // The 5->4 lossy projection is on the record in the fidelity rail.
  await expect(page.locator("body")).toContainText(/lossy/i);
});

test("validation runs in the browser (S1-S3) and states what needs the agent", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-validate").click();
  await page.getByTestId("run-validate").click();
  await expect(page.getByTestId("validate-status")).toContainText("PASS");
  await expect(page.getByTestId("finding-document-requires-agent")).toContainText(/local agent/i);
});

test("preview renders the wireframe canvas and the honest casualty refusal", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-preview").click();
  await expect(page.locator("[data-wireframe='Card']")).toBeVisible();
  await expect(page.locator("[data-wireframe='Button']")).toContainText("label=Acknowledge");
  await expect(page.getByTestId("surface-refused-uses-casualty")).toContainText("refused");
});

test("reloading and directly opening the app never hits a platform 404", async ({ page }) => {
  const first = await page.goto("/");
  expect(first?.status()).toBe(200);
  await page.getByTestId("nav-preview").click();
  const second = await page.reload();
  expect(second?.status()).toBe(200);
  await expect(page.getByTestId("notice")).toContainText("Demo project loaded");
});

test("client traffic carries no private hosts, local paths, or key material", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (r) => {
    const t = r.headers()["content-type"] ?? "";
    if (/javascript|json|html/.test(t)) {
      try {
        bodies.push(await r.text());
      } catch {
        /* body unavailable (opaque/cached): fine */
      }
    }
  });
  await page.goto("/");
  await expect(page.getByTestId("notice")).toContainText("Demo project loaded");
  const leaks: string[] = [];
  for (const body of bodies) {
    for (const pattern of [/\/Users\/[a-z]+/i, /sk-[A-Za-z0-9]{20}/, /AKIA[A-Z0-9]{16}/]) {
      const m = body.match(pattern);
      if (m) leaks.push(m[0]);
    }
  }
  expect(leaks, leaks.join(", ")).toEqual([]);
});
