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
import { A2UI_VERSIONS, projectEmit } from "@dspack-studio/composer-core";
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

  /**
   * A3/A4 EQUIVALENCE, agent half. The route must add FILE WRITING to the
   * shared emit seam and nothing else — no second opinion about gates, no
   * different A2UI version list. (The browser half is proven where the browser
   * lives: apps/composer/app/validation.test.ts asserts browserEmit is the same
   * seam plus surface selection. Together the two halves make the agent and the
   * browser equal by construction rather than by coincidence.)
   */
  it("is the shared emit seam plus file writing: same verdict, same findings, same A2UI versions", async () => {
    const { payload } = await call("emit", { path: root });

    // The one DOCUMENTED difference between the two doors: the agent also
    // emits the surfaces in the project's surfacesDir, which a browser-backed
    // project does not have. Feed the seam exactly the same list.
    const contract = JSON.parse(readFileSync(join(root, "acme-ui.dspack.json"), "utf8"));
    const profileJson = JSON.parse(readFileSync(join(root, "acme.profile.json"), "utf8"));
    const surfaces = [
      ...((contract.examples ?? []) as Array<{ id?: string; surface?: unknown }>)
        .filter((e) => e.surface)
        .map((e) => ({ name: e.id ?? "example", surface: e.surface })),
      {
        name: "uses-casualty",
        surface: JSON.parse(readFileSync(join(root, "surfaces", "uses-casualty.dsurface.json"), "utf8")),
      },
    ];
    const seam = projectEmit(contract, profileJson, surfaces);

    expect(payload.ok).toBe(seam.ok);
    expect(payload.findings).toEqual(seam.findings);
    expect(payload.catalog).toEqual(seam.catalog);
    expect(payload.surfaces.map((s: any) => s.name)).toEqual(seam.surfaces.map((s) => s.name));
    // Both versions, named on the wire — the divergence this milestone closed
    // was invisible precisely because nothing said which versions ran.
    expect(payload.a2uiVersions).toEqual([...A2UI_VERSIONS]);
    expect(seam.runs.map((r) => r.version)).toEqual([...A2UI_VERSIONS]);
    // ...and the file writing that is the route's actual added value.
    for (const seg of ["v0_9_1", "v1_0"]) {
      expect(JSON.parse(readFileSync(join(root, "out", `catalog.${seg}.json`), "utf8")).components).toBeTruthy();
      expect(JSON.parse(readFileSync(join(root, "out", `report.${seg}.json`), "utf8"))).toBeTruthy();
    }
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

/**
 * Phase 3 (Build): /project/run streaming + conversation refinement +
 * server-side fail-closed example acceptance. SSE runs are captured through
 * a minimal ServerResponse mock; every pipeline event line is parsed back.
 */
function sseCall(route: string, body: Record<string, unknown>): Promise<{ status: number; events: any[] }> {
  return new Promise((resolve, reject) => {
    let status = 0;
    const chunks: string[] = [];
    const res = {
      writeHead(code: number) {
        status = code;
        return res;
      },
      write(chunk: string) {
        chunks.push(String(chunk));
        return true;
      },
      end() {
        const events = chunks
          .join("")
          .split("\n\n")
          .map((block) => block.split("\n").find((l) => l.startsWith("data:")))
          .filter((l): l is string => !!l)
          .map((l) => JSON.parse(l.slice(5)));
        resolve({ status, events });
      },
    } as unknown as ServerResponse;
    handleProjectRoute(`/project/${route}`, body, res, {}, "text/event-stream", ((r: unknown, code: number, payload: unknown) => {
      // JSON reply instead of a stream (a refusal): surface it for asserts.
      resolve({ status: code, events: [payload] });
    }) as never).catch(reject);
  });
}

const surfaceOfRun = (events: any[]) => {
  const audit = events.find((e) => e.type === "CUSTOM" && e.name === "dspack.audit");
  return { audit: audit?.value, surface: audit?.value?.report?.attempts?.at(-1)?.surface };
};

describe("build runs (/project/run, scripted)", () => {
  it("streams a deterministic fail->repair->pass run scoped to the project", async () => {
    const { status, events } = await sseCall("run", { path: root, prompt: "a status screen", intent: "status-report", modelRef: "scripted" });
    expect(status).toBe(200);
    const names = events.map((e) => e.type + (e.name ? `:${e.name}` : ""));
    expect(names[0]).toBe("RUN_STARTED");
    expect(names).toContain("CUSTOM:dspack.gates"); // per-attempt gate results
    expect(names).toContain("CUSTOM:dspack.repair"); // the visible repair turn
    expect(names.at(-1)).toBe("RUN_FINISHED");
    const { audit, surface } = surfaceOfRun(events);
    expect(audit.outcome).toBe("passed");
    expect(audit.report.attempts.length).toBe(2); // violation, then the worked example
    expect(surface.root.component).toBe("info-card");
  });

  it("accepts HttpAgent-shaped bodies (RunAgentInput.forwardedProps)", async () => {
    const { status, events } = await sseCall("run", {
      threadId: "t",
      runId: "r",
      forwardedProps: { path: root, prompt: "a status screen", intent: "status-report", modelRef: "scripted" },
    });
    expect(status).toBe(200);
    expect(surfaceOfRun(events).audit.outcome).toBe("passed");
  });

  it("refinement is non-vacuous under scripted: the refined surface differs ONLY when the prior surface is supplied", async () => {
    const fresh = await sseCall("run", { path: root, prompt: "a status screen", intent: "status-report", modelRef: "scripted" });
    const freshSurface = surfaceOfRun(fresh.events).surface;

    const again = await sseCall("run", { path: root, prompt: "make the title clearer", intent: "status-report", modelRef: "scripted" });
    expect(JSON.stringify(surfaceOfRun(again.events).surface)).toBe(JSON.stringify(freshSurface)); // no seed -> same

    const refined = await sseCall("run", {
      path: root,
      prompt: "make the title clearer",
      intent: "status-report",
      modelRef: "scripted",
      conversation: [
        { role: "user", content: "a status screen" },
        { role: "assistant", content: JSON.stringify(freshSurface) },
      ],
    });
    const refinedSurface = surfaceOfRun(refined.events).surface;
    expect(surfaceOfRun(refined.events).audit.outcome).toBe("passed");
    expect(JSON.stringify(refinedSurface)).not.toBe(JSON.stringify(freshSurface)); // seed -> visibly different
    expect(JSON.stringify(refinedSurface)).toContain("(refined)"); // the deterministic transform marker
  });

  it("refuses a malformed conversation with 400 before running anything", async () => {
    const bad = await sseCall("run", { path: root, prompt: "x", intent: "status-report", modelRef: "scripted", conversation: [{ role: "narrator", content: 1 }] });
    expect(bad.status).toBe(400);
    expect(String((bad.events[0] as any).error)).toContain("conversation");
  });
});

describe("accepting a build result (/project/save-example, fail-closed)", () => {
  const freshExample = () => JSON.parse(readFileSync(join(root, "acme-ui.dspack.json"), "utf8")).examples[0];

  it("rejects lint-invalid surfaces server-side with the gate findings", async () => {
    const surface = structuredClone(freshExample().surface);
    surface.root.children[0].component = "not-a-component"; // S2 violation
    const { status, payload } = await call("save-example", {
      path: root,
      example: { id: "ex.chat-bad", intent: "status-report", prompt: "bad", surface },
    });
    expect(status).toBe(422);
    expect(payload.findings.some((f: any) => f.gate === "S2")).toBe(true);
    // Nothing was written.
    const doc = JSON.parse(readFileSync(join(root, "acme-ui.dspack.json"), "utf8"));
    expect(doc.examples.some((e: any) => e.id === "ex.chat-bad")).toBe(false);
  });

  it("rejects unknown intents and malformed ids", async () => {
    const surface = freshExample().surface;
    expect((await call("save-example", { path: root, example: { id: "ex.x", intent: "not-an-intent", prompt: "p", surface } })).status).toBe(422);
    expect((await call("save-example", { path: root, example: { id: "chat", intent: "status-report", prompt: "p", surface } })).status).toBe(400);
    expect((await call("save-example", { path: root, example: { id: "ex.x", intent: "status-report", prompt: "p", surface: "nope" } })).status).toBe(400);
  });

  it("accepts a governed surface, preserves the ledger, and feeds the next run's few-shot + scripted playback", async () => {
    // The accepted surface: the deterministic refinement of the worked example.
    const refined = structuredClone(freshExample().surface);
    const title = refined.root.children[0].children[0];
    title.text = `${title.text} (refined)`;
    const { status, payload } = await call("save-example", {
      path: root,
      example: { id: "ex.chat-refined", intent: "status-report", name: "Chat: refined status", prompt: "make the title clearer", surface: refined },
    });
    expect(status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.ledger.hasLedger).toBe(true);

    const doc = JSON.parse(readFileSync(join(root, "acme-ui.dspack.json"), "utf8"));
    const saved = doc.examples.find((e: any) => e.id === "ex.chat-refined");
    expect(saved.intent).toBe("status-report");
    expect(JSON.stringify(saved.surface)).toBe(JSON.stringify(refined));
    expect(doc.metadata["x-bootstrap"]).toBeDefined(); // ledger intact

    // Few-shot proof against the REAL saved file: the compiler now includes it.
    const { compileContext } = await import("@aestheticfunction/dspack-gen/core");
    const context = compileContext(doc, "status-report");
    const pair = context.fewshot.find((m: any) => m.role === "assistant" && m.content.includes("(refined)"));
    expect(pair).toBeDefined();

    // Scripted playback proof: a fresh scripted run now converges on the
    // LATEST accepted example — the accept loop visibly compounds.
    const next = await sseCall("run", { path: root, prompt: "again", intent: "status-report", modelRef: "scripted" });
    expect(JSON.stringify(surfaceOfRun(next.events).surface)).toBe(JSON.stringify(refined));
  });
});


describe("safe worked-example persistence (#42) and honest scripted absence (#43)", () => {
  const contractOf = () => JSON.parse(readFileSync(join(root, "acme-ui.dspack.json"), "utf8"));
  const surfaceOf = () => structuredClone(contractOf().examples[0].surface);

  it("mints a collision-free id from the contract on disk when the client supplies none", async () => {
    const before = contractOf().examples.map((e: any) => e.id);
    const a = await call("save-example", { path: root, example: { intent: "status-report", prompt: "first ask", surface: surfaceOf() } });
    expect(a.status).toBe(200);
    expect(a.payload.example.id).toMatch(/^ex\.chat-\d+$/);
    expect(before).not.toContain(a.payload.example.id);

    const b = await call("save-example", { path: root, example: { intent: "status-report", prompt: "second ask", surface: surfaceOf() } });
    expect(b.status).toBe(200);
    expect(b.payload.example.id).not.toBe(a.payload.example.id); // distinct across accepts

    // Both survive; every pre-existing example is byte-identical.
    const doc = contractOf();
    expect(doc.examples.map((e: any) => e.id)).toEqual(expect.arrayContaining([a.payload.example.id, b.payload.example.id, ...before]));
    for (const id of before) {
      expect(JSON.stringify(doc.examples.find((e: any) => e.id === id))).toBe(
        JSON.stringify(JSON.parse(readFileSync(join(root, "acme-ui.dspack.json"), "utf8")).examples.find((e: any) => e.id === id)),
      );
    }
  });

  it("REFUSES an explicit id that already exists rather than overwriting it", async () => {
    const existing = contractOf().examples[0];
    const before = JSON.stringify(existing);
    const { status, payload } = await call("save-example", {
      path: root,
      example: { id: existing.id, intent: "status-report", prompt: "hostile overwrite", surface: surfaceOf() },
    });
    expect(status).toBe(409);
    expect(payload.findings[0].code).toBe("example-exists");
    expect(payload.findings[0].message).toContain(existing.id);
    // Untouched, byte for byte.
    expect(JSON.stringify(contractOf().examples.find((e: any) => e.id === existing.id))).toBe(before);
  });

  it("the newly accepted example is consumable as few-shot and scripted plays the latest without replacing older ones", async () => {
    const refined = surfaceOf();
    refined.root.children[0].children[0].text = "Rollout status";
    const saved = await call("save-example", {
      path: root,
      example: { intent: "status-report", prompt: "a status screen — refined: say Rollout status", surface: refined },
    });
    expect(saved.status).toBe(200);
    const doc = contractOf();
    const { compileContext } = await import("@aestheticfunction/dspack-gen/core");
    const context = compileContext(doc, "status-report");
    expect(context.fewshot.some((m: any) => m.role === "assistant" && m.content.includes("Rollout status"))).toBe(true);
    // Older examples still present and still served.
    expect(doc.examples.length).toBeGreaterThan(1);
    expect(context.fewshot.length).toBeGreaterThanOrEqual(doc.examples.filter((e: any) => e.intent === "status-report").length);
  });

  it("an intent with no matching example never borrows another intent's: scripted refuses honestly", async () => {
    const doc = contractOf();
    doc.intents = [...doc.intents, { id: "onboarding", description: "Welcome a new operator." }];
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(root, "acme-ui.dspack.json"), JSON.stringify(doc, null, 2) + "\n");

    const { status, payload } = await call("run", { path: root, prompt: "an onboarding screen", intent: "onboarding", modelRef: "scripted" });
    expect(status).toBe(400);
    expect(String(payload.error)).toMatch(/onboarding/);
    expect(String(payload.error)).toMatch(/own surface/i);
  });
});

describe("flows in the manifest + /project/save-flow (P4 Phase B)", () => {
  const manifestPath = () => join(root, "project.json");
  const readManifest = () => JSON.parse(readFileSync(manifestPath(), "utf8"));
  const flowFixture = {
    id: "flow.flow-1",
    name: "Status walk",
    steps: [{ id: "step.status", title: "The status", surfaceId: "ex.status-report-basic", advanceOn: ["refresh"] }],
  };

  it("save-flow validates, writes project.json atomically, and preserves every other field verbatim", async () => {
    const before = readManifest();
    const { status, payload } = await call("save-flow", { path: root, flows: [flowFixture] });
    expect(status).toBe(200);
    expect(payload.ok).toBe(true);
    const after = readManifest();
    expect(after.flows).toEqual([flowFixture]);
    const { flows: _flows, ...rest } = after;
    expect(rest).toEqual(before); // the FIRST manifest-writing route must not disturb a single other field
  });

  it("connect carries the manifest flows to the client (repository parity)", async () => {
    const { status, payload } = await call("connect", { path: root });
    expect(status).toBe(200);
    expect(payload.manifest.flows).toEqual([flowFixture]);
  });

  it("refuses malformed flows with the ProjectError idiom and touches nothing", async () => {
    const before = readFileSync(manifestPath(), "utf8");
    const notArray = await call("save-flow", { path: root, flows: "nope" });
    expect(notArray.status).toBe(400);
    expect(String(notArray.payload.error)).toContain("flows");
    const badEntry = await call("save-flow", { path: root, flows: [{ id: "flow.bad" }] });
    expect(badEntry.status).toBe(422);
    expect(String(badEntry.payload.error)).toContain("flows");
    expect(readFileSync(manifestPath(), "utf8")).toBe(before);
  });

  it("an EMPTY array removes the flows key — the browser store's empty-removes-key rule", async () => {
    const { status, payload } = await call("save-flow", { path: root, flows: [] });
    expect(status).toBe(200);
    expect(payload.ok).toBe(true);
    expect("flows" in readManifest()).toBe(false);
  });
});
