/**
 * Agent-mode composer: the ledger-v2 decision controls, as a person meets
 * them (dspack-studio#32).
 *
 * composer-core and the agent routes already pin every ownership transition
 * and refusal in code. This layer pins that the RENDERED controls reach
 * them: real exported UI, real agent routes, real project files on disk —
 * no mocked transport, no hand-written ledgers.
 *
 * The premise: a copy of the shipped demo project (ledger v1, human-
 * enriched). One rediscovery migrates it and produces every decision family
 * at once, all from real source:
 *   - restructure conflicts   info-card-* — authored sub-components that
 *                             source still exports top-level (issue #13)
 *   - awaiting a decision     spark-line — present in source, absent from a
 *                             human-owned v1 section, so migration ASKS
 *   - fresh facts             a changed doc comment and a new cva variant
 *                             on entries the author owns
 */
import { expect, test, type Page } from "@playwright/test";
import {
  CONFLICT,
  CONFLICT_PARENT,
  ENRICHED,
  ENUM_ENRICHED,
  FRESH_DESCRIPTION,
  NEW_TONE,
  PENDING,
  connect,
  demoProject,
  rediscover,
  type DemoOptions,
} from "./support/agent-project";

async function migrated(page: Page, options: DemoOptions = {}) {
  const project = demoProject(options);
  await connect(page, project.root);
  await rediscover(page);
  return project;
}

test("a ledger-v1 project renders ONLY the section-level ownership experience", async ({ page }) => {
  const project = demoProject();
  await connect(page, project.root);

  await expect(page.getByTestId("ledger-components")).toContainText("human-owned");
  await expect(page.getByTestId("ledger-tokens")).toContainText("tool-owned");
  // Nothing entry-level is invented for a v1 document.
  await expect(page.getByTestId("entry-ledger")).toHaveCount(0);
  await expect(page.getByTestId("rediscovery-report")).toHaveCount(0);
  expect(project.ledger().ledger).toBeUndefined();
  // Connecting must REPLACE the demo, not bounce back to it.
  await expect(page.locator("header")).toContainText(project.root);
});

test("rediscovery migrates to v2 and surfaces every decision family without deciding any of them", async ({ page }) => {
  const project = await migrated(page, { newComponentInSource: true, sourceEvolved: true });

  await expect(page.getByTestId("deletions-awaiting")).toBeVisible();
  await expect(page.getByTestId(`deletion-${PENDING}`)).toBeVisible();
  await expect(page.getByTestId("conflicts-awaiting")).toBeVisible();
  await expect(page.getByTestId(`conflict-${CONFLICT}`)).toContainText(CONFLICT_PARENT);
  await expect(page.getByTestId("fresh-facts")).toBeVisible();

  const doc = project.contract();
  expect(doc.metadata["x-bootstrap"].ledger).toBe("2");
  expect(doc.components[PENDING]).toBeUndefined(); // asked, never silently added
  expect(doc.components[CONFLICT]).toBeUndefined(); // conflict, never auto-added
  expect(doc.metadata["x-bootstrap"].components[PENDING]).toBeDefined(); // memory seeded
  expect(doc.metadata["x-bootstrap"].doNotRediscover ?? []).toEqual([]); // never inferred
  await expect(page.getByTestId("entry-ledger")).toBeVisible();
  await expect(page.getByTestId(`entry-${PENDING}`)).toContainText("orphaned");
});

test("Restore clears the memory and the next rediscovery brings the component in", async ({ page }) => {
  const project = await migrated(page, { newComponentInSource: true });

  await page.getByTestId(`restore-${PENDING}`).click();
  await expect(page.getByTestId("notice")).toContainText(/next rediscovery/i);
  await expect(page.getByTestId(`deletion-${PENDING}`)).toHaveCount(0);
  expect(project.ledger().components[PENDING]).toBeUndefined();

  await rediscover(page);
  expect(project.contract().components[PENDING]).toBeDefined();
  await expect(page.getByTestId(`entry-${PENDING}`)).toContainText("tool-owned");
});

test("Never rediscover tombstones the id, and rediscovery keeps skipping it", async ({ page }) => {
  const project = await migrated(page, { newComponentInSource: true });

  await page.getByTestId(`tombstone-${PENDING}`).click();
  await expect(page.getByTestId("notice")).toContainText(/never re-add it/i);
  await expect(page.getByTestId(`entry-${PENDING}`)).toContainText("tombstoned");
  expect(project.ledger().doNotRediscover).toEqual([PENDING]);
  expect(project.ledger().components[PENDING]).toBeUndefined(); // decided: memory retired

  await rediscover(page);
  expect(project.contract().components[PENDING]).toBeUndefined();
  await expect(page.getByTestId(`deletion-${PENDING}`)).toHaveCount(0);
  await expect(page.getByTestId(`entry-${PENDING}`)).toContainText("tombstoned");
});

