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
    // #30: the refusal is an AUTHORED decision — classified structurally from
    // the profile's casualty declaration, with severity/code/message intact.
    expect(casualty.severity).toBe("error");
    expect(casualty.acknowledged).toEqual({
      componentId: "mini-stepper",
      class: "cannot-represent",
      reason: expect.stringContaining("steps is an array prop"),
    });
    // Catalogs + reports land in out/.
    const catalog = JSON.parse(readFileSync(join(root, "out", "catalog.v0_9_1.json"), "utf8"));
    expect(catalog.catalogId).toContain("https://acme.example/catalogs/acme-ui");
    // ok is false because one surface refused? No: ok reflects catalog gates.
    expect(payload.ok).toBe(true);
  });
});

describe("acknowledged casualties (#30)", () => {
  it("stops acknowledging when the authored reason is removed, without touching other findings", async () => {
    const { writeFileSync } = await import("node:fs");
    const path = join(root, "acme.profile.json");
    const original = readFileSync(path, "utf8");
    const profile = JSON.parse(original);
    profile.casualtyComponents[0].reason = "   ";
    writeFileSync(path, JSON.stringify(profile, null, 2));
    try {
      const { payload } = await call("emit", { path: root });
      const refusal = payload.findings.find((f: any) => f.code === "emit-surface");
      // Either the profile refuses to load (its own contract), or the refusal
      // stands unacknowledged. Never acknowledged without a written reason.
      if (refusal) expect(refusal.acknowledged).toBeUndefined();
      else expect(payload.findings.some((f: any) => f.gate === "profile")).toBe(true);
    } finally {
      writeFileSync(path, original);
    }
  });

  it("never acknowledges a refusal caused by an unknown component", async () => {
    const { writeFileSync, rmSync } = await import("node:fs");
    const surface = join(root, "surfaces", "unknown-component.dsurface.json");
    writeFileSync(
      surface,
      JSON.stringify(
        { dspackSurface: "0.1", system: "Acme UI", intent: "unknown-probe", root: { component: "not-a-component" } },
        null,
        2,
      ),
    );
    try {
      const { payload } = await call("emit", { path: root });
      const refusal = payload.findings.find((f: any) => f.code === "emit-surface" && f.target === "unknown-component");
      expect(refusal).toBeDefined();
      expect(refusal.acknowledged).toBeUndefined();
      // The demo's genuine casualty is still acknowledged alongside it.
      const casualty = payload.findings.find((f: any) => f.code === "emit-surface" && f.target === "uses-casualty");
      expect(casualty.acknowledged).toBeDefined();
    } finally {
      rmSync(surface, { force: true });
    }
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
    // The demo project ships a v1 ledger: this first rediscovery migrates it
    // (human-owned components section -> entries unattributed, byte-identical
    // ones re-adopted as tool-owned). Migration cannot distinguish
    // "hand-deleted" from "new since the snapshot", so the fresh-only id
    // ASKS instead of silently adding.
    expect(payload.report.migration).toBe("human-owned");
    expect(payload.contract.metadata["x-bootstrap"].ledger).toBe("2");
    expect(payload.report.components.added).toEqual([]);
    expect(payload.report.components.deletedAwaitingDecision).toContain("spark-line");
    expect(payload.contract.components["spark-line"]).toBeUndefined();
    // Human-owned entries preserved verbatim: enrichment survives the merge.
    expect(payload.contract.components["action-button"].props.label.required).toBe(true);
    expect(payload.contract.components["action-button"].whenToUse).toBeTruthy();
    // Governance carried over verbatim.
    expect(payload.contract.rules.length).toBeGreaterThan(0);
    // Section state derives from entries under v2: enrichment keeps it human-owned.
    const byName = Object.fromEntries(payload.ledger.sections.map((s: any) => [s.section, s.state]));
    expect(byName.components).toBe("human-owned");
    expect(payload.ledger.entryLevel).toBe(true);
    // Restoring the genuinely-new component is one explicit decision.
    const restored = await call("rediscover", { path: root, restoreTopLevel: ["spark-line"] });
    expect(restored.status).toBe(200);
    expect(restored.payload.report.components.restoredTopLevel).toEqual([{ id: "spark-line" }]);
    expect(restored.payload.contract.components["spark-line"]).toBeDefined();
    const entries = Object.fromEntries(restored.payload.ledger.componentEntries.map((e: any) => [e.id, e.state]));
    expect(entries["spark-line"]).toBe("tool-owned"); // restored tool-owned
    expect(["human-owned", "unattributed"]).toContain(entries["action-button"]); // enriched, yours
  });

  it("refuses a malformed restoreTopLevel with 400 before touching the project", async () => {
    const bad = await call("rediscover", { path: root, restoreTopLevel: [42] });
    expect(bad.status).toBe(400);
    expect(bad.payload.error).toContain("array of component id strings");
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

  it("restoredConflict: authored sub-component blocks re-add until the explicit restore-top-level intent", async () => {
    // Undo the tombstone and author spark-line as a sub-component of
    // action-button (the #13 restructure shape, through the real routes).
    const contract = JSON.parse(readFileSync(join(root, "acme-ui.dspack.json"), "utf8"));
    contract.metadata["x-bootstrap"].doNotRediscover = [];
    contract.components["action-button"].composition = {
      subComponents: [{ id: "spark-line", name: "SparkLine", description: "Inline trend inside the button." }],
    };
    const saved = await call("save", { path: root, kind: "contract", document: contract });
    expect(saved.payload.ok).toBe(true);

    // Outcome 3 first (leave unresolved): reported, never re-added.
    const unresolved = await call("rediscover", { path: root });
    expect(unresolved.status).toBe(200);
    // The shipped demo project carries its own #13-shaped conflicts
    // (info-card sub-vocabulary discovered top-level in source), so assert
    // on spark-line specifically rather than the whole list.
    expect(unresolved.payload.report.components.restoredConflict).toContainEqual({ id: "spark-line", parent: "action-button" });
    expect(unresolved.payload.contract.components["spark-line"]).toBeUndefined();

    // A contradictory intent refuses with the tool's words (nothing partial).
    const contradicted = await call("rediscover", { path: root, restoreTopLevel: ["not-in-source"] });
    expect(contradicted.status).toBe(409);
    expect(contradicted.payload.error).toContain("not-in-source");

    // Outcome 2: the explicit intent restores tool-owned, nested preserved.
    const restored = await call("rediscover", { path: root, restoreTopLevel: ["spark-line"] });
    expect(restored.status).toBe(200);
    expect(restored.payload.report.components.restoredTopLevel).toEqual([{ id: "spark-line", parent: "action-button" }]);
    expect(restored.payload.report.components.restoredConflict.map((x: any) => x.id)).not.toContain("spark-line");
    expect(restored.payload.contract.components["spark-line"]).toBeDefined();
    expect(restored.payload.contract.components["action-button"].composition.subComponents[0].id).toBe("spark-line");
    expect(restored.payload.ledger.componentEntries.find((e: any) => e.id === "spark-line").state).toBe("tool-owned");

    // Subsequent runs treat it as ordinary tool-owned; the conflict is gone.
    const after = await call("rediscover", { path: root });
    expect(after.payload.report.components.restoredConflict.map((x: any) => x.id)).not.toContain("spark-line");
    expect(after.payload.report.components.unchanged).toContain("spark-line");
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
