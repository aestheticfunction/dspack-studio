/**
 * Composer project routes, exercised against a temp copy of the shipped demo
 * project (apps/composer/demo-project — a REAL non-canonical contract
 * bootstrapped by dspack-export and human-enriched, with a JSON profile).
 *
 * The routes are thin orchestration over published packages; these tests pin
 * the orchestration: connect reports the ledger states, emit runs the real
 * gates and reports the casualty surface's refusal as a finding, validate
 * distinguishes contract vocabulary (mini-stepper IS in the contract, S2
 * passes) from profile casualties (emit refuses it), and save enforces
 * ledger preservation.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { handleProjectRoute } from "./project.js";

const demoProject = fileURLToPath(new URL("../../composer/demo-project", import.meta.url));

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "composer-project-"));
  cpSync(demoProject, root, { recursive: true });
});

type Reply = { status: number; payload: any };

async function call(route: string, body: Record<string, unknown>): Promise<Reply> {
  let reply: Reply | undefined;
  const json = (_res: unknown, status: number, payload: unknown) => {
    reply = { status, payload };
  };
  const handled = await handleProjectRoute(
    `/project/${route}`,
    body,
    {} as ServerResponse,
    {},
    undefined,
    json as never,
  );
  expect(handled).toBe(true);
  expect(reply, `route '${route}' must reply`).toBeDefined();
  return reply!;
}

describe("connect", () => {
  it("returns manifest, ledger states, and the surface inventory", async () => {
    const { status, payload } = await call("connect", { path: root });
    expect(status).toBe(200);
    expect(payload.manifest.name).toBe("Acme UI");
    const byName = Object.fromEntries(payload.ledger.sections.map((s: any) => [s.section, s.state]));
    expect(byName.components).toBe("human-owned"); // enriched after bootstrap
    expect(byName.tokens).toBe("tool-owned");
    expect(byName.rules).toBe("human-authored");
    expect(payload.extraSurfaces.map((s: any) => s.name)).toEqual(["uses-casualty"]);
    expect(payload.extraSurfaces[0].surface.dspackSurface).toBe("0.1");
    expect(payload.profileIssue).toBeNull();
  });

  it("refuses a relative path and a directory without project.json", async () => {
    expect((await call("connect", { path: "relative/nope" })).status).toBe(400);
    expect((await call("connect", { path: tmpdir() })).status).toBe(404);
  });
});

describe("emit", () => {
  it("runs the real gates, writes out/, and reports the casualty refusal as a finding", async () => {
    const { status, payload } = await call("emit", { path: root });
    expect(status).toBe(200);
    expect(Object.keys(payload.catalog.components)).toEqual(["Button", "Card", "Badge", "TextField", "Text", "Column"]);
    // The good example emits; the casualty surface refuses with the authored reason.
    const casualty = payload.findings.find((f: any) => f.gate === "A3" && f.code === "emit-surface");
    expect(casualty.target).toBe("uses-casualty");
    expect(casualty.message).toContain("declared casualty");
    expect(casualty.message).toContain("dropdown-menu casualty".split(" ")[0] === "dropdown-menu" ? "steps" : "steps");
    // Catalogs + reports land in out/.
    const catalog = JSON.parse(readFileSync(join(root, "out", "catalog.v0_9_1.json"), "utf8"));
    expect(catalog.catalogId).toContain("https://acme.example/catalogs/acme-ui");
    // ok is false because one surface refused? No: ok reflects catalog gates.
    expect(payload.ok).toBe(true);
  });
});

describe("validate", () => {
  it("passes the contract harness and distinguishes vocabulary from profile casualties", async () => {
    const { status, payload } = await call("validate", { path: root });
    expect(status).toBe(200);
    // mini-stepper IS contract vocabulary: S2 passes for the casualty surface;
    // its refusal is emit-time (profile), not lint-time (contract).
    expect(payload.findings.filter((f: any) => f.gate === "document")).toEqual([]);
    expect(payload.findings.filter((f: any) => f.severity === "error")).toEqual([]);
    expect(payload.ok).toBe(true);
  });
});

describe("rediscover", () => {
  it("merges a real source change at ledger granularity: adds the new component, preserves enrichment", async () => {
    // A genuinely new component appears in source after enrichment.
    const { writeFileSync } = await import("node:fs");
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
      ].join("\n"),
    );
    const { status, payload } = await call("rediscover", { path: root });
    expect(status).toBe(200);
    expect(payload.report.components.added).toContain("spark-line");
    // The demo project ships a v1 ledger: this first rediscovery migrates it
    // (human-owned components section -> entries unattributed, byte-identical
    // ones re-adopted as tool-owned).
    expect(payload.report.migration).toBe("human-owned");
    expect(payload.contract.metadata["x-bootstrap"].ledger).toBe("2");
    // Human-owned entries preserved verbatim: enrichment survives the merge.
    expect(payload.contract.components["action-button"].props.label.required).toBe(true);
    expect(payload.contract.components["action-button"].whenToUse).toBeTruthy();
    // Governance carried over verbatim.
    expect(payload.contract.rules.length).toBeGreaterThan(0);
    // Section state derives from entries under v2: enrichment keeps it human-owned.
    const byName = Object.fromEntries(payload.ledger.sections.map((s: any) => [s.section, s.state]));
    expect(byName.components).toBe("human-owned");
    // The ledger now reports entry-level states to the composer.
    expect(payload.ledger.entryLevel).toBe(true);
    const entries = Object.fromEntries(payload.ledger.componentEntries.map((e: any) => [e.id, e.state]));
    expect(entries["spark-line"]).toBe("tool-owned"); // newly added, tool-owned
    expect(["human-owned", "unattributed"]).toContain(entries["action-button"]); // enriched, yours
  });

  it("skip-and-ask: a hand-deleted entry is never silently restored; tombstoning ends the asking", async () => {
    const { writeFileSync } = await import("node:fs");
    // Hand-delete spark-line from the document (the ledger hash remains).
    const contract = JSON.parse(readFileSync(join(root, "acme-ui.dspack.json"), "utf8"));
    delete contract.components["spark-line"];
    writeFileSync(join(root, "acme-ui.dspack.json"), JSON.stringify(contract, null, 2) + "\n");

    // Rediscovery: the source still has spark-line, but restoration is skipped.
    const first = await call("rediscover", { path: root });
    expect(first.status).toBe(200);
    expect(first.payload.contract.components["spark-line"]).toBeUndefined();
    expect(first.payload.report.components.deletedAwaitingDecision).toContain("spark-line");
    const orphan = first.payload.ledger.componentEntries.find((e: any) => e.id === "spark-line");
    expect(orphan.state).toBe("orphaned"); // deletion memory survives the merge

    // Decide: tombstone it (what the composer's "Never rediscover" button saves).
    const decided = structuredClone(first.payload.contract);
    decided.metadata["x-bootstrap"].doNotRediscover = ["spark-line"];
    delete decided.metadata["x-bootstrap"].components["spark-line"];
    const saved = await call("save", { path: root, kind: "contract", document: decided });
    expect(saved.payload.ok).toBe(true);

    // Rediscovery now skips it unambiguously, and keeps skipping it.
    const second = await call("rediscover", { path: root });
    expect(second.status).toBe(200);
    expect(second.payload.report.components.suppressed).toContain("spark-line");
    expect(second.payload.report.components.deletedAwaitingDecision).not.toContain("spark-line");
    expect(second.payload.contract.components["spark-line"]).toBeUndefined();
    expect(second.payload.ledger.componentEntries.find((e: any) => e.id === "spark-line").state).toBe("tombstoned");
  });
});

describe("save", () => {
  it("refuses dropping the bootstrap ledger", async () => {
    const contract = JSON.parse(readFileSync(join(root, "acme-ui.dspack.json"), "utf8"));
    const stripped = structuredClone(contract);
    delete stripped.metadata["x-bootstrap"];
    const { payload } = await call("save", { path: root, kind: "contract", document: stripped });
    expect(payload.ok).toBe(false);
    expect(payload.findings[0].code).toBe("ledger-dropped");
  });

  it("accepts a harness-valid contract edit and reports the new ledger state", async () => {
    const contract = JSON.parse(readFileSync(join(root, "acme-ui.dspack.json"), "utf8"));
    contract.components["tag-pill"].whenNotToUse = "Long prose; TagPill is for two-word states.";
    const { payload } = await call("save", { path: root, kind: "contract", document: contract });
    expect(payload.ok).toBe(true);
    const persisted = JSON.parse(readFileSync(join(root, "acme-ui.dspack.json"), "utf8"));
    expect(persisted.components["tag-pill"].whenNotToUse).toContain("two-word");
  });

  it("refuses a schema-invalid profile with pathed findings", async () => {
    const profile = JSON.parse(readFileSync(join(root, "acme.profile.json"), "utf8"));
    profile.components[0].propMap.tone.kind = "vibes";
    const { payload } = await call("save", { path: root, kind: "profile", document: profile });
    expect(payload.ok).toBe(false);
    expect(payload.findings[0].path ?? payload.findings[0].target).toContain("propMap");
  });
});