test("Remove tombstone lets the component return", async ({ page }) => {
  const project = await migrated(page, { newComponentInSource: true });
  await page.getByTestId(`tombstone-${PENDING}`).click();
  await expect(page.getByTestId(`entry-${PENDING}`)).toContainText("tombstoned");

  await page.getByTestId(`ownership-untombstone-${PENDING}`).click();
  await expect(page.getByTestId("notice")).toContainText(/may re-add/i);
  expect(project.ledger().doNotRediscover).toEqual([]);

  await rediscover(page);
  expect(project.contract().components[PENDING]).toBeDefined();
});

test("Keep nested tombstones the restructured id and the conflict stops being reported", async ({ page }) => {
  const project = await migrated(page);
  const nestedBefore = JSON.stringify(project.contract().components[CONFLICT_PARENT]);

  await page.getByTestId(`keep-nested-${CONFLICT}`).click();
  await expect(page.getByTestId("notice")).toContainText(/nested/i);
  await expect(page.getByTestId(`conflict-${CONFLICT}`)).toHaveCount(0);
  expect(project.ledger().doNotRediscover).toContain(CONFLICT);

  await rediscover(page);
  await expect(page.getByTestId(`conflict-${CONFLICT}`)).toHaveCount(0);
  expect(project.contract().components[CONFLICT]).toBeUndefined();
  // The authored nested representation is untouched by the decision.
  expect(JSON.stringify(project.contract().components[CONFLICT_PARENT])).toBe(nestedBefore);
});

test("Restore top-level adds the fresh entry tool-owned and preserves the nested representation", async ({ page }) => {
  const project = await migrated(page);
  const nestedBefore = JSON.stringify(project.contract().components[CONFLICT_PARENT]);

  await page.getByTestId(`restore-top-level-${CONFLICT}`).click();
  await expect(page.getByTestId("notice")).toContainText(/top-level/i);

  const doc = project.contract();
  expect(doc.components[CONFLICT]).toBeDefined();
  expect(JSON.stringify(doc.components[CONFLICT_PARENT])).toBe(nestedBefore); // both now exist
  await expect(page.getByTestId(`entry-${CONFLICT}`)).toContainText("tool-owned");
  await expect(page.getByTestId(`conflict-${CONFLICT}`)).toHaveCount(0);
  await expect(page.getByTestId("rediscovery-report")).toContainText("restored top-level");
});

test("an unresolved conflict persists across rediscoveries and is never silently re-added", async ({ page }) => {
  const project = await migrated(page);
  await expect(page.getByTestId(`conflict-${CONFLICT}`)).toBeVisible();

  await rediscover(page);
  await expect(page.getByTestId(`conflict-${CONFLICT}`)).toBeVisible(); // still asking
  expect(project.contract().components[CONFLICT]).toBeUndefined(); // still not added
  expect(project.ledger().doNotRediscover ?? []).not.toContain(CONFLICT); // never inferred
});

test("accepting a scalar-leaf fact writes exactly that value into the entry you own", async ({ page }) => {
  const project = await migrated(page, { sourceEvolved: true });
  const accept = page.getByTestId(`accept-${ENRICHED}-description`);
  await expect(accept).toBeVisible();
  expect(project.contract().components[ENRICHED].description).not.toBe(FRESH_DESCRIPTION);

  await accept.click();
  await expect(page.getByTestId("notice")).toContainText(/stays human-owned/i);
  expect(project.contract().components[ENRICHED].description).toBe(FRESH_DESCRIPTION);
  await expect(accept).toHaveCount(0); // reviewed: the fact is gone
  // Accepting does not claim ownership of the entry.
  await expect(page.getByTestId(`entry-${ENRICHED}`)).not.toContainText("tool-owned");
});

test("accepting an enum addition appends only the new value, keeping authored order", async ({ page }) => {
  const project = await migrated(page, { sourceEvolved: true });
  const before = project.contract().components[ENUM_ENRICHED].props.tone.values as string[];
  expect(before).not.toContain(NEW_TONE);

  await page.getByTestId(`accept-${ENUM_ENRICHED}-props-tone-values`).click();
  await expect(page.getByTestId("notice")).toContainText(/accepted/i);

  const after = project.contract().components[ENUM_ENRICHED].props.tone.values as string[];
  expect(after).toEqual([...before, NEW_TONE]); // append-only, order preserved
});

