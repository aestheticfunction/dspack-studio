/**
 * Real project files for the agent-mode composer suite.
 *
 * Each spec gets its own temp copy of the shipped demo project
 * (apps/composer/demo-project — a real dspack-export bootstrap with real
 * React source), so the agent reads and WRITES actual files exactly as it
 * does for a user. Nothing here mocks the pipeline: discovery, merging, and
 * ownership all run in the published packages.
 *
 * The demo project ships a ledger-v1 contract whose `info-card` entry
 * declares authored sub-components that source still exports top-level, so
 * one rediscovery always produces restructure conflicts. The two options
 * below add the other decision families the same way a real project would:
 * by changing source.
 */
import { appendFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const DEMO = fileURLToPath(new URL("../../apps/composer/demo-project", import.meta.url));

/** Ids the demo project produces naturally, used across the specs. */
export const CONFLICT = "info-card-header";
export const CONFLICT_PARENT = "info-card";
/** A component present in source but not in the v1 contract: it must ASK. */
export const PENDING = "spark-line";
/** The entry whose source description changes, producing a scalar-leaf fact. */
export const ENRICHED = "mini-stepper";
/** The entry whose cva gains a variant value, producing a pure-addition fact. */
export const ENUM_ENRICHED = "action-button";
export const NEW_TONE = "spotlight";
/** The doc comment source grows; it becomes the fresh `/description` fact. */
export const FRESH_DESCRIPTION = "Compact progress indicator, now documented for dense layouts.";

export interface DemoProject {
  root: string;
  contractPath: string;
  contract: () => Record<string, any>;
  ledger: () => Record<string, any>;
  writeContract: (doc: Record<string, any>) => void;
}

export interface DemoOptions {
  /** Add a genuinely new component to source (`spark-line`). */
  newComponentInSource?: boolean;
  /**
   * Evolve source so enriched entries carry fresh facts to review: a changed
   * doc comment (scalar leaf on `mini-stepper`) and a new cva variant value
   * (pure addition on `action-button`).
   */
  sourceEvolved?: boolean;
}

export function demoProject(options: DemoOptions = {}): DemoProject {
  const root = mkdtempSync(join(tmpdir(), "composer-agent-"));
  cpSync(DEMO, root, { recursive: true });
  const contractPath = join(root, "acme-ui.dspack.json");
  const read = () => JSON.parse(readFileSync(contractPath, "utf8")) as Record<string, any>;
  const write = (doc: Record<string, any>) => writeFileSync(contractPath, `${JSON.stringify(doc, null, 2)}\n`);

  if (options.newComponentInSource) {
    writeFileSync(
      join(root, "components", "ui", "spark-line.tsx"),
      [
        "import * as React from 'react';",
        "export interface SparkLineProps extends React.HTMLAttributes<SVGElement> {",
        "  /** Data points, newest last. */",
        "  points: number[];",
        "}",
        "/** Tiny inline trend line. */",
        "export const SparkLine = ({ points, ...props }: SparkLineProps) => (",
        "  <svg {...props} className=\"acme-spark-line\" />",
        ");",
        "",
      ].join("\n"),
    );
  }

  if (options.sourceEvolved) {
    const stepper = join(root, "components", "ui", "mini-stepper.tsx");
    writeFileSync(
      stepper,
      readFileSync(stepper, "utf8").replace(
        "/** Compact progress indicator. Steps are data, not children. */",
        `/** ${FRESH_DESCRIPTION} */`,
      ),
    );
    const button = join(root, "components", "ui", "action-button.tsx");
    writeFileSync(
      button,
      readFileSync(button, "utf8").replace(
        "        plain: 'bg-transparent underline-offset-4 hover:underline',",
        `        plain: 'bg-transparent underline-offset-4 hover:underline',\n        ${NEW_TONE}: 'bg-[var(--acme-brand)] ring-2 ring-offset-2',`,
      ),
    );
  }

  return { root, contractPath, contract: read, ledger: () => read().metadata["x-bootstrap"], writeContract: write };
}

/** Append to a source file (used to make a later rediscovery differ). */
export function appendSource(root: string, file: string, text: string): void {
  appendFileSync(join(root, "components", "ui", file), text);
}

/** Connect the composer UI to a project directory, the way a person does. */
export async function connect(page: Page, root: string): Promise<void> {
  await page.goto("/");
  // New flow: the Projects hub is the entry; "Connect a repository" opens the
  // Connect view, where a path becomes a project bound to that repository. Go
  // to the hub explicitly — a reload/reconnect reopens the last project onto
  // Build, and the hub's source picker is only there.
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("new-source-connect").click();
  await page.getByTestId("new-project-connect").click();
  await page.getByTestId("project-path").waitFor();
  await page.getByTestId("project-path").fill(root);
  const connected = page.waitForResponse((r) => r.url().includes("/project/connect"));
  await page.getByTestId("connect").click();
  await connected;
  await page.getByTestId("notice").filter({ hasText: `Connected to ${root}` }).waitFor();
}

/**
 * Run rediscovery and wait for it to SETTLE. Waiting on the report element
 * alone is a trap once a report is already on screen: the assertions would
 * race the merge. Wait on the real route, then on the busy flag clearing.
 */
export async function rediscover(page: Page): Promise<void> {
  // A connected local-repository project surfaces a Repository view where the
  // rediscover control lives.
  await page.getByTestId("nav-repository").click();
  const merged = page.waitForResponse((r) => r.url().includes("/project/rediscover"));
  await page.getByTestId("rediscover").click();
  await merged;
  await page.getByTestId("rediscovery-report").waitFor();
  await page.getByText("rediscovering…").waitFor({ state: "hidden" });
}

/**
 * Bring a temp demo project to BUILD-READY through the real routes: connect,
 * then emit once (readiness requires a produced emit result client-side; the
 * Build view derives it from the live browser emit after connect, so
 * connecting a complete project is sufficient — this helper just waits for
 * the nav to unlock).
 */
export async function connectReady(page: Page, root: string): Promise<void> {
  await connect(page, root);
  await page.getByTestId("nav-build").isEnabled();
}
