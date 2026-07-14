/**
 * FM-11 take-it-home e2e. Three honesty checks in the receipts spirit:
 * the in-page validator reproduces fixture-001's RECORDED findings for the
 * recorded attempt-0 surface (browser validator == recorded pipeline); the
 * downloadable contract byte-matches the byte-synced repo copy; the MCP
 * config pins ds-mcp to 0.3.1+ (the re-pinned schema). The whole view is
 * static-site-complete: the suite blocks the agent at the network layer and
 * everything still works.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const fixture001 = JSON.parse(
  readFileSync(join(process.cwd(), "packages", "replay", "fixtures", "fixture-001.json"), "utf-8"),
) as { events: Array<{ event: { type: string; name?: string; value?: any } }> };

/** The recorded caught attempt: first dspack.gates event with a failed gate. */
const recordedCatch = fixture001.events
  .map((e) => e.event)
  .find((ev) => ev.type === "CUSTOM" && ev.name === "dspack.gates" && ev.value.gates.some((g: any) => g.status === "FAIL"))!.value as {
  surface: unknown;
  findings: Array<{ ruleId: string; message: string; rationale: string }>;
};

async function gotoTakeHome(page: Page) {
  // The deployed static site has no agent; reproduce that here so the view
  // is proven agent-free (the production suite runs this spec as-is).
  await page.route("http://localhost:8787/**", (r) => r.abort());
  await page.route("http://127.0.0.1:8787/**", (r) => r.abort());
  await page.goto("/");
  await page.getByTestId("view-home").click();
  await expect(page.getByTestId("take-home")).toBeVisible();
}

test("the view states its scope and the MCP config pins ds-mcp 0.3.1+", async ({ page }) => {
  await gotoTakeHome(page);
  await expect(page.getByTestId("view-help")).toContainText("your own editor");
  const config = await page.getByTestId("mcp-config").textContent();
  const parsed = JSON.parse(config!) as { mcpServers: Record<string, { command: string; args: string[] }> };
  const server = parsed.mcpServers["design-system"];
  expect(server.command).toBe("npx");
  const ref = server.args.find((a) => a.startsWith("@aestheticfunction/ds-mcp@"))!;
  const [major, minor, patch] = ref.split("@")[2].replace(/^[\^~]/, "").split(".").map(Number);
  expect(major * 1_000_000 + minor * 1_000 + patch).toBeGreaterThanOrEqual(3_001);
  await expect(page.getByTestId("mcp-version-note")).toContainText("pre-0.1.1 generation schema");
});

test("honesty: the downloadable contract byte-matches the byte-synced repo copy", async ({ page, request }) => {
  await gotoTakeHome(page);
  const href = await page.getByTestId("contract-download").getAttribute("href");
  const served = await (await request.get(href!)).text();
  const repoCopy = readFileSync(join(process.cwd(), "packages", "contracts", "astryx.dspack.json"), "utf-8");
  expect(served).toBe(repoCopy);
});

test("honesty: the in-page validator reproduces fixture-001's recorded findings", async ({ page }) => {
  await gotoTakeHome(page);
  await page.getByTestId("validate-load-example").click();
  // The textarea now carries the recorded attempt-0 surface verbatim.
  const pasted = await page.getByTestId("validate-input").inputValue();
  expect(JSON.parse(pasted)).toEqual(recordedCatch.surface);
  await page.getByTestId("validate-run").click();
  await expect(page.getByTestId("validate-verdict")).toContainText("Gates failed");
  const findings = page.getByTestId("validate-finding");
  await expect(findings).toHaveCount(recordedCatch.findings.length);
  for (const [i, recorded] of recordedCatch.findings.entries()) {
    await expect(findings.nth(i)).toContainText(recorded.ruleId);
    await expect(findings.nth(i)).toContainText(recorded.message);
    await expect(findings.nth(i)).toContainText(recorded.rationale);
  }
});

test("a clean surface passes and a malformed paste is rejected verbatim, nothing evaluated", async ({ page }) => {
  await gotoTakeHome(page);
  const contract = JSON.parse(
    readFileSync(join(process.cwd(), "packages", "contracts", "astryx.dspack.json"), "utf-8"),
  ) as { examples: Array<{ surface: unknown }> };
  await page.getByTestId("validate-input").fill(JSON.stringify(contract.examples[0].surface));
  await page.getByTestId("validate-run").click();
  await expect(page.getByTestId("validate-verdict")).toContainText("All gates pass");
  await page.getByTestId("validate-input").fill("{this is not json");
  await page.getByTestId("validate-run").click();
  await expect(page.getByTestId("validate-rejected")).toContainText("not JSON");
  await expect(page.getByTestId("validate-report")).toHaveCount(0);
});

test("the local-agent path is copy-paste commands and honest offline status", async ({ page }) => {
  await gotoTakeHome(page);
  const commands = await page.getByTestId("local-agent-commands").textContent();
  expect(commands).toContain("git clone https://github.com/aestheticfunction/dspack-studio.git");
  expect(commands).toContain("pnpm --filter agent dev");
  // Agent blocked at the network layer: the status line must not claim a live agent.
  await expect(page.getByTestId("local-agent-status")).toContainText("Once it answers");
});

test("take-home view has no axe violations", async ({ page }) => {
  await gotoTakeHome(page);
  await page.getByTestId("validate-load-example").click();
  await page.getByTestId("validate-run").click();
  await expect(page.getByTestId("validate-report")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .disableRules(["region"]) // single-app shell; landmarks reviewed manually
    .analyze();
  expect(results.violations).toEqual([]);
});