test("a decision survives a full page reload and reconnect", async ({ page }) => {
  const project = await migrated(page, { newComponentInSource: true });
  await page.getByTestId(`tombstone-${PENDING}`).click();
  await expect(page.getByTestId(`entry-${PENDING}`)).toContainText("tombstoned");

  await page.reload();
  await connect(page, project.root);
  await expect(page.getByTestId(`entry-${PENDING}`)).toContainText("tombstoned");
  expect(project.ledger().doNotRediscover).toEqual([PENDING]);
});

test("a refused action is surfaced verbatim and leaves the ledger untouched", async ({ page }) => {
  const project = await migrated(page);
  await expect(page.getByTestId(`conflict-${CONFLICT}`)).toBeVisible();

  // Another window (or an editor) tombstones the id while this view is open:
  // the restore intent now contradicts a standing decision, and the tool
  // refuses the whole run rather than resolving it for us.
  const doc = project.contract();
  doc.metadata["x-bootstrap"].doNotRediscover = [CONFLICT];
  project.writeContract(doc);
  const before = JSON.stringify(project.contract());

  await page.getByTestId(`restore-top-level-${CONFLICT}`).click();
  await expect(page.getByTestId("notice")).toContainText(/refused/i);
  await expect(page.getByTestId("notice")).toContainText(/doNotRediscover|tombstone/i);
  expect(JSON.stringify(project.contract())).toBe(before); // nothing written
});

test("double activation cannot submit the same decision twice", async ({ page }) => {
  const project = await migrated(page, { newComponentInSource: true });
  const button = page.getByTestId(`tombstone-${PENDING}`);

  // Latency on the REAL save (the request still reaches the agent) makes the
  // window between the two activations observable instead of theoretical.
  await page.route("**/project/save", async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    await route.continue();
  });
  await button.dispatchEvent("click");
  await expect(button).toBeDisabled();
  await button.dispatchEvent("click").catch(() => {});
  await expect(page.getByTestId(`entry-${PENDING}`)).toContainText("tombstoned");

  await expect.poll(() => project.ledger().doNotRediscover).toEqual([PENDING]); // exactly once
});

test("decisions are operable by keyboard, and focus is never dropped to the body", async ({ page }) => {
  const project = await migrated(page, { newComponentInSource: true });

  await page.getByTestId(`tombstone-${PENDING}`).focus();
  await expect(page.getByTestId(`tombstone-${PENDING}`)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId(`entry-${PENDING}`)).toContainText("tombstoned");
  expect(project.ledger().doNotRediscover).toEqual([PENDING]);

  // The row that held focus is gone; focus must land somewhere meaningful.
  const active = await page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? "");
  expect(active, "focus fell to the document body after the decided row disappeared").not.toBe("body");
});

test("an acknowledged casualty reads as a decision, not unfinished work (#30)", async ({ page }) => {
  const project = demoProject();
  await connect(page, project.root);

  // The project home: gates pass, the acknowledgement reported alongside.
  const row = page.getByTestId("progress").filter({ hasText: "Gates green" });
  await expect(row).toContainText("Gates pass · 1 acknowledged casualty");
  await expect(row).not.toContainText("error finding");

  // The Validate view still shows the refusal, its severity, and the
  // authored reason verbatim — classified, never suppressed.
  await page.getByTestId("nav-validate").click();
  const refusal = page.getByTestId("finding-A3-emit-surface");
  await expect(refusal).toContainText("error");
  await expect(refusal).toContainText("uses-casualty");
  await expect(refusal).toContainText(/declared casualty/i);
  await expect(refusal).toContainText(/steps is an array prop/);
  await expect(page.getByTestId("acknowledged-uses-casualty")).toBeVisible();

  // The decision survives a reload.
  await page.reload();
  await connect(page, project.root);
  await expect(page.getByTestId("progress").filter({ hasText: "Gates green" })).toContainText("acknowledged casualty");
});

test("a real error alongside an acknowledged casualty keeps the row failed (#30)", async ({ page }) => {
  const project = demoProject();
  // A surface referencing a component the profile does not map at all: a
  // genuine unresolved refusal, sitting beside the authored casualty.
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    `${project.root}/surfaces/unknown-component.dsurface.json`,
    JSON.stringify({ dspackSurface: "0.1", system: "Acme UI", intent: "unknown-probe", root: { component: "not-a-component" } }, null, 2),
  );
  await connect(page, project.root);

  const row = page.getByTestId("progress").filter({ hasText: "Gates green" });
  await expect(row).toContainText("1 error finding · 1 acknowledged casualty");
  await page.getByTestId("nav-validate").click();
  // Only the authored one is classified; the unknown component is not.
  await expect(page.getByTestId("acknowledged-uses-casualty")).toBeVisible();
  await expect(page.getByTestId("acknowledged-unknown-component")).toHaveCount(0);
});
