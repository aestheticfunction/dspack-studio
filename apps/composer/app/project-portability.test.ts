import { describe, expect, it } from "vitest";
import { PROJECT_EXPORT_VERSION, buildProjectExport, parseProjectImport } from "./project-portability";
import type { ProjectVocab } from "./projects";
import shadcnContract from "../shadcn-v3-project/shadcn-ui.dspack.json";
import shadcnProfile from "../shadcn-v3-project/shadcn-v3.profile.json";

/**
 * P4 Phase A — flows travel in the project file (fail-first).
 *
 * F6 (ratified): the export version STAYS "0.1" and `flows` is an additive
 * optional top-level field. The measured compat behavior this rests on:
 * current builds pass-but-drop unknown top-level fields, so a flows-bearing
 * file imports cleanly (minus flows) into stale builds, while THIS build
 * round-trips them — and, per the profile-gate precedent, a flows field that
 * is PRESENT but malformed fails the import closed with a plain reason.
 */

const vocab: ProjectVocab = {
  contract: shadcnContract as unknown as Record<string, unknown>,
  profile: shadcnProfile as unknown as Record<string, unknown>,
  previewRegistry: "shadcn",
};

const flow = {
  id: "flow.flow-1",
  name: "Order walkthrough",
  description: "Review the order, then confirm the deletion.",
  steps: [
    { id: "step.review-the-order", title: "Review the order", surfaceId: "ex.order-detail-summary", advanceOn: ["download_invoice"] },
    { id: "step.delete-the-account", title: "Delete the account", surfaceId: "ex.delete-account-confirmation", terminal: true },
  ],
};

const baseInput = { name: "Portable", description: "d", vocab, exportedAt: "2026-08-11T00:00:00.000Z" };

describe("project export — optional flows field on version 0.1 (F6)", () => {
  it("writes flows when the project has them, on the SAME export version", () => {
    const exp = buildProjectExport({ ...baseInput, flows: [flow] } as never);
    expect((exp as unknown as Record<string, unknown>).flows).toEqual([flow]);
    expect(exp.composerProjectExport).toBe(PROJECT_EXPORT_VERSION);
    expect(PROJECT_EXPORT_VERSION).toBe("0.1");
  });

  it("omits the flows field entirely when there are none (absent, not [])", () => {
    expect("flows" in buildProjectExport(baseInput)).toBe(false);
    expect("flows" in buildProjectExport({ ...baseInput, flows: [] } as never)).toBe(false);
  });
});

describe("project import — flows round-trip, absent means [], malformed fails closed", () => {
  it("round-trips flows through export text → parse", () => {
    const text = JSON.stringify({ ...buildProjectExport(baseInput), flows: [flow] });
    const result = parseProjectImport(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result as unknown as { flows: unknown }).flows).toEqual([flow]);
  });

  it("an absent flows field imports as [] (stale exports stay importable)", () => {
    const result = parseProjectImport(JSON.stringify(buildProjectExport(baseInput)));
    expect(result.ok).toBe(true);
    if (result.ok) expect((result as unknown as { flows: unknown }).flows).toEqual([]);
  });

  it("a PRESENT but non-array flows field rejects the import with a plain reason", () => {
    const result = parseProjectImport(JSON.stringify({ ...buildProjectExport(baseInput), flows: "three of them" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain("flow");
  });

  it("a flow entry missing required fields rejects the import (fail-closed, like the profile gate)", () => {
    for (const bad of [
      [{ id: "flow.x" }], // no name, no steps
      [{ id: "flow.x", name: "X", steps: [{ id: "step.a", title: "A" }] }], // step without surfaceId
      [{ id: "flow.x", name: "X", steps: [{ id: "step.a", title: "A", surfaceId: "ex.a", on: [{ event: "e" }] }] }], // malformed reserved `on`
      [{ id: "flow.x", name: "X", steps: [{ id: "step.a", title: "A", surfaceId: "ex.a", advanceOn: "confirm" }] }], // advanceOn not an array
    ]) {
      const result = parseProjectImport(JSON.stringify({ ...buildProjectExport(baseInput), flows: bad }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.toLowerCase()).toContain("flow");
    }
  });

  it("the version gate is unchanged: a foreign version still rejects outright", () => {
    const result = parseProjectImport(JSON.stringify({ ...buildProjectExport(baseInput), composerProjectExport: "9.9" }));
    expect(result.ok).toBe(false);
  });
});
