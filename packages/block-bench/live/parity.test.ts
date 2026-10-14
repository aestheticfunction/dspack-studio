/**
 * Parity reads every string a surface shows (live/parity.ts): its text nodes, its string props and the strings an
 * array holds, such as an Astryx table's column labels and row cells, under the same rule for every arm and
 * condition. Parity is reported beside the ADR-B3 decision and never in it.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runCell } from "./arms";
import { promptsFor, readCorpus, type Corpus } from "./corpus";
import { checkParity, surfaceTexts } from "./parity";
import { createScriptedProvider } from "./providers/scripted";
import { loadReference, type LoadedReference } from "./references";
import { ARMS, CONDITIONS, type Arm, type Condition, type PriorResult } from "./types";

/** An Astryx table as Stage 3's rt-01 surfaces built it: its column labels and row cells are strings in arrays. */
const astryxTable = {
  dspackSurface: "0.1",
  system: "Astryx",
  intent: "record-collection",
  root: {
    component: "card",
    id: "records-card",
    children: [
      { component: "text", id: "records-title", props: { type: "display-3" }, text: "Open Support Tickets" },
      { component: "table", id: "records-table", props: { columns: ["Ticket ID", "Subject", "Status", "Priority"], data: [{ cells: ["TKT-2847", "Login failing", "In Progress", "High"] }], density: "compact" } },
    ],
  },
};

describe("parity reads every string a surface shows", () => {
  it("reads an Astryx table's column labels and row cells, which it keeps as strings in arrays", () => {
    expect(checkParity(astryxTable, { labels: ["status", "priority", "in progress"], components: ["table"] })).toEqual({
      score: 1,
      satisfied: ["label:status", "label:priority", "label:in progress", "component:table"],
      missing: [],
    });
  });

  it("reads strings in nested arrays, and strings beside objects in a mixed array", () => {
    const surface = { root: { component: "list", id: "l", props: { rows: [["Overdue", "High"], ["Open", "Low"]], items: ["Escalated", { label: "Archived" }] } } };
    expect(surfaceTexts(surface)).toEqual(expect.arrayContaining(["Overdue", "High", "Open", "Low", "Escalated", "Archived"]));
  });

  it("still reads nothing under the keys that name structure rather than content, arrays included", () => {
    const surface = { root: { component: "table", id: "priority-table", props: { columns: ["Ticket"] }, children: [{ component: "text", id: ["status-cell"], intent: ["status"] }] } };
    expect(checkParity(surface, { labels: ["priority", "status"], components: [] })).toEqual({ score: 0, satisfied: [], missing: ["label:priority", "label:status"] });
  });

  it("reads a shadcn table's header labels, which are text nodes, as it always did", () => {
    const head = (text: string) => ({ component: "table-head", text });
    const surface = { root: { component: "table", children: [{ component: "table-header", children: [{ component: "table-row", children: [head("Status"), head("Priority")] }] }] } };
    expect(checkParity(surface, { labels: ["status", "priority"], components: ["table"] })).toEqual({ score: 1, satisfied: ["label:status", "label:priority", "component:table"], missing: [] });
  });
});

describe("the same reading scores every arm and every condition", () => {
  let corpus: Corpus;
  let astryx: LoadedReference;
  beforeAll(async () => {
    corpus = readCorpus();
    astryx = await loadReference("astryx");
  }, 60_000);
  afterEach(() => vi.unstubAllGlobals());

  it("rt-01 on Astryx: every arm's table lists Status and Priority, and every passing cell's parity counts both, fresh and refined", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("no network in the dry run"))));
    const prompt = promptsFor(corpus, "astryx").find((p) => p.id === "rt-01")!;
    const run = (arm: Arm, condition: Condition, prior?: PriorResult) =>
      runCell({ reference: astryx, provider: createScriptedProvider({ faults: false }), arm, condition, prompt, corpus, ...(prior ? { prior } : {}), clock: () => "2026-10-14T00:00:00.000Z" });
    const freshScores = new Set<number>();
    let checked = 0;
    for (const arm of ARMS) {
      const fresh = await run(arm, "fresh");
      freshScores.add(fresh.record.parity!.score);
      for (const condition of CONDITIONS) {
        const { record } = condition === "fresh" ? fresh : await run(arm, condition, fresh.prior);
        if (!record.passed) continue;
        checked += 1;
        expect(record.parity?.satisfied, `${arm} ${condition}`).toEqual(expect.arrayContaining(["label:status", "label:priority", "component:table"]));
      }
    }
    // Every arm's fresh table carries the same columns, so every arm's fresh parity is the same, and complete.
    expect([...freshScores]).toEqual([1]);
    expect(checked).toBeGreaterThanOrEqual(ARMS.length * 2);
  }, 120_000);
});
